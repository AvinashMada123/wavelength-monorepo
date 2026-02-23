import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";
import { queryOne, toCamel } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ profile: null }, { status: 401 });
    }

    const idToken = authHeader.slice(7);
    const decoded = await getAdminAuth().verifyIdToken(idToken);

    const row = await queryOne(
      "SELECT uid, email, display_name, role, org_id, status, created_at, last_login_at, invited_by FROM users WHERE uid = $1",
      [decoded.uid]
    );

    if (!row) {
      return NextResponse.json({ profile: null });
    }

    return NextResponse.json({ profile: toCamel(row) });
  } catch (error) {
    console.error("[Auth/Me] Error:", error);
    return NextResponse.json({ profile: null }, { status: 401 });
  }
}
