"""
Audio codec utilities for telephony provider interoperability.

Handles mu-law <-> PCM conversion and sample rate conversion
needed for Twilio (8kHz mu-law) <-> Gemini Live (16kHz PCM).

Uses audioop.ratecv() for resampling — it applies a proper anti-aliasing
filter, which is critical for Gemini's speech recognition accuracy.
"""

import audioop


def mulaw_to_pcm16(data: bytes) -> bytes:
    """Convert mu-law 8-bit audio to PCM 16-bit signed little-endian."""
    return audioop.ulaw2lin(data, 2)


def pcm16_to_mulaw(data: bytes) -> bytes:
    """Convert PCM 16-bit signed little-endian audio to mu-law 8-bit."""
    return audioop.lin2ulaw(data, 2)


def resample_8k_to_16k(pcm_data: bytes) -> bytes:
    """Resample 8kHz PCM16 to 16kHz using audioop.ratecv (anti-aliased)."""
    if not pcm_data:
        return b""
    resampled, _ = audioop.ratecv(pcm_data, 2, 1, 8000, 16000, None)
    return resampled


def resample_16k_to_8k(pcm_data: bytes) -> bytes:
    """Resample 16kHz PCM16 to 8kHz using audioop.ratecv (anti-aliased)."""
    if not pcm_data:
        return b""
    resampled, _ = audioop.ratecv(pcm_data, 2, 1, 16000, 8000, None)
    return resampled


def resample_24k_to_8k(pcm_data: bytes) -> bytes:
    """Resample 24kHz PCM16 to 8kHz (3:1 ratio) using audioop.ratecv.
    Used for Gemini Live output -> Twilio."""
    if not pcm_data:
        return b""
    resampled, _ = audioop.ratecv(pcm_data, 2, 1, 24000, 8000, None)
    return resampled


def twilio_inbound_to_gemini(mulaw_8k: bytes) -> bytes:
    """Full pipeline: Twilio mu-law 8kHz -> PCM 16kHz for Gemini Live input."""
    pcm_8k = mulaw_to_pcm16(mulaw_8k)
    return resample_8k_to_16k(pcm_8k)


def gemini_to_twilio_outbound(pcm_24k: bytes) -> bytes:
    """Full pipeline: Gemini Live 24kHz PCM -> mu-law 8kHz for Twilio output."""
    pcm_8k = resample_24k_to_8k(pcm_24k)
    return pcm16_to_mulaw(pcm_8k)
