"""Audio format conversion utilities for the traditional pipeline.

Consolidates audio conversions used across STT, TTS, and recording.
References existing implementations in audio_pipeline.py and audio_codec.py.
"""
import numpy as np


def resample_24k_to_16k(audio_bytes: bytes) -> bytes:
    """Resample 24kHz PCM16 audio to 16kHz using numpy linear interpolation.

    Used for: TTS output (24kHz) → Plivo/recording (16kHz).
    """
    if not audio_bytes:
        return b""
    samples_24k = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)
    n_in = len(samples_24k)
    n_out = int(n_in * 2 / 3)
    if n_out == 0:
        return b""
    x_new = np.linspace(0, n_in - 1, n_out, dtype=np.float32)
    samples_16k = np.interp(x_new, np.arange(n_in, dtype=np.float32), samples_24k)
    return np.clip(samples_16k, -32768, 32767).astype(np.int16).tobytes()


def mulaw_to_pcm16k(mulaw_bytes: bytes) -> bytes:
    """Convert mu-law 8kHz audio to PCM 16kHz.

    Used for: Twilio inbound audio → Deepgram STT / recording.
    Reuses audioop for proper anti-aliased resampling.
    """
    import audioop
    pcm_8k = audioop.ulaw2lin(mulaw_bytes, 2)
    resampled, _ = audioop.ratecv(pcm_8k, 2, 1, 8000, 16000, None)
    return resampled


def pcm16k_to_mulaw_8k(audio_bytes: bytes) -> bytes:
    """Convert 16kHz PCM16 to 8kHz mu-law.

    Used for: TTS output (after 24k→16k resample) → Twilio outbound.
    """
    import audioop
    pcm_8k, _ = audioop.ratecv(audio_bytes, 2, 1, 16000, 8000, None)
    return audioop.lin2ulaw(pcm_8k, 2)


def pcm_rms(audio_bytes: bytes) -> float:
    """Calculate RMS energy of PCM16 audio. For logging, not gating."""
    if not audio_bytes or len(audio_bytes) < 2:
        return 0.0
    samples = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)
    if len(samples) == 0:
        return 0.0
    return float(np.sqrt(np.mean(samples ** 2)))
