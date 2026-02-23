import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";
import { queryOne, query, toCamel } from "@/lib/db";

const SESSION_COOKIE_NAME = "__session";
const SESSION_EXPIRY = 60 * 60 * 24 * 14 * 1000; // 14 days

export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json();

    if (!idToken) {
      return NextResponse.json(
        { success: false, message: "Missing ID token" },
        { status: 400 }
      );
    }

    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(idToken);

    // Fetch profile + create session cookie in parallel
    const [row, sessionCookie] = await Promise.all([
      queryOne(
        "SELECT uid, email, display_name, role, org_id, status, created_at, last_login_at, invited_by FROM users WHERE uid = $1",
        [decoded.uid]
      ),
      adminAuth.createSessionCookie(idToken, { expiresIn: SESSION_EXPIRY }),
    ]);

    // Update last login (fire-and-forget)
    query("UPDATE users SET last_login_at = NOW() WHERE uid = $1", [decoded.uid]).catch(() => {});

    const profile = row ? toCamel(row) : null;

    const response = NextResponse.json({ success: true, profile });

    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_EXPIRY / 1000,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[Login API] Error:", error);
    const message =
      error instanceof Error ? error.message : "Login failed";
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}
