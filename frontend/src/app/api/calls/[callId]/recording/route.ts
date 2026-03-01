import { NextRequest, NextResponse } from "next/server";

const FWAI_BACKEND_URL =
  process.env.CALL_SERVER_URL?.replace(/\/call\/conversational$/, "") ||
  "http://34.93.142.172:3001";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const { callId } = await params;

  try {
    const url = `${FWAI_BACKEND_URL}/calls/${callId}/recording`;

    // Forward the Range header from the browser for seeking support
    const headers: Record<string, string> = {};
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      headers["Range"] = rangeHeader;
    }

    const response = await fetch(url, { headers });

    if (!response.ok && response.status !== 206) {
      return NextResponse.json(
        { error: "Recording not found" },
        { status: response.status }
      );
    }

    const contentType = response.headers.get("content-type") || "audio/mpeg";
    const audioData = await response.arrayBuffer();

    // Build response headers
    const resHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(audioData.byteLength),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    };

    // Forward range-related headers from backend
    const contentRange = response.headers.get("content-range");
    if (contentRange) {
      resHeaders["Content-Range"] = contentRange;
    }

    return new NextResponse(audioData, {
      status: response.status === 206 ? 206 : 200,
      headers: resHeaders,
    });
  } catch (error) {
    console.error("[API /api/calls/recording] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch recording" },
      { status: 500 }
    );
  }
}
