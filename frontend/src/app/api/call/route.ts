import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth-helpers";
import { query, queryOne, getUidAndOrgFromToken } from "@/lib/db";
import { triggerCall, checkConcurrencySlot, ConcurrencyLimitError } from "@/lib/call-trigger";

export async function POST(request: NextRequest) {
  try {
    // Support both Bearer token (preferred, always fresh) and session cookie (fallback)
    let orgId = "";
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const result = await getUidAndOrgFromToken(request);
        if (!(result instanceof NextResponse)) {
          orgId = result.orgId;
          console.log("[API /api/call] Authenticated via Bearer token, orgId:", orgId);
        }
      } catch (err) {
        console.warn("[API /api/call] Bearer token auth failed:", err);
      }
    }
    if (!orgId) {
      const authUser = await getAuthenticatedUser(request);
      orgId = authUser?.orgId || "";
      if (orgId) {
        console.log("[API /api/call] Authenticated via session cookie, orgId:", orgId);
      } else {
        console.warn("[API /api/call] No valid auth found — bot config will not be resolved");
      }
    }

    const body = await request.json();
    const { payload } = body;

    // Resolve botConfigId — fall back to active config if not specified
    let botConfigId = payload.botConfigId || "";
    let botConfigName = "";
    if (orgId && !botConfigId) {
      const activeConfig = await queryOne<{ id: string; name: string }>(
        "SELECT id, name FROM bot_configs WHERE org_id = $1 AND is_active = true LIMIT 1",
        [orgId]
      );
      if (activeConfig) {
        botConfigId = activeConfig.id;
        botConfigName = activeConfig.name;
        console.log(`[API /api/call] Using active config: "${activeConfig.name}" (id: ${activeConfig.id})`);
      } else {
        console.warn(`[API /api/call] No active config found for org ${orgId}`);
      }
    } else if (botConfigId && orgId) {
      const config = await queryOne<{ name: string }>(
        "SELECT name FROM bot_configs WHERE id = $1 AND org_id = $2",
        [botConfigId, orgId]
      );
      if (config) botConfigName = config.name;
    }

    // Build webhook base URL from request
    const host = request.headers.get("host") || "localhost:3000";
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProto || (host.includes("localhost") ? "http" : "http");
    const webhookBaseUrl = `${protocol}://${host}`;

    // --- Check concurrency and reserve a slot ---
    let uiCallId: string | undefined;
    if (orgId) {
      try {
        const slot = await checkConcurrencySlot({
          orgId,
          phoneNumber: payload.phoneNumber,
          contactName: payload.contactName || "Customer",
          botConfigId,
          botConfigName: botConfigName || undefined,
          leadId: payload.leadId,
          initiatedBy: "user",
          requestPayload: { phoneNumber: payload.phoneNumber, contactName: payload.contactName, botConfigId },
        });
        uiCallId = slot.uiCallId;
      } catch (err) {
        if (err instanceof ConcurrencyLimitError) {
          return NextResponse.json(
            {
              success: false,
              call_uuid: "",
              message: `All call lines are busy (${err.activeCount}/${err.limit} active). Please wait for a call to finish.`,
              concurrencyLimit: true,
              activeCount: err.activeCount,
              limit: err.limit,
            },
            { status: 429 }
          );
        }
        throw err;
      }
    }

    // --- Trigger call ---
    try {
      const result = await triggerCall({
        orgId,
        phoneNumber: payload.phoneNumber,
        contactName: payload.contactName || "Customer",
        botConfigId,
        leadId: payload.leadId,
        webhookBaseUrl,
        contactEmail: payload.contactEmail,
        customVariableOverrides: payload.customVariableOverrides,
        agentName: payload.agentName,
        companyName: payload.companyName,
        eventName: payload.eventName,
        eventHost: payload.eventHost,
        location: payload.location,
        voice: payload.voice,
        clientName: payload.clientName,
        jobTitle: payload.jobTitle,
      });

      // Update the reserved ui_calls row with call_uuid
      if (uiCallId) {
        await query(
          "UPDATE ui_calls SET call_uuid = $1, response = $2, status = 'in-progress' WHERE id = $3",
          [result.callUuid, JSON.stringify(result.rawResponse), uiCallId]
        ).catch(() => {});
      }

      return NextResponse.json({
        ...result.rawResponse,
        _debug: {
          callServerUrl: process.env.CALL_SERVER_URL || "http://34.93.142.172:3001/call/conversational",
          payloadSentToCallServer: result.callServerPayload,
          botConfigFound: !!result.configDoc,
          requestedBotConfigId: payload.botConfigId || null,
          resolvedConfigId: result.configDoc?.id || null,
          resolvedConfigName: result.configDoc?.name || null,
          usedFallback: !!payload.botConfigId && result.configDoc?.id !== payload.botConfigId,
          authMethod: authHeader?.startsWith("Bearer ") ? "bearer" : "cookie",
        },
      });
    } catch (callErr) {
      // Mark the reserved slot as failed
      if (uiCallId) {
        await query("UPDATE ui_calls SET status = 'failed' WHERE id = $1", [uiCallId]).catch(() => {});
      }
      throw callErr;
    }
  } catch (error) {
    console.error("[API /api/call] Error:", error);
    return NextResponse.json(
      { success: false, call_uuid: "", message: `Failed to initiate call: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
