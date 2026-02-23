import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, query, queryOne, toCamelRows } from "@/lib/db";
import { DEFAULT_BOT_CONFIG } from "@/lib/default-bot-config";
import { sendInviteEmail } from "@/lib/email";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if ("error" in auth) return auth.error;

    const rows = await query("SELECT * FROM organizations ORDER BY created_at DESC");
    return NextResponse.json({ organizations: toCamelRows(rows) });
  } catch (error) {
    console.error("[Admin Org API] GET Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if ("error" in auth) return auth.error;
    const { uid } = auth;

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case "create": {
        const { orgName, plan, adminEmail } = body;
        if (!orgName?.trim()) {
          return NextResponse.json({ error: "Organization name is required" }, { status: 400 });
        }

        const now = new Date().toISOString();
        const orgSlug = orgName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

        const orgId = crypto.randomUUID();
        const settings = {
          defaults: {
            clientName: orgSlug,
            agentName: "Agent",
            companyName: orgName.trim(),
            eventName: "",
            eventHost: "",
            voice: "Puck",
            location: "",
          },
          appearance: { sidebarCollapsed: false, animationsEnabled: true },
          ai: { autoQualify: true },
        };

        await query(
          `INSERT INTO organizations (id, name, slug, plan, status, webhook_url, created_by, created_at, updated_at, settings)
           VALUES ($1, $2, $3, $4, 'active', '', $5, $6, $6, $7)`,
          [orgId, orgName.trim(), orgSlug, plan || "free", uid, now, JSON.stringify(settings)]
        );

        // Seed default bot config
        const botConfigId = crypto.randomUUID();
        await query(
          `INSERT INTO bot_configs (id, org_id, name, is_active, prompt, questions, objections, objection_keywords, context_variables, qualification_criteria, persona_engine_enabled, product_intelligence_enabled, social_proof_enabled, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
          [
            botConfigId, orgId,
            DEFAULT_BOT_CONFIG.name, DEFAULT_BOT_CONFIG.isActive,
            DEFAULT_BOT_CONFIG.prompt,
            JSON.stringify(DEFAULT_BOT_CONFIG.questions),
            JSON.stringify(DEFAULT_BOT_CONFIG.objections),
            JSON.stringify(DEFAULT_BOT_CONFIG.objectionKeywords),
            JSON.stringify(DEFAULT_BOT_CONFIG.contextVariables),
            JSON.stringify(DEFAULT_BOT_CONFIG.qualificationCriteria),
            DEFAULT_BOT_CONFIG.personaEngineEnabled,
            DEFAULT_BOT_CONFIG.productIntelligenceEnabled,
            DEFAULT_BOT_CONFIG.socialProofEnabled,
            uid, now,
          ]
        );

        // Optionally invite an admin
        let inviteId: string | undefined;
        if (adminEmail?.trim()) {
          inviteId = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          await query(
            `INSERT INTO invites (id, email, org_id, org_name, role, invited_by, status, created_at, expires_at)
             VALUES ($1, $2, $3, $4, 'client_admin', $5, 'pending', $6, $7)`,
            [inviteId, adminEmail.trim().toLowerCase(), orgId, orgName.trim(), uid, now, expiresAt.toISOString()]
          );
          const baseUrl = request.nextUrl.origin;
          try {
            await sendInviteEmail({ toEmail: adminEmail.trim().toLowerCase(), orgName: orgName.trim(), inviteId, baseUrl });
          } catch (emailErr) {
            console.error("[Admin Org API] Failed to send invite email:", emailErr);
          }
        }

        return NextResponse.json({ success: true, orgId, inviteId });
      }

      case "update": {
        const { orgId, updates } = body;
        if (!orgId) {
          return NextResponse.json({ error: "orgId is required" }, { status: 400 });
        }

        const allowed: Record<string, unknown> = {};
        if (updates?.plan) allowed.plan = updates.plan;
        if (updates?.status) allowed.status = updates.status;

        const sets: string[] = [];
        const vals: unknown[] = [];
        let idx = 1;
        for (const [k, v] of Object.entries(allowed)) {
          sets.push(`${k} = $${idx++}`);
          vals.push(v);
        }
        sets.push(`updated_at = $${idx++}`);
        vals.push(new Date().toISOString());
        vals.push(orgId);

        await query(
          `UPDATE organizations SET ${sets.join(", ")} WHERE id = $${idx}`,
          vals
        );

        return NextResponse.json({ success: true });
      }

      case "invite": {
        const { orgId, email, role } = body;
        if (!orgId || !email?.trim()) {
          return NextResponse.json({ error: "orgId and email are required" }, { status: 400 });
        }

        const orgRow = await queryOne<{ name: string }>(
          "SELECT name FROM organizations WHERE id = $1",
          [orgId]
        );
        const orgName = orgRow?.name ?? "Organization";

        const inviteId = crypto.randomUUID();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        await query(
          `INSERT INTO invites (id, email, org_id, org_name, role, invited_by, status, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
          [inviteId, email.trim().toLowerCase(), orgId, orgName, role || "client_user", uid, now.toISOString(), expiresAt.toISOString()]
        );

        const baseUrl = request.nextUrl.origin;
        try {
          await sendInviteEmail({ toEmail: email.trim().toLowerCase(), orgName, inviteId, baseUrl });
        } catch (emailErr) {
          console.error("[Admin Org API] Failed to send invite email:", emailErr);
        }

        return NextResponse.json({ success: true, inviteId });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Admin Org API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
