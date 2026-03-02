"""DeepgramSTTClient — streaming STT via Deepgram Nova-3 WebSocket.

Uses raw websockets for full control over reconnection and audio buffering.
"""
import asyncio
import json
import time
from typing import Callable, Optional

import websockets
from loguru import logger

from src.core.config import config


class DeepgramSTTClient:
    """Streaming STT via Deepgram Nova-3 WebSocket.

    Includes automatic reconnection on WebSocket drops.
    """

    def __init__(self, state, log):
        self.state = state
        self.log = log

        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._receive_task: Optional[asyncio.Task] = None
        self._reconnect_count = 0
        self._max_reconnects = 3

        # Rolling reconnect buffer (last 2s of audio for replay on reconnect)
        self._reconnect_buffer = bytearray()
        self._max_reconnect_buffer = 16000 * 2 * 2  # 2 seconds at 16kHz 16-bit

        # Callbacks (set by TurnManager)
        self.on_transcript_final: Optional[Callable] = None
        self.on_transcript_interim: Optional[Callable] = None
        self.on_speech_started: Optional[Callable] = None
        self.on_utterance_end: Optional[Callable] = None

    async def start(self):
        """Open WebSocket connection to Deepgram."""
        await self._connect()

    async def _connect(self):
        """Establish WebSocket connection to Deepgram Nova-3."""
        api_key = config.deepgram_api_key
        if not api_key:
            self.log.error("DEEPGRAM_API_KEY not set — STT disabled")
            return

        # Build URL with query parameters
        params = {
            "model": "nova-3",
            "language": "multi",  # Multi-language (English + Hindi)
            "encoding": "linear16",
            "sample_rate": "16000",
            "channels": "1",
            "punctuate": "true",
            "interim_results": "true",
            "utterance_end_ms": "1000",
            "vad_events": "true",
            "endpointing": "300",  # 300ms endpointing for responsive turns
            "smart_format": "true",
        }
        query = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"wss://api.deepgram.com/v1/listen?{query}"

        try:
            self._ws = await websockets.connect(
                url,
                additional_headers={"Authorization": f"Token {api_key}"},
                ping_interval=5,
                ping_timeout=10,
                close_timeout=3,
            )
            self._reconnect_count = 0
            self._receive_task = asyncio.create_task(self._receive_loop())
            self.log.detail("Deepgram STT connected")
        except Exception as e:
            self.log.error(f"Deepgram connection failed: {e}")
            self._ws = None

    async def send_audio(self, audio_bytes: bytes):
        """Forward raw audio chunk to Deepgram.

        Also maintains reconnect buffer (rolling 2s window).
        If WS is disconnected, buffers audio and triggers reconnect.
        """
        # Maintain reconnect buffer (rolling window)
        self._reconnect_buffer.extend(audio_bytes)
        if len(self._reconnect_buffer) > self._max_reconnect_buffer:
            excess = len(self._reconnect_buffer) - self._max_reconnect_buffer
            del self._reconnect_buffer[:excess]

        if self._ws is None:
            # WS down — buffer audio, attempt reconnect
            if self._reconnect_count < self._max_reconnects:
                asyncio.create_task(self._reconnect())
            return

        try:
            await self._ws.send(audio_bytes)
        except Exception:
            # WS dropped mid-send
            self._ws = None
            if self._reconnect_count < self._max_reconnects:
                asyncio.create_task(self._reconnect())

    async def close(self):
        """Close WebSocket gracefully (send CloseStream message)."""
        if self._receive_task:
            self._receive_task.cancel()
            self._receive_task = None

        if self._ws:
            try:
                # Send CloseStream message
                await self._ws.send(json.dumps({"type": "CloseStream"}))
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

    async def _reconnect(self):
        """Reconnect to Deepgram on WS drop.

        1. Open new connection
        2. Replay buffered audio (last 2s) so mid-word speech isn't lost
        3. Resume normal audio forwarding
        """
        if self._ws is not None:
            return  # Already reconnected

        self._reconnect_count += 1
        self.log.warn(f"Deepgram reconnect attempt {self._reconnect_count}/{self._max_reconnects}")

        try:
            await self._connect()

            if self._ws and self._reconnect_buffer:
                # Replay buffered audio
                try:
                    await self._ws.send(bytes(self._reconnect_buffer))
                    self.log.detail(f"Replayed {len(self._reconnect_buffer)} bytes on reconnect")
                except Exception:
                    pass
        except Exception as e:
            self.log.error(f"Deepgram reconnect failed: {e}")

    async def _receive_loop(self):
        """Receive and dispatch Deepgram messages."""
        try:
            async for message in self._ws:
                try:
                    data = json.loads(message)
                    msg_type = data.get("type", "")

                    if msg_type == "Results":
                        await self._handle_results(data)
                    elif msg_type == "SpeechStarted":
                        if self.on_speech_started:
                            await self.on_speech_started()
                    elif msg_type == "UtteranceEnd":
                        if self.on_utterance_end:
                            await self.on_utterance_end()
                    elif msg_type == "Metadata":
                        pass  # Connection metadata, ignore
                    elif msg_type == "Error":
                        self.log.error(f"Deepgram error: {data}")
                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    logger.error(f"Deepgram receive error: {e}")

        except websockets.ConnectionClosed:
            self.log.warn("Deepgram WS closed")
            self._ws = None
            # Attempt reconnect
            if self.state.is_active and self._reconnect_count < self._max_reconnects:
                await self._reconnect()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            self.log.error(f"Deepgram receive loop error: {e}")
            self._ws = None

    async def _handle_results(self, data: dict):
        """Process transcript results from Deepgram."""
        channel = data.get("channel", {})
        alternatives = channel.get("alternatives", [])
        if not alternatives:
            return

        transcript = alternatives[0].get("transcript", "").strip()
        confidence = alternatives[0].get("confidence", 0.0)
        is_final = data.get("is_final", False)

        if not transcript:
            return

        if is_final:
            if self.on_transcript_final:
                await self.on_transcript_final(transcript, confidence)
        else:
            if self.on_transcript_interim:
                await self.on_transcript_interim(transcript)
