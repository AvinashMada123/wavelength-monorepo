"""Tool call handling: _handle_tool_call, _bg_ghl_tag."""
import asyncio
import json
import time

from loguru import logger

from src.tools import execute_tool


class ToolHandler:
    """Handles tool calls from Gemini and sends responses back."""

    def __init__(self, state, log):
        self.state = state
        self.log = log

    async def _handle_tool_call(self, tool_call, send_response=True):
        """Execute tool and send response back to AI - gracefully handles errors.

        Args:
            tool_call: The tool call dict from Gemini (functionCalls list).
            send_response: If True (Live API), sends response via _ai_backend.
                           If False (Traditional), returns response dict for TurnManager.
        """
        s = self.state
        func_calls = tool_call.get("functionCalls", [])
        results = []  # Collect results when send_response=False
        for fc in func_calls:
            tool_name = fc.get("name")
            tool_args = fc.get("args", {})
            call_id = fc.get("id")

            self.log.detail(f"Tool: {tool_name}")
            s._transcript._save_transcript("TOOL", f"{tool_name}: {tool_args}")

            # Handle end_call tool
            if tool_name == "end_call":
                s._closing_call = True  # Immediately prevent further agent speech
                reason = tool_args.get("reason", "conversation ended")
                self.log.detail(f"End call: {reason}")

                s._transcript._save_transcript("SYSTEM", f"Agent requested call end: {reason}")

                # Mark agent as having said goodbye
                s.agent_said_goodbye = True

                # Send success response
                resp = {"success": True, "message": "Call ending now. Do not say anything else."}
                if send_response:
                    try:
                        await s._ai_backend.send_tool_response(call_id, tool_name, resp)
                    except Exception:
                        pass
                else:
                    results.append({"id": call_id, "name": tool_name, "response": resp})

                # Check if user already said goodbye
                s._lifecycle._check_mutual_goodbye()

                # DND detection — check user's actual speech for opt-out signals
                if hasattr(s, '_accumulated_user_text') and s._accumulated_user_text:
                    user_speech = s._accumulated_user_text.lower()
                    # Permanent DND keywords
                    permanent_dnd = ["don't call", "dont call", "stop calling", "police", "complaint", "block",
                                     "mat karo call", "band karo"]
                    # Temporary DND keywords (30 days)
                    temporary_dnd = ["not interested", "nahi chahiye", "don't need this", "dont need this",
                                     "remove my number"]

                    dnd_reason = None
                    dnd_permanent = False

                    for kw in permanent_dnd:
                        if kw in user_speech:
                            dnd_reason = f"User said: '{kw}'"
                            dnd_permanent = True
                            break

                    if not dnd_reason:
                        for kw in temporary_dnd:
                            if kw in user_speech:
                                dnd_reason = f"User said: '{kw}'"
                                break

                    # Secondary signal: check LLM's reason (lower confidence)
                    if not dnd_reason:
                        llm_reason = tool_args.get("reason", "").lower()
                        for kw in permanent_dnd + temporary_dnd:
                            if kw in llm_reason:
                                dnd_reason = f"LLM inferred: '{kw}' from reason: {tool_args.get('reason', '')}"
                                dnd_permanent = kw in [k.lower() for k in permanent_dnd]
                                break

                    if dnd_reason:
                        confidence = "high" if "User said" in dnd_reason else "llm_inferred"
                        self.log.warn(f"DND detected [{confidence}]: {dnd_reason}")
                        s._transcript._save_transcript("SYSTEM", f"DND flagged: {dnd_reason}")
                        # Set DND in background
                        try:
                            from datetime import datetime, timedelta, timezone as tz
                            from src.db.session_db import session_db
                            org_id = s.context.get("_org_id", "")
                            until = None if dnd_permanent else datetime.now(tz.utc) + timedelta(days=30)
                            session_db.set_contact_dnd(
                                s.caller_phone, org_id, until=until, reason=dnd_reason, confidence=confidence
                            )
                        except Exception as e:
                            self.log.error(f"Failed to set DND: {e}")

                # Hang up after 5 seconds (allow TTS to finish goodbye audio)
                asyncio.create_task(s._lifecycle._hangup_call_delayed(5.0))
                return results if not send_response else None

            # Handle save_user_info tool — saves user details via Gemini's audio understanding
            if tool_name == "save_user_info":
                t_company = tool_args.get("company")
                t_role = tool_args.get("role")
                t_name = tool_args.get("name")
                t_key_detail = tool_args.get("key_detail")
                try:
                    from src.cross_call_memory import save_from_tool_call

                    save_from_tool_call(
                        phone=s.caller_phone,
                        company=t_company,
                        role=t_role,
                        name=t_name,
                        key_detail=t_key_detail,
                        org_id=s.context.get("_org_id", ""),
                    )
                    self.log.detail(f"User info saved: company={t_company}, role={t_role}, name={t_name}")

                    # Track key facts for session split context (survives all splits)
                    if t_role:
                        fact = f"Customer role: {t_role}"
                        if t_company:
                            fact += f" at {t_company}"
                        if fact not in s._key_facts:
                            s._key_facts.append(fact)
                    elif t_company:
                        fact = f"Customer company: {t_company}"
                        if fact not in s._key_facts:
                            s._key_facts.append(fact)
                    if t_key_detail:
                        fact = f"Key detail: {t_key_detail}"
                        if fact not in s._key_facts:
                            s._key_facts.append(fact)

                    # Update session state for persona detection
                    # NOTE: Do NOT inject fabricated text into _accumulated_user_text —
                    # it must stay user-speech-only for memory extraction accuracy.
                    # Build a separate string for persona detection only.
                    if t_role and not s._detected_persona:
                        from src.persona_engine import detect_persona
                        role_text = f"I work as a {t_role}" + (f" at {t_company}" if t_company else "")
                        detection_text = s._accumulated_user_text + " " + role_text
                        detected = detect_persona(detection_text, s._custom_persona_keywords)
                        if detected:
                            s._detected_persona = detected
                            s._prebuilt_setup_msg = None  # Invalidate — persona changed
                            self.log.detail(f"Persona detected from tool call: {detected}")
                except Exception as e:
                    logger.error(f"save_user_info error: {e}")

                # Server-side validation: check if saved values appear in actual user speech
                confidence = "high"
                unverified_fields = []
                saved_values = {
                    "company": t_company, "role": t_role,
                    "name": t_name, "key_detail": t_key_detail,
                }
                if hasattr(s, '_accumulated_user_text') and s._accumulated_user_text:
                    user_text_lower = s._accumulated_user_text.lower()
                    for field_name, field_val in saved_values.items():
                        if field_val and field_val.lower() not in user_text_lower:
                            unverified_fields.append(f"{field_name}='{field_val}'")
                    if unverified_fields:
                        confidence = "low"
                        self.log.warn(
                            f"save_user_info confidence LOW: {', '.join(unverified_fields)} "
                            f"not found in user speech"
                        )
                else:
                    # No accumulated user text yet — cannot verify
                    confidence = "unverified"

                s._transcript._save_transcript(
                    "SYSTEM",
                    f"save_user_info confidence={confidence}"
                    + (f" unverified=[{', '.join(unverified_fields)}]" if unverified_fields else "")
                )

                # Send success response so conversation continues
                resp = {"success": True, "message": "Information saved", "confidence": confidence}
                if send_response:
                    try:
                        await s._ai_backend.send_tool_response(call_id, tool_name, resp)
                    except Exception:
                        pass
                else:
                    results.append({"id": call_id, "name": tool_name, "response": resp})
                return results if not send_response else None

            # Handle get_social_proof tool — returns enrollment stats for conversation
            if tool_name == "get_social_proof":
                # Gate: if min turn threshold not reached, tell AI to continue discovery instead
                if s._social_proof_min_turn and s._turn_count < s._social_proof_min_turn:
                    self.log.detail(f"Social proof BLOCKED at turn {s._turn_count} (min {s._social_proof_min_turn}) — telling AI to continue discovery")
                    sp_result = {
                        "instruction": "Social proof data is not available yet. Continue with discovery questions — build more rapport before referencing stats. Do NOT mention enrollment numbers or company stats yet."
                    }
                else:
                    try:
                        from src.social_proof import get_social_proof as _get_social_proof
                        sp_result = _get_social_proof(
                            company=tool_args.get("company"),
                            city=tool_args.get("city"),
                            role=tool_args.get("role"),
                        )
                        self.log.detail(f"Social proof: company={tool_args.get('company')}, city={tool_args.get('city')}, role={tool_args.get('role')}")
                    except Exception as e:
                        logger.error(f"get_social_proof error: {e}")
                        sp_result = {"general_phrase": "We have thousands of enrollees across India.", "instruction": "Use this general stat naturally."}

                # Send tool response back
                if send_response:
                    try:
                        await s._ai_backend.send_tool_response(call_id, tool_name, sp_result)
                    except Exception:
                        pass
                else:
                    results.append({"id": call_id, "name": tool_name, "response": sp_result})
                return results if not send_response else None

            # Handle configurable GHL workflow tools (tag-based) — fire-and-forget
            if tool_name.startswith("ghl_workflow_"):
                wf_id = tool_name.replace("ghl_workflow_", "")
                reason = tool_args.get("reason", "")
                wf = next((w for w in s._ghl_workflows if w.get("id") == wf_id), None)
                wf_name = wf.get("name", wf_id) if wf else wf_id
                self.log.detail(f"GHL workflow '{wf_name}': {reason}")
                s._transcript._save_transcript("TOOL", f"{tool_name}: {reason}")

                if wf_id in s._triggered_workflows:
                    msg = f"Workflow '{wf_name}' already triggered this call"
                elif not wf or not wf.get("tag"):
                    msg = "Workflow not found or missing tag"
                elif not s.ghl_api_key or not s.ghl_location_id:
                    msg = "GHL API key or Location ID not configured in org settings"
                else:
                    # Mark as triggered and send immediate response to unblock AI
                    s._triggered_workflows.add(wf_id)
                    msg = f"Workflow '{wf_name}' triggered"
                    # Execute GHL HTTP calls in background (fire-and-forget)
                    asyncio.create_task(self._bg_ghl_tag(
                        tag=wf["tag"], wf_name=wf_name, wf_id=wf_id,
                    ))

                # Send immediate response — don't wait for HTTP
                resp = {"success": wf_id in s._triggered_workflows, "message": msg}
                if send_response:
                    try:
                        await s._ai_backend.send_tool_response(call_id, tool_name, resp)
                    except Exception:
                        pass
                else:
                    results.append({"id": call_id, "name": tool_name, "response": resp})
                return results if not send_response else None

            # Handle send_whatsapp tool - trigger GHL workflow (legacy) — fire-and-forget
            if tool_name == "send_whatsapp":
                reason = tool_args.get("reason", "")
                self.log.detail(f"Send WhatsApp: {reason}")
                s._transcript._save_transcript("TOOL", f"send_whatsapp: {reason}")

                if s._whatsapp_sent:
                    msg = "WhatsApp already sent this call"
                    self.log.detail(msg)
                elif not s.ghl_api_key or not s.ghl_location_id:
                    msg = "WhatsApp not configured - GHL API key or location ID missing"
                    self.log.warn(msg)
                else:
                    s._whatsapp_sent = True
                    milestone = f"WhatsApp/details sent to customer (turn {s._turn_count})"
                    if milestone not in s._conversation_milestones:
                        s._conversation_milestones.append(milestone)
                    msg = "WhatsApp triggered via GHL contact tag"
                    # Execute GHL HTTP calls in background (fire-and-forget)
                    asyncio.create_task(self._bg_ghl_tag(
                        tag="ai-onboardcall-goldmember", wf_name="send_whatsapp",
                    ))

                # Send immediate response — don't wait for HTTP
                resp = {"success": s._whatsapp_sent, "message": msg}
                if send_response:
                    try:
                        await s._ai_backend.send_tool_response(call_id, tool_name, resp)
                    except Exception:
                        pass
                else:
                    results.append({"id": call_id, "name": tool_name, "response": resp})
                return results if not send_response else None

            # Execute the tool with context for templates - graceful error handling
            try:
                tool_start = time.time()
                result = await execute_tool(tool_name, s.caller_phone, context=s.context, **tool_args)
                tool_ms = (time.time() - tool_start) * 1000
                success = result.get("success", False)
                message = result.get("message", "Tool executed")
                self.log.detail(f"Tool result: {'OK' if success else 'FAIL'} ({tool_ms:.0f}ms)")
            except Exception as e:
                logger.error(f"Tool execution error for {tool_name}: {e}")
                success = False
                message = f"Tool temporarily unavailable, but conversation can continue"

            logger.debug(f"TOOL RESULT: success={success}, message={message}")
            s._transcript._save_transcript("TOOL_RESULT", f"{tool_name}: {'success' if success else 'failed'}")

            # Always send tool response back so conversation continues
            resp = {"success": success, "message": message}
            if send_response:
                try:
                    await s._ai_backend.send_tool_response(call_id, tool_name, resp)
                    logger.debug(f"Sent tool response for {tool_name}")
                except Exception as e:
                    logger.error(f"Error sending tool response: {e} - continuing conversation")
            else:
                results.append({"id": call_id, "name": tool_name, "response": resp})

        return results if not send_response else None

    async def _bg_ghl_tag(self, tag: str, wf_name: str, wf_id: str = ""):
        """Execute GHL tagging in background — fire-and-forget, never blocks audio."""
        s = self.state
        try:
            from src.services.ghl_whatsapp import tag_ghl_contact
            result = await tag_ghl_contact(
                phone=s.caller_phone,
                email=s.context.get("email", ""),
                api_key=s.ghl_api_key,
                location_id=s.ghl_location_id,
                tag=tag,
            )
            if result.get("success"):
                self.log.detail(f"GHL bg tag '{tag}' OK")
                milestone = f"Workflow '{wf_name}' triggered (turn {s._turn_count})"
                if milestone not in s._conversation_milestones:
                    s._conversation_milestones.append(milestone)
            else:
                self.log.warn(f"GHL bg tag '{tag}' failed: {result.get('error', 'unknown')}")
        except Exception as e:
            self.log.warn(f"GHL bg tag '{tag}' error: {e}")
