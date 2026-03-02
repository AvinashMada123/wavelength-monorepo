"""TurnManager — orchestrates STT -> LLM -> TTS pipeline. Implements AIBackend.

Critical concurrency design:
- Only ONE LLM turn runs at a time (enforced by _turn_lock)
- inject_text() queues messages; a background task drains the queue
- LLM and TTS run in parallel via a TTS queue (true pipelining)
- Barge-in requires substantive speech (not just filler words)
"""
import asyncio
import base64
import re
import time
from typing import Optional

from loguru import logger

from .stt_client import DeepgramSTTClient
from .llm_client import GeminiTextClient, TextChunk, ToolCall, TurnComplete, ErrorEvent
from .tts_client import GeminiTTSClient
from .audio_converter import resample_24k_to_16k, mulaw_to_pcm16k
from .audio_pipeline import AudioChunk


class TurnManager:
    """Orchestrates STT -> LLM -> TTS pipeline. Implements AIBackend."""

    def __init__(self, state, log):
        self.state = state
        self.log = log

        self.stt = DeepgramSTTClient(state, log)
        self.llm = GeminiTextClient(state, log)
        self.tts = GeminiTTSClient(state, log)

        self._is_agent_speaking = False
        self._pending_user_text: list[str] = []

        # Concurrency control
        self._turn_lock = asyncio.Lock()

        # Queue for inject_text messages
        self._inject_queue: asyncio.Queue = asyncio.Queue()
        self._inject_processor_task: Optional[asyncio.Task] = None

        # Barge-in state
        self._barge_in_pending = False
        self._barge_in_timer: Optional[asyncio.TimerHandle] = None
        self._interim_text_buffer = ""

        # Filler words (configurable per-bot)
        self._filler_words = state.context.pop("_barge_in_fillers", None) or {
            "uh", "um", "hmm", "hm", "ok", "okay", "haan", "ha", "accha",
            "right", "yeah", "yep", "mhm", "theek hai", "bas", "aur",
            "matlab", "woh", "arre", "han ji",
        }
        if isinstance(self._filler_words, list):
            self._filler_words = set(self._filler_words)

        # Agent audio tracking
        self._agent_text_spoken = ""

        # Task handles
        self._tts_task: Optional[asyncio.Task] = None
        self._tts_queue: Optional[asyncio.Queue] = None
        self._current_turn_task: Optional[asyncio.Task] = None

        # Canned audio (pre-synthesized during start())
        self._canned_one_moment: Optional[bytes] = None

    # --- AIBackend interface ---

    async def start(self, plivo_ws):
        """Initialize all three clients, trigger greeting."""
        s = self.state

        # Start sender worker (shared with Live API path)
        s._sender_worker_task = asyncio.create_task(s._audio._plivo_sender_worker())

        # Start Deepgram STT
        self.stt.on_transcript_final = self._on_transcript_final
        self.stt.on_transcript_interim = self._on_transcript_interim
        self.stt.on_speech_started = self._on_speech_started
        self.stt.on_utterance_end = self._on_utterance_end
        await self.stt.start()

        # Build system prompt and configure LLM
        system_prompt = s._prompt_builder.build_text_system_prompt()
        self.llm.set_system_prompt(system_prompt)
        self.llm.set_tools(s._prompt_builder.get_tool_declarations_for_text_api())

        # Pre-synthesize canned "One moment please" audio
        asyncio.create_task(self._presynthesize_canned_audio())

        # Run greeting turn
        greeting_trigger = s._prompt_builder.build_greeting_trigger()
        s.greeting_sent = True
        s._greeting_trigger_time = time.time()
        await self._run_llm_turn(greeting_trigger)

        # Start inject processor loop
        self._inject_processor_task = asyncio.create_task(self._inject_processor_loop())

        self.log.detail(f"Traditional pipeline started (voice: {self.tts._voice})")

    async def handle_audio(self, audio_data):
        """Forward audio to Deepgram STT + record for post-call.

        audio_data can be:
        - str (base64 encoded, from Plivo)
        - dict with 'payload' key (from Twilio)
        """
        s = self.state

        # Decode audio
        if isinstance(audio_data, dict):
            # Twilio format: {'payload': base64_audio, ...}
            raw = base64.b64decode(audio_data.get("payload", ""))
            # Twilio sends 8kHz mu-law — convert to 16kHz PCM
            audio_bytes = mulaw_to_pcm16k(raw)
        else:
            # Plivo format: base64 string of 16kHz PCM
            audio_bytes = base64.b64decode(audio_data)

        # Record user audio
        s._audio._record_audio("USER", audio_bytes, 16000)

        # Track user audio timing
        s._last_user_audio_time = time.time()

        # Forward to Deepgram STT
        await self.stt.send_audio(audio_bytes)

    async def inject_text(self, text: str, turn_complete: bool = True):
        """Inject system message — fire-and-forget for callers.

        Always puts the message on _inject_queue. The _inject_processor_loop
        background task drains it and acquires _turn_lock independently.
        """
        await self._inject_queue.put((text, turn_complete))

    async def send_tool_response(self, call_id: str, tool_name: str, response: dict):
        """Not used directly in traditional pipeline.

        Tool responses are handled inside _run_llm_turn via _execute_tool.
        This method exists for AIBackend interface compliance.
        """
        pass

    async def stop(self):
        """Close Deepgram WS, cancel TTS tasks, cancel inject processor."""
        if self._inject_processor_task:
            self._inject_processor_task.cancel()
            self._inject_processor_task = None

        if self._current_turn_task:
            self._current_turn_task.cancel()
            self._current_turn_task = None

        if self._tts_task:
            self._tts_task.cancel()
            self._tts_task = None

        await self.stt.close()

    # --- Background tasks ---

    async def _inject_processor_loop(self):
        """Background task that drains _inject_queue.

        Each turn is spawned as a SEPARATE task (create_task), not awaited
        directly. This ensures that barge-in cancelling _current_turn_task
        only kills the turn, not the processor loop itself.
        """
        s = self.state
        while s.is_active:
            try:
                text, turn_complete = await self._inject_queue.get()

                if not turn_complete:
                    # Context injection only — no lock needed
                    self.llm.append_context(text)
                else:
                    # Spawn turn as separate task
                    task = asyncio.create_task(self._run_llm_turn(text))
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass  # Turn cancelled by barge-in; loop continues

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Inject processor error: {e}")

    async def _tts_consumer(self, tts_queue: asyncio.Queue):
        """Background task that consumes sentences from tts_queue and synthesizes.

        Runs in parallel with the LLM iteration loop (true pipelining).
        """
        s = self.state
        try:
            while True:
                sentence = await tts_queue.get()
                if sentence is None:
                    break  # Signal: turn complete or tool call pause

                try:
                    async for audio_24k in self.tts.synthesize(sentence):
                        if self.tts._cancelled:
                            break

                        # Resample 24k -> 16k BEFORE queuing and recording
                        audio_16k = resample_24k_to_16k(audio_24k)
                        if not audio_16k:
                            continue

                        # Queue to Plivo sender
                        chunk = AudioChunk(
                            audio_b64=base64.b64encode(audio_16k).decode(),
                            turn_id=s._current_turn_id,
                            sample_rate=16000,
                        )
                        try:
                            s._plivo_send_queue.put_nowait(chunk)
                        except asyncio.QueueFull:
                            pass

                        # Record agent audio at 16kHz
                        s._audio._record_audio("AI", audio_16k, 16000)

                        # Track timing
                        if s._first_audio_time is None:
                            s._first_audio_time = time.time()
                        s._last_ai_audio_time = time.time()
                        s._current_turn_audio_chunks += 1

                    self._agent_text_spoken += sentence

                except Exception as e:
                    logger.error(f"TTS consumer error: {e}")
                    # Skip this sentence, try next

        except asyncio.CancelledError:
            pass

    async def _presynthesize_canned_audio(self):
        """Pre-synthesize 'One moment please' audio during startup."""
        try:
            audio_chunks = []
            async for chunk in self.tts.synthesize("One moment please."):
                audio_chunks.append(resample_24k_to_16k(chunk))
            self._canned_one_moment = b"".join(audio_chunks)
        except Exception as e:
            logger.error(f"Failed to pre-synthesize canned audio: {e}")

    # --- STT callbacks ---

    async def _on_transcript_final(self, text: str, confidence: float):
        """Accumulate final transcript text."""
        s = self.state
        if not text.strip():
            return

        self._pending_user_text.append(text)

        # Save transcript
        s._transcript._save_transcript("USER", text)

        # Track for latency
        s._last_user_speech_time = time.time()

        # Check barge-in: if pending and this is substantive, trigger
        if self._barge_in_pending and self._is_substantive(text):
            await self._handle_barge_in()

    async def _on_transcript_interim(self, text: str):
        """Log interim transcript. Check for barge-in with substantive text."""
        if not text.strip():
            return

        self._interim_text_buffer = text

        # If barge-in pending: check if text is substantive
        if self._barge_in_pending and self._is_substantive(text):
            await self._handle_barge_in()

    async def _on_utterance_end(self):
        """User stopped speaking. Collect text and send to LLM."""
        s = self.state
        if not self._pending_user_text:
            return

        # Collect accumulated text
        full_text = " ".join(self._pending_user_text)
        self._pending_user_text.clear()

        # Clear barge-in state
        self._barge_in_pending = False
        if self._barge_in_timer:
            self._barge_in_timer.cancel()
            self._barge_in_timer = None
        self._interim_text_buffer = ""

        if not full_text.strip():
            return

        # Track user speech
        s._last_user_speech_time = time.time()
        s._current_turn_user_text.append(full_text)

        # User response timing (for micro-moment detection)
        if s._agent_turn_complete_time and s._user_response_start_time is None:
            s._user_response_start_time = time.time()

        # Pre-checks: DND, voicemail, non-English
        if await self._pre_check_user_text(full_text):
            return  # Handled (e.g., end_call triggered)

        # Send to LLM (bypass inject queue for lower latency)
        asyncio.create_task(self._run_llm_turn(full_text))

    async def _on_speech_started(self):
        """User started speaking. Handle barge-in if agent is talking."""
        s = self.state
        s._user_speaking = True
        s._user_speech_start_time = time.time()

        if not self._is_agent_speaking:
            return  # Agent not talking, just note user is speaking

        # Agent IS speaking — set barge-in pending
        self._barge_in_pending = True
        self._interim_text_buffer = ""

        # Start 2s safety timeout: if no interim transcript, force cancel TTS
        loop = asyncio.get_event_loop()
        if self._barge_in_timer:
            self._barge_in_timer.cancel()
        self._barge_in_timer = loop.call_later(
            2.0, lambda: asyncio.create_task(self._force_barge_in_timeout())
        )

    # --- Internal orchestration ---

    async def _run_llm_turn(self, user_text: str):
        """Send to LLM, stream response through TTS to Plivo.

        TRUE PIPELINING: LLM and TTS run concurrently via a queue.
        """
        s = self.state

        async with self._turn_lock:
            # Self-register as the active turn AFTER acquiring lock
            self._current_turn_task = asyncio.current_task()

            try:
                accumulated_text = ""
                tts_buffer = ""
                self._is_agent_speaking = True
                self._barge_in_pending = False
                self._agent_text_spoken = ""
                s._current_turn_audio_chunks = 0
                s._turn_start_time = time.time()
                tool_result = None
                is_first_sentence = True

                while True:  # Tool call loop
                    # Create TTS consumer for this generation cycle
                    self._tts_queue = asyncio.Queue()
                    self._tts_task = asyncio.create_task(
                        self._tts_consumer(self._tts_queue)
                    )
                    self._is_agent_speaking = True  # Reset for post-tool continuation

                    async for event in self.llm.generate(user_text, tool_result):
                        if isinstance(event, TextChunk):
                            accumulated_text += event.text
                            tts_buffer += event.text

                            if self._should_flush_tts(tts_buffer, is_first_sentence):
                                await self._tts_queue.put(tts_buffer)
                                tts_buffer = ""
                                is_first_sentence = False

                        elif isinstance(event, ToolCall):
                            # Force-flush remaining buffer
                            if tts_buffer.strip():
                                await self._tts_queue.put(tts_buffer)
                                tts_buffer = ""
                            # Signal TTS consumer to drain
                            await self._tts_queue.put(None)
                            await self._tts_task

                            # Agent NOT speaking during tool execution
                            self._is_agent_speaking = False
                            self._barge_in_pending = False

                            # Execute tool
                            tool_result = await self._execute_tool(event)
                            user_text = None  # Continue with tool result
                            break  # Break inner loop -> continue outer while

                        elif isinstance(event, ErrorEvent):
                            # Play canned "one moment" audio if available
                            if self._canned_one_moment:
                                chunk = AudioChunk(
                                    audio_b64=base64.b64encode(
                                        self._canned_one_moment
                                    ).decode(),
                                    turn_id=s._current_turn_id,
                                    sample_rate=16000,
                                )
                                try:
                                    s._plivo_send_queue.put_nowait(chunk)
                                except asyncio.QueueFull:
                                    pass

                        elif isinstance(event, TurnComplete):
                            if tts_buffer.strip():
                                await self._tts_queue.put(tts_buffer)
                                tts_buffer = ""
                            await self._tts_queue.put(None)  # Signal TTS done
                            await self._tts_task

                            self.tts.reset()
                            self._signal_turn_complete(
                                accumulated_text, user_text or ""
                            )
                            # History summarization (non-blocking)
                            asyncio.create_task(
                                self.llm._maybe_summarize_history_bg()
                            )
                            return

                    else:
                        # Inner for-loop exhausted without break (no ToolCall)
                        break

            except asyncio.CancelledError:
                # Barge-in cancelled this turn
                raise
            finally:
                # ALWAYS reset on any exit path (synchronous only)
                self._is_agent_speaking = False
                self._barge_in_pending = False
                self._current_turn_task = None

    def _should_flush_tts(self, buffer: str, is_first: bool) -> bool:
        """Determine if TTS buffer should be flushed.

        First sentence: flush at 60+ chars OR sentence boundary.
        Later sentences: flush at sentence boundary OR 100+ chars.
        """
        if not buffer.strip():
            return False

        # Sentence boundary detection
        has_boundary = bool(re.search(r'[.!?:]\s*$', buffer))

        if is_first:
            return has_boundary or len(buffer) >= 60
        else:
            return has_boundary or len(buffer) >= 100

    async def _execute_tool(self, tool_call_event: ToolCall) -> dict:
        """Execute a tool call and return the result dict."""
        s = self.state

        # Build tool_call dict matching the format ToolHandler expects
        tool_call_dict = {
            "functionCalls": [{
                "name": tool_call_event.name,
                "args": tool_call_event.args,
                "id": tool_call_event.id,
            }]
        }

        # Execute with send_response=False (we handle the result)
        results = await s._tool_handler._handle_tool_call(
            tool_call_dict, send_response=False
        )

        if results and len(results) > 0:
            r = results[0]
            return {
                "name": r["name"],
                "response": r["response"],
            }
        return {
            "name": tool_call_event.name,
            "response": {"success": False, "message": "Tool execution failed"},
        }

    def _signal_turn_complete(self, agent_text: str, user_text: str):
        """Replicate turnComplete processing from gemini_ws.py."""
        s = self.state

        s._turn_count += 1
        s._current_turn_id += 1

        # Mark greeting completion
        if s._turn_count == 1 and s._greeting_completed_time is None:
            s._greeting_completed_time = time.time()
            s._greeting_in_progress = False

        full_agent = agent_text.strip()
        full_user = user_text.strip() if user_text else ""

        # Also check _current_turn_user_text for accumulated STT text
        if s._current_turn_user_text:
            full_user = " ".join(s._current_turn_user_text)
            s._current_turn_user_text = []

        # Update last text trackers
        if full_agent:
            s._last_agent_text = full_agent
            s._current_turn_agent_text = []

            if "?" in full_agent:
                s._last_agent_question = full_agent
                q_sentences = [
                    q_s.strip()
                    for q_s in full_agent.replace("!", ".").replace("?", "?.").split(".")
                    if "?" in q_s
                ]
                for q in q_sentences[-2:]:
                    q = q.strip()
                    if len(q) > 10 and q not in s._questions_asked:
                        s._questions_asked.append(q)
                if len(s._questions_asked) > 12:
                    s._questions_asked = s._questions_asked[-12:]

            # Accumulate agent text for phase detection
            s._accumulated_agent_text += " " + full_agent

        if full_user:
            s._last_user_text = full_user

            # Garbled audio circuit breaker
            if s._gemini._is_garbled(full_user):
                s._garbled_turn_count += 1
                self.log.warn(
                    f"Garbled turn text ({s._garbled_turn_count}/3): '{full_user[:60]}'"
                )
                if s._garbled_turn_count >= 3:
                    self.log.warn("Garbled audio circuit breaker")
                    s._closing_call = True
                    asyncio.create_task(s._lifecycle._hangup_call_delayed(1.0))
            else:
                s._garbled_turn_count = 0

        # Track turn exchanges
        if full_agent or full_user:
            s._turn_exchanges.append({"agent": full_agent, "user": full_user})
            if len(s._turn_exchanges) > 16:
                s._turn_exchanges = s._turn_exchanges[-16:]

        # Auto-extract key facts
        if full_user and len(full_user) > 10:
            self._extract_key_facts(full_user, full_agent)

        # Auto-detect milestones
        if full_agent and full_user:
            self._detect_milestones(full_agent, full_user)

        # Accumulate user text for detection engines
        if full_user:
            s._accumulated_user_text += " " + full_user

        # Run detection engines in background
        if full_user:
            turn_ms = (time.time() - s._turn_start_time) * 1000 if s._turn_start_time else 0
            asyncio.create_task(s._detection._run_detection_engines(
                full_user, s._accumulated_user_text, full_agent, turn_ms
            ))

        # Update timing markers
        s._agent_turn_complete_time = time.time()
        s._user_response_start_time = None
        s._last_agent_turn_end_time = time.time()

        # Log turn
        self.log.turn(s._turn_count, "")
        if full_agent:
            self.log.agent(full_agent)
            s._transcript._save_transcript("AGENT", full_agent)
        if full_user:
            self.log.user(full_user)
        if s._turn_start_time:
            turn_ms = (time.time() - s._turn_start_time) * 1000
            self.log.metric(f"{turn_ms:.0f}ms | {s._current_turn_audio_chunks} chunks")

        s._turn_first_byte_time = None
        s._turn_start_time = None

    def _extract_key_facts(self, full_user: str, full_agent: str):
        """Extract key facts from user/agent text (pain points, objections)."""
        s = self.state
        user_lower = full_user.lower()

        pain_keywords = [
            "challenge", "difficult", "hard", "struggle", "frustrat",
            "problem", "issue", "worry", "fear", "concern", "losing",
            "behind", "keeping up", "overwhelm",
        ]
        for kw in pain_keywords:
            if kw in user_lower and len(s._key_facts) < 8:
                fact = f"Pain point (turn {s._turn_count}): {full_user[:120]}"
                if not any("Pain point" in f and full_user[:40] in f for f in s._key_facts):
                    s._key_facts.append(fact)
                break

        objection_keywords = [
            "expensive", "too much", "can't afford", "not interested",
            "don't need", "no thanks", "not sure", "think about it",
        ]
        for kw in objection_keywords:
            if kw in user_lower and len(s._key_facts) < 8:
                fact = f"Objection (turn {s._turn_count}): {full_user[:120]}"
                if not any("Objection" in f and full_user[:40] in f for f in s._key_facts):
                    s._key_facts.append(fact)
                break

        if full_agent:
            agent_lower = full_agent.lower()
            if "gold membership" in agent_lower and not any(
                "Product mentioned" in f for f in s._key_facts
            ):
                s._key_facts.append("Product mentioned: Gold Membership pitched")

            technique_patterns = [
                (["costing you", "cost of", "what if nothing changes"], "Cost-of-inaction"),
                (["the money or", "specifically what's holding"], "Isolate-the-objection"),
                (["what changes", "different three months"], "Future-state challenge"),
                (["emi", "installment", "per month"], "EMI/payment plan offered"),
            ]
            for keywords, name in technique_patterns:
                if any(kw in agent_lower for kw in keywords):
                    if name not in s._objection_techniques_used:
                        s._objection_techniques_used.append(name)

    def _detect_milestones(self, full_agent: str, full_user: str):
        """Auto-detect conversation milestones."""
        s = self.state
        agent_lower = full_agent.lower()
        user_lower = full_user.lower()

        pitch_signals = [
            "program", "membership", "course", "mentorship", "offer",
            "designed for", "specifically for", "here's what you get",
        ]
        if any(sig in agent_lower for sig in pitch_signals):
            m = "Product/program pitched to customer"
            if m not in s._conversation_milestones:
                s._conversation_milestones.append(m)

        agreement_signals = [
            "sounds good", "that's great", "interested", "tell me more",
            "send me", "share me", "go ahead", "sign me up", "i'm in",
            "let's do it", "of course", "definitely",
        ]
        if any(sig in user_lower for sig in agreement_signals):
            m = f"Customer showed interest/agreed (turn {s._turn_count})"
            s._conversation_milestones = [
                x for x in s._conversation_milestones
                if not x.startswith("Customer showed interest")
            ]
            s._conversation_milestones.append(m)

        price_signals = [
            "price", "cost", "payment", "rupees", "₹", "invest",
            "fee", "discount", "emi",
        ]
        if any(sig in agent_lower for sig in price_signals):
            m = "Pricing/payment discussed"
            if m not in s._conversation_milestones:
                s._conversation_milestones.append(m)

        schedule_signals = [
            "schedule", "book", "calendar", "appointment", "demo",
            "next step", "follow up", "call back",
        ]
        if any(sig in agent_lower for sig in schedule_signals):
            m = "Next steps/scheduling discussed"
            if m not in s._conversation_milestones:
                s._conversation_milestones.append(m)

    # --- Barge-in ---

    def _is_substantive(self, text: str) -> bool:
        """Check if text has at least one word NOT in filler_words."""
        words = text.lower().split()
        for word in words:
            # Strip punctuation
            clean = re.sub(r'[^\w\s]', '', word).strip()
            if clean and clean not in self._filler_words:
                return True
        return False

    async def _handle_barge_in(self):
        """Cancel TTS + LLM, clear audio queue, release turn lock."""
        s = self.state

        self._barge_in_pending = False
        if self._barge_in_timer:
            self._barge_in_timer.cancel()
            self._barge_in_timer = None

        self.log.detail("Barge-in: cancelling agent speech")

        # 1. Cancel TTS synthesis
        await self.tts.cancel()

        # 2. Cancel TTS consumer task
        if self._tts_task:
            self._tts_task.cancel()
            self._tts_task = None

        # 3. Cancel the entire _run_llm_turn task
        if self._current_turn_task:
            self._current_turn_task.cancel()

        # 4. Drain _plivo_send_queue of chunks with current turn_id
        drained = 0
        while not s._plivo_send_queue.empty():
            try:
                chunk = s._plivo_send_queue.get_nowait()
                if chunk.turn_id != s._current_turn_id:
                    # Put back chunks from other turns
                    s._plivo_send_queue.put_nowait(chunk)
                    break
                drained += 1
            except asyncio.QueueEmpty:
                break

        if drained:
            self.log.detail(f"Barge-in: drained {drained} audio chunks")

        # 5. Truncate assistant message in LLM history to what was spoken
        self.llm.truncate_last_model_message(self._agent_text_spoken)

    async def _force_barge_in_timeout(self):
        """Safety timeout: if barge-in pending for >2s with no transcript, force cancel."""
        if self._barge_in_pending:
            self.log.detail("Barge-in: 2s timeout, forcing cancel")
            await self._handle_barge_in()

    # --- Pre-checks on user text ---

    async def _pre_check_user_text(self, text: str) -> bool:
        """Run pre-checks on user text (DND, voicemail, non-English).

        Returns True if the text was handled (caller should not proceed to LLM).
        """
        s = self.state
        text_lower = text.lower()

        # Voicemail detection
        voicemail_phrases = [
            "leave a message", "leave your message", "not available",
            "press one", "press 1", "at the tone", "after the beep",
            "mailbox is full", "voicemail",
        ]
        if any(phrase in text_lower for phrase in voicemail_phrases):
            self.log.warn(f"Voicemail detected: '{text[:50]}'")
            s._transcript._save_transcript("SYSTEM", "Voicemail detected — ending call")
            s._closing_call = True
            asyncio.create_task(s._lifecycle._hangup_call_delayed(1.0))
            return True

        # Hold detection (IVR)
        hold_phrases = [
            "please hold", "your call is important", "all agents are busy",
            "hold the line", "we will connect", "estimated wait",
        ]
        if any(phrase in text_lower for phrase in hold_phrases):
            self.log.warn(f"Hold/IVR detected: '{text[:50]}'")
            s._transcript._save_transcript("SYSTEM", "IVR/hold detected — ending call")
            s._closing_call = True
            asyncio.create_task(s._lifecycle._hangup_call_delayed(1.0))
            return True

        # Non-English detection
        if s._gemini._is_non_english(text):
            s._consecutive_non_english += 1
            if s._consecutive_non_english >= 3:
                self.log.warn("Non-English language barrier — ending call")
                s._transcript._save_transcript("SYSTEM", "Language barrier: 3 consecutive non-English")
                await s._ai_backend.inject_text(
                    "[SYSTEM: The caller is speaking a language you cannot understand. "
                    "Say: 'I'm sorry, I can only assist in English. Take care!' "
                    "Then call end_call.]"
                )
                return True
        else:
            s._consecutive_non_english = 0

        return False
