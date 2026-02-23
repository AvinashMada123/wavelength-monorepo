import type { ApiCallPayload, ApiCallResponse } from "@/types/api";

export async function triggerCall(
  payload: ApiCallPayload,
  leadId?: string,
  authToken?: string
): Promise<ApiCallResponse> {
  // When a bot config is selected, strip context fields — the server resolves
  // them from the bot config's contextVariables.  Form fields are hidden so any
  // values here are stale defaults (e.g. agentName:"Agent") that would conflict.
  let cleanPayload: Record<string, unknown> = { ...payload };
  if (payload.botConfigId) {
    delete cleanPayload.agentName;
    delete cleanPayload.companyName;
    delete cleanPayload.eventName;
    delete cleanPayload.eventHost;
    delete cleanPayload.location;
  }

  // Include leadId so the backend can look up bot notes
  if (leadId) {
    cleanPayload.leadId = leadId;
  }

  console.log("[triggerCall] Sending payload:", JSON.stringify(cleanPayload, null, 2));
  console.log("[triggerCall] botConfigId:", cleanPayload.botConfigId, "authToken:", authToken ? "present" : "missing");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch("/api/call", {
    method: "POST",
    headers,
    body: JSON.stringify({ payload: cleanPayload }),
  });

  console.log("[triggerCall] Response status:", response.status, response.statusText);

  const data = await response.json();
  console.log("[triggerCall] Response data:", JSON.stringify(data, null, 2));

  if (!response.ok) {
    throw new Error(data.message || `Call failed: ${response.statusText}`);
  }

  return data;
}

/**
 * Tell the backend to hang up a call by UUID.
 * Used when the user manually marks a call as complete/failed/no-answer.
 */
export async function hangupCall(callUuid: string): Promise<void> {
  if (!callUuid) return;
  try {
    await fetch("/api/call-hangup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callUuid }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort — don't fail if the backend is unreachable
    console.warn(`[hangupCall] Failed to hang up ${callUuid}`);
  }
}
