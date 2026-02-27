import { NextRequest, NextResponse } from "next/server";
import { requireUidAndOrg, query, queryOne, toCamel, toCamelRows } from "@/lib/db";
import { triggerNextCampaignCalls } from "@/lib/call-trigger";

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireUidAndOrg(request);
    const rows = await query(
      `SELECT c.*,
         (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id AND cl.status = 'calling')::int as active_calls
       FROM campaigns c
       WHERE c.org_id = $1
       ORDER BY c.created_at DESC`,
      [orgId]
    );
    return NextResponse.json({ campaigns: toCamelRows(rows) });
  } catch (error) {
    console.error("[Campaigns API] GET error:", error);
    return NextResponse.json({ campaigns: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { uid, orgId } = await requireUidAndOrg(request);
    const body = await request.json();
    const { action, ...data } = body;

    // --- Create campaign ---
    if (action === "create") {
      const { name, botConfigId, botConfigName, leadIds, concurrencyLimit } = data;

      if (!botConfigId || !leadIds?.length) {
        return NextResponse.json(
          { success: false, message: "botConfigId and leadIds are required." },
          { status: 400 }
        );
      }

      const campaignId = crypto.randomUUID();

      // Derive webhook base URL from request headers
      const host = request.headers.get("host") || "localhost:3000";
      const proto = request.headers.get("x-forwarded-proto") ||
        (host.includes("localhost") ? "http" : "https");
      const webhookBaseUrl = `${proto}://${host}`;

      await query(
        `INSERT INTO campaigns (id, org_id, name, bot_config_id, bot_config_name, status, concurrency_limit, total_leads, webhook_base_url, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7, $8, $9, NOW())`,
        [
          campaignId, orgId, name || `Campaign ${new Date().toLocaleDateString()}`,
          botConfigId, botConfigName || null,
          concurrencyLimit || 100, leadIds.length, webhookBaseUrl, uid,
        ]
      );

      // Insert campaign_leads with position ordering
      for (let i = 0; i < leadIds.length; i++) {
        await query(
          `INSERT INTO campaign_leads (id, campaign_id, lead_id, status, position, queued_at)
           VALUES ($1, $2, $3, 'queued', $4, NOW())`,
          [crypto.randomUUID(), campaignId, leadIds[i], i]
        );
      }

      return NextResponse.json({ success: true, campaignId });
    }

    // --- Start campaign ---
    if (action === "start") {
      const campaign = await queryOne(
        "SELECT id FROM campaigns WHERE id = $1 AND org_id = $2 AND status = 'queued'",
        [data.campaignId, orgId]
      );
      if (!campaign) {
        return NextResponse.json(
          { success: false, message: "Campaign not found or not in startable state." },
          { status: 404 }
        );
      }

      await query(
        "UPDATE campaigns SET status = 'running', started_at = NOW() WHERE id = $1",
        [data.campaignId]
      );

      const triggered = await triggerNextCampaignCalls(data.campaignId);
      console.log(`[Campaigns API] Started campaign ${data.campaignId}, triggered ${triggered} calls`);

      return NextResponse.json({ success: true, triggered });
    }

    // --- Pause campaign ---
    if (action === "pause") {
      await query(
        "UPDATE campaigns SET status = 'paused', paused_at = NOW() WHERE id = $1 AND org_id = $2 AND status = 'running'",
        [data.campaignId, orgId]
      );
      return NextResponse.json({ success: true });
    }

    // --- Resume campaign ---
    if (action === "resume") {
      const updated = await query(
        "UPDATE campaigns SET status = 'running', paused_at = NULL WHERE id = $1 AND org_id = $2 AND status = 'paused' RETURNING id",
        [data.campaignId, orgId]
      );
      if (updated.length === 0) {
        return NextResponse.json(
          { success: false, message: "Campaign not found or not paused." },
          { status: 404 }
        );
      }

      const triggered = await triggerNextCampaignCalls(data.campaignId);
      console.log(`[Campaigns API] Resumed campaign ${data.campaignId}, triggered ${triggered} calls`);

      return NextResponse.json({ success: true, triggered });
    }

    // --- Cancel campaign ---
    if (action === "cancel") {
      await query(
        "UPDATE campaigns SET status = 'cancelled', completed_at = NOW() WHERE id = $1 AND org_id = $2 AND status IN ('queued', 'running', 'paused')",
        [data.campaignId, orgId]
      );
      await query(
        "UPDATE campaign_leads SET status = 'skipped' WHERE campaign_id = $1 AND status = 'queued'",
        [data.campaignId]
      );
      return NextResponse.json({ success: true });
    }

    // --- Get single campaign with leads ---
    if (action === "get") {
      const campaign = await queryOne(
        `SELECT c.*,
           (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id AND cl.status = 'calling')::int as active_calls
         FROM campaigns c
         WHERE c.id = $1 AND c.org_id = $2`,
        [data.campaignId, orgId]
      );
      if (!campaign) {
        return NextResponse.json(
          { success: false, message: "Campaign not found." },
          { status: 404 }
        );
      }

      const leads = await query(
        `SELECT cl.*, l.contact_name, l.phone_number, l.company, l.email
         FROM campaign_leads cl
         JOIN leads l ON l.id = cl.lead_id
         WHERE cl.campaign_id = $1
         ORDER BY cl.position`,
        [data.campaignId]
      );

      return NextResponse.json({
        success: true,
        campaign: toCamel(campaign),
        leads: toCamelRows(leads),
      });
    }

    return NextResponse.json({ success: false, message: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[Campaigns API] POST error:", error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 500 }
    );
  }
}
