"""Gemini WebSocket connection, receive loop, session splits, and _receive_from_google."""
import asyncio
import base64
import json
import re
import time
import unicodedata

import websockets
from loguru import logger

from src.core.config import config
from .prompt_builder import get_vertex_ai_token, LATENCY_THRESHOLD_MS
from .audio_pipeline import AudioChunk


class GeminiConnection:
    """Manages the Gemini WebSocket connection and message processing."""

    def __init__(self, state, log):
        self.state = state
        self.log = log

    def _is_garbled(self, text):
        """Check if accumulated turn text appears garbled (STT noise).
        Called on full turn text, not individual fragments."""
        if not text or len(text.strip()) < 3:
            return False  # Too short to judge — not garbled
        stripped = text.strip()
        # If it has any recognizable word (2+ alpha chars), it's not garbled
        words = re.findall(r'[a-zA-Z]{2,}', stripped)
        if words:
            return False
        # If it has Indic script characters, it's not garbled
        if re.search(r'[\u0900-\u0D7F]', stripped):
            return False
        # Only flag if it's mostly non-alpha noise
        alpha_ratio = sum(1 for c in stripped if c.isalpha()) / max(len(stripped), 1)
        return alpha_ratio < 0.3

    def _has_blocked_script(self, text):
        """Check if text contains blocked scripts (STT hallucinations).
        Allow: Latin, Devanagari, Telugu, Tamil, Kannada, Malayalam, Bengali, Gujarati, Gurmukhi.
        Block: Cyrillic, Arabic, Amharic, Thai, CJK, Hiragana, Katakana, Korean Hangul."""
        blocked_ranges = [
            (0x0400, 0x04FF),  # Cyrillic
            (0x0600, 0x06FF),  # Arabic
            (0x1200, 0x137F),  # Ethiopic/Amharic
            (0x0E00, 0x0E7F),  # Thai
            (0x4E00, 0x9FFF),  # CJK Unified
            (0x3040, 0x309F),  # Hiragana
            (0x30A0, 0x30FF),  # Katakana
            (0xAC00, 0xD7AF),  # Korean Hangul
        ]
        blocked_count = 0
        total = 0
        for ch in text:
            if ch.isalpha():
                total += 1
                cp = ord(ch)
                for start, end in blocked_ranges:
                    if start <= cp <= end:
                        blocked_count += 1
                        break
        if total == 0:
            return False
        return (blocked_count / total) > 0.3  # >30% blocked chars

    def _is_non_english(self, text):
        """Check if text is predominantly non-English (>50% non-Latin chars).
        Detects Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Gujarati, Gurmukhi
        and other regional Indic scripts that indicate a language barrier.
        Requires at least 4 alpha chars to avoid false positives from short STT noise."""
        if not text:
            return False
        alpha_chars = [c for c in text if c.isalpha()]
        if len(alpha_chars) < 4:
            return False
        non_latin = sum(1 for c in alpha_chars if ord(c) > 0x024F)  # Beyond Extended Latin
        return (non_latin / len(alpha_chars)) > 0.5

    async def _connect_and_setup_ws(self, is_standby=False):
        """Create a new Gemini WS connection and send setup message.
        Returns the connected WS (caller must handle receive loop)."""
        s = self.state
        label = "standby" if is_standby else "active"
        t0 = time.time()

        if config.use_vertex_ai:
            token = get_vertex_ai_token()
            if not token:
                logger.error("Failed to get Vertex AI token - falling back to Google AI Studio")
                url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={s._api_key}"
                extra_headers = None
            else:
                url = f"wss://{config.vertex_location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent"
                extra_headers = {"Authorization": f"Bearer {token}"}
                self.log.detail(f"Vertex AI: {config.vertex_location} ({label})")
        else:
            url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={s._api_key}"
            extra_headers = None
            self.log.detail(f"Google AI Studio ({label})")

        ws_kwargs = {"ping_interval": 30, "ping_timeout": 20, "close_timeout": 5}
        if extra_headers:
            ws_kwargs["additional_headers"] = extra_headers

        ws = await websockets.connect(url, **ws_kwargs)
        connect_ms = (time.time() - t0) * 1000
        self.log.detail(f"Gemini {label} WS connected ({connect_ms:.0f}ms)")

        s._setup_sent_time = time.time()
        await s._prompt_builder._send_session_setup_on_ws(ws, is_standby=is_standby)
        return ws

    async def _ws_receive_loop(self, ws, is_standby=False):
        """Receive loop for a Gemini WS. For standby, stops after setupComplete."""
        s = self.state
        try:
            async for message in ws:
                if not s.is_active:
                    break
                resp = json.loads(message)
                if is_standby:
                    if "setupComplete" in resp:
                        s._standby_ready.set()
                        ready_ms = (time.time() - s._setup_sent_time) * 1000 if s._setup_sent_time else 0
                        self.log.detail(f"Standby session ready ({ready_ms:.0f}ms)")
                        continue
                    elif "goAway" in resp:
                        self.log.warn("Standby GoAway — will re-prewarm")
                        await self._close_ws_quietly(ws)
                        s._standby_ws = None
                        s._standby_ready = asyncio.Event()
                        s._standby_task = None
                        s._prewarm_task = asyncio.create_task(self._prewarm_standby_connection())
                        return
                else:
                    await self._receive_from_google(message)
        except asyncio.CancelledError:
            pass
        except websockets.exceptions.ConnectionClosed as e:
            if not is_standby:
                self.log.warn(f"Active WS closed: {e.code}")
                raise  # Re-raise so _run_google_live_session can reconnect

    async def _prewarm_standby_connection(self):
        """Pre-warm standby: connect WebSocket AND pre-build setup message.
        WS connection saves ~100-400ms, pre-built setup saves ~2-5s at swap time."""
        s = self.state
        if s._standby_ws or s._swap_in_progress:
            return
        try:
            t0 = time.time()

            if config.use_vertex_ai:
                token = get_vertex_ai_token()
                if not token:
                    url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={s._api_key}"
                    extra_headers = None
                else:
                    url = f"wss://{config.vertex_location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent"
                    extra_headers = {"Authorization": f"Bearer {token}"}
            else:
                url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={s._api_key}"
                extra_headers = None

            ws_kwargs = {"ping_interval": 30, "ping_timeout": 20, "close_timeout": 5}
            if extra_headers:
                ws_kwargs["additional_headers"] = extra_headers

            ws = await websockets.connect(url, **ws_kwargs)
            connect_ms = (time.time() - t0) * 1000
            self.log.detail(f"Standby WS connected ({connect_ms:.0f}ms)")

            s._standby_ws = ws

            # Pre-build the setup message now (no time pressure) so hot-swap just sends it
            try:
                s._prebuilt_setup_msg = s._prompt_builder._build_setup_message()
                prompt_len = len(s._prebuilt_setup_msg["setup"]["system_instruction"]["parts"][0]["text"])
                self.log.detail(f"Standby setup pre-built ({prompt_len:,} chars)")
            except Exception as e:
                self.log.warn(f"Pre-build setup failed: {e}, will build at swap time")
                s._prebuilt_setup_msg = None
        except Exception as e:
            self.log.error(f"Standby connection failed: {e}")
            s._standby_ws = None

    async def _hot_swap_session(self):
        """Hot-swap: send FRESH setup to pre-connected standby, then swap.
        Setup is ALWAYS sent at swap time (never during prewarm) so system_instruction has current context."""
        s = self.state
        if s._swap_in_progress or not s._standby_ws:
            self.log.warn("No standby available, falling back")
            await self._fallback_session_split()
            return

        s._swap_in_progress = True
        s._last_split_time = time.time()  # Set early to block nudges during swap
        swap_start = time.time()
        ws = s._standby_ws
        try:
            # Cancel any existing standby tasks
            if s._standby_task:
                s._standby_task.cancel()
                s._standby_task = None

            # Send setup with FRESH context (always at swap time, never prewarm)
            s._setup_sent_time = time.time()
            try:
                await s._prompt_builder._send_session_setup_on_ws(ws, is_standby=False)
            except Exception as e:
                self.log.warn(f"Standby WS dead ({e}), falling back")
                await self._close_ws_quietly(ws)
                s._standby_ws = None
                await self._fallback_session_split()
                return

            # Wait for setupComplete
            setup_ok = False
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                resp = json.loads(msg)
                if "setupComplete" in resp:
                    setup_ok = True
                    ready_ms = (time.time() - s._setup_sent_time) * 1000
                    self.log.detail(f"Standby setup ready ({ready_ms:.0f}ms, fresh context)")
            except (asyncio.TimeoutError, websockets.exceptions.ConnectionClosed) as e:
                self.log.warn(f"Standby setup failed: {e}")

            if not setup_ok:
                self.log.warn("Standby setup not ready, falling back")
                await self._close_ws_quietly(ws)
                s._standby_ws = None
                await self._fallback_session_split()
                return

            # Send anti-repetition reinforcement via client_content
            await self._send_context_to_ws(ws)

            # Step 4: Atomic swap — cancel old BEFORE starting new to prevent duplicate audio
            old_ws = s.goog_live_ws
            old_receive_task = s._active_receive_task

            # 1. Mute audio output to prevent any in-flight audio during swap
            s._mute_audio = True

            # 2. Cancel old receive task FIRST (stop old session from generating audio)
            if old_receive_task:
                old_receive_task.cancel()
            if s._standby_task:
                s._standby_task.cancel()
                s._standby_task = None

            # 3. Drain any in-flight audio from old session
            while not s._plivo_send_queue.empty():
                try:
                    s._plivo_send_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break

            # 4. Swap to new session
            s.goog_live_ws = ws
            s._standby_ws = None

            # 5. Start new receive loop (only now, after old is cancelled)
            s._active_receive_task = asyncio.create_task(
                self._ws_receive_loop(s.goog_live_ws, is_standby=False)
            )

            # 6. Unmute and set post-swap hold (100ms before forwarding user audio)
            s._mute_audio = False
            s._post_swap_hold_until = time.time() + 0.1  # Reduced from 200ms for faster response

            # 7. Close old WS in background
            asyncio.create_task(self._close_ws_quietly(old_ws))

            s._google_session_start = time.time()
            s._standby_ready = asyncio.Event()
            s._prewarm_task = None
            s._is_reconnecting = False
            s._split_pending = False
            s._split_pending_since = None

            # Advance step-based split group counter
            if s._step_split_groups and s._current_split_group < len(s._step_split_groups) - 1:
                s._current_split_group += 1
                self.log.detail(f"Advanced to split group {s._current_split_group}/{len(s._step_split_groups)-1}")

            session_age = (time.time() - swap_start)
            swap_ms = session_age * 1000
            self.log.phase(f"SESSION SPLIT (hot-swap at turn #{s._turn_count}) ✓")
            self.log.detail("Cancel old → drain queue → swap → start new (ordered)")
            self.log.detail_last(f"Swap: {swap_ms:.0f}ms")
            s._transcript._save_transcript("SYSTEM", f"Hot-swap session split at turn #{s._turn_count} ({swap_ms:.0f}ms)")

            # Launch dead air detector — will nudge bot if nobody speaks for 5s
            if s._post_swap_reengagement_task:
                s._post_swap_reengagement_task.cancel()
            s._post_swap_reengagement_task = asyncio.create_task(
                self._post_swap_reengagement(time.time())
            )
        finally:
            s._swap_in_progress = False
            s._last_split_time = time.time()

    async def _send_context_to_ws(self, ws):
        """Send minimal session-split context via client_content.
        Full conversation context is already in the system_instruction — this just
        provides the last exchange and reinforces 'don't repeat' and 'wait for customer'.
        CRITICAL: turn_complete=False so Gemini does NOT treat this as a completed user
        turn and does NOT generate an immediate response (no more 'Understood...' pattern)."""
        s = self.state
        last_user = s._last_user_text[:150] if s._last_user_text else ""
        agent_ref = (s._last_agent_text or s._last_agent_question or "")[:150]

        # Detect if agent's last message was an unanswered question
        agent_ended_with_question = agent_ref and agent_ref.rstrip().endswith("?")

        if agent_ref and last_user:
            # Normal case: turn completed, user already responded
            trigger = (
                f'[SESSION SPLIT — brief technical refresh, customer is unaware.] '
                f'Last you said: "{agent_ref}" Customer replied: "{last_user}". '
                f'Wait for customer to speak next. Do NOT re-introduce or repeat covered topics.'
            )
        elif agent_ref and agent_ended_with_question:
            # Agent asked a question but user hasn't responded yet
            trigger = (
                f'[SESSION SPLIT — brief technical refresh, customer is unaware.] '
                f'Last you said: "{agent_ref}" Customer has not replied yet. '
                f'Wait a moment, then if customer hasn\'t spoken, briefly say '
                f'"Are you still there?" Do NOT repeat the original question verbatim.'
            )
        elif agent_ref:
            trigger = (
                f'[SESSION SPLIT — brief technical refresh, customer is unaware.] '
                f'Last you said: "{agent_ref}" '
                f'Wait for customer to speak. Do NOT re-introduce or repeat covered topics.'
            )
        else:
            trigger = "[SESSION SPLIT — brief technical refresh, customer is unaware. Wait for customer to speak.]"

        # turn_complete: False — Gemini will NOT generate a response to this.
        # It will only respond when actual user audio triggers speech detection.
        msg = {"client_content": {"turns": [{"role": "user", "parts": [{"text": trigger}]}], "turn_complete": False}}
        await ws.send(json.dumps(msg))
        self.log.detail(f"Context sent (turn_complete=False): last='{agent_ref[:50]}'")

    async def _close_ws_quietly(self, ws):
        """Close a WS without error logging."""
        try:
            await ws.close()
        except Exception:
            pass

    async def _fallback_session_split(self):
        """Fallback when standby not available: close active WS and let main loop reconnect."""
        s = self.state
        if not s.goog_live_ws or s._closing_call or s._is_reconnecting:
            return
        s._is_reconnecting = True
        s._standby_ready = asyncio.Event()
        s._split_pending = False
        s._split_pending_since = None
        self.log.phase(f"SESSION SPLIT (fallback at turn #{s._turn_count})")
        s._transcript._save_transcript("SYSTEM", f"Fallback session split at turn #{s._turn_count}")

        if s._standby_task:
            s._standby_task.cancel()
            s._standby_task = None
        if s._active_receive_task:
            s._active_receive_task.cancel()
            s._active_receive_task = None

        ws = s.goog_live_ws
        s.goog_live_ws = None
        await self._close_ws_quietly(ws)

        # Restart main session loop if it already exited (Fix 4: prevent permanent silence)
        if s.is_active and not s._closing_call:
            s._session_task = asyncio.create_task(self._run_google_live_session())

    async def _emergency_session_split(self):
        """Emergency split when GoAway fires with no standby: connect + setup + swap in one shot."""
        s = self.state
        if s._swap_in_progress or s._closing_call:
            return
        s._swap_in_progress = True
        s._last_split_time = time.time()  # Set early to block nudges during swap
        self.log.phase("SESSION SPLIT (emergency — GoAway)")
        try:
            # Null out goog_live_ws immediately to stop audio send errors
            old_ws = s.goog_live_ws
            s.goog_live_ws = None

            if s._active_receive_task:
                s._active_receive_task.cancel()
                s._active_receive_task = None

            # Connect new WS + send setup with current context
            t0 = time.time()
            ws = await self._connect_and_setup_ws(is_standby=False)

            # Wait for setupComplete
            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
            resp = json.loads(msg)
            if "setupComplete" not in resp:
                self.log.error("Emergency split: setup failed")
                await self._close_ws_quietly(ws)
                return

            # Send anti-repetition context
            await self._send_context_to_ws(ws)

            # Swap in
            s.goog_live_ws = ws
            s._active_receive_task = asyncio.create_task(
                self._ws_receive_loop(ws, is_standby=False)
            )
            asyncio.create_task(self._close_ws_quietly(old_ws))

            s._google_session_start = time.time()
            s._is_reconnecting = False
            s._split_pending = False
            s._split_pending_since = None
            # NOTE: No _post_swap_hold_until here — emergency splits are already disruptive,
            # adding a hold causes audio loss when the main loop also reconnects.
            swap_ms = (time.time() - t0) * 1000
            self.log.detail(f"Emergency swap complete ({swap_ms:.0f}ms)")
            s._transcript._save_transcript("SYSTEM", f"Emergency session split ({swap_ms:.0f}ms)")

            # Launch dead air detector — will nudge bot if nobody speaks for 5s
            if s._post_swap_reengagement_task:
                s._post_swap_reengagement_task.cancel()
            s._post_swap_reengagement_task = asyncio.create_task(
                self._post_swap_reengagement(time.time())
            )
        except Exception as e:
            self.log.error(f"Emergency split failed: {e}")
            s._is_reconnecting = True
            # Restart main session loop to trigger reconnection (Fix 4: prevent permanent silence)
            if s._active_receive_task:
                s._active_receive_task.cancel()
            if s.is_active and not s._closing_call:
                s._session_task = asyncio.create_task(self._run_google_live_session())
        finally:
            s._swap_in_progress = False
            s._last_split_time = time.time()

    async def _run_google_live_session(self):
        """Main session loop. Hot-swap handles planned transitions; this handles error recovery."""
        s = self.state
        reconnect_attempts = 0
        max_reconnects = 5

        while s.is_active and reconnect_attempts < max_reconnects:
            ws = None
            try:
                ws = await self._connect_and_setup_ws(is_standby=False)
                s.goog_live_ws = ws
                reconnect_attempts = 0

                if s._reconnect_audio_buffer:
                    self.log.detail(f"Flushing {len(s._reconnect_audio_buffer)} buffered chunks")
                    for buffered_audio in s._reconnect_audio_buffer:
                        await s._audio.handle_plivo_audio(buffered_audio)
                    s._reconnect_audio_buffer = []

                s._active_receive_task = asyncio.create_task(
                    self._ws_receive_loop(ws, is_standby=False)
                )
                await s._active_receive_task
                s._active_receive_task = None

                # If WS was replaced by hot-swap or emergency split, exit this loop
                if s.goog_live_ws is not None and s.goog_live_ws is not ws:
                    return

                # If an emergency split is in progress, it's handling reconnection —
                # do NOT start a competing reconnect (causes duplicate sessions).
                if s._swap_in_progress:
                    self.log.detail("Receive loop ended — emergency split in progress, waiting")
                    # Wait for emergency split to finish, then check if it succeeded
                    for _ in range(50):  # Up to 5 seconds
                        await asyncio.sleep(0.1)
                        if not s._swap_in_progress:
                            break
                    if s.goog_live_ws is not None and s.goog_live_ws is not ws:
                        return  # Emergency split succeeded, new session is active
                    # Emergency split failed, fall through to reconnect

                # Receive loop ended normally (WS closed cleanly, e.g. async for swallowed close).
                # If the call is still active, this is unexpected — reconnect.
                if s.is_active and not s._closing_call:
                    self.log.warn("WS receive loop ended unexpectedly — reconnecting")
                    s._is_reconnecting = True
                    reconnect_attempts += 1
                    asyncio.create_task(s._audio._send_reconnection_filler())
                    await asyncio.sleep(0.2)
                    continue
                break

            except asyncio.CancelledError:
                if s.goog_live_ws is not None and s.goog_live_ws is not ws:
                    return
                break
            except Exception as e:
                self.log.error(f"Google Live error: {e}")
                if ws:
                    await self._close_ws_quietly(ws)
                if s.is_active and not s._closing_call:
                    s._is_reconnecting = True
                    reconnect_attempts += 1
                    self.log.warn(f"Reconnecting ({reconnect_attempts}/{max_reconnects})")
                    asyncio.create_task(s._audio._send_reconnection_filler())
                    await asyncio.sleep(0.2)
                    continue
                break

        # Only null goog_live_ws if we still own it
        if s.goog_live_ws is ws:
            s.goog_live_ws = None

    async def _post_swap_reengagement(self, swap_time: float):
        """Detect dead air after session split and proactively re-engage.
        If neither user nor bot speaks within 5s of a swap, nudge the bot
        so it breaks the silence instead of waiting forever."""
        s = self.state
        try:
            await asyncio.sleep(5.0)
            if s._closing_call or not s.goog_live_ws:
                return
            # If a turn completed or user spoke since swap, someone is talking — no need
            if s._last_agent_turn_end_time and s._last_agent_turn_end_time > swap_time:
                return
            if s._last_user_speech_time and s._last_user_speech_time > swap_time:
                return
            self.log.warn("Post-swap dead air (5s) — nudging AI to re-engage")
            msg = {
                "client_content": {
                    "turns": [{"role": "user", "parts": [{"text": "[The customer is waiting. Say something brief to check if they are still there.]"}]}],
                    "turn_complete": True
                }
            }
            await s.goog_live_ws.send(json.dumps(msg))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Post-swap reengagement error: {e}")

    async def _receive_from_google(self, message):
        s = self.state
        try:
            resp = json.loads(message)

            # Log all Gemini responses for debugging
            resp_keys = list(resp.keys())
            if resp_keys != ['serverContent']:  # Don't log every content message
                logger.debug(f"Gemini response keys: {resp_keys}")

            if "setupComplete" in resp:
                setup_ms = (time.time() - s._setup_sent_time) * 1000 if s._setup_sent_time else 0
                self.log.detail(f"AI ready ({setup_ms:.0f}ms)")
                s.start_streaming = True
                s.setup_complete = True
                s._google_session_start = time.time()
                s._transcript._save_transcript("SYSTEM", f"AI ready ({setup_ms:.0f}ms)")
                if s._is_first_connection:
                    s._is_first_connection = False
                    s._greeting_trigger_time = time.time()
                    await s._prompt_builder._send_initial_greeting()
                    # Pre-warm standby immediately so it's ready before any GoAway
                    if not s._standby_ws and not s._prewarm_task:
                        s._prewarm_task = asyncio.create_task(self._prewarm_standby_connection())
                elif s._is_reconnecting:
                    s._is_reconnecting = False
                    await s._prompt_builder._send_reconnection_trigger()

            # Handle GoAway message - 9-minute warning before 10-minute session limit
            if "goAway" in resp:
                self.log.warn("GoAway — triggering session split")
                s._transcript._save_transcript("SYSTEM", "Session GoAway (10-min limit)")
                if s._standby_ws:
                    asyncio.create_task(self._hot_swap_session())
                else:
                    # No standby — prewarm + swap immediately
                    asyncio.create_task(self._emergency_session_split())
                return

            # Handle tool calls
            if "toolCall" in resp:
                await s._tool_handler._handle_tool_call(resp["toolCall"])
                return

            if "serverContent" in resp:
                sc = resp["serverContent"]

                # Check if turn is complete (greeting done)
                if sc.get("turnComplete"):
                    # Debug: log empty turns to diagnose Twilio preload failures
                    if s._current_turn_audio_chunks == 0:
                        sc_keys = list(sc.keys())
                        has_model_turn = "modelTurn" in sc
                        interrupted = sc.get("interrupted", False)
                        logger.warning(f"[{s.call_uuid[:8]}] turnComplete with 0 audio — provider={s.provider}, turn={s._turn_count}, interrupted={interrupted}, sc_keys={sc_keys}, has_modelTurn={has_model_turn}, plivo_ws={'set' if s.plivo_ws else 'None'}")
                    s._turn_count += 1
                    s._current_turn_id += 1
                    # Mark when greeting finishes (ghost monitor + audio mute anchor to this)
                    if s._turn_count == 1 and s._greeting_completed_time is None:
                        s._greeting_completed_time = time.time()
                        s._greeting_in_progress = False

                    if s._turn_start_time and s._current_turn_audio_chunks > 0:
                        turn_duration_ms = (time.time() - s._turn_start_time) * 1000
                        full_agent = ""
                        full_user = ""
                        if s._current_turn_agent_text:
                            full_agent = " ".join(s._current_turn_agent_text)
                            s._last_agent_text = full_agent
                            if "?" in full_agent:
                                s._last_agent_question = full_agent
                                # Track question sentences for anti-repetition across splits
                                q_sentences = [q_s.strip() for q_s in full_agent.replace("!", ".").replace("?", "?.").split(".") if "?" in q_s]
                                for q in q_sentences[-2:]:
                                    q = q.strip()
                                    if len(q) > 10 and q not in s._questions_asked:
                                        s._questions_asked.append(q)
                                if len(s._questions_asked) > 12:
                                    s._questions_asked = s._questions_asked[-12:]
                            s._current_turn_agent_text = []
                        if s._current_turn_user_text:
                            full_user = " ".join(s._current_turn_user_text)
                            s._last_user_text = full_user
                            s._current_turn_user_text = []

                            # D1b: Garbled audio circuit breaker (check full turn, not fragments)
                            if self._is_garbled(full_user):
                                s._garbled_turn_count += 1
                                self.log.warn(f"Garbled turn text ({s._garbled_turn_count}/3): '{full_user[:60]}'")
                                if s._garbled_turn_count >= 3:
                                    self.log.warn("Garbled audio circuit breaker — 3 consecutive garbled turns")
                                    s._closing_call = True
                                    await s._lifecycle._hangup_call_delayed(1.0)
                            else:
                                s._garbled_turn_count = 0

                        # Accumulate agent text for phase detection (D3c)
                        if full_agent:
                            s._accumulated_agent_text += " " + full_agent

                        # Track turn exchanges for compact summary
                        if full_agent or full_user:
                            s._turn_exchanges.append({"agent": full_agent, "user": full_user})
                            if len(s._turn_exchanges) > 16:
                                s._turn_exchanges = s._turn_exchanges[-16:]

                        # Auto-extract key facts from conversation for session split context
                        if full_user and len(full_user) > 10:
                            user_lower = full_user.lower()
                            # Track pain points mentioned by user
                            pain_keywords = ["challenge", "difficult", "hard", "struggle", "frustrat",
                                             "problem", "issue", "worry", "fear", "concern", "losing",
                                             "behind", "keeping up", "overwhelm"]
                            for kw in pain_keywords:
                                if kw in user_lower and len(s._key_facts) < 8:
                                    fact = f"Pain point (turn {s._turn_count}): {full_user[:120]}"
                                    # Don't add duplicate pain points
                                    if not any("Pain point" in f and full_user[:40] in f for f in s._key_facts):
                                        s._key_facts.append(fact)
                                    break
                            # Track objections
                            objection_keywords = ["expensive", "too much", "can't afford", "not interested",
                                                  "don't need", "no thanks", "not sure", "think about it"]
                            for kw in objection_keywords:
                                if kw in user_lower and len(s._key_facts) < 8:
                                    fact = f"Objection (turn {s._turn_count}): {full_user[:120]}"
                                    if not any("Objection" in f and full_user[:40] in f for f in s._key_facts):
                                        s._key_facts.append(fact)
                                    break
                        if full_agent:
                            # Track what was pitched
                            agent_lower = full_agent.lower()
                            if "gold membership" in agent_lower and not any("Product mentioned" in f for f in s._key_facts):
                                s._key_facts.append("Product mentioned: Gold Membership pitched to customer")

                            # Track objection-handling techniques for anti-repetition across splits
                            technique_patterns = [
                                (["costing you", "cost of", "what if nothing changes", "where does that leave"], "Cost-of-inaction / future projection"),
                                (["the money or", "specifically what's holding"], "Isolate-the-objection (money vs value)"),
                                (["what changes", "different three months", "different six months"], "Future-state challenge"),
                                (["emi", "installment", "per month"], "EMI/payment plan offered"),
                            ]
                            for keywords, technique_name in technique_patterns:
                                if any(kw in agent_lower for kw in keywords):
                                    if technique_name not in s._objection_techniques_used:
                                        s._objection_techniques_used.append(technique_name)

                        # Auto-detect conversation milestones for session split context
                        if full_agent and full_user:
                            agent_lower = (full_agent or "").lower()
                            user_lower = (full_user or "").lower()
                            # Detect when agent pitches/presents the offer
                            pitch_signals = ["program", "membership", "course", "mentorship", "offer",
                                             "designed for", "specifically for", "here's what you get"]
                            if any(s_item in agent_lower for s_item in pitch_signals):
                                m = "Product/program pitched to customer"
                                if m not in s._conversation_milestones:
                                    s._conversation_milestones.append(m)
                            # Detect when customer shows agreement/interest to proceed
                            agreement_signals = ["sounds good", "that's great", "interested", "tell me more",
                                                 "send me", "share me", "go ahead", "sign me up", "i'm in",
                                                 "let's do it", "of course", "definitely"]
                            if any(s_item in user_lower for s_item in agreement_signals):
                                m = f"Customer showed interest/agreed (turn {s._turn_count})"
                                # Keep only the latest agreement milestone
                                s._conversation_milestones = [
                                    x for x in s._conversation_milestones
                                    if not x.startswith("Customer showed interest")
                                ]
                                s._conversation_milestones.append(m)
                            # Detect when pricing/payment is discussed
                            price_signals = ["price", "cost", "payment", "rupees", "₹", "invest",
                                             "fee", "discount", "emi"]
                            if any(s_item in agent_lower for s_item in price_signals):
                                m = "Pricing/payment discussed"
                                if m not in s._conversation_milestones:
                                    s._conversation_milestones.append(m)
                            # Detect when scheduling/next steps discussed
                            schedule_signals = ["schedule", "book", "calendar", "appointment", "demo",
                                                "next step", "follow up", "call back"]
                            if any(s_item in agent_lower for s_item in schedule_signals):
                                m = "Next steps/scheduling discussed"
                                if m not in s._conversation_milestones:
                                    s._conversation_milestones.append(m)

                        # Step manager: silently advance step counter for session-split tracking.
                        # Do NOT inject step guidance during first session — the AI already has the
                        # full prompt and follows its natural flow. Injection only happens on reconnect
                        # (via build_reconnect_prompt in prompt_builder).
                        if s._step_manager and s._step_manager.enabled and full_user:
                            # Only advance on meaningful responses (not garbled STT noise)
                            user_alpha = sum(1 for c in full_user if c.isalpha())
                            is_meaningful = user_alpha >= 5 and not self._is_garbled(full_user)
                            if is_meaningful:
                                prev_step = s._step_manager.current_step
                                next_step = s._step_manager.advance_step()
                                if next_step:
                                    self.log.detail(f"Step {prev_step.id} → {next_step.id}: {next_step.goal}")
                                    # Check if previous step completed the current group → split
                                    prev_index = s._step_manager.current_step_index - 1
                                    if (s._step_split_groups
                                            and s._step_manager.should_split_at_step(prev_index)
                                            and not s._split_pending
                                            and not s._closing_call
                                            and not s.agent_said_goodbye):
                                        s._split_pending = True
                                        s._split_pending_since = time.time()
                                        self.log.detail(f"Step group {s._current_split_group} complete → split pending")
                                    # Step-based prewarm: entering last N steps of current group
                                    elif (s._step_split_groups
                                            and s._step_manager.should_prewarm_at_step(s._step_manager.current_step_index)
                                            and not s._standby_ws
                                            and not s._prewarm_task
                                            and not s._closing_call
                                            and not s.agent_said_goodbye):
                                        s._prewarm_task = asyncio.create_task(self._prewarm_standby_connection())
                                        self.log.detail(f"Step-based prewarm triggered (step {next_step.id}, group {s._current_split_group})")
                                elif prev_step:
                                    # No next step = last step overall; check if group boundary
                                    if (s._step_split_groups
                                            and s._step_manager.should_split_at_step(s._step_manager.current_step_index)
                                            and not s._split_pending
                                            and not s._closing_call
                                            and not s.agent_said_goodbye):
                                        s._split_pending = True
                                        s._split_pending_since = time.time()
                                        self.log.detail(f"Step group {s._current_split_group} complete → split pending")

                        # Accumulate user text for detection engines (product, linguistic mirror, persona)
                        if full_user:
                            s._accumulated_user_text += " " + full_user

                        # Run detection engines in background (non-blocking)
                        if full_user:
                            asyncio.create_task(s._detection._run_detection_engines(
                                full_user, s._accumulated_user_text, full_agent, turn_duration_ms
                            ))

                        # Update timing markers for next turn's response time measurement
                        s._agent_turn_complete_time = time.time()
                        s._user_response_start_time = None

                        extra = ""
                        if s._split_pending:
                            extra = "split pending"
                        elif (s._google_session_start
                              and (time.time() - s._google_session_start) >= (s._session_split_after_seconds - 60)):
                            extra = "prewarm standby"
                        self.log.turn(s._turn_count, extra)
                        if full_agent:
                            self.log.agent(full_agent)
                        if full_user:
                            self.log.user(full_user)
                        # Compute TTFB for this turn (user speech end → first AI audio)
                        ttfb_str = ""
                        if s._turn_first_byte_time and s._last_user_speech_time is None:
                            # _last_user_speech_time was reset when first audio arrived
                            pass
                        self.log.metric(f"{turn_duration_ms:.0f}ms | {s._current_turn_audio_chunks} chunks")
                        s._turn_first_byte_time = None
                        s._turn_start_time = None

                    # Detect empty turn (AI didn't generate audio) - nudge to respond
                    # Skip nudge during post-split cooldown to avoid triple-nudge storm
                    is_empty_turn = s._current_turn_audio_chunks == 0
                    post_split_cooldown = s._last_split_time and (time.time() - s._last_split_time) < 5.0
                    if is_empty_turn and s._turn_count >= 1 and not s._closing_call and not post_split_cooldown:
                        s._empty_turn_nudge_count += 1
                        if s._empty_turn_nudge_count <= 3:
                            self.log.warn(f"Empty turn, nudging AI ({s._empty_turn_nudge_count}/3)")
                            asyncio.create_task(self._send_silence_nudge())
                    else:
                        s._empty_turn_nudge_count = 0

                    # Session split — time-based safety net + fallback for non-NEPQ
                    session_age = (time.time() - s._google_session_start) if s._google_session_start else 0
                    has_step_splits = bool(s._step_split_groups)

                    # Determine split threshold:
                    # - NEPQ with step groups: _max_session_seconds (480s hard ceiling)
                    # - Non-NEPQ: _session_split_after_seconds (dynamic, prompt-size based)
                    split_threshold = s._max_session_seconds if has_step_splits else s._session_split_after_seconds

                    # Pre-warm standby before split threshold (time-based path)
                    # For NEPQ: step-based prewarm (above) is primary; this is safety net
                    prewarm_at = split_threshold - 60
                    if (session_age >= prewarm_at
                            and not s._standby_ws
                            and not s._prewarm_task
                            and not s._closing_call
                            and not s.agent_said_goodbye
                            and s._turn_count >= 1):
                        s._prewarm_task = asyncio.create_task(self._prewarm_standby_connection())
                        label = "safety-net" if has_step_splits else "time-based"
                        self.log.detail(f"Prewarm triggered ({label}, session age: {session_age:.0f}s)")

                    # Set split pending at threshold (defer to silence gap)
                    if (session_age >= split_threshold
                            and not is_empty_turn
                            and not s._closing_call
                            and not s._goodbye_pending
                            and not s.agent_said_goodbye
                            and s._turn_count >= 1
                            and not s._split_pending):
                        s._split_pending = True
                        s._split_pending_since = time.time()
                        label = "safety-net ceiling" if has_step_splits else "time-based"
                        self.log.detail(f"Split pending ({label}, session age: {session_age:.0f}s)")

                    # Reset turn audio counter
                    s._current_turn_audio_chunks = 0
                    s._last_agent_turn_end_time = time.time()

                    # Process deferred goodbye detection (agent finished speaking)
                    if s._goodbye_pending and not s._closing_call:
                        s._goodbye_pending = False
                        self.log.detail("Agent goodbye detected")
                        s.agent_said_goodbye = True
                        s._lifecycle._check_mutual_goodbye()

                if sc.get("interrupted"):
                    # Only clear audio if significant audio has already been sent for this turn.
                    # This prevents residual user noise from wiping out the AI's response
                    # before the user has heard anything.
                    chunks_sent = s._current_turn_audio_chunks
                    has_real_user_speech = s._last_user_transcript_time > 0

                    if not has_real_user_speech:
                        # No user has spoken yet (just background noise from phone pickup).
                        # NEVER clear audio here — the greeting is still playing.
                        self.log.warn(f"AI interrupt IGNORED (no user speech yet — protecting greeting)")
                    elif chunks_sent > 10:
                        # Genuine interruption — user spoke while AI was talking
                        self.log.warn(f"AI interrupted (after {chunks_sent} chunks sent) — clearing audio")
                        while not s._plivo_send_queue.empty():
                            try:
                                s._plivo_send_queue.get_nowait()
                            except asyncio.QueueEmpty:
                                break
                        if s.plivo_ws:
                            await s.plivo_ws.send_text(json.dumps({"event": "clearAudio", "stream_id": s.stream_id}))
                        # Anti-repetition: tell AI what it already said so it doesn't repeat
                        interrupted_text = " ".join(s._current_turn_agent_text) if s._current_turn_agent_text else ""
                        if interrupted_text and s.goog_live_ws:
                            try:
                                await s.goog_live_ws.send(json.dumps({
                                    "client_content": {
                                        "turns": [{"role": "user", "parts": [{"text":
                                            f"[You were interrupted after saying: \"{interrupted_text[:200]}\". "
                                            f"Do NOT repeat this. Respond to what the customer says next.]"
                                        }]}],
                                        "turn_complete": False
                                    }
                                }))
                            except Exception:
                                pass
                    else:
                        # Likely residual noise — don't clear, let the audio play
                        self.log.warn(f"AI interrupt IGNORED (only {chunks_sent} chunks sent — likely noise)")

                # Capture user speech transcription from Gemini
                # Handle both field names: inputTranscription (current API) and inputTranscript (legacy)
                transcription_data = sc.get("inputTranscription") or sc.get("inputTranscript")
                if transcription_data:
                    # Can be a dict {"text": "..."} or a plain string
                    if isinstance(transcription_data, dict):
                        user_text = transcription_data.get("text", "")
                    else:
                        user_text = str(transcription_data)
                    logger.debug(f"[{s.call_uuid[:8]}] Input transcript: {user_text}")
                    if user_text and user_text.strip():
                        user_text = user_text.strip()

                        # Filter out noise/silence markers - NOT real speech
                        is_noise = user_text.startswith('<') and user_text.endswith('>')
                        if not is_noise:
                            # D1c: STT script filter — block hallucinated non-Indic scripts
                            _skip_transcript = False
                            if self._has_blocked_script(user_text):
                                self.log.warn(f"Blocked script detected in STT: '{user_text[:30]}'")
                                _skip_transcript = True
                                # Don't process this text — it's a hallucination
                                if s.goog_live_ws:
                                    try:
                                        await s.goog_live_ws.send(json.dumps({
                                            "client_content": {
                                                "turns": [{"role": "user", "parts": [{"text":
                                                    "[SYSTEM: Audio was unclear. Say: 'I'm having trouble hearing you clearly. Could you repeat that?']"
                                                }]}],
                                                "turn_complete": True
                                            }
                                        }))
                                    except Exception:
                                        pass

                            if not _skip_transcript:

                                s._last_user_speech_time = time.time()  # Track for latency
                                s._last_user_transcript_time = time.time()
                                # Micro-moment: capture when user FIRST speaks this turn
                                if s._user_response_start_time is None:
                                    s._user_response_start_time = time.time()
                                logger.trace(f"[{s.call_uuid[:8]}] USER fragment: {user_text}")
                                s._current_turn_user_text.append(user_text)
                                s._transcript._save_transcript("USER", user_text)
                                s._transcript._log_conversation("user", user_text)
                                # Track if user said goodbye
                                if s._lifecycle._is_goodbye_message(user_text):
                                    logger.debug(f"[{s.call_uuid[:8]}] User goodbye detected")
                                    s.user_said_goodbye = True
                                    s._lifecycle._check_mutual_goodbye()

                                # Voicemail detection — STT keyword check in first 2 turns
                                if s._turn_count <= 2 and not s._closing_call:
                                    vm_text = user_text.lower()
                                    vm_keywords = ["voicemail", "leave a message", "after the tone", "not available",
                                                    "record your message", "after the beep", "mailbox"]
                                    if any(kw in vm_text for kw in vm_keywords):
                                        self.log.warn(f"Voicemail detected via STT: '{user_text[:50]}'")
                                        s._transcript._save_transcript("SYSTEM", f"Voicemail detected: {user_text[:80]}")
                                        s._closing_call = True
                                        await s._lifecycle._hangup_call_delayed(0.5)

                                # D2c: Non-English / regional language detection — graceful exit
                                # Rate-limited: fires once, then 60s cooldown before re-firing
                                if not s._closing_call:
                                    if self._is_non_english(user_text):
                                        s._consecutive_non_english += 1
                                        lang_cooldown = getattr(s, '_lang_barrier_last_fired', 0)
                                        if s._consecutive_non_english >= 3 and (time.time() - lang_cooldown) > 60:
                                            s._lang_barrier_last_fired = time.time()
                                            self.log.warn(f"Language barrier detected — {s._consecutive_non_english} non-English messages")
                                            s._transcript._save_transcript("SYSTEM", f"Language barrier: {s._consecutive_non_english} consecutive non-English messages")
                                            if s.goog_live_ws:
                                                try:
                                                    await s.goog_live_ws.send(json.dumps({
                                                        "client_content": {
                                                            "turns": [{"role": "user", "parts": [{"text":
                                                                "[SYSTEM: The caller is speaking in a regional language (not English). "
                                                                "Say: 'I understand you prefer speaking in your language. Let me have someone message you "
                                                                "in your preferred language on WhatsApp. Take care!' Then call end_call.]"
                                                            }]}],
                                                            "turn_complete": True
                                                        }
                                                    }))
                                                except Exception:
                                                    pass
                                    else:
                                        s._consecutive_non_english = 0

                # Handle AI speech transcription (outputTranscription)
                output_transcription = sc.get("outputTranscription")
                if output_transcription:
                    if isinstance(output_transcription, dict):
                        ai_text = output_transcription.get("text", "")
                    else:
                        ai_text = str(output_transcription)
                    if ai_text and ai_text.strip():
                        ai_text = ai_text.strip()
                        logger.trace(f"[{s.call_uuid[:8]}] AGENT fragment: {ai_text}")
                        s._has_output_transcription = True
                        s._current_turn_agent_text.append(ai_text)
                        s._transcript._save_transcript("AGENT", ai_text)
                        s._transcript._log_conversation("model", ai_text)
                        # Defer goodbye detection to turnComplete (avoid cutting call mid-sentence)
                        if not s._closing_call and s._lifecycle._is_goodbye_message(ai_text):
                            s._goodbye_pending = True

                if "modelTurn" in sc:
                    parts = sc.get("modelTurn", {}).get("parts", [])
                    for p in parts:
                        if p.get("inlineData", {}).get("data"):
                            audio = p["inlineData"]["data"]
                            audio_bytes = base64.b64decode(audio)
                            # Track audio chunks for empty turn detection
                            s._current_turn_audio_chunks += 1
                            # Track turn start time and TTFB
                            if s._current_turn_audio_chunks == 1:
                                s._turn_start_time = time.time()
                                s._turn_first_byte_time = time.time()
                                s._agent_speaking = True
                                s._user_speaking = False
                                # Log greeting TTFB (trigger → first audio)
                                if s._greeting_trigger_time and not s._first_audio_time:
                                    s._first_audio_time = time.time()
                                    ttfb_ms = (s._first_audio_time - s._greeting_trigger_time) * 1000
                                    self.log.detail(f"Greeting TTFB: {ttfb_ms:.0f}ms")
                            # AI audio is recorded in _plivo_sender_worker at send-time (16kHz)

                            # Latency check - only log if slow (> threshold)
                            if s._last_user_speech_time:
                                latency_ms = (time.time() - s._last_user_speech_time) * 1000
                                if latency_ms > LATENCY_THRESHOLD_MS:
                                    self.log.warn(f"Slow response: {latency_ms:.0f}ms")
                                s._last_user_speech_time = None  # Reset after first response

                            if s._mute_audio:
                                # Swap in progress — suppress audio to prevent duplicates
                                pass
                            elif s.plivo_ws:
                                # Send directly to plivo_send_queue
                                chunk = AudioChunk(
                                    audio_b64=audio,
                                    turn_id=s._current_turn_id,
                                    sample_rate=24000
                                )
                                try:
                                    s._plivo_send_queue.put_nowait(chunk)
                                except asyncio.QueueFull:
                                    logger.warning(f"[{s.call_uuid[:8]}] plivo_send_queue full, dropping chunk")
                                # Log first chunk for this turn
                                if s._current_turn_audio_chunks == 1:
                                    logger.debug(f"[{s.call_uuid[:8]}] Audio -> Plivo send queue")
                        if p.get("text"):
                            ai_text = p["text"].strip()
                            logger.debug(f"AI TEXT: {ai_text[:100]}...")
                            # Only save actual speech, not thinking/planning text
                            is_thinking = (
                                ai_text.startswith("**") or
                                ai_text.startswith("I've registered") or
                                ai_text.startswith("I'll ") or
                                "My first step" in ai_text or
                                "I'll be keeping" in ai_text or
                                "maintaining the" in ai_text or
                                "waiting for their response" in ai_text
                            )
                            if ai_text and not is_thinking and len(ai_text) > 3:
                                # Skip entirely if outputTranscription already captured this speech
                                # (prevents duplicate "Got it... Got it..." in transcript and buffer)
                                if not s._has_output_transcription:
                                    s._current_turn_agent_text.append(ai_text)
                                    s._transcript._save_transcript("AGENT", ai_text)
                                    s._transcript._log_conversation("model", ai_text)
                                    # Defer goodbye detection to turnComplete (avoid cutting call mid-sentence)
                                    if not s._closing_call and s._lifecycle._is_goodbye_message(ai_text):
                                        s._goodbye_pending = True

                # Reset per-turn dedup flag AFTER processing all content in this message
                # (moved from turnComplete to avoid resetting before content is processed)
                if sc.get("turnComplete"):
                    s._has_output_transcription = False
        except Exception as e:
            logger.error(f"Error processing Google message: {e} - continuing session")

    async def _send_silence_nudge(self):
        """Send a nudge to AI when silence detected"""
        s = self.state
        if not s.goog_live_ws or s._closing_call:
            return

        try:
            msg = {
                "client_content": {
                    "turns": [{
                        "role": "user",
                        "parts": [{"text": "[Respond to the customer]"}]
                    }],
                    "turn_complete": True
                }
            }
            await s.goog_live_ws.send(json.dumps(msg))
            logger.debug(f"[{s.call_uuid[:8]}] Sent nudge to AI")
        except Exception as e:
            logger.error(f"Error sending silence nudge: {e}")

    async def _send_greeting_nudge(self):
        """Send a greeting-specific nudge during preload when Gemini returns empty turns"""
        s = self.state
        if not s.goog_live_ws or s._closing_call:
            return

        try:
            msg = {
                "client_content": {
                    "turns": [{
                        "role": "user",
                        "parts": [{"text": "[Start speaking now. Say your greeting out loud.]"}]
                    }],
                    "turn_complete": True
                }
            }
            await s.goog_live_ws.send(json.dumps(msg))
            logger.debug(f"[{s.call_uuid[:8]}] Sent greeting nudge to AI")
        except Exception as e:
            logger.error(f"Error sending greeting nudge: {e}")

    async def _inject_situation_hint(self, hint: str):
        """Inject a short situation hint via client_content (no audio pause)."""
        s = self.state
        try:
            msg = {
                "client_content": {
                    "turns": [{"role": "user", "parts": [{"text": hint}]}],
                    "turn_complete": False
                }
            }
            await s.goog_live_ws.send(json.dumps(msg))
        except Exception as e:
            self.log.warn(f"Failed to inject situation hint: {e}")
