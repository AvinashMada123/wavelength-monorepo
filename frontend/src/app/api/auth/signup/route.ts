import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";
import { query, queryOne } from "@/lib/db";
import { DEFAULT_BOT_CONFIG } from "@/lib/default-bot-config";

const SESSION_COOKIE_NAME = "__session";
const SESSION_EXPIRY = 60 * 60 * 24 * 14 * 1000; // 14 days

export async function POST(request: NextRequest) {
  try {
    const { idToken, displayName, orgName, inviteId } = await request.json();

    if (!idToken || !displayName) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 }
      );
    }

    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || "";

    const now = new Date().toISOString();
    let orgId: string;
    let role = "client_admin";

    if (inviteId) {
      // Invite flow: join existing org
      const invite = await queryOne<{
        org_id: string;
        email: string;
        role: string;
        status: string;
        invited_by: string;
      }>(
        "SELECT org_id, email, role, status, invited_by FROM invites WHERE id = $1",
        [inviteId]
      );
      if (!invite) {
        return NextResponse.json(
          { success: false, message: "Invite not found" },
          { status: 400 }
        );
      }
      if (invite.status !== "pending") {
        return NextResponse.json(
          { success: false, message: "Invite already used" },
          { status: 400 }
        );
      }
      if (invite.email !== email) {
        return NextResponse.json(
          { success: false, message: "Email does not match invite" },
          { status: 400 }
        );
      }
      orgId = invite.org_id;
      role = invite.role || "client_user";

      // Mark invite as accepted
      await query(
        "UPDATE invites SET status = 'accepted', accepted_at = $1 WHERE id = $2",
        [now, inviteId]
      );

      // Create user profile
      await query(
        `INSERT INTO users (uid, email, display_name, role, org_id, status, created_at, last_login_at, invited_by)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $6, $7)`,
        [uid, email, displayName, role, orgId, now, invite.invited_by]
      );
    } else {
      // Normal signup: create new org
      if (!orgName) {
        return NextResponse.json(
          { success: false, message: "Organization name is required" },
          { status: 400 }
        );
      }

      const orgSlug = orgName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      orgId = crypto.randomUUID();

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
        `INSERT INTO organizations (id, name, slug, plan, status, webhook_url, created_by, created_at, updated_at, settings)
         VALUES ($1, $2, $3, 'free', 'active', '', $4, $5, $5, $6)`,
        [orgId, orgName, orgSlug, uid, now, JSON.stringify(settings)]
      );

      // Create user profile
      await query(
        `INSERT INTO users (uid, email, display_name, role, org_id, status, created_at, last_login_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)`,
        [uid, email, displayName, role, orgId, now]
      );

      // Seed default bot config
      const botConfigId = crypto.randomUUID();
      await query(
        `INSERT INTO bot_configs (id, org_id, name, is_active, prompt, questions, objections, objection_keywords, context_variables, qualification_criteria, persona_engine_enabled, product_intelligence_enabled, social_proof_enabled, created_by, created_at, updated_at)
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
          uid,
          now,
        ]
      );
    }

    // Create session cookie
    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_EXPIRY,
    });

    const profile = {
      uid,
      email,
      displayName,
      role,
      orgId,
      status: "active",
      createdAt: now,
      lastLoginAt: now,
    };

    const response = NextResponse.json({
      success: true,
      orgId,
      profile,
    });

    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_EXPIRY / 1000,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[Signup API] Error:", error);
    const message =
      error instanceof Error ? error.message : "Signup failed";
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}
