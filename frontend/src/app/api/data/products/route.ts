import { NextRequest, NextResponse } from "next/server";
import { getUidAndOrgFromToken, query, toCamelRows } from "@/lib/db";

const BACKEND_BASE_URL = (
  process.env.CALL_SERVER_URL || "http://34.93.142.172:3001/call/conversational"
).replace(/\/call\/conversational$/, "");

export async function GET(request: NextRequest) {
  try {
    const result = await getUidAndOrgFromToken(request);
    if (result instanceof NextResponse) return result;
    const { orgId } = result;

    const rows = await query("SELECT * FROM product_sections WHERE org_id = $1", [orgId]);
    return NextResponse.json({ sections: toCamelRows(rows) });
  } catch (error) {
    console.error("[Products API] GET error:", error);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await getUidAndOrgFromToken(request);
    if (result instanceof NextResponse) return result;
    const { orgId } = result;

    const body = await request.json();
    const { action } = body;
    const now = new Date().toISOString();

    switch (action) {
      case "upload": {
        const { text } = body;
        const res = await fetch(`${BACKEND_BASE_URL}/products/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, orgId }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error("[Products API] Backend upload error:", res.status, errText);
          return NextResponse.json(
            { error: `Backend returned ${res.status}` },
            { status: 502 }
          );
        }

        const data = await res.json();
        const sections = data.sections || [];

        for (const section of sections) {
          const id = section.id || `sec_${crypto.randomUUID().slice(0, 8)}`;
          await query(
            `INSERT INTO product_sections (id, org_id, name, content, keywords, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $6)
             ON CONFLICT (id) DO UPDATE SET name = $3, content = $4, keywords = $5, updated_at = $6`,
            [id, orgId, section.name || "", section.content || "", JSON.stringify(section.keywords || []), now]
          );
        }

        const rows = await query("SELECT * FROM product_sections WHERE org_id = $1", [orgId]);
        return NextResponse.json({ success: true, sections: toCamelRows(rows) });
      }

      case "createSection": {
        const { section } = body;
        await query(
          `INSERT INTO product_sections (id, org_id, name, content, keywords, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [section.id, orgId, section.name || "", section.content || "", JSON.stringify(section.keywords || []), now]
        );
        return NextResponse.json({ success: true });
      }

      case "updateSection": {
        const { sectionId, updates } = body;
        const sets: string[] = [];
        const vals: unknown[] = [];
        let idx = 1;
        const fieldMap: Record<string, string> = { name: "name", content: "content", keywords: "keywords" };
        for (const [k, v] of Object.entries(updates || {})) {
          const col = fieldMap[k];
          if (col) {
            sets.push(`${col} = $${idx++}`);
            vals.push(col === "keywords" ? JSON.stringify(v) : v);
          }
        }
        sets.push(`updated_at = $${idx++}`);
        vals.push(now);
        vals.push(sectionId);
        vals.push(orgId);
        await query(
          `UPDATE product_sections SET ${sets.join(", ")} WHERE id = $${idx} AND org_id = $${idx + 1}`,
          vals
        );
        return NextResponse.json({ success: true });
      }

      case "deleteSection": {
        const { sectionId } = body;
        await query("DELETE FROM product_sections WHERE id = $1 AND org_id = $2", [sectionId, orgId]);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Products API] POST error:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
