"""Call lifecycle: preload, attach, monitors, hangup, stop, and goodbye detection."""
import asyncio
import json
import time
from datetime import datetime

from loguru import logger

from src.core.config import config


class CallLifecycle:
    """Manages the call lifecycle: preloading, attaching, monitoring, and stopping."""

    # Minimum turns before goodbye detection activates (prevents premature call end)
    MIN_TURNS_FOR_GOODBYE = 2

    def __init__(self, state, log):
        self.state = state
        self.log = log

    def _is_goodbye_message(self, text: str) -> bool:
        """Detect if agent is saying goodbye - triggers auto call end.
        Only activates after MIN_TURNS_FOR_GOODBYE to prevent early cutoff."""
        s = self.state
        if s._turn_count < self.MIN_TURNS_FOR_GOODBYE:
            return False

        text_lower = text.lower()
        goodbye_phrases = [
            # Direct goodbyes
            'bye', 'goodbye', 'good bye', 'bye bye', 'buh bye',
            # Take care variants
            'take care', 'take it easy', 'be well', 'stay safe',
            # Talk later variants
            'talk later', 'talk soon', 'talk to you', 'speak soon', 'speak later',
            'catch you later', 'catch up later', 'chat later', 'chat soon',
            # Day wishes
            'have a great', 'have a nice', 'have a good', 'have a wonderful',
            'enjoy your', 'all the best', 'best of luck', 'good luck',
            # Thanks for calling
            'thanks for calling', 'thank you for calling', 'thanks for your time',
            'thank you for your time', 'appreciate your time', 'appreciate you calling',
            # Nice talking
            'nice talking', 'great talking', 'good talking', 'lovely talking',
            'nice chatting', 'great chatting', 'pleasure talking', 'pleasure speaking',
            'enjoyed talking', 'enjoyed our', 'was great speaking',
            # See you
            'see you', 'see ya', 'cya', 'until next time', 'till next time',
            # Ending indicators
            'signing off', 'thats all', "that's all", 'nothing else',
            'we are done', "we're done", 'call ended', 'ending the call'
        ]
        for phrase in goodbye_phrases:
            if phrase in text_lower:
                return True
        return False

    def _check_mutual_goodbye(self):
        """End call when agent says goodbye (don't wait too long for user)"""
        s = self.state
        if s.agent_said_goodbye and not s._closing_call:
            if s.user_said_goodbye:
                logger.info(f"[{s.call_uuid[:8]}] Mutual goodbye - ending call")
                s._closing_call = True
                asyncio.create_task(self._hangup_call_delayed(0.5))  # Quick end
            else:
                # Agent said goodbye but user hasn't - start short timeout
                logger.debug(f"[{s.call_uuid[:8]}] Agent goodbye, waiting 3s for user")
                asyncio.create_task(self._quick_goodbye_timeout(3.0))

    async def _quick_goodbye_timeout(self, timeout: float):
        """Quick timeout after agent says goodbye - don't wait too long"""
        s = self.state
        try:
            await asyncio.sleep(timeout)
            if not s._closing_call and s.agent_said_goodbye:
                logger.debug(f"[{s.call_uuid[:8]}] Goodbye timeout - ending call")
                s._closing_call = True
                await self._hangup_call_delayed(0.5)
        except asyncio.CancelledError:
            pass

    async def preload(self):
        """Preload the Gemini session while phone is ringing"""
        s = self.state
        try:
            s._preload_start_time = time.time()
            self.log.section("CALL INITIATED")
            self.log.phase("PRELOAD")
            self.log.detail(f"Phone: {s.caller_phone} ({s.context.get('customer_name', 'Unknown')})")
            self.log.detail(f"Prompt: {len(s.prompt):,} chars")
            s.is_active = True
            s._session_task = asyncio.create_task(s._gemini._run_google_live_session())
            try:
                await asyncio.wait_for(s._preload_complete.wait(), timeout=8.0)
                preload_ms = (time.time() - s._preload_start_time) * 1000
                self.log.detail_last(f"Preloaded: {len(s.preloaded_audio)} chunks in {preload_ms:.0f}ms")
            except asyncio.TimeoutError:
                preload_ms = (time.time() - s._preload_start_time) * 1000
                self.log.warn(f"Preload timeout ({preload_ms:.0f}ms), {len(s.preloaded_audio)} chunks")
            return True
        except Exception as e:
            self.log.error(f"Preload failed: {e}")
            return False

    def attach_plivo_ws(self, plivo_ws):
        """Attach Plivo WebSocket when user answers"""
        s = self.state
        s.plivo_ws = plivo_ws
        s.call_start_time = datetime.now()
        s._call_answered_time = time.time()
        # Start recording now — gates _record_audio() so pre-answer audio is excluded
        s._rec_started = True
        # Stop silence keepalive — real user audio will flow now
        if s._silence_keepalive_task:
            s._silence_keepalive_task.cancel()
            s._silence_keepalive_task = None
        # Reset agent turn end time to NOW — the greeting is about to play to the caller.
        # Without this, watchdog measures from preload generation time (seconds/minutes ago)
        # and fires a false "unresponsive" alarm while greeting is still playing.
        s._last_agent_turn_end_time = time.time()
        preload_count = len(s.preloaded_audio)
        s._preloaded_chunk_count = preload_count  # Save for watchdog timeout calc
        self.log.phase("CALL ANSWERED")
        if s._preload_start_time:
            wait_ms = (time.time() - s._preload_start_time) * 1000
            self.log.detail(f"Ring duration: {wait_ms:.0f}ms")
        self.log.detail(f"Plivo WS attached, {preload_count} preloaded chunks")
        # Start sender worker BEFORE sending preloaded audio so consumer is ready
        s._sender_worker_task = asyncio.create_task(s._audio._plivo_sender_worker())
        if s.preloaded_audio:
            asyncio.create_task(s._audio._send_preloaded_audio())
        else:
            self.log.warn("No preloaded audio - re-triggering greeting")
            # Re-trigger greeting so Gemini generates it in real-time
            s.greeting_sent = False
            s._greeting_trigger_time = time.time()
            asyncio.create_task(s._prompt_builder._send_initial_greeting())
        # Start call duration timer
        s._timeout_task = asyncio.create_task(self._monitor_call_duration())
        # Start silence monitor (3 second SLA)
        s._silence_monitor_task = asyncio.create_task(self._monitor_silence())
        # Start session watchdog — detects dead Gemini sessions
        asyncio.create_task(self._session_watchdog())
        # Start ghost monologue monitor — ends call if user never speaks
        asyncio.create_task(self._monitor_ghost_monologue())

    async def _monitor_call_duration(self):
        """Monitor call duration with periodic heartbeat and trigger wrap-up at 8 minutes"""
        s = self.state
        try:
            logger.debug(f"[{s.call_uuid[:8]}] Call monitor started")

            # Heartbeat every 60 seconds until wrap-up time
            wrap_up_time = s.max_call_duration - 30  # 7:30
            elapsed = 0

            while elapsed < wrap_up_time:
                await asyncio.sleep(60)
                elapsed += 60
                if s.is_active and not s._closing_call:
                    logger.info(f"[{s.call_uuid[:8]}] Call in progress: {elapsed}s")
                else:
                    return  # Call ended, stop monitoring

                # No-engagement timeout: if user hasn't engaged after 60s, end call
                if elapsed > 60 and s._turn_count <= 1 and not s._closing_call:
                    self.log.warn(f"No engagement after {elapsed:.0f}s — ending call")
                    s._transcript._save_transcript("SYSTEM", "No engagement timeout: user never engaged after 60s")
                    if s.goog_live_ws:
                        try:
                            await s.goog_live_ws.send(json.dumps({
                                "client_content": {
                                    "turns": [{"role": "user", "parts": [{"text":
                                        "[SYSTEM: The caller has not engaged after 60 seconds. "
                                        "Say: 'It seems like this isn't a good time. I'll send you the details on WhatsApp instead. Take care!' "
                                        "Then immediately call end_call.]"
                                    }]}],
                                    "turn_complete": True
                                }
                            }))
                        except Exception:
                            pass
                    # Give 15 seconds for the goodbye message, then force hangup
                    await asyncio.sleep(15.0)
                    if s.is_active and not s._closing_call:
                        s._closing_call = True
                        await self._hangup_call_delayed(1.0)
                    return

            if s.is_active and not s._closing_call:
                logger.info(f"Call {s.call_uuid[:8]} reaching {s.max_call_duration}s limit - triggering wrap-up")
                s._closing_call = True
                await self._send_wrap_up_message()

                # Wait another 30 seconds then force end
                await asyncio.sleep(30)
                if s.is_active:
                    logger.info(f"Call {s.call_uuid[:8]} reached max duration - ending call")
                    await self.stop()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in call duration monitor: {e}")

    async def _send_wrap_up_message(self):
        """Send a message to AI to wrap up the call"""
        s = self.state
        if not s.goog_live_ws:
            return
        try:
            msg = {
                "client_content": {
                    "turns": [{
                        "role": "user",
                        "parts": [{"text": "[SYSTEM: Call time limit reached. Please politely wrap up the conversation now. Say a warm goodbye and end the call gracefully.]"}]
                    }],
                    "turn_complete": True
                }
            }
            await s.goog_live_ws.send(json.dumps(msg))
            logger.info("Sent wrap-up message to AI")
            s._transcript._save_transcript("SYSTEM", "Call time limit - wrapping up")
        except Exception as e:
            logger.error(f"Error sending wrap-up message: {e}")

    async def _monitor_silence(self):
        """Monitor for silence - nudge AI if no response after user speaks.
        IMPORTANT: Do NOT nudge if the AI just finished speaking (it asked a question
        and is waiting for the customer). Only nudge when the customer spoke and the AI
        hasn't responded."""
        s = self.state
        try:
            while s.is_active and not s._closing_call:
                await asyncio.sleep(0.3)  # Check every 0.3 seconds for faster response

                if s._last_user_speech_time is None:
                    continue

                # Guard: If the AI finished speaking AFTER the user's last speech,
                # the AI already responded — no nudge needed. The AI is now waiting
                # for the customer to speak next.
                if (s._last_agent_turn_end_time
                        and s._last_agent_turn_end_time > s._last_user_speech_time):
                    s._last_user_speech_time = None  # Reset, AI already responded
                    continue

                silence_duration = time.time() - s._last_user_speech_time

                # Cooldown: skip nudge if a session split just completed (avoids triple-nudge storm)
                if s._last_split_time and (time.time() - s._last_split_time) < 5.0:
                    continue

                # If silence exceeds SLA, nudge the AI to respond
                if silence_duration >= s._silence_sla_seconds:
                    self.log.warn(f"{silence_duration:.1f}s silence - nudging AI")
                    await s._gemini._send_silence_nudge()
                    # Reset timer to avoid repeated nudges
                    s._last_user_speech_time = None

                # 90-second mid-call silence guard — catches cases where user
                # spoke early then went completely silent (ghost monitor already exited)
                if (s._last_user_speech_time is not None and
                    s._turn_count > 1 and
                    (time.time() - s._last_user_speech_time) > 90 and
                    not s._closing_call and
                    not hasattr(s, '_silence_guard_fired')):
                    s._silence_guard_fired = True
                    self.log.warn("90s silence guard — user went silent mid-call")
                    s._transcript._save_transcript("SYSTEM", "90s silence guard: user went silent")
                    if s.goog_live_ws:
                        try:
                            await s.goog_live_ws.send(json.dumps({
                                "client_content": {
                                    "turns": [{"role": "user", "parts": [{"text":
                                        "[SYSTEM: The caller has been completely silent for 90 seconds. "
                                        "Say: 'Are you still there?' and wait for a response. "
                                        "If they don't respond soon, say goodbye and call end_call.]"
                                    }]}],
                                    "turn_complete": True
                                }
                            }))
                        except Exception:
                            pass

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in silence monitor: {e}")

    async def _monitor_ghost_monologue(self):
        """End call gracefully if user never speaks after greeting.
        3-strike system: check at 15s, 25s, 30s — then end call."""
        s = self.state
        try:
            # Strike 1: Wait 15s after call answer for user to speak
            await asyncio.sleep(15.0)
            if not s.is_active or s._closing_call:
                return
            if s._last_user_speech_time is not None or s._turn_count > 1:
                return  # User spoke, not a ghost

            # User hasn't spoken — send check
            self.log.warn("Ghost monologue strike 1 — user silent 15s, sending check")
            s._transcript._save_transcript("SYSTEM", "Ghost monologue: strike 1, checking")
            if s.goog_live_ws:
                try:
                    await s.goog_live_ws.send(json.dumps({
                        "client_content": {
                            "turns": [{"role": "user", "parts": [{"text":
                                "[SYSTEM: The caller has not spoken at all for 15 seconds. "
                                "Say ONLY: 'Hello, can you hear me?' and wait for a response.]"
                            }]}],
                            "turn_complete": True
                        }
                    }))
                except Exception:
                    pass

            # Strike 2: Wait 10 more seconds
            await asyncio.sleep(10.0)
            if not s.is_active or s._closing_call:
                return
            if s._last_user_speech_time is not None or s._turn_count > 1:
                return

            self.log.warn("Ghost monologue strike 2 — still silent, sending second check")
            s._transcript._save_transcript("SYSTEM", "Ghost monologue: strike 2")
            if s.goog_live_ws:
                try:
                    await s.goog_live_ws.send(json.dumps({
                        "client_content": {
                            "turns": [{"role": "user", "parts": [{"text":
                                "[SYSTEM: The caller STILL has not spoken after 25 seconds. "
                                "Say ONLY: 'I think we may have a bad connection.' and wait briefly.]"
                            }]}],
                            "turn_complete": True
                        }
                    }))
                except Exception:
                    pass

            # Strike 3: Wait 5 more seconds — then end call
            await asyncio.sleep(5.0)
            if not s.is_active or s._closing_call:
                return
            if s._last_user_speech_time is None and s._turn_count <= 1:
                self.log.warn("Ghost monologue strike 3 — ending call")
                s._transcript._save_transcript("SYSTEM", "Ghost monologue: ending call — no user speech after 30s")
                s._closing_call = True
                await self._hangup_call_delayed(1.0)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in ghost monologue monitor: {e}")

    async def _session_watchdog(self):
        """Detect dead Gemini sessions and force reconnection.
        Only fires when the session is GENUINELY dead — not when the AI is mid-generation.
        Key guard: if _current_turn_audio_chunks > 0, the AI is actively generating — NOT stuck."""
        s = self.state
        try:
            # Short initial delay — just enough for greeting audio to start playing
            await asyncio.sleep(5.0)

            while s.is_active and not s._closing_call:
                # Guard: never fire if AI is currently generating audio or swap is in progress
                if s._current_turn_audio_chunks > 0 or s._swap_in_progress or s._agent_speaking:
                    await asyncio.sleep(2.0)
                    continue

                # CRITICAL CHECK: If goog_live_ws is None and we're not already reconnecting,
                # the main session loop died without recovery. Force emergency reconnect.
                if (not s.goog_live_ws
                        and not s._swap_in_progress
                        and s._last_user_audio_time
                        and (time.time() - s._last_user_audio_time) < 5.0):
                    self.log.warn("Session watchdog: WS is None but user audio flowing — forcing reconnect")
                    s._transcript._save_transcript("SYSTEM", "Watchdog: WS dead, forcing reconnect")

                    # Try nudge first before full session split
                    if not s._watchdog_nudge_sent:
                        s._watchdog_nudge_sent = True
                        self.log.warn("Watchdog: trying nudge before session split")
                        if s.goog_live_ws:
                            try:
                                await s.goog_live_ws.send(json.dumps({
                                    "client_content": {
                                        "turns": [{"role": "user", "parts": [{"text":
                                            "[SYSTEM: You seem to have paused. Continue the conversation naturally.]"
                                        }]}],
                                        "turn_complete": True
                                    }
                                }))
                            except Exception:
                                pass
                        await asyncio.sleep(3.0)  # Wait 3s for response
                        if s._current_turn_audio_chunks > 0:
                            s._watchdog_nudge_sent = False
                            continue  # Nudge worked, AI responded

                    asyncio.create_task(s._gemini._emergency_session_split())
                    await asyncio.sleep(10.0)  # Cooldown after reconnect

                    # Track emergency split count and graceful exit after 2 failures
                    s._emergency_split_count += 1
                    if s._emergency_split_count >= 2:
                        self.log.warn("Watchdog: 2 failed splits — graceful exit")
                        s._closing_call = True
                        if s.goog_live_ws:
                            try:
                                await s.goog_live_ws.send(json.dumps({
                                    "client_content": {
                                        "turns": [{"role": "user", "parts": [{"text":
                                            "[SYSTEM: We are having technical difficulties. Say: 'I apologize, we seem to "
                                            "be having some technical issues. Let me send you the details on WhatsApp instead. "
                                            "Thank you for your time!' Then call end_call.]"
                                        }]}],
                                        "turn_complete": True
                                    }
                                }))
                            except Exception:
                                pass
                        return  # Exit watchdog

                    s._watchdog_nudge_sent = False  # Reset for next cycle
                    continue

                # Check: user audio has been flowing but AI has generated
                # ZERO audio chunks since the last turn ended. Session is alive but unresponsive.
                # Use time since CALL ANSWERED (not since agent turn end) to handle the
                # preload gap — greeting completes during preload but user may not answer for 10-20s.
                if s._last_user_audio_time:
                    time_since_user = time.time() - s._last_user_audio_time
                    user_audio_flowing = time_since_user < 5.0

                    if user_audio_flowing and s._last_agent_turn_end_time:
                        time_since_agent = time.time() - s._last_agent_turn_end_time

                        # Post-greeting: user needs time to HEAR the greeting + respond.
                        # Greeting playback takes ~40ms per chunk. Add that to the base 15s timeout
                        # so the user gets a full 15s AFTER the greeting finishes playing.
                        # Cap playback estimate at 15s to avoid disabling the watchdog entirely.
                        greeting_playback_s = min(s._preloaded_chunk_count * 0.04, 15.0)
                        post_greeting_timeout = greeting_playback_s + 15.0
                        if s._turn_count <= 1 and time_since_agent > post_greeting_timeout and not getattr(s, '_post_greeting_watchdog_fired', False):
                            s._post_greeting_watchdog_fired = True
                            self.log.warn(f"Session watchdog: AI unresponsive for {time_since_agent:.0f}s after greeting "
                                          f"(timeout={post_greeting_timeout:.0f}s, playback={greeting_playback_s:.1f}s) — forcing reconnect")
                            s._transcript._save_transcript("SYSTEM", "Watchdog: AI unresponsive post-greeting, forcing reconnect")

                            # Try nudge first before full session split
                            if not s._watchdog_nudge_sent:
                                s._watchdog_nudge_sent = True
                                self.log.warn("Watchdog: trying nudge before session split")
                                if s.goog_live_ws:
                                    try:
                                        await s.goog_live_ws.send(json.dumps({
                                            "client_content": {
                                                "turns": [{"role": "user", "parts": [{"text":
                                                    "[SYSTEM: You seem to have paused. Continue the conversation naturally.]"
                                                }]}],
                                                "turn_complete": True
                                            }
                                        }))
                                    except Exception:
                                        pass
                                await asyncio.sleep(3.0)  # Wait 3s for response
                                if s._current_turn_audio_chunks > 0:
                                    s._watchdog_nudge_sent = False
                                    continue  # Nudge worked, AI responded

                            asyncio.create_task(s._gemini._emergency_session_split())
                            await asyncio.sleep(10.0)  # Cooldown after reconnect

                            # Track emergency split count and graceful exit after 2 failures
                            s._emergency_split_count += 1
                            if s._emergency_split_count >= 2:
                                self.log.warn("Watchdog: 2 failed splits — graceful exit")
                                s._closing_call = True
                                if s.goog_live_ws:
                                    try:
                                        await s.goog_live_ws.send(json.dumps({
                                            "client_content": {
                                                "turns": [{"role": "user", "parts": [{"text":
                                                    "[SYSTEM: We are having technical difficulties. Say: 'I apologize, we seem to "
                                                    "be having some technical issues. Let me send you the details on WhatsApp instead. "
                                                    "Thank you for your time!' Then call end_call.]"
                                                }]}],
                                                "turn_complete": True
                                            }
                                        }))
                                    except Exception:
                                        pass
                                return  # Exit watchdog

                            s._watchdog_nudge_sent = False  # Reset for next cycle
                            continue

                        # General unresponsive check for mid-call (turn > 1)
                        if time_since_agent > 10.0 and s._turn_count > 1:
                            self.log.warn(f"Session watchdog: AI unresponsive for {time_since_agent:.0f}s "
                                          f"— forcing reconnect")
                            s._transcript._save_transcript("SYSTEM", "Watchdog: AI unresponsive, forcing reconnect")

                            # Try nudge first before full session split
                            if not s._watchdog_nudge_sent:
                                s._watchdog_nudge_sent = True
                                self.log.warn("Watchdog: trying nudge before session split")
                                if s.goog_live_ws:
                                    try:
                                        await s.goog_live_ws.send(json.dumps({
                                            "client_content": {
                                                "turns": [{"role": "user", "parts": [{"text":
                                                    "[SYSTEM: You seem to have paused. Continue the conversation naturally.]"
                                                }]}],
                                                "turn_complete": True
                                            }
                                        }))
                                    except Exception:
                                        pass
                                await asyncio.sleep(3.0)  # Wait 3s for response
                                if s._current_turn_audio_chunks > 0:
                                    s._watchdog_nudge_sent = False
                                    continue  # Nudge worked, AI responded

                            asyncio.create_task(s._gemini._emergency_session_split())
                            await asyncio.sleep(10.0)  # Cooldown after reconnect

                            # Track emergency split count and graceful exit after 2 failures
                            s._emergency_split_count += 1
                            if s._emergency_split_count >= 2:
                                self.log.warn("Watchdog: 2 failed splits — graceful exit")
                                s._closing_call = True
                                if s.goog_live_ws:
                                    try:
                                        await s.goog_live_ws.send(json.dumps({
                                            "client_content": {
                                                "turns": [{"role": "user", "parts": [{"text":
                                                    "[SYSTEM: We are having technical difficulties. Say: 'I apologize, we seem to "
                                                    "be having some technical issues. Let me send you the details on WhatsApp instead. "
                                                    "Thank you for your time!' Then call end_call.]"
                                                }]}],
                                                "turn_complete": True
                                            }
                                        }))
                                    except Exception:
                                        pass
                                return  # Exit watchdog

                            s._watchdog_nudge_sent = False  # Reset for next cycle
                            continue

                await asyncio.sleep(2.0)  # Check every 2 seconds
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in session watchdog: {e}")

    async def _hangup_call_delayed(self, delay: float):
        """Hang up the call after a short delay (audio is queued in provider buffer)"""
        s = self.state
        try:
            await asyncio.sleep(delay)

            hangup_uuid = s.plivo_call_uuid or s.call_uuid
            self.log.detail(f"{s.provider} hangup API: {hangup_uuid}")

            import httpx
            import base64

            max_attempts = 2  # Initial attempt + 1 retry
            for attempt in range(max_attempts):
                try:
                    t0 = time.time()

                    if s.provider == "twilio":
                        # Twilio: POST to update call status to "completed"
                        account_sid = s.twilio_account_sid or config.twilio_account_sid
                        auth_token = s.twilio_auth_token or config.twilio_auth_token
                        url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Calls/{hangup_uuid}.json"

                        async with httpx.AsyncClient() as client:
                            response = await client.post(
                                url,
                                auth=(account_sid, auth_token),
                                data={"Status": "completed"},
                            )
                            api_ms = (time.time() - t0) * 1000

                            if response.status_code in [200, 204]:
                                self.log.detail(f"Twilio hangup OK ({api_ms:.0f}ms)")
                                break  # Success, no retry needed
                            else:
                                self.log.error(f"Twilio hangup failed: {response.status_code} ({api_ms:.0f}ms)")
                                if attempt < max_attempts - 1:
                                    self.log.detail("Retrying hangup in 1s...")
                                    await asyncio.sleep(1.0)
                    else:
                        # Plivo: DELETE call resource
                        auth_id = s.plivo_auth_id or config.plivo_auth_id
                        auth_token = s.plivo_auth_token or config.plivo_auth_token
                        auth_string = f"{auth_id}:{auth_token}"
                        auth_b64 = base64.b64encode(auth_string.encode()).decode()

                        url = f"https://api.plivo.com/v1/Account/{auth_id}/Call/{hangup_uuid}/"

                        async with httpx.AsyncClient() as client:
                            response = await client.delete(
                                url,
                                headers={"Authorization": f"Basic {auth_b64}"}
                            )
                            api_ms = (time.time() - t0) * 1000

                            if response.status_code in [204, 200]:
                                self.log.detail(f"Plivo hangup OK ({api_ms:.0f}ms)")
                                break  # Success, no retry needed
                            else:
                                self.log.error(f"Plivo hangup failed: {response.status_code} ({api_ms:.0f}ms)")
                                if attempt < max_attempts - 1:
                                    self.log.detail("Retrying hangup in 1s...")
                                    await asyncio.sleep(1.0)

                except Exception as e:
                    logger.error(f"Error hanging up call {s.call_uuid} (attempt {attempt + 1}): {type(e).__name__}: {e}")
                    if attempt < max_attempts - 1:
                        self.log.detail("Retrying hangup in 1s...")
                        await asyncio.sleep(1.0)
                    else:
                        import traceback
                        traceback.print_exc()

        except Exception as e:
            logger.error(f"Error hanging up call {s.call_uuid}: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # Always stop the session
            if s.is_active:
                await self.stop()

    async def _fallback_hangup(self, timeout: float):
        """Fallback hangup if user doesn't respond after agent says goodbye"""
        s = self.state
        try:
            await asyncio.sleep(timeout)
            if not s._closing_call and s.agent_said_goodbye:
                logger.info(f"Fallback hangup - user didn't respond within {timeout}s after agent goodbye")
                s._closing_call = True
                await self._hangup_call_delayed(1.0)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Fallback hangup error: {e}")

    async def stop(self):
        s = self.state
        if not s.is_active:
            return

        s.is_active = False
        self.log.section("CALL ENDED")

        # Cancel all tasks
        for task in [s._timeout_task, s._silence_monitor_task,
                     s._sender_worker_task, s._standby_task,
                     s._prewarm_task, s._active_receive_task,
                     s._post_swap_reengagement_task]:
            if task:
                task.cancel()

        # Close standby WS
        if s._standby_ws:
            await s._gemini._close_ws_quietly(s._standby_ws)
            s._standby_ws = None

        # Calculate call duration and log summary
        duration = 0
        if s.call_start_time:
            duration = (datetime.now() - s.call_start_time).total_seconds()
            mins = int(duration // 60)
            secs = duration % 60
            self.log.detail(f"Duration: {mins}m {secs:.0f}s | Turns: {s._turn_count}")
            if s._first_audio_time and s._greeting_trigger_time:
                ttfb = (s._first_audio_time - s._greeting_trigger_time) * 1000
                self.log.detail(f"Greeting TTFB: {ttfb:.0f}ms")
            if s._call_answered_time and s._preload_start_time:
                preload_total = (s._call_answered_time - s._preload_start_time) * 1000
                self.log.detail_last(f"Preload→Answer: {preload_total:.0f}ms")
            s._transcript._save_transcript("SYSTEM", f"Call duration: {duration:.1f}s, turns: {s._turn_count}")

        if s.goog_live_ws:
            try:
                await s.goog_live_ws.close()
            except Exception:
                pass
        if s._session_task:
            s._session_task.cancel()

        s._transcript._save_transcript("SYSTEM", "Call ended")

        # Trigger post-call GHL workflows (tag-based)
        for wf in s._ghl_workflows:
            if wf.get("timing") == "post_call" and wf.get("enabled") and wf.get("tag"):
                if not s.ghl_api_key or not s.ghl_location_id:
                    logger.warning(f"Post-call GHL workflow '{wf.get('name', wf.get('id', '?'))}' skipped — GHL API key or Location ID not configured")
                    continue
                try:
                    from src.services.ghl_whatsapp import tag_ghl_contact
                    result = await tag_ghl_contact(
                        phone=s.caller_phone,
                        email=s.context.get("email", ""),
                        api_key=s.ghl_api_key,
                        location_id=s.ghl_location_id,
                        tag=wf["tag"],
                    )
                    self.log.detail(f"Post-call GHL workflow '{wf.get('name', wf['id'])}' tag '{wf['tag']}': {result}")
                except Exception as e:
                    logger.warning(f"Post-call GHL workflow '{wf.get('name', wf.get('id', '?'))}' failed: {e}")

        # Stop recording thread
        if s._recording_queue:
            s._recording_queue.put(None)  # Shutdown signal
        if s._recording_thread:
            s._recording_thread.join(timeout=2.0)

        # Stop transcript writer thread
        if s._transcript_queue:
            s._transcript_queue.put(None)  # Shutdown signal
        if s._transcript_thread:
            s._transcript_thread.join(timeout=2.0)

        # Stop conversation logger thread
        if s._conversation_queue:
            s._conversation_queue.put(None)  # Shutdown signal
        if s._conversation_thread:
            s._conversation_thread.join(timeout=2.0)

        s._post_call._start_post_call_processing(duration)
