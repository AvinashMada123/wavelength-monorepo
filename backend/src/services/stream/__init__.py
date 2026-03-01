"""Stream package — refactored from plivo_gemini_stream.py.

Re-exports the public API so existing imports continue to work.
"""
from .session_manager import (
    preload_session,
    create_session,
    remove_session,
    get_session,
    get_preloading_session,
    set_plivo_uuid,
    get_active_session_count,
    _sessions,
    _preloading_sessions,
    _sessions_lock,
    _session_reaper,
)
from .session import PlivoGeminiSession

__all__ = [
    "preload_session",
    "create_session",
    "remove_session",
    "get_session",
    "get_preloading_session",
    "set_plivo_uuid",
    "get_active_session_count",
    "_sessions",
    "_preloading_sessions",
    "_sessions_lock",
    "_session_reaper",
    "PlivoGeminiSession",
]
