"""Transcript I/O, recording threads, and conversation logging."""
import json
import queue
import threading
import time
from datetime import datetime
from pathlib import Path

from loguru import logger

from src.core.config import config
from src.db.session_db import session_db


# Recording directory
RECORDINGS_DIR = Path(__file__).parent.parent.parent / "recordings"
RECORDINGS_DIR.mkdir(exist_ok=True)


class TranscriptLogger:
    """Manages transcript writing, conversation logging, and recording threads."""

    def __init__(self, state, log):
        self.state = state
        self.log = log
        # Start background threads immediately
        self._start_transcript_thread()
        self._start_conversation_logger()
        if state.recording_enabled:
            self._start_recording_thread()

    def _start_transcript_thread(self):
        """Start background thread for writing transcript to file (no latency impact)"""
        s = self.state
        transcript_dir = Path(__file__).parent.parent.parent / "transcripts"
        transcript_dir.mkdir(exist_ok=True)
        self._transcript_file = transcript_dir / f"{s.call_uuid}.txt"

        def transcript_worker():
            while True:
                try:
                    item = s._transcript_queue.get(timeout=1.0)
                    if item is None:  # Shutdown signal
                        break
                    ts, role, text = item
                    with open(self._transcript_file, "a") as f:
                        f.write(f"[{ts}] {role}: {text}\n")
                except queue.Empty:
                    continue
                except Exception as e:
                    logger.error(f"Transcript writer error: {e}")

        s._transcript_thread = threading.Thread(target=transcript_worker, daemon=True)
        s._transcript_thread.start()

    def _save_transcript(self, role, text):
        """Save transcript to in-memory list, session DB, and queue file write (non-blocking)"""
        s = self.state
        timestamp = datetime.now().strftime("%H:%M:%S")

        # Always add to in-memory list (for webhook backup)
        s._full_transcript.append({
            "role": role,
            "text": text,
            "timestamp": timestamp
        })

        # Add to session DB in-memory store (zero latency, batch written post-call)
        try:
            session_db.add_transcript_entry(s.call_uuid, role, text)
        except Exception:
            pass

        # Queue file write to background thread (non-blocking)
        if config.enable_transcripts:
            try:
                s._transcript_queue.put_nowait((timestamp, role, text))
            except queue.Full:
                pass

    def _start_recording_thread(self):
        """Start background thread for recording audio (sample-counter based)"""
        s = self.state
        def recording_worker():
            while True:
                try:
                    item = s._recording_queue.get(timeout=1.0)
                    if item is None:  # Shutdown signal
                        break
                    role, audio_bytes, sample_rate, user_sample_pos = item
                    if role == "USER":
                        s._rec_user_chunks.append(audio_bytes)
                    else:
                        s._rec_ai_events.append((user_sample_pos, audio_bytes))
                except queue.Empty:
                    continue
                except Exception as e:
                    logger.error(f"Recording thread error: {e}")

        s._recording_thread = threading.Thread(target=recording_worker, daemon=True)
        s._recording_thread.start()
        logger.debug("Recording thread started")

    def _start_conversation_logger(self):
        """Start background thread for saving conversation to file (no latency impact)"""
        s = self.state
        def conversation_worker():
            while True:
                try:
                    item = s._conversation_queue.get(timeout=1.0)
                    if item is None:  # Shutdown signal
                        break
                    # Append to file
                    self._save_conversation_to_file(item)
                except queue.Empty:
                    continue
                except Exception as e:
                    logger.error(f"Conversation logger error: {e}")

        s._conversation_thread = threading.Thread(target=conversation_worker, daemon=True)
        s._conversation_thread.start()
        logger.debug("Conversation logger thread started")

    def _save_conversation_to_file(self, message: dict):
        """Append conversation message as JSONL line (called from background thread)"""
        s = self.state
        try:
            with open(s._conversation_file, 'a') as f:
                f.write(json.dumps(message) + "\n")
        except Exception as e:
            logger.error(f"Error saving conversation to file: {e}")

    def _load_conversation_from_file(self) -> list:
        """Load conversation history from JSONL file for reconnection"""
        s = self.state
        try:
            if s._conversation_file.exists():
                history = []
                with open(s._conversation_file, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            history.append(json.loads(line))
                # Return only last N messages
                return history[-s._max_history_size:]
        except Exception as e:
            logger.error(f"Error loading conversation from file: {e}")
        return []

    def _log_conversation(self, role: str, text: str):
        """Queue conversation message for background file save (non-blocking)"""
        s = self.state
        message = {"role": role, "text": text, "timestamp": time.time()}
        # Update in-memory cache
        s._conversation_history.append(message)
        if len(s._conversation_history) > s._max_history_size:
            s._conversation_history = s._conversation_history[-s._max_history_size:]
        # Queue for background file write
        try:
            s._conversation_queue.put_nowait(message)
        except queue.Full:
            pass

    def _transcribe_recording_sync(self, recording_info: dict, call_uuid: str):
        """Transcribe using Gemini 2.0 Flash with native speaker diarization"""
        s = self.state
        try:
            from google import genai
            import time as time_module

            mixed_wav = recording_info.get("mixed_wav")

            if not mixed_wav or not mixed_wav.exists():
                logger.warning(f"No mixed recording found for {call_uuid}")
                return None

            logger.info(f"Starting Gemini transcription for {call_uuid}")

            # Initialize Gemini client
            client = genai.Client(api_key=s._api_key)

            # Upload the audio file
            logger.info(f"Uploading audio file for transcription...")
            audio_file = client.files.upload(file=str(mixed_wav))

            # Wait for processing
            while audio_file.state == "PROCESSING":
                time_module.sleep(2)
                audio_file = client.files.get(name=audio_file.name)

            if audio_file.state == "FAILED":
                logger.error(f"Gemini audio processing failed for {call_uuid}")
                return None

            # Generate transcript with speaker diarization
            prompt = """Transcribe this phone call audio accurately.

This is a stereo recording: the LEFT channel is the "Agent" (AI sales counselor) and the RIGHT channel is the "User" (customer).

Rules:
- Label left-channel speech as "Agent" and right-channel speech as "User"
- Format each line as: [MM:SS] Speaker: text
- Use timestamps from the audio
- Keep the transcript natural and accurate
- Do NOT add any commentary, just the transcript"""

            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[audio_file, prompt]
            )

            # Save transcript
            transcript_file = Path(__file__).parent.parent.parent / "transcripts" / f"{call_uuid}_final.txt"
            with open(transcript_file, "w") as f:
                f.write(response.text)

            # Clean up uploaded file
            try:
                client.files.delete(name=audio_file.name)
            except Exception:
                pass

            logger.info(f"Gemini transcription complete for {call_uuid}")
            return transcript_file

        except ImportError:
            logger.warning("google-genai not installed - skipping transcription")
            return None
        except Exception as e:
            logger.error(f"Gemini transcription error: {e}")
            return None
