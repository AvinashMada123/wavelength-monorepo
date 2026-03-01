"""Detection engines: persona, situation, product, linguistic mirror, micro-moments."""
import asyncio

from loguru import logger


class DetectionEngines:
    """Runs all detection engines and handles intelligence injection."""

    def __init__(self, state, log):
        self.state = state
        self.log = log

    def inject_intelligence(self, brief: str):
        """Store pre-call intelligence brief. Must be called BEFORE preload starts
        so it gets included in the initial system prompt via _send_session_setup_on_ws."""
        if not brief:
            return
        self.state._intelligence_brief = brief
        self.log.detail(f"Intelligence stored ({len(brief)} chars)")

    def inject_social_proof(self, summary: str):
        """Store pre-call social proof summary. Called BEFORE preload starts."""
        if not summary:
            return
        self.state._social_proof_summary = summary
        self.log.detail(f"Social proof stored ({len(summary)} chars)")

    async def _run_detection_engines(self, full_user: str, accumulated_text: str, full_agent: str, turn_duration_ms: float):
        """Run all detection engines in background task (non-blocking to audio path)"""
        s = self.state
        try:
            loop = asyncio.get_event_loop()

            # Persona detection (one-time, locked after first detection)
            if s._use_persona_engine:
                if not s._detected_persona:
                    from src.persona_engine import detect_persona
                    detected = await loop.run_in_executor(
                        None, detect_persona, accumulated_text, s._custom_persona_keywords
                    )
                    if detected:
                        s._detected_persona = detected
                        s._prebuilt_setup_msg = None  # Invalidate — persona changed
                        self.log.detail(f"Persona detected: {detected}")

                # Situation detection (re-evaluated every turn)
                from src.persona_engine import detect_situations, get_situation_hint
                new_situations_list = await loop.run_in_executor(
                    None, detect_situations, full_user, s._custom_situation_keywords
                )
                s._active_situations = new_situations_list
                if s._active_situations:
                    self.log.detail(f"Situations active: {s._active_situations}")
                new_situations = set(s._active_situations) - set(s._previous_situations)
                if new_situations:
                    s._prebuilt_setup_msg = None  # Invalidate — situations changed
                    if s.goog_live_ws:
                        hint = get_situation_hint(list(new_situations)[0], s._custom_situation_keywords)
                        if hint:
                            asyncio.create_task(s._gemini._inject_situation_hint(hint))
                            self.log.detail(f"Injected situation hint: {list(new_situations)[0]}")
                s._previous_situations = list(s._active_situations)

            # Product section detection (only when product intelligence is enabled)
            if s._use_product_intelligence:
                if s._db_product_sections and s._db_product_keywords:
                    # DB keyword matching — progressively reveal sections (cap at 2)
                    from src.persona_engine import _normalize_transcription
                    text_lower = _normalize_transcription(full_user).lower()
                    active = []
                    for section_name, kw_list in s._db_product_keywords.items():
                        if section_name not in s._db_product_sections:
                            continue
                        keywords = kw_list if isinstance(kw_list, list) else kw_list.get("keywords", []) if isinstance(kw_list, dict) else []
                        for kw in keywords:
                            if isinstance(kw, str) and kw.lower() in text_lower:
                                active.append(section_name)
                                break
                    s._active_product_sections = active[:2]
                elif s._db_product_sections:
                    pass  # No keywords — stay empty until keywords provided
                else:
                    from src.product_intelligence import detect_product_sections
                    s._active_product_sections = await loop.run_in_executor(
                        None, detect_product_sections, full_user, s._active_situations
                    )
                if s._active_product_sections != s._previous_product_sections:
                    s._prebuilt_setup_msg = None  # Invalidate — product sections changed
                    self.log.detail(f"Product sections: {s._active_product_sections}")
                s._previous_product_sections = list(s._active_product_sections)

            # Linguistic Mirror
            if accumulated_text:
                from src.linguistic_mirror import detect_linguistic_style, style_changed
                new_style = await loop.run_in_executor(None, detect_linguistic_style, accumulated_text)
                if new_style and style_changed(s._linguistic_style, new_style):
                    s._previous_linguistic_style = dict(s._linguistic_style)
                    s._linguistic_style = new_style
                    s._prebuilt_setup_msg = None  # Invalidate — linguistic style changed
                    self.log.detail(f"Linguistic style: {new_style}")

            # Micro-Moment Detection
            if s._micro_moment_detector:
                response_time_ms = 0
                if s._agent_turn_complete_time and s._user_response_start_time:
                    response_time_ms = (s._user_response_start_time - s._agent_turn_complete_time) * 1000
                mm_hint = await loop.run_in_executor(
                    None, s._micro_moment_detector.record_turn,
                    s._turn_count, full_user, full_agent, response_time_ms, turn_duration_ms
                )
                if mm_hint and s.goog_live_ws:
                    asyncio.create_task(s._gemini._inject_situation_hint(mm_hint))
                    self.log.detail(f"Micro-moment: {s._micro_moment_detector.current_strategy}")

        except Exception as e:
            self.log.warn(f"Detection engine error: {e}")
