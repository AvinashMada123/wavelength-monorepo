import { NextRequest, NextResponse } from "next/server";
import { requireUidAndOrg } from "@/lib/db";

const BACKEND_BASE_URL = (
  process.env.CALL_SERVER_URL || "http://34.93.142.172:3001/call/conversational"
).replace(/\/call\/conversational$/, "");

// snake_case → camelCase for memory objects
function camelizeMemory(raw: Record<string, unknown>) {
  return {
    phone: raw.phone,
    name: raw.name || raw.contact_name,
    persona: raw.persona,
    company: raw.company,
    role: raw.role,
    objections: raw.objections,
    interestAreas: raw.interest_areas,
    keyFacts: raw.key_facts,
    callCount: raw.call_count,
    lastCallDate: raw.last_call_date,
    lastCallSummary: raw.last_call_summary,
    lastCallOutcome: raw.last_call_outcome,
    allCallUuids: raw.all_call_uuids,
    linguisticStyle: raw.linguistic_style,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireUidAndOrg(request);
    const phone = request.nextUrl.searchParams.get("phone");

    const url = phone
      ? `${BACKEND_BASE_URL}/memory/${encodeURIComponent(phone)}?org_id=${encodeURIComponent(orgId)}`
      : `${BACKEND_BASE_URL}/memory?org_id=${encodeURIComponent(orgId)}`;

    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ memory: null });
      }
      return NextResponse.json({ error: "Backend error" }, { status: 502 });
    }

    const data = await res.json();

    if (phone) {
      const mem = data.memory || data;
      return NextResponse.json({ memory: camelizeMemory(mem) });
    }

    const memories = (data.memories || []).map((m: Record<string, unknown>) => camelizeMemory(m));
    return NextResponse.json({ memories, total: data.total || memories.length });
  } catch (error) {
    console.error("[Memory API] GET error:", error);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { orgId } = await requireUidAndOrg(request);
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case "update": {
        const { phone, updates } = body;
        const res = await fetch(
          `${BACKEND_BASE_URL}/memory/${encodeURIComponent(phone)}?org_id=${encodeURIComponent(orgId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          }
        );
        if (!res.ok) {
          return NextResponse.json({ error: "Backend update failed" }, { status: 502 });
        }
        const data = await res.json();
        return NextResponse.json(data);
      }

      case "delete": {
        const { phone } = body;
        const res = await fetch(
          `${BACKEND_BASE_URL}/memory/${encodeURIComponent(phone)}?org_id=${encodeURIComponent(orgId)}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          return NextResponse.json({ error: "Backend delete failed" }, { status: 502 });
        }
        const data = await res.json();
        return NextResponse.json(data);
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Memory API] POST error:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
