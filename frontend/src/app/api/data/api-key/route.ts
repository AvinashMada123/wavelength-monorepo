import { NextRequest, NextResponse } from "next/server";
import { requireUidAndOrg, queryOne, query } from "@/lib/db";
import { randomBytes } from "crypto";

/** GET - Return the current org API key (if any) */
export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireUidAndOrg(request);
    const row = await queryOne<{ settings: Record<string, unknown> }>(
      "SELECT settings FROM fwai_aicall_organizations WHERE id = $1",
      [orgId]
    );
    const apiKey = (row?.settings as Record<string, string>)?.apiKey || "";
    return NextResponse.json({ apiKey });
  } catch (error) {
    console.error("[API Key] GET error:", error);
    return NextResponse.json({ apiKey: "" }, { status: 500 });
  }
}

/** POST - Generate a new API key (or regenerate) */
export async function POST(request: NextRequest) {
  try {
    const { orgId } = await requireUidAndOrg(request);

    const newKey = `wl_${randomBytes(24).toString("hex")}`;

    // Merge into existing settings
    const row = await queryOne<{ settings: Record<string, unknown> }>(
      "SELECT settings FROM fwai_aicall_organizations WHERE id = $1",
      [orgId]
    );
    const current = row?.settings || {};
    const merged = { ...current, apiKey: newKey };

    await query(
      "UPDATE fwai_aicall_organizations SET settings = $1, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(merged), orgId]
    );

    return NextResponse.json({ apiKey: newKey });
  } catch (error) {
    console.error("[API Key] POST error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
