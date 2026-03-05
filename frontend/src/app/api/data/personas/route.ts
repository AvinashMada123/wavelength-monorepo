import { NextRequest, NextResponse } from "next/server";
import { getUidAndOrgFromToken, query, toCamelRows } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const result = await getUidAndOrgFromToken(request);
    if (result instanceof NextResponse) return result;
    const { orgId } = result;
    const botConfigId = request.nextUrl.searchParams.get("botConfigId");

    const [personas, situations] = await Promise.all([
      botConfigId
        ? query("SELECT * FROM fwai_aicall_personas WHERE org_id = $1 AND bot_config_id = $2", [orgId, botConfigId])
        : query("SELECT * FROM fwai_aicall_personas WHERE org_id = $1", [orgId]),
      botConfigId
        ? query("SELECT * FROM fwai_aicall_situations WHERE org_id = $1 AND bot_config_id = $2", [orgId, botConfigId])
        : query("SELECT * FROM fwai_aicall_situations WHERE org_id = $1", [orgId]),
    ]);

    return NextResponse.json({
      personas: toCamelRows(personas),
      situations: toCamelRows(situations),
    });
  } catch (error) {
    console.error("[Personas API] GET error:", error);
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
      case "createPersona": {
        const { persona, botConfigId } = body;
        await query(
          `INSERT INTO fwai_aicall_personas (id, org_id, bot_config_id, name, content, keywords, phrases, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
          [
            persona.id, orgId, botConfigId || null,
            persona.name || "",
            persona.content || "",
            JSON.stringify(persona.keywords || []),
            JSON.stringify(persona.phrases || []),
            now,
          ]
        );
        return NextResponse.json({ success: true });
      }
      case "updatePersona": {
        const { personaId, updates } = body;
        const sets: string[] = [];
        const vals: unknown[] = [];
        let idx = 1;
        const fieldMap: Record<string, string> = {
          name: "name", content: "content", keywords: "keywords",
        };
        for (const [k, v] of Object.entries(updates || {})) {
          const col = fieldMap[k];
          if (col) {
            sets.push(`${col} = $${idx++}`);
            vals.push(col === "keywords" ? JSON.stringify(v) : v);
          }
        }
        sets.push(`updated_at = $${idx++}`);
        vals.push(now);
        vals.push(personaId);
        vals.push(orgId);
        await query(
          `UPDATE fwai_aicall_personas SET ${sets.join(", ")} WHERE id = $${idx} AND org_id = $${idx + 1}`,
          vals
        );
        return NextResponse.json({ success: true });
      }
      case "deletePersona": {
        const { personaId } = body;
        await query("DELETE FROM fwai_aicall_personas WHERE id = $1 AND org_id = $2", [personaId, orgId]);
        return NextResponse.json({ success: true });
      }
      case "createSituation": {
        const { situation, botConfigId } = body;
        await query(
          `INSERT INTO fwai_aicall_situations (id, org_id, bot_config_id, name, content, keywords, hint, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
          [
            situation.id, orgId, botConfigId || null,
            situation.name || "",
            situation.content || "",
            JSON.stringify(situation.keywords || []),
            situation.hint || "",
            now,
          ]
        );
        return NextResponse.json({ success: true });
      }
      case "updateSituation": {
        const { situationId, updates } = body;
        const sets: string[] = [];
        const vals: unknown[] = [];
        let idx = 1;
        const fieldMap: Record<string, string> = {
          name: "name", content: "content", keywords: "keywords",
        };
        for (const [k, v] of Object.entries(updates || {})) {
          const col = fieldMap[k];
          if (col) {
            sets.push(`${col} = $${idx++}`);
            vals.push(col === "keywords" ? JSON.stringify(v) : v);
          }
        }
        sets.push(`updated_at = $${idx++}`);
        vals.push(now);
        vals.push(situationId);
        vals.push(orgId);
        await query(
          `UPDATE fwai_aicall_situations SET ${sets.join(", ")} WHERE id = $${idx} AND org_id = $${idx + 1}`,
          vals
        );
        return NextResponse.json({ success: true });
      }
      case "deleteSituation": {
        const { situationId } = body;
        await query("DELETE FROM fwai_aicall_situations WHERE id = $1 AND org_id = $2", [situationId, orgId]);
        return NextResponse.json({ success: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Personas API] POST error:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
