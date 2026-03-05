import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";
import { query, queryOne } from "@/lib/db";
import { DEFAULT_BOT_CONFIG } from "@/lib/default-bot-config";

/**
 * POST /api/admin/restore-from-firebase
 *
 * Emergency restoration endpoint: pulls all users from Firebase Auth
 * and recreates their records in PostgreSQL (users, organizations, bot_configs).
 *
 * Protected by a secret key passed in the request body.
 */
export async function POST(request: NextRequest) {
  try {
    const { secret } = await request.json();

    // Simple secret protection — set RESTORE_SECRET env var or use default
    const expectedSecret = process.env.RESTORE_SECRET || "wavelength-restore-2026";
    if (secret !== expectedSecret) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 403 });
    }

    const adminAuth = getAdminAuth();
    const now = new Date().toISOString();

    // List all Firebase users (paginated, up to 1000 per page)
    const allUsers: Array<{
      uid: string;
      email: string;
      displayName: string;
      creationTime: string;
      lastSignInTime: string;
    }> = [];

    let nextPageToken: string | undefined;
    do {
      const listResult = await adminAuth.listUsers(1000, nextPageToken);
      for (const user of listResult.users) {
        allUsers.push({
          uid: user.uid,
          email: user.email || "",
          displayName: user.displayName || user.email?.split("@")[0] || "User",
          creationTime: user.metadata.creationTime || now,
          lastSignInTime: user.metadata.lastSignInTime || now,
        });
      }
      nextPageToken = listResult.pageToken;
    } while (nextPageToken);

    if (allUsers.length === 0) {
      return NextResponse.json({ message: "No users found in Firebase", restored: 0 });
    }

    const results = {
      totalFirebaseUsers: allUsers.length,
      usersCreated: 0,
      usersSkipped: 0,
      orgsCreated: 0,
      botConfigsCreated: 0,
      errors: [] as string[],
    };

    for (const fbUser of allUsers) {
      try {
        // Check if user already exists in DB
        const existing = await queryOne<{ uid: string }>(
          "SELECT uid FROM fwai_aicall_users WHERE uid = $1",
          [fbUser.uid]
        );

        if (existing) {
          results.usersSkipped++;
          continue;
        }

        // Create organization for this user
        const orgId = crypto.randomUUID();
        const orgName = fbUser.displayName
          ? `${fbUser.displayName}'s Org`
          : `Org-${fbUser.email.split("@")[0]}`;
        const orgSlug = orgName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

        const settings = {
          defaults: {
            clientName: orgSlug,
            agentName: "Agent",
            companyName: orgName,
            eventName: "",
            eventHost: "",
            voice: "Puck",
            location: "",
          },
          appearance: {
            sidebarCollapsed: false,
            animationsEnabled: true,
          },
          ai: {
            autoQualify: true,
          },
        };

        await query(
          `INSERT INTO fwai_aicall_organizations (id, name, slug, plan, status, webhook_url, created_by, created_at, updated_at, settings)
           VALUES ($1, $2, $3, 'free', 'active', '', $4, $5, $5, $6)`,
          [orgId, orgName, orgSlug, fbUser.uid, fbUser.creationTime, JSON.stringify(settings)]
        );
        results.orgsCreated++;

        // Create user record
        await query(
          `INSERT INTO fwai_aicall_users (uid, email, display_name, role, org_id, status, created_at, last_login_at)
           VALUES ($1, $2, $3, 'client_admin', $4, 'active', $5, $6)`,
          [fbUser.uid, fbUser.email, fbUser.displayName, orgId, fbUser.creationTime, fbUser.lastSignInTime]
        );
        results.usersCreated++;

        // Seed default bot config
        const botConfigId = crypto.randomUUID();
        await query(
          `INSERT INTO fwai_aicall_bot_configs (id, org_id, name, is_active, prompt, questions, objections, objection_keywords, context_variables, qualification_criteria, persona_engine_enabled, product_intelligence_enabled, social_proof_enabled, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
          [
            botConfigId,
            orgId,
            DEFAULT_BOT_CONFIG.name,
            DEFAULT_BOT_CONFIG.isActive,
            DEFAULT_BOT_CONFIG.prompt,
            JSON.stringify(DEFAULT_BOT_CONFIG.questions),
            JSON.stringify(DEFAULT_BOT_CONFIG.objections),
            JSON.stringify(DEFAULT_BOT_CONFIG.objectionKeywords),
            JSON.stringify(DEFAULT_BOT_CONFIG.contextVariables),
            JSON.stringify(DEFAULT_BOT_CONFIG.qualificationCriteria),
            DEFAULT_BOT_CONFIG.personaEngineEnabled,
            DEFAULT_BOT_CONFIG.productIntelligenceEnabled,
            DEFAULT_BOT_CONFIG.socialProofEnabled,
            fbUser.uid,
            now,
          ]
        );
        results.botConfigsCreated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.errors.push(`User ${fbUser.email} (${fbUser.uid}): ${msg}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Database restoration complete",
      ...results,
    });
  } catch (error) {
    console.error("[restore-from-firebase] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Restoration failed" },
      { status: 500 }
    );
  }
}
