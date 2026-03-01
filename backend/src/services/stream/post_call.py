"""Post-call processing: recording save, transcription, webhook, memory extraction."""
import json
import threading
import time
from datetime import datetime
from pathlib import Path

from loguru import logger

from src.core.config import config
from src.db.session_db import session_db


class PostCallProcessor:
    """Handles all post-call processing: save, transcribe, DB update, webhook."""

    def __init__(self, state, log):
        self.state = state
        self.log = log

    def _start_post_call_processing(self, duration: float):
        """Run all post-call processing (save, transcribe, DB update, webhook) in background thread"""
        s = self.state

        def process_in_background():
            try:
                # Step 1: Save recording
                recording_info = s._audio._save_recording()

                # Step 2: Finalize call immediately — do NOT wait for transcription
                # This ensures /calls/{uuid}/status returns "completed" right away
                # so the frontend stops polling and the webhook can be sent.
                session_db.finalize_call(
                    s.call_uuid,
                    status="completed",
                    ended_at=datetime.now(),
                    duration_seconds=round(duration, 1),
                    persona=s._detected_persona,
                )

                # Step 3: Transcribe (Gemini 2.0 Flash or Whisper) — runs after status update
                if recording_info and config.enable_whisper:
                    s._transcript._transcribe_recording_sync(recording_info, s.call_uuid)

                # Step 4: Build transcript text
                transcript = ""
                try:
                    transcript_dir = Path(__file__).parent.parent.parent / "transcripts"
                    final_transcript = transcript_dir / f"{s.call_uuid}_final.txt"
                    realtime_transcript = transcript_dir / f"{s.call_uuid}.txt"
                    if final_transcript.exists():
                        transcript = final_transcript.read_text()
                    elif realtime_transcript.exists():
                        transcript = realtime_transcript.read_text()
                except Exception:
                    pass
                # Fallback to in-memory transcript
                if not transcript.strip() and s._full_transcript:
                    transcript = "\n".join([
                        f"[{t['timestamp']}] {t['role']}: {t['text']}"
                        for t in s._full_transcript
                    ])

                # Step 4.5: Generate AI call summary from transcript
                ai_summary = ""
                if transcript.strip():
                    try:
                        ai_summary = self._generate_call_summary_sync(transcript)
                        logger.info(f"[{s.call_uuid[:8]}] AI summary generated ({len(ai_summary)} chars)")
                    except Exception as e:
                        logger.warning(f"Summary generation error: {e}")

                # Step 5: Save cross-call memory (per phone number)
                try:
                    from src.cross_call_memory import extract_and_save_memory
                    # Derive interest level
                    completion_rate = s._turn_count / max(s._turn_count, 1)
                    if completion_rate > 0.7:
                        interest_level = "High"
                    elif completion_rate > 0.4:
                        interest_level = "Medium"
                    else:
                        interest_level = "Low"
                    # Gather all situations that were active during the call
                    all_situations = list(set(
                        s._previous_situations + s._active_situations
                    ))
                    extract_and_save_memory(
                        phone=s.caller_phone,
                        contact_name=s.context.get("customer_name", ""),
                        call_uuid=s.call_uuid,
                        detected_persona=s._detected_persona,
                        active_situations=all_situations,
                        turn_exchanges=list(s._turn_exchanges),
                        accumulated_user_text=s._accumulated_user_text,
                        duration=duration,
                        interest_level=interest_level,
                        linguistic_style=s._linguistic_style,
                        org_id=s.context.get("_org_id", ""),
                    )
                except Exception as e:
                    logger.error(f"Cross-call memory save error: {e}")

                # Step 5.5: Update DB with transcript, summary, and detected data
                try:
                    update_fields = {}
                    if transcript.strip():
                        update_fields["transcript"] = transcript
                    if ai_summary:
                        update_fields["call_summary"] = ai_summary
                    if s._active_product_sections:
                        update_fields["collected_responses"] = json.dumps({
                            "product_sections": list(set(s._active_product_sections)),
                            "situations": list(set(s._previous_situations + s._active_situations)),
                        })
                    if update_fields:
                        session_db.update_call(s.call_uuid, **update_fields)
                except Exception as e:
                    logger.error(f"Post-call DB update error: {e}")

                # Step 6: Call webhook AFTER everything is saved
                if s.webhook_url:
                    import asyncio as _asyncio
                    loop = _asyncio.new_event_loop()
                    _asyncio.set_event_loop(loop)
                    try:
                        loop.run_until_complete(self._call_webhook(duration, transcript, ai_summary))
                    finally:
                        loop.close()

                logger.info(f"[{s.call_uuid[:8]}] Post-call processing complete")
            except Exception as e:
                logger.error(f"Post-call processing error: {e}")

        # Start background thread - call ends immediately, this runs separately
        processing_thread = threading.Thread(target=process_in_background, daemon=True)
        processing_thread.start()

    def _generate_call_summary_sync(self, transcript: str) -> str:
        """Generate a concise AI summary from the call transcript using Gemini."""
        s = self.state
        if not transcript or not transcript.strip():
            return ""
        try:
            from google import genai as _genai
            client = _genai.Client(api_key=s._api_key)
            contact = s.context.get("customer_name", "the contact")
            prompt = (
                f"You are a sales call analyst. Summarize this call transcript in 2-3 sentences.\n"
                f"Focus on: what the contact said about their situation, interest level, "
                f"any objections or concerns raised, and the outcome.\n"
                f"Contact name: {contact}\n\n"
                f"TRANSCRIPT:\n{transcript[:4000]}\n\n"
                f"Respond with ONLY the summary text, no headers or labels."
            )
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
            )
            return response.text.strip()
        except Exception as e:
            logger.warning(f"Call summary generation failed: {e}")
            return transcript[:300] if transcript else ""

    async def _call_webhook(self, duration: float, transcript: str = "", call_summary: str = ""):
        """Call webhook URL with call data (transcript + basic info)"""
        s = self.state
        try:
            import httpx

            # Derive interest level from conversation engagement (duration + turns)
            turn_count = s._turn_count
            if duration >= 240 or turn_count >= 6:
                interest_level = "High"
            elif duration >= 120 or turn_count >= 3:
                interest_level = "Medium"
            else:
                interest_level = "Low"

            # Use AI-generated summary if provided, otherwise fall back to truncated transcript
            if not call_summary:
                call_summary = transcript[:300] if transcript else ""

            # Normalize transcript entries for the UI:
            # - Filter out SYSTEM / TOOL / TOOL_RESULT lines
            # - Lowercase role names (agent/user)
            # - Accumulate consecutive AGENT chunks into a single bubble
            normalized_entries = []
            buf_role: str | None = None
            buf_text: str = ""
            buf_ts: str = ""
            for entry in s._full_transcript:
                role = entry.get("role", "")
                text = entry.get("text", "").strip()
                if role in ("SYSTEM", "TOOL", "TOOL_RESULT") or not text:
                    continue
                norm_role = "agent" if role == "AGENT" else "user"
                if norm_role == buf_role:
                    buf_text += " " + text
                else:
                    if buf_text.strip():
                        normalized_entries.append({"role": buf_role, "text": buf_text.strip(), "timestamp": buf_ts})
                    buf_role = norm_role
                    buf_text = text
                    buf_ts = entry.get("timestamp", "")
            if buf_text.strip():
                normalized_entries.append({"role": buf_role, "text": buf_text.strip(), "timestamp": buf_ts})

            persona_label = ""
            if s._detected_persona:
                if s._custom_persona_keywords:
                    persona_label = s._detected_persona
                else:
                    persona_label = s._detected_persona.replace("_", " ").title()

            # Extract objections and pain points from key_facts collected during the call
            objections = []
            pain_points = []
            for fact in s._key_facts:
                if fact.startswith("Objection"):
                    # Extract the user's text after the prefix "Objection (turn N): "
                    obj_text = fact.split(": ", 1)[1] if ": " in fact else fact
                    objections.append(obj_text)
                elif fact.startswith("Pain point"):
                    pp_text = fact.split(": ", 1)[1] if ": " in fact else fact
                    pain_points.append(pp_text)

            # Build collected_responses from intelligence gathered during the call
            collected_responses = {}
            if s._detected_persona:
                collected_responses["detected_persona"] = persona_label
            if s._active_situations:
                collected_responses["situations"] = ", ".join(s._active_situations)
            if s._active_product_sections and s._active_product_sections != ["overview"]:
                collected_responses["product_sections"] = ", ".join(set(s._active_product_sections))
            if pain_points:
                collected_responses["pain_points"] = "; ".join(pain_points)

            # Completion rate: proportion of conversation stages reached
            # Stage 1 = opener, Stage 2 = discovery, Stage 3 = cost/pain, Stage 4 = pitch
            stages_reached = 1  # Always reach stage 1 (opener)
            if pain_points or any("Pain point" in f for f in s._key_facts):
                stages_reached = 2  # Reached discovery
            if any("Product mentioned" in f for f in s._key_facts):
                stages_reached = 4  # Reached pitch (implies cost stage passed)
            elif stages_reached >= 2 and turn_count >= 4:
                stages_reached = 3  # Likely reached cost stage
            completion_rate = round(stages_reached / 4, 2)

            payload = {
                "event": "call_ended",
                "call_uuid": s.call_uuid,
                "caller_phone": s.caller_phone,
                "contact_name": s.context.get("customer_name", ""),
                "client_name": s.client_name,
                "duration_seconds": round(duration, 1),
                "timestamp": datetime.now().isoformat(),
                # Transcript
                "transcript": transcript,
                "transcript_entries": normalized_entries,
                # Persona
                "persona": persona_label,
                "triggered_persona": s._detected_persona,
                # Call engagement stats
                "questions_completed": turn_count,
                "total_questions": max(turn_count, 8),
                "completion_rate": completion_rate,
                "interest_level": interest_level,
                "call_summary": call_summary,
                "objections_raised": objections,
                "collected_responses": collected_responses,
                "question_pairs": [],
                "call_metrics": {
                    "total_duration_s": round(duration, 1),
                    "turn_count": turn_count,
                    "avg_latency_ms": 0,
                    "p90_latency_ms": 0,
                    "min_latency_ms": 0,
                    "max_latency_ms": 0,
                    "total_nudges": 0,
                },
                "recording_url": f"/calls/{s.call_uuid}/recording",
                "triggered_situations": list(s._active_situations or []),
                "triggered_product_sections": list(set(s._active_product_sections or [])),
                "social_proof_used": bool(s._social_proof_summary),
                "micro_moments": {
                    "final_strategy": s._micro_moment_detector.current_strategy if s._micro_moment_detector else "discovery",
                    "moments_detected": s._micro_moment_detector.get_moments_log() if s._micro_moment_detector else [],
                },
            }

            self.log.detail(f"Webhook: {s.webhook_url}")
            t0 = time.time()
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(s.webhook_url, json=payload)
                wh_ms = (time.time() - t0) * 1000
                self.log.detail(f"Webhook response: {resp.status_code} ({wh_ms:.0f}ms)")
        except Exception as e:
            logger.error(f"Error calling webhook: {e}")
