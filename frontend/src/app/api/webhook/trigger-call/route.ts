import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

const CALL_SERVER_URL =
  process.env.CALL_SERVER_URL ||
  "http://34.93.142.172:3001/call/conversational";

const N8N_TRANSCRIPT_WEBHOOK_URL =
  process.env.N8N_TRANSCRIPT_WEBHOOK_URL ||
  "https://n8n.srv1100770.hstgr.cloud/webhook/fwai-transcript";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformBotConfig(config: any) {
  const questions = (config.questions || [])
    .sort((a: { order: number }, b: { order: number }) => a.order - b.order)
    .map((q: { id: string; prompt: string }) => ({ id: q.id, prompt: q.prompt }));

  const objections: Record<string, string> = {};
  for (const o of config.objections || []) {
    objections[o.key] = o.response;
  }

  return {
    prompt: config.prompt ?? "",
    questions,
    objections,
    objectionKeywords: config.objection_keywords || config.objectionKeywords || {},
  };
}

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
    const orgSettings = orgRow.settings as Record<string, string>;

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

    // --- Load bot config ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configDoc: any = await queryOne(
      "SELECT * FROM bot_configs WHERE id = $1 AND org_id = $2",
      [botConfigId, orgId]
    );

    if (!configDoc) {
      return NextResponse.json(
        { success: false, message: `Bot config '${botConfigId}' not found for this organization.` },
        { status: 404 }
      );
    }

    const botConfigPayload = transformBotConfig(configDoc);

    // --- Load related data (personas, products, social proof) ---
    let personaPayload: Record<string, unknown> = {};
    let productPayload: Record<string, unknown> = {};
    let socialProofPayload: Record<string, unknown> = {};
    const cfgId = configDoc.id as string;

    if (configDoc.persona_engine_enabled) {
      const [personas, situations] = await Promise.all([
        query("SELECT * FROM personas WHERE org_id = $1 AND bot_config_id = $2", [orgId, cfgId]),
        query("SELECT * FROM situations WHERE org_id = $1 AND bot_config_id = $2", [orgId, cfgId]),
      ]);
      personaPayload = {
        personas,
        personaKeywords: personas.reduce((acc: Record<string, { keywords: string[]; prompt: string }>, p) => {
          acc[p.name as string] = { keywords: (p.keywords as string[]) || [], prompt: (p.content as string) || "" };
          return acc;
        }, {}),
        situations,
        situationKeywords: situations.reduce((acc: Record<string, { keywords: string[]; prompt: string }>, s) => {
          acc[s.name as string] = { keywords: (s.keywords as string[]) || [], prompt: (s.content as string) || "" };
          return acc;
        }, {}),
      };
    }

    if (configDoc.product_intelligence_enabled) {
      const productSections = await query(
        "SELECT * FROM product_sections WHERE org_id = $1 AND bot_config_id = $2",
        [orgId, cfgId]
      );
      productPayload = {
        productSections,
        productKeywords: productSections.reduce((acc: Record<string, unknown[]>, s) => {
          acc[s.name as string] = (s.keywords as unknown[]) || [];
          return acc;
        }, {}),
      };
    }

    if (configDoc.social_proof_enabled) {
      const [companies, cities, roles] = await Promise.all([
        query("SELECT * FROM ui_social_proof_companies WHERE org_id = $1 AND bot_config_id = $2", [orgId, cfgId]),
        query("SELECT * FROM ui_social_proof_cities WHERE org_id = $1 AND bot_config_id = $2", [orgId, cfgId]),
        query("SELECT * FROM ui_social_proof_roles WHERE org_id = $1 AND bot_config_id = $2", [orgId, cfgId]),
      ]);
      socialProofPayload = { socialProofCompanies: companies, socialProofCities: cities, socialProofRoles: roles };
    }

    // --- Auto-create lead if not provided ---
    // Look up existing lead by phone (or GHL contact ID), create if missing
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
        // Create new lead
        const newLeadId = crypto.randomUUID();
        await query(
          `INSERT INTO leads (id, org_id, contact_name, phone_number, email, company, location, tags, status, call_count, source, ghl_contact_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new', 0, 'ghl', $9, NOW(), NOW())`,
          [
            newLeadId,
            orgId,
            contactName || "Unknown",
            phoneNumber,
            contactEmail || null,
            ghlCompanyName || null,
            ghlCity || null,
            JSON.stringify(ghlTags || []),
            ghlContactId || null,
          ]
        );
        leadId = newLeadId;
        console.log(`[Webhook trigger-call] Created new lead ${newLeadId} for phone ${phoneNumber}`);
      }
    }

    // --- Load bot notes if memory recall enabled ---
    let botNotes = "";
    if (configDoc.memory_recall_enabled && leadId) {
      const leadRow = await queryOne<{ bot_notes: string }>(
        "SELECT bot_notes FROM leads WHERE id = $1",
        [leadId]
      );
      if (leadRow?.bot_notes) botNotes = leadRow.bot_notes;
    }

    // --- Build context ---
    const ctx = configDoc.context_variables || configDoc.contextVariables || {};
    const context: Record<string, string> = {
      customer_name: contactName || "Customer",
      agent_name: ctx.agentName || "Agent",
      company_name: ctx.companyName || "",
      event_name: ctx.eventName || "",
      event_host: ctx.eventHost || "",
      location: ctx.location || "",
      ...(contactEmail ? { email: contactEmail } : {}),
    };
    const customVars = ctx.customVariables as Record<string, string> | undefined;
    if (customVars && typeof customVars === "object") {
      for (const [key, value] of Object.entries(customVars)) {
        if (key && value && !context[key]) context[key] = value;
      }
    }
    if (customVariableOverrides && typeof customVariableOverrides === "object") {
      for (const [key, value] of Object.entries(customVariableOverrides as Record<string, string>)) {
        if (key && value) context[key] = value;
      }
    }

    // --- Build webhook URL ---
    const host = request.headers.get("host") || "localhost:3000";
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProto || (host.includes("localhost") ? "http" : "https");
    const callEndWebhookUrl = `${protocol}://${host}/api/call-ended?orgId=${orgId}`;

    // --- Assemble call server payload ---
    const callServerPayload: Record<string, unknown> = {
      phoneNumber,
      contactName: contactName || "Customer",
      clientName: "fwai",
      orgId,
      webhookUrl: callEndWebhookUrl,
      n8nWebhookUrl: N8N_TRANSCRIPT_WEBHOOK_URL,
      context,
      ...botConfigPayload,
      ...personaPayload,
      ...productPayload,
      ...socialProofPayload,
      preResearchEnabled: configDoc.pre_research_enabled ?? false,
      memoryRecallEnabled: configDoc.memory_recall_enabled ?? false,
      socialProofEnabled: configDoc.social_proof_enabled ?? false,
      socialProofMinTurn: configDoc.social_proof_min_turn ?? 0,
      personaEngineEnabled: configDoc.persona_engine_enabled ?? false,
      productIntelligenceEnabled: configDoc.product_intelligence_enabled ?? false,
      ...(botNotes ? { botNotes } : {}),
      ...(leadId ? { leadId } : {}),
      maxCallDuration: configDoc.max_call_duration ?? 480,
      ghlWorkflows: configDoc.ghl_workflows ?? [],
      ...(configDoc.voice ? { voice: configDoc.voice } : {}),
    };

    if (configDoc.micro_moments_config) {
      callServerPayload.microMomentsConfig = configDoc.micro_moments_config;
    }

    // GHL + Plivo from org settings
    const ghlWhatsappWebhookUrl = orgSettings?.ghlWhatsappWebhookUrl || "";
    const ghlApiKey = orgSettings?.ghlApiKey || "";
    const ghlLocationId = orgSettings?.ghlLocationId || "";
    const plivoAuthId = orgSettings?.plivoAuthId || "";
    const plivoAuthToken = orgSettings?.plivoAuthToken || "";
    const plivoPhoneNumber = orgSettings?.plivoPhoneNumber || "";

    if (ghlWhatsappWebhookUrl) callServerPayload.ghlWhatsappWebhookUrl = ghlWhatsappWebhookUrl;
    if (ghlApiKey) callServerPayload.ghlApiKey = ghlApiKey;
    if (ghlLocationId) callServerPayload.ghlLocationId = ghlLocationId;
    if (plivoAuthId && plivoAuthToken) {
      callServerPayload.plivoAuthId = plivoAuthId;
      callServerPayload.plivoAuthToken = plivoAuthToken;
    }
    if (plivoPhoneNumber) callServerPayload.plivoPhoneNumber = plivoPhoneNumber;

    // --- Send to call server ---
    console.log(`[Webhook trigger-call] Triggering call for org ${orgId}, config "${configDoc.name}", phone ${phoneNumber}`);

    const response = await fetch(CALL_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(callServerPayload),
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[Webhook trigger-call] Non-JSON response:", response.status, responseText.slice(0, 500));
      return NextResponse.json(
        { success: false, message: `Call server returned ${response.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      callUuid: data.call_uuid || "",
      message: data.message || "Call initiated",
    });
  } catch (error) {
    console.error("[Webhook trigger-call] Error:", error);
    return NextResponse.json(
      { success: false, message: `Failed to trigger call: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
