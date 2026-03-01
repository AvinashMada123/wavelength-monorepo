"""Module-level session management: create, preload, remove, reaper."""
import asyncio
import os
import time
from typing import Dict, Optional

from loguru import logger


# Session storage with concurrency protection
MAX_CONCURRENT_SESSIONS = int(os.environ.get("MAX_CONCURRENT_SESSIONS", 100))
_sessions: Dict[str, "PlivoGeminiSession"] = {}  # noqa: F821 — forward ref
_preloading_sessions: Dict[str, "PlivoGeminiSession"] = {}  # noqa: F821
_sessions_lock = asyncio.Lock()


def get_active_session_count() -> int:
    """Return total active + preloading sessions (no lock, approximate)"""
    return len(_sessions) + len(_preloading_sessions)


def set_plivo_uuid(internal_uuid: str, plivo_uuid: str):
    """Set the Plivo UUID on a preloaded session for proper hangup"""
    # No lock needed: single-threaded asyncio, called from async context
    session = _preloading_sessions.get(internal_uuid) or _sessions.get(internal_uuid)
    if session:
        session.plivo_call_uuid = plivo_uuid
        logger.info(f"Set Plivo UUID {plivo_uuid} on session {internal_uuid}")
    else:
        logger.error(f"CRITICAL: Could not find session {internal_uuid} to set Plivo UUID {plivo_uuid}. Call hangup will fail!")
        logger.error(f"  _preloading_sessions keys: {list(_preloading_sessions.keys())}")
        logger.error(f"  _sessions keys: {list(_sessions.keys())}")


async def preload_session(call_uuid: str, caller_phone: str, prompt: str = None, context: dict = None, webhook_url: str = None, intelligence_brief: str = "", social_proof_summary: str = "", max_call_duration: int = 300) -> bool:
    """Prepare a session while phone is ringing.
    Creates the session object for bookkeeping but does NOT connect to Gemini.
    Gemini connection starts in attach_plivo_ws() after the call connects."""
    # Import here to avoid circular import
    from .session import PlivoGeminiSession

    async with _sessions_lock:
        total = len(_sessions) + len(_preloading_sessions)
        if total >= MAX_CONCURRENT_SESSIONS:
            logger.warning(f"Max concurrent sessions ({MAX_CONCURRENT_SESSIONS}) reached. Rejecting {call_uuid}")
            raise Exception(f"Max concurrent sessions ({MAX_CONCURRENT_SESSIONS}) reached")
        session = PlivoGeminiSession(call_uuid, caller_phone, prompt=prompt, context=context, webhook_url=webhook_url, max_call_duration=max_call_duration)
        if intelligence_brief:
            session.inject_intelligence(intelligence_brief)
        if social_proof_summary:
            session.inject_social_proof(social_proof_summary)
        _preloading_sessions[call_uuid] = session
    # preload() now just does bookkeeping (no Gemini connection)
    success = await session.preload()
    return success


async def create_session(call_uuid: str, caller_phone: str, plivo_ws, prompt: str = None, context: dict = None, webhook_url: str = None) -> Optional["PlivoGeminiSession"]:  # noqa: F821
    """Create or retrieve preloaded session"""
    # Import here to avoid circular import
    from .session import PlivoGeminiSession

    async with _sessions_lock:
        # Check for preloaded session
        if call_uuid in _preloading_sessions:
            session = _preloading_sessions.pop(call_uuid)
            session.caller_phone = caller_phone
            session.attach_plivo_ws(plivo_ws)
            _sessions[call_uuid] = session
            logger.info(f"Using PRELOADED session for {call_uuid}")
            session._save_transcript("SYSTEM", "Call connected (preloaded)")
            return session

        # Fallback: create new session (check limit)
        total = len(_sessions) + len(_preloading_sessions)
        if total >= MAX_CONCURRENT_SESSIONS:
            logger.warning(f"Max concurrent sessions ({MAX_CONCURRENT_SESSIONS}) reached. Rejecting {call_uuid}")
            return None

    # Create outside lock
    logger.info(f"No preloaded session, creating new for {call_uuid}")
    session = PlivoGeminiSession(call_uuid, caller_phone, prompt=prompt, context=context, webhook_url=webhook_url)
    session._save_transcript("SYSTEM", "Call started (no preload)")
    # attach_plivo_ws will start Gemini
    session.attach_plivo_ws(plivo_ws)
    async with _sessions_lock:
        _sessions[call_uuid] = session
    return session


async def get_session(call_uuid: str) -> Optional["PlivoGeminiSession"]:  # noqa: F821
    async with _sessions_lock:
        return _sessions.get(call_uuid)


def get_preloading_session(call_uuid: str) -> Optional["PlivoGeminiSession"]:  # noqa: F821
    """Get a preloading session (non-async, for intelligence injection)."""
    return _preloading_sessions.get(call_uuid)


async def remove_session(call_uuid: str):
    """Remove and stop session atomically"""
    async with _sessions_lock:
        session = _sessions.pop(call_uuid, None)
        preload_session_obj = _preloading_sessions.pop(call_uuid, None)
    # Stop outside lock (stop() does async I/O)
    if session:
        await session.stop()
    if preload_session_obj:
        await preload_session_obj.stop()


async def _session_reaper():
    """Background task: clean up zombie sessions that were never answered or got stuck.
    Runs every 60s. Removes prepared sessions that never connected after 60s
    and active sessions with no audio activity for 10 minutes."""
    PRELOAD_TTL = 60    # 60 seconds — session created but call never connected
    ACTIVE_TTL = 600    # 10 minutes — max call duration safety net
    while True:
        await asyncio.sleep(60)
        now = time.time()
        stale = []
        try:
            async with _sessions_lock:
                # Check preloading sessions (never got answered)
                for uuid, session in list(_preloading_sessions.items()):
                    age = now - (session._preload_start_time or now)
                    if age > PRELOAD_TTL:
                        stale.append(("preload", uuid, age))
                # Check active sessions (stuck/leaked)
                for uuid, session in list(_sessions.items()):
                    started = session._call_answered_time or session._preload_start_time or now
                    age = now - started
                    if age > ACTIVE_TTL and not session.is_active:
                        stale.append(("active", uuid, age))

            for kind, uuid, age in stale:
                logger.warning(f"Reaper: removing stale {kind} session {uuid[:8]} (age={age:.0f}s)")
                await remove_session(uuid)

            if stale:
                total = len(_sessions) + len(_preloading_sessions)
                logger.info(f"Reaper: cleaned {len(stale)} sessions, {total} remaining")
        except Exception as e:
            logger.error(f"Session reaper error: {e}")
