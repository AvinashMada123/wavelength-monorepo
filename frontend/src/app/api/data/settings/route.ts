import { NextRequest, NextResponse } from "next/server";
import { requireUidAndOrg, queryOne, query } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireUidAndOrg(request);
    const row = await queryOne<{ settings: Record<string, unknown> }>(
      "SELECT settings FROM organizations WHERE id = $1",
      [orgId]
    );
    const settings = row?.settings || {};
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("[Settings API] GET error:", error);
    return NextResponse.json({ settings: {} }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { orgId } = await requireUidAndOrg(request);
    const { settings } = await request.json();

    // Read current settings and merge to avoid overwriting existing fields
    const row = await queryOne<{ settings: Record<string, unknown> }>(
      "SELECT settings FROM organizations WHERE id = $1",
      [orgId]
    );
    const current = (row?.settings || {}) as Record<string, Record<string, unknown>>;
    const merged = {
      ...current,
      ...settings,
      defaults: { ...(current.defaults ?? {}), ...(settings.defaults ?? {}) },
      appearance: { ...(current.appearance ?? {}), ...(settings.appearance ?? {}) },
      ai: { ...(current.ai ?? {}), ...(settings.ai ?? {}) },
    };

    await query(
      "UPDATE organizations SET settings = $1, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(merged), orgId]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Settings API] POST error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
