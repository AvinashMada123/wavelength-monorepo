"""Prompt building, tool declarations, voice detection, and setup message construction."""
import json
import time
from loguru import logger

from src.core.config import config
from src.conversational_prompts import render_prompt


# Latency threshold - only log if slower than this (ms)
# 250ms silence_duration_ms + ~200ms Gemini inference = ~450ms baseline; warn above 1000ms
LATENCY_THRESHOLD_MS = 1000


def get_vertex_ai_token():
    """Get OAuth2 access token for Vertex AI"""
    try:
        import google.auth
        from google.auth.transport.requests import Request

        scopes = [
            'https://www.googleapis.com/auth/cloud-platform',
            'https://www.googleapis.com/auth/generative-language',
            'https://www.googleapis.com/auth/generative-language.retriever',
        ]
        t0 = time.time()
        credentials, project = google.auth.default(scopes=scopes)
        credentials.refresh(Request())
        token_ms = (time.time() - t0) * 1000
        logger.info(f"Vertex AI token for {project} ({token_ms:.0f}ms)")
        return credentials.token
    except Exception as e:
        logger.error(f"Failed to get Vertex AI token: {e}")
        return None


def detect_voice_from_prompt(prompt: str) -> str:
    """Detect voice based on prompt content. Returns 'Kore' for female, 'Puck' for male (default).

    Only checks the IDENTITY line (first line) for agent name to avoid matching customer names.
    Explicit 'Female Voice'/'Male Voice' directives take highest priority anywhere in prompt.
    """
    if not prompt:
        return "Puck"
    prompt_lower = prompt.lower()

    # HIGHEST PRIORITY: Explicit voice directive in prompt (e.g. "Must use Female Voice")
    if "male voice" in prompt_lower:
        # Check female first since "female voice" also contains "male voice"
        if "female voice" in prompt_lower:
            logger.info("Explicit 'Female Voice' directive in prompt - using Kore")
            return "Kore"
        logger.info("Explicit 'Male Voice' directive in prompt - using Puck")
        return "Puck"

    # Extract only the IDENTITY line (first line or line containing "IDENTITY:")
    # to avoid matching customer names like "Priya" in the rest of the prompt
    identity_line = ""
    for line in prompt_lower.split("\n"):
        line = line.strip()
        if line.startswith("identity:") or line.startswith("identity :"):
            identity_line = line
            break
    if not identity_line:
        # Fallback: use just the first non-empty line
        for line in prompt_lower.split("\n"):
            if line.strip():
                identity_line = line.strip()
                break

    # Check agent name in identity line only
    female_indicators = [
        "mousumi", "priya", "anjali", "divya", "neha", "pooja", "shreya",
        "sunita", "anita", "kavita", "rekha", "meena", "sita", "geeta"
    ]
    for indicator in female_indicators:
        if indicator in identity_line:
            logger.info(f"Detected female agent name '{indicator}' in identity - using Kore voice")
            return "Kore"

    male_names = [
        "rahul", "vishnu", "avinash", "arjun", "raj", "amit", "vijay", "suresh",
        "mahesh", "ramesh", "ganesh", "kiran", "sanjay", "ajay", "ravi", "kumar"
    ]
    for name in male_names:
        if name in identity_line:
            logger.info(f"Detected male agent name '{name}' in identity - using Puck voice")
            return "Puck"

    # Default to male voice
    return "Puck"


