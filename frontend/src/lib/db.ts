import { Pool, type QueryResultRow } from "pg";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

/* ------------------------------------------------------------------ */
/*  PostgreSQL connection pool (survives Next.js hot-reload)          */
/* ------------------------------------------------------------------ */

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://devuser:dev%402026@140.245.206.162:5432/devdb";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function getPool(): Pool {
  if (globalThis.__pgPool) return globalThis.__pgPool;
  globalThis.__pgPool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return globalThis.__pgPool;
}

export const pool = getPool();

/* ------------------------------------------------------------------ */
/*  Query helpers                                                     */
/* ------------------------------------------------------------------ */

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<T[]> {
  const { rows } = await pool.query<T>(text, values);
  return rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ */
/*  snake_case  <->  camelCase  conversions                           */
/* ------------------------------------------------------------------ */

export function toCamel<T = Record<string, unknown>>(
  row: Record<string, unknown>
): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = v;
  }
  return out as T;
}

export function toCamelRows<T = Record<string, unknown>>(
  rows: Record<string, unknown>[]
): T[] {
  return rows.map((r) => toCamel<T>(r));
}

/* ------------------------------------------------------------------ */
/*  Auth helper: extract uid + orgId from Bearer token                */
/* ------------------------------------------------------------------ */

export async function getUidAndOrgFromToken(
  request: NextRequest
): Promise<{ uid: string; orgId: string } | NextResponse> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const idToken = authHeader.slice(7);
  const decoded = await getAdminAuth().verifyIdToken(idToken);

  const row = await queryOne<{ org_id: string }>(
    "SELECT org_id FROM users WHERE uid = $1",
    [decoded.uid]
  );
  if (!row) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  return { uid: decoded.uid, orgId: row.org_id };
}

/**
 * Variant that throws instead of returning NextResponse.
 * Useful for routes that catch errors at the top level.
 */
export async function requireUidAndOrg(
  request: NextRequest
): Promise<{ uid: string; orgId: string }> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
  const idToken = authHeader.slice(7);
  const decoded = await getAdminAuth().verifyIdToken(idToken);

  const row = await queryOne<{ org_id: string }>(
    "SELECT org_id FROM users WHERE uid = $1",
    [decoded.uid]
  );
  if (!row) throw new Error("User not found");
  return { uid: decoded.uid, orgId: row.org_id };
}

/**
 * Verify the caller is a super_admin. Returns uid + db helpers or an error response.
 */
export async function requireSuperAdmin(
  request: NextRequest
): Promise<{ uid: string } | { error: NextResponse }> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const idToken = authHeader.slice(7);
  const decoded = await getAdminAuth().verifyIdToken(idToken);

  const row = await queryOne<{ role: string }>(
    "SELECT role FROM users WHERE uid = $1",
    [decoded.uid]
  );
  if (!row || row.role !== "super_admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { uid: decoded.uid };
}
