import { query, queryOne } from "@/lib/db";

const CALL_SERVER_URL =
  process.env.CALL_SERVER_URL ||
  "http://34.93.142.172:3001/call/conversational";

const N8N_TRANSCRIPT_WEBHOOK_URL =
  process.env.N8N_TRANSCRIPT_WEBHOOK_URL ||
  "https://n8n.srv1100770.hstgr.cloud/webhook/fwai-transcript";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformBotConfig(config: any) {
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

export interface TriggerCallParams {
  orgId: string;
  phoneNumber: string;
  contactName: string;
  botConfigId: string;
  leadId?: string;
  webhookBaseUrl: string;
  contactEmail?: string;
  customVariableOverrides?: Record<string, string>;
  // Optional overrides from UI call form
  agentName?: string;
  companyName?: string;
  eventName?: string;
  eventHost?: string;
  location?: string;
  voice?: string;
  clientName?: string;
  jobTitle?: string;
}

export interface TriggerCallResult {
  callUuid: string;
  success: boolean;
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawResponse: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callServerPayload: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configDoc: Record<string, any> | null;
}

/**
 * Core call-triggering logic shared between /api/call and /api/webhook/trigger-call.
 * Loads bot config, personas, products, social proof, builds context, and POSTs to call server.
 */
export async function triggerCall(params: TriggerCallParams): Promise<TriggerCallResult> {
  const {
    orgId, phoneNumber, contactName, botConfigId, leadId,
    webhookBaseUrl, contactEmail, customVariableOverrides,
    agentName, companyName, eventName, eventHost, location,
    voice, clientName, jobTitle,
  } = params;

  // --- Load bot config ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const configDoc: any = await queryOne(
    "SELECT * FROM bot_configs WHERE id = $1 AND org_id = $2",
    [botConfigId, orgId]
  );

  if (!configDoc) {
    throw new Error(`Bot config '${botConfigId}' not found for org '${orgId}'.`);
  }

  const botConfigPayload = transformBotConfig(configDoc);
  const cfgId = configDoc.id as string;

  // --- Load related data (personas, products, social proof) ---
  let personaPayload: Record<string, unknown> = {};
  let productPayload: Record<string, unknown> = {};
  let socialProofPayload: Record<string, unknown> = {};

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
    agent_name: agentName || ctx.agentName || "Agent",
    company_name: companyName || ctx.companyName || "",
    event_name: eventName || ctx.eventName || "",
    event_host: eventHost || ctx.eventHost || "",
    location: location || ctx.location || "",
    ...(contactEmail ? { email: contactEmail } : {}),
  };
  const customVars = ctx.customVariables as Record<string, string> | undefined;
  if (customVars && typeof customVars === "object") {
    for (const [key, value] of Object.entries(customVars)) {
      if (key && value && !context[key]) context[key] = value;
    }
  }
  if (customVariableOverrides && typeof customVariableOverrides === "object") {
    for (const [key, value] of Object.entries(customVariableOverrides)) {
      if (key && value) context[key] = value;
    }
  }

  // --- Load org settings (GHL + Plivo) ---
  const orgRow = await queryOne<{ settings: Record<string, unknown> }>(
    "SELECT settings FROM organizations WHERE id = $1",
    [orgId]
  );
  const orgSettings = (orgRow?.settings || {}) as Record<string, string>;

  // --- Build webhook URL ---
  const callEndWebhookUrl = `${webhookBaseUrl}/api/call-ended?orgId=${orgId}`;

  // --- Assemble call server payload ---
  const callServerPayload: Record<string, unknown> = {
    phoneNumber,
    contactName: contactName || "Customer",
    clientName: clientName || "fwai",
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
    ...(jobTitle ? { jobTitle } : {}),
    maxCallDuration: configDoc.max_call_duration ?? 480,
    ghlWorkflows: configDoc.ghl_workflows ?? [],
    ...(configDoc.voice || voice ? { voice: configDoc.voice || voice } : {}),
  };

  if (configDoc.micro_moments_config) {
    callServerPayload.microMomentsConfig = configDoc.micro_moments_config;
  }

  // Provider from bot config (per-config, not org-wide)
  const callProvider = (configDoc.call_provider as string) || "plivo";
  callServerPayload.callProvider = callProvider;

  // GHL + Plivo from org settings
  if (orgSettings.ghlWhatsappWebhookUrl) callServerPayload.ghlWhatsappWebhookUrl = orgSettings.ghlWhatsappWebhookUrl;
  if (orgSettings.ghlApiKey) callServerPayload.ghlApiKey = orgSettings.ghlApiKey;
  if (orgSettings.ghlLocationId) callServerPayload.ghlLocationId = orgSettings.ghlLocationId;
  if (orgSettings.plivoAuthId && orgSettings.plivoAuthToken) {
    callServerPayload.plivoAuthId = orgSettings.plivoAuthId;
    callServerPayload.plivoAuthToken = orgSettings.plivoAuthToken;
  }
  if (orgSettings.plivoPhoneNumber) callServerPayload.plivoPhoneNumber = orgSettings.plivoPhoneNumber;

  // Twilio credentials from org settings (used when callProvider is "twilio")
  if (orgSettings.twilioAccountSid && orgSettings.twilioAuthToken) {
    callServerPayload.twilioAccountSid = orgSettings.twilioAccountSid;
    callServerPayload.twilioAuthToken = orgSettings.twilioAuthToken;
  }
  if (orgSettings.twilioPhoneNumber) callServerPayload.twilioPhoneNumber = orgSettings.twilioPhoneNumber;

  // --- Send to call server ---
  console.log(`[call-trigger] Triggering call for org ${orgId}, config "${configDoc.name}", phone ${phoneNumber}`);

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
    console.error("[call-trigger] Non-JSON response:", response.status, responseText.slice(0, 500));
    throw new Error(`Call server returned ${response.status}: ${responseText.slice(0, 200) || "(empty body)"}`);
  }

  // Check for error responses from the call server
  if (!response.ok) {
    const errMsg = data.detail || data.message || data.error || JSON.stringify(data);
    console.error(`[call-trigger] Call server error (${response.status}):`, errMsg);
    throw new Error(`Call server error (${response.status}): ${errMsg}`);
  }

  if (!data.call_uuid) {
    console.error("[call-trigger] Call server returned no call_uuid:", JSON.stringify(data).slice(0, 500));
    throw new Error(`Call server did not return a call_uuid: ${data.detail || data.message || JSON.stringify(data).slice(0, 200)}`);
  }

  return {
    callUuid: data.call_uuid,
    success: true,
    message: data.message || "Call initiated",
    rawResponse: data,
    callServerPayload,
    configDoc,
  };
}

