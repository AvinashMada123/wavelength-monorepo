"""GoogleCloudTTSClient — TTS via Google Cloud Text-to-Speech REST API.

Single responsibility: text in -> audio bytes out (16kHz PCM).
Drop-in replacement for GeminiTTSClient with same interface.

Key advantages over Gemini TTS:
- ~200-400ms latency (vs 4-5s for Gemini TTS)
- Cheaper: $4-16/1M chars (vs Gemini TTS pricing)
- All Indian languages: hi-IN, ta-IN, te-IN, en-IN, bn-IN, kn-IN, ml-IN, gu-IN
- Outputs 16kHz directly (no resampling artifacts)
"""
import asyncio
import base64
import time
from typing import AsyncIterator

import httpx
from loguru import logger

from src.core.config import config


class GoogleCloudTTSClient:
    """TTS via Google Cloud Text-to-Speech REST API.

    Same interface as GeminiTTSClient: synthesize(), cancel(), reset().
    Uses REST API with API key auth — no SDK dependency needed.

    Voice selection strategy:
    - Short Gemini names (Kore, Puck, etc.) → Wavenet voices (warmest prosody)
    - Full Cloud TTS voice names → used as-is
    - Wavenet: ~600-700ms, $16/1M chars, warm natural prosody
    - Neural2: ~400-900ms, $16/1M chars, faster but more robotic
    - Chirp3-HD: ~600-1500ms, $30/1M chars, robotic on telephony
    """

    ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"

    # Gemini voice names → Cloud TTS Wavenet voice mapping
    # Wavenet has the warmest, most natural prosody for telephony
    _GEMINI_TO_WAVENET = {
        # Female voices → Wavenet-A (female)
        "Kore": "A", "Aoede": "A", "Leda": "A", "Despina": "A",
        "Callirrhoe": "A", "Erinome": "A", "Laomedeia": "A",
        "Pulcherrima": "A", "Vindemiatrix": "A",
        # Male voices → Wavenet-B (male)
        "Puck": "B", "Charon": "B", "Fenrir": "B", "Orus": "B",
        "Zephyr": "B", "Achernar": "B", "Achird": "B",
        "Enceladus": "B", "Iapetus": "B", "Umbriel": "B",
        # Additional voices (alternate Wavenet variants)
        "Algenib": "C", "Algieba": "C", "Alnilam": "C",
        "Autonoe": "D", "Gacrux": "D", "Rasalgethi": "D",
        "Sadachbia": "D", "Sadaltager": "D", "Schedar": "D",
        "Sulafat": "E", "Zubenelgenubi": "F",
    }

    # All known Gemini voice names (for detection)
    _GEMINI_VOICE_NAMES = set(_GEMINI_TO_WAVENET.keys())

    def __init__(self, state, log):
        self.state = state
        self.log = log

        # Voice and language MUST be passed via API — no hardcoded defaults
        raw_voice = state._tts_voice or state._resolved_voice
        self._language = state._tts_language

        # Auto-expand short Gemini voice names to Wavenet
        self._voice = self._resolve_voice_name(raw_voice, self._language)

        if not self._voice:
            logger.warning(f"[{state.call_uuid[:8]}] Cloud TTS: No voice specified — pass 'voice' in API request")
        if not self._language:
            logger.warning(f"[{state.call_uuid[:8]}] Cloud TTS: No language specified — pass 'language' in API request")

        # API key: use dedicated Cloud TTS key, fallback to Gemini key
        self._api_key = config.google_cloud_tts_api_key or config.google_api_key
        if not self._api_key:
            logger.error(f"[{state.call_uuid[:8]}] Cloud TTS: No API key available!")

        # HTTP client (reused across calls for connection pooling)
        self._http = httpx.AsyncClient(timeout=10.0)

        # Cancellation flag
        self._cancelled = False

        # Connection preloaded flag
        self._connection_warm = False

        # Cache resolved voice on state (for session consistency)
        if state._resolved_voice is None:
            state._resolved_voice = self._voice

        self.log.detail(f"Cloud TTS init: voice={self._voice}, language={self._language}")

    def _resolve_voice_name(self, voice: str, language: str) -> str:
        """Expand short Gemini voice names to Cloud TTS Wavenet voices.

        "Kore" + "en-IN" → "en-IN-Wavenet-A" (female, warm prosody)
        "Puck" + "hi-IN" → "hi-IN-Wavenet-B" (male, warm prosody)
        "en-IN-Wavenet-D" → "en-IN-Wavenet-D" (already full, pass through)
        """
        if not voice:
            return voice

        # Already a full Cloud TTS voice name (contains hyphens like "en-IN-Wavenet-A")
        if "-" in voice and len(voice) > 10:
            return voice

        # Short Gemini name — map to Wavenet variant (warmest prosody)
        voice_cap = voice[0].upper() + voice[1:] if voice else voice
        wavenet_variant = self._GEMINI_TO_WAVENET.get(voice_cap)
        if wavenet_variant:
            lang = language or "en-IN"
            expanded = f"{lang}-Wavenet-{wavenet_variant}"
            logger.info(f"Cloud TTS: mapped '{voice}' → '{expanded}' (Wavenet, warm prosody)")
            return expanded

        return voice

    async def warmup(self):
        """Pre-warm HTTP connection to Cloud TTS endpoint.

        Call during start() to eliminate cold-start latency (~500-800ms)
        on the first real synthesize() call.
        """
        if self._connection_warm:
            return
        try:
            t0 = time.time()
            # Synthesize a tiny silent text to establish HTTP/2 connection
            warmup_body = {
                "input": {"text": "."},
                "voice": {
                    "languageCode": self._language or "en-US",
                    "name": self._voice or f"{self._language or 'en-US'}-Wavenet-A",
                },
                "audioConfig": {
                    "audioEncoding": "LINEAR16",
                    "sampleRateHertz": 16000,
                },
            }
            headers = {
                "X-goog-api-key": self._api_key,
                "Content-Type": "application/json",
            }
            resp = await self._http.post(self.ENDPOINT, json=warmup_body, headers=headers)
            elapsed = (time.time() - t0) * 1000
            self._connection_warm = True
            self.log.detail(f"Cloud TTS warmup: HTTP connection established in {elapsed:.0f}ms (status={resp.status_code})")
        except Exception as e:
            logger.warning(f"Cloud TTS warmup failed (non-fatal): {e}")

    def _wrap_ssml(self, text: str) -> str:
        """Wrap text in SSML with prosody for natural speech.

        - rate="95%": slightly slower, removes rushed AI feel
        - pitch="-1st": drops pitch 1 semitone, sounds more grounded
        """
        # Escape XML special characters
        escaped = (text.replace("&", "&amp;").replace("<", "&lt;")
                   .replace(">", "&gt;").replace('"', "&quot;"))
        return (
            f'<speak><prosody rate="95%" pitch="-1st">'
            f'{escaped}</prosody></speak>'
        )

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        """Synthesize text to 16kHz PCM audio via Google Cloud TTS REST API.

        Yields audio bytes (16kHz PCM16) — single chunk, ready for Plivo.
        No resampling needed — Google's internal resampler handles 16kHz natively.
        """
        if not text or not text.strip():
            return

        self._cancelled = False

        # Build request body
        voice_params = {}
        if self._language:
            voice_params["languageCode"] = self._language
        if self._voice:
            voice_params["name"] = self._voice

        # Fallback: at minimum languageCode is required
        if "languageCode" not in voice_params:
            voice_params["languageCode"] = "en-US"

        # Use SSML for natural prosody (slight rate/pitch adjustment)
        ssml_text = self._wrap_ssml(text.strip())

        request_body = {
            "input": {"ssml": ssml_text},
            "voice": voice_params,
            "audioConfig": {
                "audioEncoding": "LINEAR16",
                "sampleRateHertz": 16000,
            },
        }

        headers = {
            "X-goog-api-key": self._api_key,
            "Content-Type": "application/json",
        }

        try:
            self.log.detail(f"Cloud TTS: voice={self._voice}, lang={self._language}, text='{text[:60]}'")
            t0 = time.time()

            response = await self._http.post(
                self.ENDPOINT,
                json=request_body,
                headers=headers,
            )

            elapsed_ms = (time.time() - t0) * 1000

            if response.status_code != 200:
                error_body = response.text[:300]
                logger.error(f"Cloud TTS API error {response.status_code}: {error_body}")
                return

            data = response.json()
            audio_b64 = data.get("audioContent", "")

            if not audio_b64:
                logger.error("Cloud TTS: empty audioContent in response")
                return

            audio_bytes = base64.b64decode(audio_b64)

            # Strip WAV header if present (LINEAR16 responses include 44-byte WAV header)
            if len(audio_bytes) > 44 and audio_bytes[:4] == b"RIFF":
                audio_bytes = audio_bytes[44:]

            self.log.detail(f"Cloud TTS: {len(audio_bytes)} bytes in {elapsed_ms:.0f}ms for '{text[:40]}'")

            if not self._cancelled:
                yield audio_bytes

        except httpx.TimeoutException:
            logger.error(f"Cloud TTS timeout for '{text[:50]}'")
        except Exception as e:
            logger.error(f"Cloud TTS error for '{text[:50]}': {e}")

    async def cancel(self):
        """Cancel in-progress synthesis (for barge-in).

        Sets _cancelled flag. Since REST returns complete audio in one shot,
        this prevents the yielded audio from being used.
        """
        self._cancelled = True

    def reset(self):
        """Reset cancellation flag for next turn."""
        self._cancelled = False

    async def close(self):
        """Close HTTP client (call on session teardown)."""
        await self._http.aclose()
