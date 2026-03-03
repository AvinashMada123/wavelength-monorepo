"""GeminiTTSClient — TTS via Gemini 2.5 Flash TTS API.

Single responsibility: text in -> audio bytes out (24kHz PCM).
Sentence buffering is handled by TurnManager._should_flush_tts().
"""
import asyncio
import time
from typing import AsyncIterator

from google import genai
from google.genai import types
from loguru import logger

from src.core.config import gemini_key_pool


class GeminiTTSClient:
    """TTS via Gemini 2.5 Flash TTS API.

    Single responsibility: text in -> audio bytes out.
    Sentence buffering is handled by TurnManager._should_flush_tts().
    """

    def __init__(self, state, log):
        self.state = state
        self.log = log

        # Voice and language MUST be passed via API — no hardcoded defaults
        self._voice = state._tts_voice or state._resolved_voice
        self._language = state._tts_language

        if not self._voice:
            logger.warning(f"[{state.call_uuid[:8]}] TTS: No voice specified — pass 'voice' in API request")
        if not self._language:
            logger.warning(f"[{state.call_uuid[:8]}] TTS: No language specified — pass 'language' in API request")

        # API client
        self._api_key = gemini_key_pool.get_key()
        self._client = genai.Client(api_key=self._api_key)
        self._model = "gemini-2.5-flash-preview-tts"

        # Cancellation flag
        self._cancelled = False

        # Cache resolved voice on state (for session consistency)
        if state._resolved_voice is None:
            state._resolved_voice = self._voice

        self.log.detail(f"TTS voice: {self._voice}, language: {self._language}")

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        """Synthesize a text string into audio bytes (24kHz PCM).

        Yields audio chunks as they stream from the Gemini TTS API.
        Caller (TurnManager._tts_consumer) handles:
        - Resampling 24k -> 16k
        - Queuing to _plivo_send_queue
        - Recording agent audio
        - Cancellation via self.cancel()
        """
        if not text or not text.strip():
            return

        self._cancelled = False

        # Build speech config dynamically — only include voice/language if provided via API
        speech_kwargs = {}
        if self._language:
            speech_kwargs["language_code"] = self._language
        if self._voice:
            speech_kwargs["voice_config"] = types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=self._voice,
                )
            )

        config = types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(**speech_kwargs) if speech_kwargs else None,
        )

        try:
            # Wrap text with explicit TTS instruction to prevent model from
            # generating text responses instead of audio (400 error)
            tts_input = f"Say the following text exactly as written:\n{text}"
            self.log.detail(f"TTS API call: voice={self._voice}, lang={self._language}, text='{text[:60]}'")
            t0 = time.time()
            stream = await self._client.aio.models.generate_content_stream(
                model=self._model,
                contents=tts_input,
                config=config,
            )
            self.log.detail(f"TTS stream opened in {(time.time()-t0)*1000:.0f}ms")
            chunk_idx = 0
            async for chunk in stream:
                if self._cancelled:
                    self.log.detail("TTS: cancelled flag set, breaking")
                    break

                if (chunk.candidates
                        and chunk.candidates[0].content
                        and chunk.candidates[0].content.parts):
                    part = chunk.candidates[0].content.parts[0]
                    if part.inline_data and part.inline_data.data:
                        if chunk_idx == 0:
                            self.log.detail(f"TTS first audio chunk: {len(part.inline_data.data)} bytes at {(time.time()-t0)*1000:.0f}ms")
                        chunk_idx += 1
                        yield part.inline_data.data
                    elif part.text:
                        self.log.detail(f"TTS WARNING: got text instead of audio: '{part.text[:80]}'")

            self.log.detail(f"TTS complete: {chunk_idx} chunks in {(time.time()-t0)*1000:.0f}ms")

        except Exception as e:
            logger.error(f"TTS synthesis error for '{text[:50]}': {e}")
            # Non-fatal — skip this sentence, caller tries next

    async def cancel(self):
        """Cancel in-progress synthesis (for barge-in).

        Sets _cancelled flag, current synthesize() call breaks out of its loop.
        """
        self._cancelled = True

    def reset(self):
        """Reset cancellation flag for next turn."""
        self._cancelled = False