/**
 * Advance the campaign queue: trigger calls to fill available concurrency slots.
 * Called from campaign start/resume and from call-ended webhook.
 */
export async function triggerNextCampaignCalls(campaignId: string): Promise<number> {
  // Load campaign
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaign: any = await queryOne(
    "SELECT * FROM campaigns WHERE id = $1 AND status = 'running'",
    [campaignId]
  );
  if (!campaign) return 0;

  // Count currently active calls
  const activeResult = await queryOne<{ count: string }>(
    "SELECT COUNT(*) as count FROM campaign_leads WHERE campaign_id = $1 AND status = 'calling'",
    [campaignId]
  );
  const activeCalls = parseInt(activeResult?.count || "0", 10);

  // How many slots are available?
  const slotsAvailable = (campaign.concurrency_limit as number) - activeCalls;
  if (slotsAvailable <= 0) return 0;

  // Fetch next N queued leads
  const nextLeads = await query(
    `SELECT cl.id, cl.lead_id, l.phone_number, l.contact_name, l.email, l.company, l.location
     FROM campaign_leads cl
     JOIN leads l ON l.id = cl.lead_id
     WHERE cl.campaign_id = $1 AND cl.status = 'queued'
     ORDER BY cl.position
     LIMIT $2`,
    [campaignId, slotsAvailable]
  );

  // Also fetch retry_pending leads whose retry time has passed
  const retrySlots = Math.max(0, slotsAvailable - nextLeads.length);
  const retryLeads = retrySlots > 0 ? await query(
    `SELECT cl.id, cl.lead_id, l.phone_number, l.contact_name, l.email, l.company, l.location
     FROM campaign_leads cl
     JOIN leads l ON l.id = cl.lead_id
     WHERE cl.campaign_id = $1 AND cl.status = 'retry_pending' AND cl.next_retry_at <= NOW()
     ORDER BY cl.next_retry_at
     LIMIT $2`,
    [campaignId, retrySlots]
  ) : [];

  // Merge: queued leads first, then retries filling remaining slots
  const allLeads = [...nextLeads, ...retryLeads];

  if (allLeads.length === 0) {
    // Check if all are done (no calling, no queued, no retry_pending)
    const remaining = await queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM campaign_leads WHERE campaign_id = $1 AND status IN ('queued', 'calling', 'retry_pending')",
      [campaignId]
    );
    if (parseInt(remaining?.count || "0", 10) === 0) {
      await query(
        "UPDATE campaigns SET status = 'completed', completed_at = NOW() WHERE id = $1",
        [campaignId]
      );
      console.log(`[call-trigger] Campaign ${campaignId} completed — all leads processed.`);
    }
    return 0;
  }

  const webhookBaseUrl = campaign.webhook_base_url as string;
  const botConfigId = campaign.bot_config_id as string;
  const orgId = campaign.org_id as string;

  let triggered = 0;

  // Fire calls concurrently
  const results = await Promise.allSettled(
    allLeads.map(async (cl) => {
      // Mark as calling BEFORE triggering (prevents double-trigger race)
      // Handles both queued and retry_pending leads
      const updated = await query(
        "UPDATE campaign_leads SET status = 'calling', called_at = NOW() WHERE id = $1 AND status IN ('queued', 'retry_pending') RETURNING id",
        [cl.id]
      );
      if (updated.length === 0) return; // already picked up by another concurrent trigger

      try {
        const result = await triggerCall({
          orgId,
          phoneNumber: cl.phone_number as string,
          contactName: (cl.contact_name as string) || "Customer",
          botConfigId,
          leadId: cl.lead_id as string,
          webhookBaseUrl,
          contactEmail: (cl.email as string) || undefined,
        });

        // Store call_uuid in campaign_lead
        await query(
          "UPDATE campaign_leads SET call_uuid = $1 WHERE id = $2",
          [result.callUuid, cl.id]
        );

        // Create ui_calls record so it appears in Call Logs
        const callId = crypto.randomUUID();
        await query(
          `INSERT INTO ui_calls (id, org_id, call_uuid, lead_id, request, response, status, initiated_at, initiated_by, bot_config_id, bot_config_name)
           VALUES ($1, $2, $3, $4, $5, $6, 'in-progress', NOW(), 'campaign', $7, $8)`,
          [
            callId, orgId, result.callUuid, cl.lead_id,
            JSON.stringify({ phoneNumber: cl.phone_number, contactName: cl.contact_name, botConfigId, campaignId }),
            JSON.stringify(result.rawResponse),
            botConfigId,
            campaign.bot_config_name || null,
          ]
        );

        triggered++;
        console.log(`[call-trigger] Campaign ${campaignId}: triggered call for lead ${cl.lead_id}, uuid ${result.callUuid}`);
      } catch (err) {
        // Mark as failed
        await query(
          "UPDATE campaign_leads SET status = 'failed', completed_at = NOW(), error_message = $1 WHERE id = $2",
          [err instanceof Error ? err.message : String(err), cl.id]
        );
        await query(
          "UPDATE campaigns SET failed_calls = failed_calls + 1 WHERE id = $1",
          [campaignId]
        );
        console.error(`[call-trigger] Campaign ${campaignId}: failed to trigger lead ${cl.lead_id}:`, err);
      }
    })
  );

  return triggered;
}