# Tool definitions for Gemini Live (minimal for lower latency)
# NOTE: WhatsApp messaging disabled during calls to reduce latency/interruptions
TOOL_DECLARATIONS = [
    {
        "name": "end_call",
        "description": "End the phone call. Call this IMMEDIATELY when: 1) The customer says 'not interested', 'don't call me', 'wrong number', or any rejection. 2) Both you AND the customer have said goodbye/bye/take care — call end_call with NO additional text. 3) The customer explicitly asks to hang up. CRITICAL: If you already said 'bye'/'take care'/'goodbye' and the customer responds with 'bye'/'okay bye'/'thanks bye', call end_call IMMEDIATELY without generating ANY text. Do NOT say goodbye twice.",
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {"type": "string"}
            },
            "required": ["reason"]
        }
    },
    {
        "name": "save_user_info",
        "description": "Save important information the user shared about themselves. Call this whenever the user tells you their name, company, job role, or other key personal details. This helps remember them for future calls.",
        "parameters": {
            "type": "object",
            "properties": {
                "company": {
                    "type": "string",
                    "description": "The company or organization the user works at, if mentioned"
                },
                "role": {
                    "type": "string",
                    "description": "The user's job title or role, if mentioned"
                },
                "name": {
                    "type": "string",
                    "description": "The user's name, if they introduce themselves"
                },
                "key_detail": {
                    "type": "string",
                    "description": "Any other important detail the user shared (e.g. 'referred by a friend', 'looking to switch careers')"
                }
            }
        }
    },
    {
        "name": "switch_language",
        "description": "Switch the voice language for this call. Call this IMMEDIATELY when the customer chooses a language (e.g. 'Hindi please', 'Tamil', 'English'). Supported languages: en-IN (English India), hi-IN (Hindi), ta-IN (Tamil), te-IN (Telugu), bn-IN (Bengali), kn-IN (Kannada), ml-IN (Malayalam), gu-IN (Gujarati). After calling this, continue speaking in the chosen language.",
        "parameters": {
            "type": "object",
            "properties": {
                "language_code": {
                    "type": "string",
                    "description": "The language code to switch to, e.g. 'hi-IN' for Hindi, 'ta-IN' for Tamil, 'en-IN' for English"
                }
            },
            "required": ["language_code"]
        }
    },
    {
        "name": "get_social_proof",
        "description": "Get social proof statistics to reference in conversation. Call this when you learn the prospect's company, city, or job role, to get real numbers you can mention naturally.",
        "parameters": {
            "type": "object",
            "properties": {
                "company": {
                    "type": "string",
                    "description": "The company/organization the prospect works at (e.g. 'Wipro', 'TCS', 'Infosys')"
                },
                "city": {
                    "type": "string",
                    "description": "The city the prospect is in (e.g. 'Hyderabad', 'Bangalore', 'Mumbai')"
                },
                "role": {
                    "type": "string",
                    "description": "The prospect's job role (e.g. 'Software Engineer', 'Data Analyst', 'Product Manager')"
                }
            }
        }
    }
]


