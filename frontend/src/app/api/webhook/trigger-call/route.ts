import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { triggerCall } from "@/lib/call-trigger";

/**
 * Public webhook endpoint for triggering calls via API key.
 * No Firebase auth required — authenticates via x-api-key header or ?key= query param.
 *
 * POST /api/webhook/trigger-call
 * Headers: x-api-key: <org-api-key>
 * Body: { phoneNumber, contactName, botConfigId, leadId?, customVariableOverrides? }
 */
export async function POST(request: NextRequest) {
  try {
    // --- Auth via API key ---
    const apiKey =
      request.headers.get("x-api-key") ||
      request.nextUrl.searchParams.get("key") ||
      "";

    if (!apiKey) {
      return NextResponse.json(
        { success: false, message: "Missing API key. Provide x-api-key header or ?key= query param." },
        { status: 401 }
      );
    }

    // Look up org by API key stored in settings
    const orgRow = await queryOne<{ id: string; settings: Record<string, unknown> }>(
      "SELECT id, settings FROM organizations WHERE settings->>'apiKey' = $1",
      [apiKey]
    );

    if (!orgRow) {
      return NextResponse.json(
        { success: false, message: "Invalid API key." },
        { status: 401 }
      );
    }

    const orgId = orgRow.id;

    // --- Parse request body ---
    const body = await request.json();

    // Detect GHL webhook format: GHL sends customData with our fields, plus hundreds
    // of custom field Q&A pairs at the top level that we ignore.
    let phoneNumber: string | undefined;
    let contactName: string | undefined;
    let contactEmail: string | undefined;
    let botConfigId: string | undefined;
    let leadId: string | undefined;
    let customVariableOverrides: Record<string, string> | undefined;
    let ghlContactId: string | undefined;
    let ghlCompanyName: string | undefined;
    let ghlCity: string | undefined;
    let ghlTags: string[] | undefined;

    if (body.customData && body.customData.botConfigId) {
      // --- GHL webhook payload ---
      const cd = body.customData as Record<string, string>;
      phoneNumber = cd.phoneNumber;
      contactName = cd.contactName;
      contactEmail = cd.contactEmail;
      botConfigId = cd.botConfigId;
      leadId = cd.leadId;

      // Extract cv* prefixed fields as context variable overrides
      // e.g. cvAgent_name → agent_name, cvLocation → location
      customVariableOverrides = {};
      for (const [key, value] of Object.entries(cd)) {
        if (key.startsWith("cv") && key.length > 2 && value) {
          const varName = key.slice(2, 3).toLowerCase() + key.slice(3);
          customVariableOverrides[varName] = String(value);
        }
      }

      // Capture standard GHL contact fields for lead creation
      ghlContactId = body.contact_id;
      ghlCompanyName = body.company_name;
      ghlCity = body.city;
      if (typeof body.tags === "string" && body.tags) {
        ghlTags = body.tags.split(",").map((t: string) => t.trim()).filter(Boolean);
      }

      // Fallback: use top-level GHL fields if customData doesn't have them
      if (!phoneNumber) phoneNumber = body.phone;
      if (!contactName) contactName = body.full_name || [body.first_name, body.last_name].filter(Boolean).join(" ");
      if (!contactEmail) contactEmail = body.email;

      console.log(`[Webhook trigger-call] GHL payload detected. Phone: ${phoneNumber}, Config: ${botConfigId}, Contact: ${ghlContactId}`);
    } else {
      // --- Standard webhook payload ---
      phoneNumber = body.phoneNumber;
      contactName = body.contactName;
      contactEmail = body.contactEmail;
      botConfigId = body.botConfigId;
      leadId = body.leadId;
      customVariableOverrides = body.customVariableOverrides;
    }

    if (!phoneNumber) {
      return NextResponse.json(
        { success: false, message: "phoneNumber is required." },
        { status: 400 }
      );
    }

    if (!botConfigId) {
      return NextResponse.json(
        { success: false, message: "botConfigId is required." },
        { status: 400 }
      );
    }

    // --- Auto-create lead if not provided ---
    if (!leadId) {
      let existingLead: { id: string; bot_notes: string | null } | null = null;

      if (ghlContactId) {
        existingLead = await queryOne<{ id: string; bot_notes: string | null }>(
          "SELECT id, bot_notes FROM leads WHERE org_id = $1 AND ghl_contact_id = $2",
          [orgId, ghlContactId]
        );
      }
      if (!existingLead && phoneNumber) {
        existingLead = await queryOne<{ id: string; bot_notes: string | null }>(
          "SELECT id, bot_notes FROM leads WHERE org_id = $1 AND phone_number = $2",
          [orgId, phoneNumber]
        );
      }

      if (existingLead) {
        leadId = existingLead.id;
      } else {
        const newLeadId = crypto.randomUUID();
        const leadSource = ghlContactId ? "ghl" : "api";
        await query(
          `INSERT INTO leads (id, org_id, contact_name, phone_number, email, company, location, tags, status, call_count, source, ghl_contact_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new', 0, $9, $10, NOW(), NOW())`,
          [
            newLeadId, orgId, contactName || "Unknown", phoneNumber,
            contactEmail || null, ghlCompanyName || null, ghlCity || null,
            JSON.stringify(ghlTags || []), leadSource, ghlContactId || null,
          ]
        );
        leadId = newLeadId;
        console.log(`[Webhook trigger-call] Created new lead ${newLeadId} for phone ${phoneNumber}`);
      }
    }

    // --- Build webhook base URL ---
    const host = request.headers.get("host") || "localhost:3000";
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProto || (host.includes("localhost") ? "http" : "https");
    const webhookBaseUrl = `${protocol}://${host}`;

    // --- Trigger call via shared logic ---
    const result = await triggerCall({
      orgId,
      phoneNumber,
      contactName: contactName || "Customer",
      botConfigId,
      leadId,
      webhookBaseUrl,
      contactEmail,
      customVariableOverrides,
    });

    // --- Create ui_calls entry so the call-ended webhook can find & update it ---
    if (result.callUuid) {
      try {
        const uiCallId = crypto.randomUUID();
        await query(
          `INSERT INTO ui_calls (id, org_id, call_uuid, lead_id, request, response, status, initiated_at, initiated_by, bot_config_id, bot_config_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10)`,
          [
            uiCallId, orgId, result.callUuid, leadId || null,
            JSON.stringify({ phoneNumber, contactName, botConfigId, source: "api" }),
            JSON.stringify(result.rawResponse),
            "in-progress", "api", botConfigId, result.configDoc?.name || null,
          ]
        );
        console.log(`[Webhook trigger-call] Created ui_calls entry ${uiCallId} for call ${result.callUuid}`);
      } catch (uiCallErr) {
        console.error("[Webhook trigger-call] Failed to create ui_calls entry (non-fatal):", uiCallErr);
      }
    }

    return NextResponse.json({
      success: true,
      callUuid: result.callUuid,
      message: result.message,
    });
  } catch (error) {
    console.error("[Webhook trigger-call] Error:", error);
    return NextResponse.json(
      { success: false, message: `Failed to trigger call: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
