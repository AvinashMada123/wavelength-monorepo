import { NextRequest, NextResponse } from "next/server";
import { requireUidAndOrg, query, toCamelRows } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireUidAndOrg(request);
    const rows = await query(
      "SELECT * FROM ui_calls WHERE org_id = $1 ORDER BY initiated_at DESC",
      [orgId]
    );
    return NextResponse.json({ calls: toCamelRows(rows) });
  } catch (error) {
    console.error("[Calls API] GET error:", error);
    return NextResponse.json({ calls: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { uid, orgId } = await requireUidAndOrg(request);
    const body = await request.json();
    const { action, ...data } = body;

    if (action === "add") {
      const call = data.call;
      const id = call.id || crypto.randomUUID();
      await query(
        `INSERT INTO ui_calls (id, org_id, call_uuid, lead_id, request, response, status, initiated_at, initiated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           call_uuid = EXCLUDED.call_uuid,
           request = EXCLUDED.request,
           response = EXCLUDED.response,
           status = EXCLUDED.status,
           initiated_by = EXCLUDED.initiated_by`,
        [
          id, orgId,
          call.callUuid || null,
          call.leadId || null,
          JSON.stringify(call.request || {}),
          call.response ? JSON.stringify(call.response) : null,
          call.status || "initiating",
          call.initiatedAt || new Date().toISOString(),
          uid,
        ]
      );
      return NextResponse.json({ success: true });
    }

    if (action === "update") {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let idx = 1;

      const fieldMap: Record<string, string> = {
        callUuid: "call_uuid",
        status: "status",
        endedData: "ended_data",
        durationSeconds: "duration_seconds",
        interestLevel: "interest_level",
        completionRate: "completion_rate",
        callSummary: "call_summary",
        qualification: "qualification",
        completedAt: "completed_at",
        response: "response",
      };

      for (const [key, value] of Object.entries(data.updates || {})) {
        const col = fieldMap[key];
        if (col) {
          sets.push(`${col} = $${idx++}`);
          vals.push(
            ["ended_data", "qualification", "response"].includes(col)
              ? JSON.stringify(value)
              : value
          );
        }
      }

      if (sets.length === 0) {
        return NextResponse.json({ success: true });
      }

      vals.push(data.id);
      vals.push(orgId);
      await query(
        `UPDATE ui_calls SET ${sets.join(", ")} WHERE id = $${idx} AND org_id = $${idx + 1}`,
        vals
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[Calls API] POST error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