class PromptBuilder:
    """Builds setup messages, tool declarations, and manages voice detection."""

    def __init__(self, state, log):
        self.state = state
        self.log = log

    def _get_tool_declarations(self):
        """Build tool declarations dynamically based on session capabilities."""
        s = self.state
        # Only include get_social_proof tool if social proof is enabled
        tools = [t for t in TOOL_DECLARATIONS if t["name"] != "get_social_proof" or s._social_proof_enabled]

        # Add configurable GHL workflow tools (during_call only — pre/post are handled server-side)
        seen_tool_names = {t["name"] for t in tools}
        for wf in s._ghl_workflows:
            wf_id = wf.get("id", "")
            if not wf_id:
                continue  # Skip workflows with empty/missing ID
            if wf.get("timing") == "during_call" and wf.get("enabled") and wf.get("tag"):
                tool_name = f"ghl_workflow_{wf_id}"
                if tool_name in seen_tool_names:
                    continue  # Skip duplicate tool names
                seen_tool_names.add(tool_name)
                base_desc = wf.get("description", f"Trigger the '{wf.get('name', 'workflow')}' workflow")
                # Append strict commitment criteria to prevent false triggers on tentative responses
                commitment_guard = (
                    " ONLY call this workflow when the user says explicit words like "
                    "'yes I'll attend', 'count me in', 'I'll be there', 'I'm coming', "
                    "'yes definitely', 'sure I'll come'. "
                    "NEVER call this on tentative responses like 'okay', 'maybe', "
                    "'let me check', 'send me details', 'I'll think about it', 'hmm'."
                )
                tools.append({
                    "name": tool_name,
                    "description": base_desc + commitment_guard,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "reason": {
                                "type": "string",
                                "description": "Why you're triggering this workflow now"
                            }
                        },
                        "required": ["reason"]
                    }
                })

        # Legacy: keep send_whatsapp if GHL creds are set but no workflows configured
        if s.ghl_api_key and s.ghl_location_id and not s._ghl_workflows:
            tools.append({
                "name": "send_whatsapp",
                "description": "Send a WhatsApp message to the caller via the configured workflow. Use this when your prompt instructs you to send a WhatsApp message. Can only be sent once per call.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "reason": {
                            "type": "string",
                            "description": "Brief reason for sending the message, e.g. 'welcome message after greeting'"
                        }
                    },
                    "required": ["reason"]
                }
            })
        return tools

    def _build_setup_message(self) -> dict:
        """Build the complete setup message dict (prompt + config).
        Expensive but safe to run ahead of time during prewarm."""
        s = self.state
        # On session splits (not first connection), strip greeting instructions from memory
        # to prevent the AI from re-greeting mid-call
        if not s._is_first_connection and s.context.get("_memory_context"):
            # Use the IMMUTABLE original memory context as source — prevents progressive
            # degradation across multiple session splits (each split was re-stripping the
            # already-stripped version, losing more context each time)
            if not hasattr(s, "_original_memory_context"):
                s._original_memory_context = str(s.context["_memory_context"])  # Immutable copy
            raw = s._original_memory_context
            # Strip GREETING, AFTER GREETING, and FLOW lines to prevent re-greeting on session splits
            cleaned = "\n".join(
                line for line in raw.split("\n")
                if not line.strip().startswith(("GREETING:", "AFTER GREETING:", "FLOW:"))
            )
            cleaned += "\n[You are CONTINUING a mid-call conversation. Do NOT greet or re-introduce yourself.]"
            s.context["_memory_context"] = cleaned

        # Linguistic Mirror: build style instruction
        from src.linguistic_mirror import compose_mirror_instruction
        mirror_inst = compose_mirror_instruction(s._linguistic_style)

        if s._use_persona_engine:
            # UI prompt is ALWAYS the base — persona engine adds DB-configured prompts
            full_prompt = s.prompt

            # Add detected persona prompt
            if s._detected_persona:
                if s._custom_persona_keywords:
                    persona_label = s._detected_persona
                    persona_config = s._custom_persona_keywords.get(s._detected_persona, {})
                    persona_prompt = persona_config.get("prompt", "") if isinstance(persona_config, dict) else ""
                else:
                    persona_label = s._detected_persona.replace("_", " ").title()
                    persona_prompt = ""

                if persona_prompt:
                    full_prompt += f"\n\n[PERSONA: {persona_label}]\n{persona_prompt}"
                else:
                    # Fallback: generic hint if no custom prompt configured
                    full_prompt += (
                        f"\n\n[PERSONA DETECTED: {persona_label}. "
                        f"Tailor your pitch to resonate with their specific needs, priorities, and pain points.]"
                    )
                self.log.detail(f"Persona prompt injected: {persona_label} ({len(persona_prompt)} chars)")
            else:
                self.log.detail("No persona detected yet — prompt has no persona hint")

            # Add situation prompts — use DB prompts if available, fall back to hardcoded
            _FALLBACK_SITUATION_HINTS = {
                "price_objection": "Price Concern — Focus on value and ROI rather than price. Don't discount.",
                "high_interest": "High Interest — Customer is showing strong interest. Guide toward next steps and closing.",
                "skepticism": "Skepticism — Build credibility with facts, real results, and social proof.",
                "time_objection": "Time Concern — Emphasize flexibility, self-paced options, and minimal time commitment.",
                "competitor_comparison": "Competitor Comparison — Differentiate your offering, highlight unique strengths.",
            }
            for situation in s._active_situations[:2]:
                sit_prompt = ""
                if s._custom_situation_keywords:
                    sit_config = s._custom_situation_keywords.get(situation, {})
                    sit_prompt = sit_config.get("prompt", "") if isinstance(sit_config, dict) else ""
                if sit_prompt:
                    full_prompt += f"\n\n[SITUATION: {situation}]\n{sit_prompt}"
                else:
                    fallback = _FALLBACK_SITUATION_HINTS.get(situation, situation.replace("_", " ").title())
                    full_prompt += f"\n[SITUATION: {fallback}]"

            if mirror_inst:
                full_prompt += "\n\n" + mirror_inst
        else:
            full_prompt = s.prompt
            if mirror_inst:
                full_prompt += "\n\n" + mirror_inst

        # Product knowledge sections (loaded for both persona engine and direct prompt mode)
        if s._active_product_sections:
            if s._db_product_sections:
                # Use per-bot-config DB sections (not global file-based ones)
                parts = [s._db_product_sections[k] for k in s._active_product_sections if k in s._db_product_sections]
                product_content = "\n\n".join(parts) if parts else ""
            else:
                from src.product_intelligence import load_product_sections
                product_content = load_product_sections(s._active_product_sections)
            if product_content:
                full_prompt += "\n\n" + product_content

        # Speech style guidance removed — Gemini native audio handles this naturally,
        # and per-bot-config prompts can include tone instructions if needed.

        # Inject pre-call intelligence into system prompt (not as user message)
        if s._intelligence_brief:
            full_prompt += (
                "\n\n[BACKGROUND INTEL ON PROSPECT'S COMPANY/INDUSTRY — optional reference only. "
                "NEVER use this in your opening or greeting. Only reference IF the customer brings up "
                "their company or industry first. NEVER mention you looked anything up. "
                "IMPORTANT: This is about the COMPANY/INDUSTRY only — not the person. "
                "If the prospect's memory (above) contains their role, background, or interests, "
                "ALWAYS trust the memory over this intel. Never contradict memory data. "
                "Do NOT weave intel into conversation unprompted — wait for the customer to mention it.]\n"
                f"{s._intelligence_brief}"
            )

        # Pre-call social proof summary (generic aggregate stats)
        if s._social_proof_summary:
            if s._social_proof_min_turn and s._social_proof_min_turn > 0:
                full_prompt += (
                    f"\n\n[SOCIAL PROOF STATS - enrollment data you can reference ONLY after turn {s._social_proof_min_turn}. "
                    f"Do NOT call get_social_proof or reference enrollment numbers until you have completed at least {s._social_proof_min_turn} turns of discovery. "
                    "Focus on understanding the prospect first. Here are aggregate stats for later use:]\n"
                    f"{s._social_proof_summary}"
                )
            else:
                full_prompt += (
                    "\n\n[SOCIAL PROOF STATS - enrollment data you can reference naturally. "
                    "When the prospect mentions their company, city, or role, call get_social_proof "
                    "to get specific numbers. For now, here are aggregate stats:]\n"
                    f"{s._social_proof_summary}"
                )

        # Cross-call memory: injected inside compose_prompt() for persona engine,
        # but must be appended manually in direct prompt mode
        if s.context.get("_memory_context"):
            if not s._use_persona_engine:
                full_prompt += "\n\n" + s.context["_memory_context"]
            self.log.detail(f"Memory context injected ({len(s.context['_memory_context'])} chars)")

        # Real-time search usage instructions (only if live search is enabled)
        if config.enable_live_search:
            full_prompt += (
                "\n\nREAL-TIME KNOWLEDGE: You have access to Google Search. "
                "When the customer mentions their company, role, industry, or any specific entity, "
                "you may naturally reference relevant recent information. "
                "CRITICAL RULES: "
                "1) NEVER say 'I searched' or 'according to my research' or 'I found that' "
                "2) Weave information naturally: 'Oh [company], I heard they just...' "
                "3) Only use search when it genuinely helps the conversation "
                "4) Keep responses SHORT (1-2 sentences max) even when using search results"
            )

        # Inject current date/time so the AI knows "today" for all calls
        from datetime import datetime as _dt
        _now = _dt.now()
        full_prompt += f"\n\n[CURRENT DATE/TIME: {_now.strftime('%A, %B %d, %Y at %I:%M %p')}]"

        # Minimal universal rules — safety net for prompts that lack their own.
        full_prompt += (
            "\n\n[CORE RULES] "
            "1) Max 1-2 sentences, then STOP and WAIT for the customer to respond. "
            "NEVER answer your own questions. NEVER generate the customer's response. "
            "NEVER put words in the customer's mouth or complete their sentences. "
            "You are ONLY the agent — never role-play both sides of the conversation. "
            "NEVER continue talking after asking a question. "
            "Always end your response with a question. Never end on a statement and wait silently. "
            "2) If you receive context about a previous conversation, do NOT acknowledge it. "
            "Just wait for the customer to speak, then respond naturally. "
            "3) You have a maximum of 2 attempts to present any single offer. After 2 attempts "
            "without a clear yes or no, you MUST move to one of: (a) ask what is holding them back, "
            "(b) offer an alternative date/time, (c) acknowledge their hesitation and give them space. "
            "If you have mentioned the same session, event, or offer in two separate turns, your attempts "
            "are used up. Do NOT rephrase and repeat the same offer a third time. "
            "4) When the customer gives a short response (1-3 words) that determines a yes/no decision, "
            "confirm their intent before acting on it. Say 'Just to confirm, you would like to join?' "
            "before triggering any workflow or pivoting to a rejection fallback. "
            "5) When ending a call, say your closing phrase exactly once. Do not say goodbye or "
            "'see you tonight' or 'looking forward' more than once. "
            "If you already said 'bye'/'take care' and the customer responds, "
            "call end_call IMMEDIATELY with zero text — do NOT say another goodbye. "
            "6) IMPORTANT: The customer's speech is transcribed by speech-to-text which can be INACCURATE. "
            "If the customer's response seems garbled, nonsensical, or doesn't match the context, "
            "assume POSITIVE intent (e.g. they probably said 'yes'/'sure'/'okay') and continue the conversation. "
            "NEVER treat a garbled/unclear response as a rejection or 'not interested'. "
            "If truly ambiguous, ask a simple clarifying question like 'Sorry, could you say that again?' "
            "7) INFORMATIONAL STEPS: When a step is purely informational (no question asked), "
            "deliver the information and IMMEDIATELY continue to the next step in the same turn. "
            "Do NOT wait for 'okay' or acknowledgment on purely informational statements. "
            "Only wait when you explicitly ask a question or need the customer to do something. "
            "8) NEVER GET STUCK: If the customer asks you for information you have (names, details, etc.), "
            "TELL THEM directly. Do NOT repeatedly say 'check WhatsApp' if they are asking YOU. "
            "If you have context variables with the answer, share it. "
            "If you've asked the same thing twice and the customer can't answer, help them or move on. "
            "9) STEP TRACKING: Always remember which step you are on. After a conversation summary, "
            "check the summary for the last completed step and continue from the NEXT step. "
            "NEVER restart from Step 1 or repeat earlier steps that were already completed."
        )

        # On reconnect or hot-swap, append conversation context + anti-repetition
        # to system_instruction so AI knows where the conversation is.
        if not s._is_first_connection:
            summary = s._prompt_builder._build_compact_summary()
            if summary:
                full_prompt += f"\n\n[CONVERSATION SO FAR — you are mid-call, do NOT greet again:]\n{summary}"
                # Anti-repetition — compact, includes both sides + milestones
                agent_ref = s._last_agent_text or s._last_agent_question
                if agent_ref:
                    last_user = s._last_user_text or "(customer is about to respond)"
                    milestone_hint = ""
                    if s._conversation_milestones:
                        milestone_hint = (
                            f' ALREADY ACCOMPLISHED: {"; ".join(s._conversation_milestones)}. '
                            'These topics are DONE — never revisit them.'
                        )
                    full_prompt += (
                        f'\n\n[ANTI-REPETITION — Last exchange: You said: "{agent_ref[:400]}" '
                        f'Customer replied: "{last_user[:400]}".{milestone_hint} '
                        'Pick up EXACTLY from here. Respond directly to what the customer '
                        'just said and move the conversation FORWARD to a NEW topic. '
                        'Do NOT rephrase, re-pitch, or revisit anything from the conversation above. '
                        'Do NOT ask a question similar to anything already asked above.]'
                    )
                # Explicit questions blacklist for the new session
                if s._questions_asked:
                    questions_list = "; ".join(f'"{q[:80]}"' for q in s._questions_asked[-6:])
                    full_prompt += (
                        f'\n\n[QUESTIONS ALREADY ASKED — DO NOT ask these or anything similar: {questions_list}. '
                        'Ask something COMPLETELY NEW.]'
                    )
                # Explicit techniques blacklist for the new session
                if s._objection_techniques_used:
                    techniques_list = "; ".join(s._objection_techniques_used)
                    full_prompt += (
                        f'\n\n[OBJECTION TECHNIQUES ALREADY TRIED: {techniques_list}. '
                        'You MUST use a DIFFERENT technique next time.]'
                    )
                # Extra guard for post-greeting reconnects: the AI already greeted,
                # so NEVER repeat the greeting even if the summary includes it
                if s.greeting_sent and s._turn_count <= 1:
                    full_prompt += (
                        "\n\n[CRITICAL: You already greeted the customer with your opening line. "
                        "Do NOT say your greeting again. Do NOT introduce yourself again. "
                        "Do NOT say your name or company name again. "
                        "Simply respond to whatever the customer says next — like 'Hello' or 'Hi'.]"
                    )
                self.log.detail(f"Setup with summary ({len(summary)} chars)")
            else:
                file_history = s._transcript._load_conversation_from_file()
                if file_history:
                    history_text = "\n\n[Recent conversation - continue from here:]\n"
                    for msg_item in file_history[-s._max_history_size:]:
                        role = "Customer" if msg_item["role"] == "user" else "You"
                        history_text += f"{role}: {msg_item['text']}\n"
                    history_text += "\n[Continue naturally. Do NOT greet again.]"
                    full_prompt += history_text
                    s._is_reconnecting = False
                else:
                    # Emergency split with no turns recorded yet — greeting was already played
                    # but no conversation history exists. Prevent re-greeting.
                    if s.greeting_sent:
                        full_prompt += (
                            "\n\n[SESSION RESUMED — you already greeted the customer. "
                            "Do NOT greet again. Do NOT introduce yourself again. "
                            "Wait silently for the customer to speak first, then respond naturally.]"
                        )
                        self.log.detail("Setup with no-regreet guard (no turns yet)")

        # Render variables in the full composed prompt so {agent_name}, {company_name}
        # etc. work inside persona content, situation content, and product sections too
        full_prompt = render_prompt(full_prompt, s.context)

        # Voice MUST be passed via API — no auto-detection from prompt
        if s._resolved_voice is None:
            s._resolved_voice = s.context.get("_voice") or s._tts_voice
        voice_name = s._resolved_voice
        if not voice_name:
            logger.warning(f"[{s.call_uuid[:8]}] Live API: No voice specified — pass 'voice' in API request")

        if config.use_vertex_ai:
            model_name = f"projects/{config.vertex_project_id}/locations/{config.vertex_location}/publishers/google/models/gemini-live-2.5-flash-native-audio"
        else:
            model_name = "models/gemini-2.5-flash-native-audio-preview-12-2025"

        # Language/accent for Live API TTS — must be passed via API
        language_code = s._tts_language

        # Build speech_config dynamically — only include voice/language if provided
        speech_config = {}
        if language_code:
            speech_config["language_code"] = language_code
        if voice_name:
            speech_config["voice_config"] = {
                "prebuilt_voice_config": {"voice_name": voice_name}
            }

        msg = {
            "setup": {
                "model": model_name,
                "generation_config": {
                    "response_modalities": ["AUDIO"],
                    "speech_config": speech_config,
                    "thinking_config": {
                        "thinking_budget": 0  # Disable reasoning for fastest responses
                    }
                },
                "realtime_input_config": {
                    "automatic_activity_detection": {
                        "disabled": False,
                        "start_of_speech_sensitivity": "START_SENSITIVITY_HIGH",
                        "end_of_speech_sensitivity": "END_SENSITIVITY_HIGH",
                        "prefix_padding_ms": 100,
                        "silence_duration_ms": 800,
                    }
                },
                "input_audio_transcription": {},
                "output_audio_transcription": {},
                "system_instruction": {"parts": [{"text": full_prompt}]},
                "tools": [
                    {"function_declarations": self._get_tool_declarations()},
                    *([] if not config.enable_live_search else [{"google_search": {}}])
                ]
            }
        }
        return msg

    def _build_compact_summary(self) -> str:
        """Build compact conversation summary for session split.
        Includes PROGRESS (what's been accomplished) + KEY FACTS + recent turn history."""
        s = self.state
        if not s._turn_exchanges and not s._key_facts and not s._conversation_milestones and not s._questions_asked:
            return ""
        lines = []

        # CONVERSATION PROGRESS — critical for preventing repetition after splits
        # This tells the AI exactly where the conversation is, so it doesn't restart the pitch
        if s._conversation_milestones:
            lines.append("CONVERSATION PROGRESS (already accomplished — do NOT repeat these):")
            for milestone in s._conversation_milestones:
                lines.append(f"  ✓ {milestone}")
            lines.append("")

        # QUESTIONS ALREADY ASKED — prevents cross-session repetition
        if s._questions_asked:
            lines.append("QUESTIONS ALREADY ASKED (do NOT ask these again, even rephrased):")
            for q in s._questions_asked:
                lines.append(f"  ✗ {q}")
            lines.append("")

        # OBJECTION TECHNIQUES ALREADY TRIED — forces different approaches
        if s._objection_techniques_used:
            lines.append("OBJECTION TECHNIQUES ALREADY TRIED (use a DIFFERENT approach next time):")
            for t in s._objection_techniques_used:
                lines.append(f"  ✗ {t}")
            lines.append("")

        # KEY FACTS section — cumulative, survives all session splits
        if s._key_facts:
            lines.append("KEY FACTS (confirmed during this call):")
            for fact in s._key_facts:
                lines.append(f"  - {fact}")
            lines.append("")

        # Recent conversation — last 10 turns for context
        if s._turn_exchanges:
            lines.append("RECENT CONVERSATION:")
            exchanges = s._turn_exchanges[-10:]
            for i, ex in enumerate(exchanges):
                turn_num = s._turn_count - len(exchanges) + i + 1
                agent = ex.get("agent", "")[:200]
                user = ex.get("user", "")[:200]
                if agent and user:
                    lines.append(f"T{turn_num}: You: {agent} | Customer: {user}")
                elif agent:
                    lines.append(f"T{turn_num}: You: {agent}")
                elif user:
                    lines.append(f"T{turn_num}: Customer: {user}")

        lines.append("")
        lines.append(
            "ALL ABOVE IS DONE. Continue FORWARD from where you left off. "
            "Do NOT re-pitch, re-explain, or revisit ANY topic from the progress list above. "
            "Do NOT acknowledge this context. Respond naturally to what the customer says next."
        )
        return "\n".join(lines)

    async def _send_session_setup_on_ws(self, ws, is_standby=False):
        """Send setup message on a specific WS. Uses pre-built message if available (hot-swap path)."""
        s = self.state
        # Use pre-built message if available (hot-swap path), otherwise build now (first connection / fallback)
        if s._prebuilt_setup_msg and not s._is_first_connection:
            msg = s._prebuilt_setup_msg
            s._prebuilt_setup_msg = None  # Consume it (one-time use)
            self.log.detail("Using pre-built setup message")
        else:
            msg = self._build_setup_message()

        full_prompt = msg["setup"]["system_instruction"]["parts"][0]["text"]
        voice_name = msg["setup"]["generation_config"]["speech_config"]["voice_config"]["prebuilt_voice_config"]["voice_name"]
        self.log.detail(f"System instruction: {len(full_prompt):,} chars")
        await ws.send(json.dumps(msg))
        label = "standby" if is_standby else ("first" if s._is_first_connection else "reconnect")
        self.log.detail(f"Setup sent ({label}), voice: {voice_name}")

    async def _send_initial_greeting(self):
        """Send initial trigger to make AI start the conversation"""
        s = self.state
        if s.greeting_sent or not s.goog_live_ws:
            return
        s.greeting_sent = True

        # Auto-generate greeting trigger from context
        trigger_text = s.context.get("greeting_trigger", "")
        if not trigger_text:
            customer_name = s.context.get("customer_name", "")
            has_memory = bool(s.context.get("_memory_context"))
            if has_memory and customer_name:
                trigger_text = (
                    f"[Start the conversation now. This is a REPEAT CALLER. "
                    f"Say ONE short sentence greeting {customer_name} — mention your name and reference last time. "
                    f"Then ask ONE short follow-up question. Keep the ENTIRE greeting under 15 words total.]"
                )
            else:
                trigger_text = (
                    f"[Start the conversation now. Follow your STEP 1 or START instruction exactly. "
                    f"The customer's name is '{customer_name}'. Say your greeting and STOP. Wait for their response.]"
                )

        msg = {
            "client_content": {
                "turns": [{"role": "user", "parts": [{"text": trigger_text}]}],
                "turn_complete": True
            }
        }
        await s.goog_live_ws.send(json.dumps(msg))
        self.log.detail("Greeting trigger sent")

    def build_text_system_prompt(self) -> str:
        """Build system prompt for text LLM (same content, no Live API wrapper).

        Reuses existing _build_setup_message() prompt composition logic,
        but returns just the text string (not the setup JSON).
        """
        msg = self._build_setup_message()
        return msg["setup"]["system_instruction"]["parts"][0]["text"]

    def build_greeting_trigger(self) -> str:
        """Return greeting trigger for the text pipeline.

        Uses the prompt's own START/greeting instruction — does NOT override it.
        This trigger stays in history as the first user message, creating a valid
        alternating sequence: user -> model -> user -> model...
        Gemini requires first contents message to be role 'user'.
        """
        s = self.state
        # Allow API-provided greeting override
        trigger_text = s.context.get("greeting_trigger", "")
        if not trigger_text:
            customer_name = s.context.get("customer_name", "")
            has_memory = bool(s.context.get("_memory_context"))
            if has_memory and customer_name:
                trigger_text = (
                    f"[Start the conversation now. This is a REPEAT CALLER. "
                    f"Say ONE short sentence greeting {customer_name} — mention your name and reference last time. "
                    f"Then ask ONE short follow-up question. Keep the ENTIRE greeting under 15 words total.]"
                )
            else:
                # Use the prompt's own START/greeting — don't override it
                trigger_text = (
                    f"[Start the conversation now. Follow your STEP 1 or START instruction exactly. "
                    f"The customer's name is '{customer_name}'. Say your greeting and STOP. Wait for their response.]"
                )
        return trigger_text

    def get_tool_declarations_for_text_api(self) -> list:
        """Return tool declarations formatted for google.genai text API.

        Same tools as _get_tool_declarations(), adapted for text API format.
        The text API uses the same structure but wrapped in google.genai types.
        """
        return self._get_tool_declarations()

    async def _send_reconnection_trigger(self):
        """Send context after fallback reconnection.
        CRITICAL: turn_complete=False so Gemini does NOT generate an immediate response.
        Same fix as _send_context_to_ws — prevents 'Understood...' pattern."""
        s = self.state
        if not s.goog_live_ws:
            return

        # Use the same context-sending logic as hot-swap
        await s._gemini._send_context_to_ws(s.goog_live_ws)
        logger.debug(f"[{s.call_uuid[:8]}] Reconnect context sent (turn_complete=False)")
