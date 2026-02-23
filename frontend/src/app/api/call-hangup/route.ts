import { NextRequest, NextResponse } from "next/server";

const CALL_SERVER_URL =
  (process.env.CALL_SERVER_URL || "http://34.93.142.172:3001/call/conversational")
    .replace(/\/call\/conversational$/, "");

export async function POST(request: NextRequest) {
  try {
    const { callUuid } = await request.json();
    if (!callUuid) {
      return NextResponse.json({ success: false, message: "Missing callUuid" }, { status: 400 });
    }

    // Tell the Python backend to hang up the Plivo call
    const res = await fetch(`${CALL_SERVER_URL}/calls/${callUuid}/hangup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call_uuid: callUuid }),
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { success: false, message: `Backend returned ${res.status}` },
      { status: 502 }
    );
  } catch (error) {
    console.error("[API /api/call-hangup] Error:", error);
    return NextResponse.json({ success: true }); // Don't fail the frontend
  }
}
