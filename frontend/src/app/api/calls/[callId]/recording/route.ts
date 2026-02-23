import { NextRequest, NextResponse } from "next/server";

const FWAI_BACKEND_URL =
  process.env.CALL_SERVER_URL?.replace(/\/call\/conversational$/, "") ||
  "http://34.93.142.172:3001";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const { callId } = await params;

  try {
    const url = `${FWAI_BACKEND_URL}/calls/${callId}/recording`;
    console.log("[API /api/calls/recording] Proxying to:", url);

    const response = await fetch(url);

    if (!response.ok) {
      return NextResponse.json(
        { error: "Recording not found" },
        { status: response.status }
      );
    }

    const contentType = response.headers.get("content-type") || "audio/mpeg";
    const audioData = await response.arrayBuffer();

    return new NextResponse(audioData, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(audioData.byteLength),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[API /api/calls/recording] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch recording" },
      { status: 500 }
    );
  }
}
