import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params;

    // Verify org exists
    const orgRow = await queryOne<{ settings: Record<string, unknown>; name: string }>(
      "SELECT name, settings FROM organizations WHERE id = $1",
      [orgId]
    );
    if (!orgRow) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Fetch active bot config
    const config = await queryOne(
      "SELECT * FROM bot_configs WHERE org_id = $1 AND is_active = true LIMIT 1",
      [orgId]
    );

    if (!config) {
      return NextResponse.json({ error: "No active bot config" }, { status: 404 });
    }

    const settings = ((orgRow.settings as Record<string, Record<string, string>>) || {}).defaults || {};

    // Format for n8n consumption
    const questions = ((config.questions as Array<{ id: string; prompt: string; order: number }>) || [])
      .sort((a, b) => a.order - b.order)
      .map((q) => ({ id: q.id, prompt: q.prompt }));

    const objections = Object.fromEntries(
      ((config.objections as Array<{ key: string; response: string }>) || []).map((o) => [o.key, o.response])
    );

    const objectionKeywords = (config.objection_keywords as Record<string, string[]>) || Object.fromEntries(
      ((config.objections as Array<{ key: string; keywords: string[] }>) || []).map((o) => [o.key, o.keywords])
    );

    const response = {
      prompt: config.prompt,
      questions,
      objections,
      objectionKeywords,
      context: {
        agent_name: settings.agentName || "Agent",
        company_name: settings.companyName || orgRow.name || "",
        event_host: settings.eventHost || "",
        location: settings.location || "",
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[API /api/bot-config] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bot config" },
      { status: 500 }
    );
  }
}
