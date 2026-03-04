import { NextRequest, NextResponse } from "next/server";
import { requireUidAndOrg, query, queryOne, toCamel, toCamelRows } from "@/lib/db";

/**
 * GET /api/data/init
 * Returns all bootstrap data for the authenticated user in a single round-trip.
 * Called by fetchInit() in auth-context on login and page refresh.
 * Each sub-query is individually fault-tolerant — one bad table won't kill the response.
 */
export async function GET(request: NextRequest) {
  try {
    const { uid, orgId } = await requireUidAndOrg(request);

    // Run all queries in parallel; use individual try/catch so one failure returns [] not 500
    const safeQuery = async (sql: string, values: unknown[]) => {
      try { return await query(sql, values); } catch { return []; }
    };
    const safeQueryOne = async <T extends Record<string, unknown>>(sql: string, values: unknown[]) => {
      try { return await queryOne<T>(sql, values); } catch { return null; }
    };

    const [userRow, orgRow, leads, calls, botConfigs, team] = await Promise.all([
      safeQueryOne(
        "SELECT uid, email, display_name, role, org_id, status, created_at, last_login_at, invited_by FROM users WHERE uid = $1",
        [uid]
      ),
      safeQueryOne<{ settings: Record<string, unknown> }>(
        "SELECT settings FROM organizations WHERE id = $1",
        [orgId]
      ),
      safeQuery("SELECT * FROM leads WHERE org_id = $1 ORDER BY created_at DESC", [orgId]),
      safeQuery("SELECT * FROM ui_calls WHERE org_id = $1 ORDER BY initiated_at DESC LIMIT 200", [orgId]),
      safeQuery("SELECT * FROM bot_configs WHERE org_id = $1 ORDER BY created_at DESC", [orgId]),
      safeQuery(
        "SELECT uid, email, display_name, role, org_id, status, created_at, invited_by FROM users WHERE org_id = $1",
        [orgId]
      ),
    ]);

    if (!userRow) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      profile: toCamel(userRow),
      settings: orgRow?.settings || {},
      leads: toCamelRows(leads),
      calls: toCamelRows(calls),
      botConfigs: toCamelRows(botConfigs),
      team: toCamelRows(team),
    });
  } catch (error) {
    console.error("[Init API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/data/init
 * One-time DB migration: ensures tables exist with correct schema.
 */
export async function POST(request: NextRequest) {
  try {
    await requireUidAndOrg(request);

    // Create leads table with all columns including bot_notes
    await query(`
      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        org_id TEXT REFERENCES organizations(id),
        phone_number TEXT NOT NULL,
        contact_name TEXT,
        email TEXT,
        company TEXT,
        location TEXT,
        tags JSONB DEFAULT '[]',
        status TEXT DEFAULT 'new',
        call_count INTEGER DEFAULT 0,
        last_call_date TIMESTAMP WITH TIME ZONE,
        source TEXT DEFAULT 'manual',
        ghl_contact_id TEXT,
        qualification_level TEXT,
        qualification_confidence INTEGER,
        last_qualified_at TIMESTAMP WITH TIME ZONE,
        bot_notes TEXT,
        custom_fields JSONB DEFAULT '{}',
        created_by TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Add bot_notes column if it does not exist
    await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS bot_notes TEXT`);

    // Add custom_fields JSONB column for GHL custom field values
    await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'`);

    // Add bot_config_id to data tables so each bot config has independent data
    const tablesNeedingBotConfigId = [
      "personas", "situations", "product_sections",
      "ui_social_proof_companies", "ui_social_proof_cities", "ui_social_proof_roles",
    ];
    for (const table of tablesNeedingBotConfigId) {
      await query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS bot_config_id TEXT`);
    }

    // Add max_call_duration and ghl_workflows columns to bot_configs
    await query(`ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS max_call_duration INTEGER DEFAULT 480`);
    await query(`ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS ghl_workflows JSONB DEFAULT '[]'`);

    // Migrate existing rows: assign to the org's active bot config
    for (const table of tablesNeedingBotConfigId) {
      await query(
        `UPDATE ${table} t SET bot_config_id = (
          SELECT id FROM bot_configs WHERE org_id = t.org_id AND is_active = true LIMIT 1
        ) WHERE t.bot_config_id IS NULL`
      );
    }

    // Campaign tables
    await query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        bot_config_id TEXT NOT NULL,
        bot_config_name TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        concurrency_limit INTEGER NOT NULL DEFAULT 100,
        total_leads INTEGER NOT NULL DEFAULT 0,
        completed_calls INTEGER NOT NULL DEFAULT 0,
        failed_calls INTEGER NOT NULL DEFAULT 0,
        no_answer_calls INTEGER NOT NULL DEFAULT 0,
        webhook_base_url TEXT NOT NULL,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        paused_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS campaign_leads (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        lead_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        call_uuid TEXT,
        position INTEGER NOT NULL,
        queued_at TIMESTAMPTZ DEFAULT NOW(),
        called_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        error_message TEXT
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns(org_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_campaigns_org_status ON campaigns(org_id, status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_cl_campaign ON campaign_leads(campaign_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_cl_campaign_status ON campaign_leads(campaign_id, status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_cl_call_uuid ON campaign_leads(call_uuid)`);

    // Migrations: retry support
    await query(`ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS retry_config JSONB`);
    await query(`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0`);
    await query(`ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ`);

    // Migrations: voice, call_provider, pipeline_mode, language, tts_provider
    await query(`ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS voice TEXT DEFAULT ''`);
    await query(`ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS call_provider TEXT DEFAULT 'plivo'`);
    await query(`ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS pipeline_mode TEXT DEFAULT 'live_api'`);
    await query(`ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS language TEXT DEFAULT ''`);
    await query(`ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT ''`);
    await query(`ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS conversation_flow_mermaid TEXT DEFAULT ''`);

    // 16. call_queue (webhook calls queued when at concurrency limit)
    await query(`CREATE TABLE IF NOT EXISTS call_queue (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      source TEXT NOT NULL DEFAULT 'api',
      status TEXT NOT NULL DEFAULT 'queued',
      lead_id TEXT,
      bot_config_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      error_message TEXT,
      call_uuid TEXT
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_call_queue_org_status ON call_queue(org_id, status, created_at)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ui_calls_org_active ON ui_calls(org_id) WHERE status IN ('in-progress', 'initiating')`);

    return NextResponse.json({ success: true, message: "Database initialized" });
  } catch (error) {
    console.error("[Init API] POST error:", error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 500 }
    );
  }
}
