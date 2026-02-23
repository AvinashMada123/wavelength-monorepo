import { NextRequest, NextResponse } from "next/server";
import { addCallUpdate } from "@/lib/call-updates-store";
import { qualifyLead } from "@/lib/gemini";
import { query, queryOne } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();

    const queryOrgId = request.nextUrl.searchParams.get("orgId") || "";

    console.log("[API /api/call-ended] Received call-ended webhook");
    console.log("[API /api/call-ended] call_uuid:", data.call_uuid);
    console.log("[API /api/call-ended] contact_name:", data.contact_name);
    console.log("[API /api/call-ended] duration_seconds:", data.duration_seconds);
    console.log("[API /api/call-ended] interest_level:", data.interest_level);
    console.log("[API /api/call-ended] completion_rate:", data.completion_rate);
    console.log("[API /api/call-ended] call_summary:", data.call_summary?.slice(0, 100));
    console.log("[API /api/call-ended] orgId (query):", queryOrgId, "orgId (body):", data.orgId);
    console.log("[API /api/call-ended] recording_url:", data.recording_url || "(none)");

    if (!data.recording_url && data.call_uuid) {
      data.recording_url = `/api/calls/${data.call_uuid}/recording`;
    }
    if (!data.transcript_entries) {
      data.transcript_entries = [];
    }

    // Strip stage-direction pause markers from agent text, e.g. "(pa 2-3 seconds)", "(pause)", "(wait 1 second)"
    // These are LLM artefacts that should never appear in transcripts or be spoken by TTS
    const stripPauseMarkers = (text: string): string =>
      text
        .replace(/\(\s*(?:pa|pause|wait|silence|breath(?:e|ing)?|sigh|chuckle|laughs?|hmm+|umm+)[^)]*\)/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();

    if (Array.isArray(data.transcript_entries)) {
      data.transcript_entries = data.transcript_entries.map(
        (entry: { role: string; text: string; timestamp: string }) => ({
          ...entry,
          text: stripPauseMarkers(entry.text ?? ""),
        })
      );
    }
    if (Array.isArray(data.question_pairs)) {
      data.question_pairs = data.question_pairs.map(
        (pair: { agent_said: string; user_said: string; [key: string]: unknown }) => ({
          ...pair,
          agent_said: stripPauseMarkers(pair.agent_said ?? ""),
        })
      );
    }

    // Determine call status — no_answer means call was not picked up
    const isNoAnswer = !!data.no_answer;
    const callStatus = isNoAnswer ? "no-answer" : "completed";
    console.log(`[API /api/call-ended] Call status: ${callStatus}${isNoAnswer ? " (unanswered)" : ""}`);

    // Qualify lead with Gemini if we have any call data (skip for no-answer)
    // The Python backend always sends question_pairs:[] but we can still qualify from transcript/summary
    if (!isNoAnswer && (data.question_pairs?.length > 0 || data.transcript || data.call_summary)) {
      try {
        const qualification = await qualifyLead(data);
        if (qualification) {
          data.qualification = qualification;
          console.log(
            `[API /api/call-ended] Qualified as ${qualification.level} (${qualification.confidence}%)`
          );
        }
      } catch (err) {
        console.error("[API /api/call-ended] Qualification error (non-fatal):", err);
      }
    }

    const orgId: string = queryOrgId || data.orgId || "";

    // Update PostgreSQL if orgId is present
    if (orgId) {
      try {
        // Find the call by call_uuid
        const callRow = await queryOne<{ id: string; lead_id: string }>(
          "SELECT id, lead_id FROM ui_calls WHERE org_id = $1 AND call_uuid = $2 LIMIT 1",
          [orgId, data.call_uuid]
        );

        if (callRow) {
          await query(
            `UPDATE ui_calls SET
              status = $1,
              ended_data = $2,
              duration_seconds = $3,
              interest_level = $4,
              completion_rate = $5,
              call_summary = $6,
              qualification = $7,
              completed_at = NOW()
            WHERE id = $8`,
            [
              callStatus,
              JSON.stringify(data),
              data.duration_seconds || 0,
              data.interest_level || "",
              data.completion_rate || 0,
              data.call_summary || "",
              data.qualification ? JSON.stringify(data.qualification) : null,
              callRow.id,
            ]
          );
          console.log(`[API /api/call-ended] Updated call doc for ${data.call_uuid} → ${callStatus}`);

          // Auto-save call summary/intelligence to lead's bot_notes (skip for no-answer)
          if (!isNoAnswer && callRow.lead_id) {
            try {
              const noteParts: string[] = [];
              const now = new Date().toISOString().split("T")[0];
              noteParts.push(`--- Call ${now} (${data.duration_seconds || 0}s) ---`);
              if (data.call_summary) noteParts.push(`Summary: ${data.call_summary}`);
              // Qualification crux
              if (data.qualification) {
                noteParts.push(`Qualification: ${data.qualification.level} (${data.qualification.confidence}%)`);
                if (data.qualification.reasoning) noteParts.push(`Reasoning: ${data.qualification.reasoning}`);
                if (data.qualification.painPoints?.length) noteParts.push(`Pain points: ${data.qualification.painPoints.join("; ")}`);
                if (data.qualification.recommendedAction) noteParts.push(`Next action: ${data.qualification.recommendedAction}`);
              }
              if (data.interest_level && data.interest_level !== "Unknown") noteParts.push(`Interest: ${data.interest_level}`);
              if (data.triggered_persona) noteParts.push(`Persona: ${data.triggered_persona}`);
              if (data.triggered_situations?.length) noteParts.push(`Situations: ${data.triggered_situations.join(", ")}`);
              if (data.triggered_product_sections?.length) noteParts.push(`Products discussed: ${data.triggered_product_sections.join(", ")}`);

              if (noteParts.length > 1) {
                const noteBlock = noteParts.join("\n");
                await query(
                  `UPDATE leads SET bot_notes = CASE
                    WHEN bot_notes IS NULL OR bot_notes = '' THEN $1
                    ELSE bot_notes || E'\n\n' || $1
                  END WHERE id = $2`,
                  [noteBlock, callRow.lead_id]
                );
                console.log(`[API /api/call-ended] Appended bot_notes to lead ${callRow.lead_id}`);
              }
            } catch (noteErr) {
              console.error("[API /api/call-ended] Bot notes update error (non-fatal):", noteErr);
            }
          }
        } else {
          console.warn(`[API /api/call-ended] No call doc found for ${data.call_uuid} in org ${orgId}`);
        }

        // Increment usage counters on the organization (JSONB update)
        const minutes = Math.ceil((data.duration_seconds || 0) / 60);
        await query(
          `UPDATE organizations SET
            usage = jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(usage, '{}'::jsonb),
                  '{totalCalls}',
                  to_jsonb(COALESCE((usage->>'totalCalls')::int, 0) + 1)
                ),
                '{totalMinutes}',
                to_jsonb(COALESCE((usage->>'totalMinutes')::numeric, 0) + $1)
              ),
              '{lastCallAt}',
              to_jsonb($2::text)
            )
          WHERE id = $3`,
          [minutes, new Date().toISOString(), orgId]
        );
        console.log(`[API /api/call-ended] Incremented usage for org ${orgId}`);
      } catch (dbErr) {
        console.error("[API /api/call-ended] DB update error (non-fatal):", dbErr);
      }
    }

    // Keep in-memory store for backward compatibility
    addCallUpdate(orgId, data);

    return NextResponse.json({
      success: true,
      message: "Call ended data received",
    });
  } catch (error) {
    console.error("[API /api/call-ended] Error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to process call ended data" },
      { status: 500 }
    );
  }
}
