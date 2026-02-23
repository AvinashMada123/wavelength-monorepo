import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, query } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if ("error" in auth) return auth.error;

    // Fetch users, orgs, and recent calls in parallel
    const [usersRows, orgsRows, recentCallsRows] = await Promise.all([
      query("SELECT uid, email, display_name, org_id, role, status, created_at FROM users ORDER BY created_at DESC"),
      query("SELECT id, name FROM organizations"),
      query(
        `SELECT c.id, c.org_id, c.call_uuid, c.request, c.status, c.initiated_at, c.duration_seconds,
                c.ended_data, c.interest_level, c.call_summary,
                o.name as org_name
         FROM ui_calls c
         LEFT JOIN organizations o ON o.id = c.org_id
         ORDER BY c.initiated_at DESC
         LIMIT 20`
      ),
    ]);

    const totalUsers = usersRows.length;

    // Build org name lookup
    const orgNames = new Map<string, string>();
    for (const org of orgsRows) {
      orgNames.set(org.id as string, (org.name as string) || "Unknown");
    }

    // Recent signups (already sorted desc, take 10)
    const recentSignups = usersRows.slice(0, 10).map((u) => ({
      uid: u.uid,
      email: u.email || "",
      displayName: u.display_name || "",
      orgId: u.org_id || "",
      orgName: orgNames.get(u.org_id as string) || "Unknown",
      createdAt: u.created_at || "",
    }));

    // Recent calls - extract summary and transcript from ended_data
    const recentCalls = recentCallsRows.map((c) => {
      const req = (c.request || {}) as Record<string, string>;
      const endedData = (c.ended_data || {}) as Record<string, unknown>;
      
      return {
        id: c.id,
        orgId: c.org_id,
        orgName: c.org_name || "Unknown",
        contactName: req.contactName || "Unknown",
        phoneNumber: req.phoneNumber || "",
        status: c.status || "unknown",
        initiatedAt: c.initiated_at || "",
        durationSeconds: c.duration_seconds,
        callSummary: c.call_summary || endedData.call_summary || "",
        interestLevel: c.interest_level || endedData.interest_level || "",
        transcript: endedData.transcript || "",
        transcriptEntries: endedData.transcript_entries || [],
      };
    });

    return NextResponse.json({ totalUsers, recentSignups, recentCalls });
  } catch (error) {
    console.error("[Admin Stats API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
