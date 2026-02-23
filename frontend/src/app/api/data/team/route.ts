import { NextRequest, NextResponse } from "next/server";
import { getUidAndOrgFromToken, query, queryOne, toCamelRows } from "@/lib/db";
import { sendInviteEmail } from "@/lib/email";

export async function GET(request: NextRequest) {
  try {
    const result = await getUidAndOrgFromToken(request);
    if (result instanceof NextResponse) return result;
    const { orgId } = result;

    const rows = await query(
      "SELECT uid, email, display_name, role, org_id, status, created_at, last_login_at FROM users WHERE org_id = $1",
      [orgId]
    );
    return NextResponse.json({ members: toCamelRows(rows) });
  } catch (error) {
    console.error("[Team API] GET error:", error);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await getUidAndOrgFromToken(request);
    if (result instanceof NextResponse) return result;
    const { orgId, uid } = result;

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case "invite": {
        const { email, role } = body;
        // Get org name
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
          [
            inviteId,
            email.trim().toLowerCase(),
            orgId,
            orgName,
            role,
            uid,
            now.toISOString(),
            expiresAt.toISOString(),
          ]
        );

        const baseUrl = request.nextUrl.origin;
        try {
          await sendInviteEmail({ toEmail: email.trim().toLowerCase(), orgName, inviteId, baseUrl });
        } catch (emailErr) {
          console.error("[Team API] Failed to send invite email:", emailErr);
        }

        return NextResponse.json({ success: true, inviteId });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Team API] POST error:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
