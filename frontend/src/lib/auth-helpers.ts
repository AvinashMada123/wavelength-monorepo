import { NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { queryOne } from "@/lib/db";
import type { UserRole } from "@/types/user";

const SESSION_COOKIE_NAME = "__session";

export interface AuthenticatedUser {
  uid: string;
  email: string;
  orgId: string;
  role: UserRole;
}

export async function getAuthenticatedUser(
  request: NextRequest
): Promise<AuthenticatedUser | null> {
  try {
    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionCookie) return null;

    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    const row = await queryOne<{ email: string; org_id: string; role: string }>(
      "SELECT email, org_id, role FROM users WHERE uid = $1",
      [decoded.uid]
    );
    if (!row) return null;

    return {
      uid: decoded.uid,
      email: row.email,
      orgId: row.org_id,
      role: row.role as UserRole,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(
  request: NextRequest
): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

export async function requireRole(
  request: NextRequest,
  roles: UserRole[]
): Promise<AuthenticatedUser> {
  const user = await requireAuth(request);
  if (!roles.includes(user.role)) {
    throw new Error("Forbidden");
  }
  return user;
}
