import { NextRequest, NextResponse } from "next/server";
import { requireUidAndOrg, query, toCamelRows } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireUidAndOrg(request);
    const rows = await query(
      "SELECT * FROM leads WHERE org_id = $1 ORDER BY created_at DESC",
      [orgId]
    );
    return NextResponse.json({ leads: toCamelRows(rows) });
  } catch (error) {
    console.error("[Leads API] GET error:", error);
    return NextResponse.json({ leads: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { uid, orgId } = await requireUidAndOrg(request);
    const body = await request.json();
    const { action, ...data } = body;

    if (action === "add") {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const lead = { ...data.lead, id, createdBy: uid, createdAt: now, updatedAt: now };
      await query(
        `INSERT INTO leads (id, org_id, phone_number, contact_name, email, company, location, tags, status, call_count, source, ghl_contact_id, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
        [
          id, orgId,
          data.lead.phoneNumber || "",
          data.lead.contactName || "",
          data.lead.email || null,
          data.lead.company || null,
          data.lead.location || null,
          JSON.stringify(data.lead.tags || []),
          data.lead.status || "new",
          data.lead.callCount || 0,
          data.lead.source || "manual",
          data.lead.ghlContactId || null,
          uid,
          now,
        ]
      );
      return NextResponse.json({ success: true, lead });
    }

    if (action === "addBulk") {
      const now = new Date().toISOString();
      const leads: Record<string, unknown>[] = [];
      for (const item of data.leads) {
        const id = crypto.randomUUID();
        await query(
          `INSERT INTO leads (id, org_id, phone_number, contact_name, email, company, location, tags, status, call_count, source, ghl_contact_id, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
          [
            id, orgId,
            item.phoneNumber || "",
            item.contactName || "",
            item.email || null,
            item.company || null,
            item.location || null,
            JSON.stringify(item.tags || []),
            item.status || "new",
            item.callCount || 0,
            item.source || "manual",
            item.ghlContactId || null,
            uid,
            now,
          ]
        );
        leads.push({ ...item, id, createdBy: uid, createdAt: now, updatedAt: now });
      }
      return NextResponse.json({ success: true, leads });
    }

    if (action === "update") {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let idx = 1;

      const fieldMap: Record<string, string> = {
        contactName: "contact_name",
        phoneNumber: "phone_number",
        email: "email",
        company: "company",
        location: "location",
        tags: "tags",
        status: "status",
        callCount: "call_count",
        lastCallDate: "last_call_date",
        qualificationLevel: "qualification_level",
        qualificationConfidence: "qualification_confidence",
        lastQualifiedAt: "last_qualified_at",
        botNotes: "bot_notes",
      };

      for (const [key, value] of Object.entries(data.updates || {})) {
        const col = fieldMap[key];
        if (col) {
          sets.push(`${col} = $${idx++}`);
          vals.push(col === "tags" ? JSON.stringify(value) : value);
        }
      }
      sets.push(`updated_at = $${idx++}`);
      vals.push(new Date().toISOString());
      vals.push(data.id);

      await query(
        `UPDATE leads SET ${sets.join(", ")} WHERE id = $${idx} AND org_id = $${idx + 1}`,
        [...vals, orgId]
      );
      return NextResponse.json({ success: true });
    }

    if (action === "delete") {
      for (const id of data.ids) {
        await query("DELETE FROM leads WHERE id = $1 AND org_id = $2", [id, orgId]);
      }
      return NextResponse.json({ success: true });
    }

    if (action === "incrementCallCount") {
      await query(
        `UPDATE leads SET call_count = call_count + 1, last_call_date = $1, updated_at = $1 WHERE id = $2 AND org_id = $3`,
        [new Date().toISOString(), data.id, orgId]
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[Leads API] POST error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
