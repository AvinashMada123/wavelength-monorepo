import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const row = await queryOne(
      "SELECT id, email, org_id, org_name, role, status, expires_at FROM invites WHERE id = $1",
      [token]
    );

    if (!row) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    return NextResponse.json({
      invite: {
        id: row.id,
        email: row.email,
        orgId: row.org_id,
        orgName: row.org_name,
        role: row.role,
        status: row.status,
        expiresAt: row.expires_at,
      },
    });
  } catch (error) {
    console.error("[Invite API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
