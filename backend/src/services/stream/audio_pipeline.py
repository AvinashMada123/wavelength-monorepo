"""AudioChunk dataclass, recording, resampling, and sender worker."""
import asyncio
import base64
import json
import queue
import struct
import time
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from loguru import logger

from src.core.config import config


# Recording directory
RECORDINGS_DIR = Path(__file__).parent.parent.parent / "recordings"
RECORDINGS_DIR.mkdir(exist_ok=True)


@dataclass
class AudioChunk:
    """Audio chunk flowing through the queue pipeline"""
    audio_b64: str        # Base64-encoded audio data
    turn_id: int          # Gemini turn counter (for cancellation)
    sample_rate: int = 24000


class AudioPipeline:
    """Handles audio recording, resampling, sending, and inbound audio processing."""

    def __init__(self, state, log):
        self.state = state
        self.log = log

    def _record_audio(self, role: str, audio_bytes: bytes, sample_rate: int = 16000):
        """Record audio chunk for post-call recording (non-blocking, sample-counter based).
        USER audio increments the sample counter; AI audio is tagged with current counter value."""
        s = self.state
        if not s.recording_enabled or not s._recording_queue or not s._rec_started:
            return
        try:
            user_pos = s._rec_user_sample_count
            s._recording_queue.put_nowait((role, audio_bytes, sample_rate, user_pos))
            # Increment sample counter for USER audio (16-bit = 2 bytes per sample)
            if role == "USER":
                s._rec_user_sample_count += len(audio_bytes) // 2
        except queue.Full:
            pass  # Drop frame if queue is full (shouldn't happen)

    def _resample_24k_to_16k(self, audio_bytes: bytes) -> bytes:
        """Resample 24kHz audio to 16kHz using numpy (fast linear interpolation).
        Used in the LIVE audio path — kept simple for low latency."""
        samples_24k = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)
        n_in = len(samples_24k)
        n_out = int(n_in * 2 / 3)
        if n_out == 0:
            return b''
        x_new = np.linspace(0, n_in - 1, n_out, dtype=np.float32)
        samples_16k = np.interp(x_new, np.arange(n_in, dtype=np.float32), samples_24k)
        return np.clip(samples_16k, -32768, 32767).astype(np.int16).tobytes()

    @staticmethod
    def _strip_trailing_silence(samples: np.ndarray, sample_rate: int, pad_seconds: float = 0.5) -> np.ndarray:
        """Remove trailing silence, keeping pad_seconds of buffer."""
        nonzero = np.nonzero(samples)[0]
        if len(nonzero) == 0:
            return samples[:0]
        last_nonzero = nonzero[-1]
        end = min(last_nonzero + int(sample_rate * pad_seconds), len(samples))
        return samples[:end]

    def _save_recording(self):
        """Save stereo recording: AI on left channel, USER on right channel.
        Both tracks are 16kHz (AI recorded at send-time after resampling).
        USER chunks concatenated as continuous stream (master clock).
        AI chunks placed by user_sample_pos with write cursor for sequential burst handling."""
        s = self.state
        total_chunks = len(s._rec_user_chunks) + len(s._rec_ai_events)
        logger.info(f"Saving recording: enabled={s.recording_enabled}, "
                    f"user_chunks={len(s._rec_user_chunks)}, ai_events={len(s._rec_ai_events)}")
        if not s.recording_enabled or total_chunks == 0:
            logger.warning(f"Skipping recording: enabled={s.recording_enabled}, chunks={total_chunks}")
            return None
        try:
            RATE = 16000  # Both tracks are 16kHz
            BPS = 2  # bytes per sample (16-bit PCM)

            # --- Step 1: Build USER track (continuous 16kHz from Plivo) ---
            user_pcm = b''.join(s._rec_user_chunks)
            user_samples = len(user_pcm) // BPS
            user_duration_s = user_samples / RATE
            logger.info(f"USER track: {user_samples} samples = {user_duration_s:.1f}s")

            # --- Step 2: Build AI track (16kHz, placed by user sample position) ---
            # Write cursor ensures burst chunks are sequential, not overlapping.
            # First pass: calculate total size needed
            ai_write_cursor = 0  # in bytes
            for user_pos, ai_audio in s._rec_ai_events:
                target_offset = user_pos * BPS  # Same rate, direct mapping
                actual_offset = max(ai_write_cursor, target_offset)
                ai_write_cursor = actual_offset + len(ai_audio)
            ai_track_bytes = max(len(user_pcm), ai_write_cursor)
            ai_track = bytearray(ai_track_bytes)

            # Second pass: place chunks
            ai_write_cursor = 0
            for user_pos, ai_audio in s._rec_ai_events:
                target_offset = user_pos * BPS
                actual_offset = max(ai_write_cursor, target_offset)
                end = actual_offset + len(ai_audio)
                if end <= len(ai_track):
                    ai_track[actual_offset:end] = ai_audio
                elif actual_offset < len(ai_track):
                    ai_track[actual_offset:] = ai_audio[:len(ai_track) - actual_offset]
                ai_write_cursor = end

            ai_duration_s = len(ai_track) / (RATE * BPS)
            logger.info(f"AI track: {len(ai_track) // BPS} samples = {ai_duration_s:.1f}s, "
                        f"{len(s._rec_ai_events)} events")

            # --- Step 3: Strip trailing silence ---
            ai_np = np.frombuffer(bytes(ai_track), dtype=np.int16)
            user_np = np.frombuffer(user_pcm, dtype=np.int16)
            ai_np = self._strip_trailing_silence(ai_np, RATE)
            user_np = self._strip_trailing_silence(user_np, RATE)

            # --- Step 4: Pad to equal length and interleave stereo ---
            max_samples = max(len(ai_np), len(user_np))
            if max_samples == 0:
                logger.warning("Recording is empty after stripping silence")
                return None

            ai_padded = np.zeros(max_samples, dtype=np.int16)
            ai_padded[:len(ai_np)] = ai_np
            user_padded = np.zeros(max_samples, dtype=np.int16)
            user_padded[:len(user_np)] = user_np

            stereo = np.empty(max_samples * 2, dtype=np.int16)
            stereo[0::2] = ai_padded    # Left = AI
            stereo[1::2] = user_padded   # Right = USER
            stereo_bytes = stereo.tobytes()

            final_duration_s = max_samples / RATE
            logger.info(f"Recording built: {final_duration_s:.1f}s stereo @{RATE}Hz "
                        f"(user={user_duration_s:.1f}s, ai={ai_duration_s:.1f}s)")

            # Export as MP3 using pydub, fall back to WAV
            mixed_mp3 = RECORDINGS_DIR / f"{s.call_uuid}_mixed.mp3"
            try:
                from pydub import AudioSegment
                audio_segment = AudioSegment(
                    data=stereo_bytes,
                    sample_width=2,
                    frame_rate=RATE,
                    channels=2
                )
                audio_segment.export(str(mixed_mp3), format="mp3", bitrate="128k")
                logger.info(f"Stereo MP3 saved: {mixed_mp3.stat().st_size} bytes")
            except ImportError:
                logger.warning("pydub not installed, falling back to stereo WAV")
                mixed_mp3 = RECORDINGS_DIR / f"{s.call_uuid}_mixed.wav"
                with wave.open(str(mixed_mp3), 'wb') as wav:
                    wav.setnchannels(2)
                    wav.setsampwidth(2)
                    wav.setframerate(RATE)
                    wav.writeframes(stereo_bytes)
                logger.info(f"Stereo WAV saved: {len(stereo_bytes)} bytes")

            return {
                "mixed_wav": mixed_mp3,
                "call_start": time.time()
            }
        except Exception as e:
            logger.error(f"Error saving recording: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return None

    async def _plivo_sender_worker(self):
        """Worker: Reads from plivo_send_queue, sends to Plivo WebSocket"""
        s = self.state
        logger.debug(f"[{s.call_uuid[:8]}] Plivo sender worker started")
        _sender_count = 0
        try:
            while s.is_active:
                try:
                    chunk: AudioChunk = await asyncio.wait_for(
                        s._plivo_send_queue.get(), timeout=1.0
                    )
                except asyncio.TimeoutError:
                    continue

                _sender_count += 1
                if _sender_count == 1:
                    logger.info(f"[{s.call_uuid[:8]}] Sender: first audio chunk dequeued (sr={chunk.sample_rate}, turn={chunk.turn_id})")
                elif _sender_count == 10:
                    logger.info(f"[{s.call_uuid[:8]}] Sender: 10 chunks sent to Plivo so far")

                if not s.plivo_ws:
                    if _sender_count <= 3:
                        logger.warning(f"[{s.call_uuid[:8]}] Sender: plivo_ws is None, cannot send audio!")
                    continue

                try:
                    audio_bytes = base64.b64decode(chunk.audio_b64)

                    if s.provider == "twilio":
                        # Twilio: resample Gemini 24kHz → 8kHz mu-law
                        from src.utils.audio_codec import gemini_to_twilio_outbound
                        if chunk.sample_rate == 24000:
                            mulaw_bytes = gemini_to_twilio_outbound(audio_bytes)
                            # Record at 16kHz (same as Plivo path)
                            rec_16k = self._resample_24k_to_16k(audio_bytes)
                        else:
                            # Already 16kHz PCM — convert to 8kHz mu-law
                            from src.utils.audio_codec import resample_16k_to_8k, pcm16_to_mulaw
                            mulaw_bytes = pcm16_to_mulaw(resample_16k_to_8k(audio_bytes))
                            rec_16k = audio_bytes
                        self._record_audio("AI", rec_16k, 16000)
                        payload_b64 = base64.b64encode(mulaw_bytes).decode()
                        await s.plivo_ws.send_text(json.dumps({
                            "event": "media",
                            "streamSid": s.twilio_stream_sid,
                            "media": {
                                "payload": payload_b64
                            }
                        }))
                    else:
                        # Plivo: resample 24kHz → 16kHz PCM
                        if chunk.sample_rate == 24000:
                            audio_bytes = self._resample_24k_to_16k(audio_bytes)
                        # Record AI audio at send-time, already 16kHz
                        self._record_audio("AI", audio_bytes, 16000)
                        payload_b64 = base64.b64encode(audio_bytes).decode()
                        await s.plivo_ws.send_text(json.dumps({
                            "event": "playAudio",
                            "media": {
                                "contentType": "audio/x-l16",
                                "sampleRate": 16000,
                                "payload": payload_b64
                            }
                        }))
                except Exception as e:
                    logger.error(f"[{s.call_uuid[:8]}] {s.provider} sender error: {e}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[{s.call_uuid[:8]}] Plivo sender worker error: {e}")
        logger.debug(f"[{s.call_uuid[:8]}] Plivo sender worker stopped")

    async def _send_reconnection_filler(self):
        """Handle silence during reconnection - clear stale audio and send silence frames
        to keep the audio stream alive (prevents 'dead line' feeling for the user)."""
        s = self.state
        if not s.plivo_ws or s._closing_call:
            return
        try:
            logger.debug(f"[{s.call_uuid[:8]}] Preparing for reconnection")

            # Clear any pending audio to prevent stale data
            await s.plivo_ws.send_text(json.dumps({
                "event": "clearAudio",
                "stream_id": s.stream_id
            }))

            # Send silence frames to keep audio stream alive (200ms at 16kHz, 16-bit mono)
            silence = b'\x00' * 6400
            silence_b64 = base64.b64encode(silence).decode()
            await s.plivo_ws.send_text(json.dumps({
                "event": "playAudio",
                "media": {
                    "contentType": "audio/x-l16",
                    "sampleRate": 16000,
                    "payload": silence_b64
                }
            }))

        except Exception as e:
            logger.error(f"Error in reconnection filler: {e}")

    async def handle_plivo_audio(self, audio_b64):
        """Handle incoming audio from Plivo - graceful error handling"""
        s = self.state
        try:
            if not s.is_active or not s.start_streaming:
                return  # Skip silently to reduce log noise
            # After agent said goodbye, stop forwarding audio to Gemini
            # This prevents Gemini from responding again (repeating goodbye)
            if s.agent_said_goodbye or s._closing_call:
                return
            if not s.goog_live_ws:
                # Track user audio time even when buffering — watchdog needs this
                # to detect dead sessions and trigger reconnection
                s._last_user_audio_time = time.time()
                # Buffer audio during reconnection (don't lose user speech)
                if len(s._reconnect_audio_buffer) < s._max_reconnect_buffer:
                    s._reconnect_audio_buffer.append(audio_b64)
                    if len(s._reconnect_audio_buffer) == 1:
                        logger.warning("Google WS disconnected - buffering audio for reconnection")
                return

            # Post-swap hold: buffer audio briefly after swap so Gemini processes context first
            now = time.time()
            if now < s._post_swap_hold_until:
                if len(s._reconnect_audio_buffer) < s._max_reconnect_buffer:
                    s._reconnect_audio_buffer.append(audio_b64)
                return
            elif s._post_swap_hold_until > 0 and s._reconnect_audio_buffer:
                # Hold expired — flush buffered audio. Copy + clear first to avoid
                # re-append feedback loop if handle_plivo_audio re-buffers.
                s._post_swap_hold_until = 0
                to_flush = list(s._reconnect_audio_buffer)
                s._reconnect_audio_buffer = []
                for buffered in to_flush:
                    await self.handle_plivo_audio(buffered)

            chunk = base64.b64decode(audio_b64)

            # Detect when user starts speaking (after agent finished)
            if s._last_user_audio_time is None or (now - s._last_user_audio_time) > 1.0:
                # Gap > 1 second means new user speech segment
                if s._agent_speaking or not s._user_speaking:
                    s._user_speaking = True
                    s._agent_speaking = False
                    s._user_speech_start_time = now
                    logger.debug(f"[{s.call_uuid[:8]}] User speaking")

                # Silence gap detected — trigger deferred split if pending
                if s._split_pending and not s._swap_in_progress:
                    s._split_pending = False
                    s._split_pending_since = None
                    self.log.detail("Silence gap detected — triggering deferred split")
                    asyncio.create_task(s._gemini._hot_swap_session())
            elif s._split_pending and s._split_pending_since:
                # Safety timeout: force split after 20s even without silence gap.
                # 10s was too aggressive — after a long model response, user needs time
                # to process before speaking, and background phone noise prevents gap detection.
                if (now - s._split_pending_since) > 20.0 and not s._swap_in_progress:
                    s._split_pending = False
                    s._split_pending_since = None
                    self.log.warn("Split pending >20s without silence gap — forcing split")
                    asyncio.create_task(s._gemini._hot_swap_session())

            s._last_user_audio_time = now

            # Record user audio (16kHz)
            self._record_audio("USER", chunk, 16000)

            # Mute user audio to Gemini during greeting — prevents VAD from
            # interrupting the greeting and causing double-greeting regeneration
            if s._greeting_in_progress:
                return

            s.inbuffer.extend(chunk)
            chunks_sent = 0
            while len(s.inbuffer) >= s.BUFFER_SIZE:
                ac = s.inbuffer[:s.BUFFER_SIZE]
                msg = {"realtime_input": {"media_chunks": [{"mime_type": "audio/pcm;rate=16000", "data": base64.b64encode(bytes(ac)).decode()}]}}
                try:
                    # Send to main voice model (native audio)
                    await s.goog_live_ws.send(json.dumps(msg))
                    chunks_sent += 1
                    # Log first chunk sent to Gemini for this user speech
                    if chunks_sent == 1 and s._user_speaking:
                        logger.trace(f"[{s.call_uuid[:8]}] Sending user audio to Gemini")
                except Exception as send_err:
                    logger.error(f"Error sending audio to Google: {send_err} - triggering reconnect")
                    # Null out dead WS so subsequent audio gets buffered (line 1659)
                    s.goog_live_ws = None
                    s.inbuffer.clear()
                    # Buffer current audio for replay after reconnect
                    if len(s._reconnect_audio_buffer) < s._max_reconnect_buffer:
                        s._reconnect_audio_buffer.append(audio_b64)
                    # Trigger emergency session split (same as GoAway handling)
                    if not s._swap_in_progress and not s._closing_call:
                        asyncio.create_task(s._gemini._emergency_session_split())
                    return
                s.inbuffer = s.inbuffer[s.BUFFER_SIZE:]
        except Exception as e:
            logger.error(f"Audio processing error: {e} - continuing session")

    async def handle_plivo_message(self, message):
        s = self.state
        event = message.get("event")
        if event == "media":
            payload = message.get("media", {}).get("payload", "")
            if payload:
                await self.handle_plivo_audio(payload)
        elif event == "start":
            s.stream_id = message.get("start", {}).get("streamId", "")
            logger.info(f"Stream started: {s.stream_id}")
        elif event == "stop":
            await s._lifecycle.stop()

    async def handle_twilio_media(self, message):
        """Handle Twilio media event — convert mu-law 8kHz to PCM 16kHz and forward to Gemini."""
        s = self.state
        media = message.get("media", {})
        payload = media.get("payload", "")
        if not payload:
            return
        try:
            from src.utils.audio_codec import twilio_inbound_to_gemini
            mulaw_bytes = base64.b64decode(payload)
            pcm_16k = twilio_inbound_to_gemini(mulaw_bytes)
            # Re-encode as base64 and route through existing PCM handler
            pcm_b64 = base64.b64encode(pcm_16k).decode()
            await self.handle_plivo_audio(pcm_b64)
        except Exception as e:
            logger.error(f"[{s.call_uuid[:8]}] Twilio audio conversion error: {e}")
