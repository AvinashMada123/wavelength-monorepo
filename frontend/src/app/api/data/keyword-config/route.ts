import { NextRequest, NextResponse } from "next/server";
import { requireUidAndOrg } from "@/lib/db";

const BACKEND_BASE_URL = (
  process.env.CALL_SERVER_URL || "http://34.93.142.172:3001/call/conversational"
).replace(/\/call\/conversational$/, "");

export async function POST(request: NextRequest) {
  try {
    await requireUidAndOrg(request);
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case "getPersonaConfig": {
        const res = await fetch(`${BACKEND_BASE_URL}/persona-config`);
        if (!res.ok) return NextResponse.json({ error: "Backend error" }, { status: 502 });
        return NextResponse.json(await res.json());
      }

      case "updatePersonaConfig": {
        const { config } = body;
        const res = await fetch(`${BACKEND_BASE_URL}/persona-config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
        if (!res.ok) return NextResponse.json({ error: "Backend error" }, { status: 502 });
        return NextResponse.json(await res.json());
      }

      case "getProductConfig": {
        const res = await fetch(`${BACKEND_BASE_URL}/product-config`);
        if (!res.ok) return NextResponse.json({ error: "Backend error" }, { status: 502 });
        return NextResponse.json(await res.json());
      }

      case "updateProductConfig": {
        const { config } = body;
        const res = await fetch(`${BACKEND_BASE_URL}/product-config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
        if (!res.ok) return NextResponse.json({ error: "Backend error" }, { status: 502 });
        return NextResponse.json(await res.json());
      }

      case "getMicroMomentsConfig": {
        const res = await fetch(`${BACKEND_BASE_URL}/micro-moments-config`);
        if (!res.ok) return NextResponse.json({ error: "Backend error" }, { status: 502 });
        return NextResponse.json(await res.json());
      }

      case "updateMicroMomentsConfig": {
        const { config } = body;
        const res = await fetch(`${BACKEND_BASE_URL}/micro-moments-config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
        if (!res.ok) return NextResponse.json({ error: "Backend error" }, { status: 502 });
        return NextResponse.json(await res.json());
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Keyword Config API] POST error:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
