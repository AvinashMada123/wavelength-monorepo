import { NextRequest, NextResponse } from "next/server";
import { getUidAndOrgFromToken, query, toCamelRows } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const result = await getUidAndOrgFromToken(request);
    if (result instanceof NextResponse) return result;
    const { orgId } = result;

    const rows = await query("SELECT * FROM bot_configs WHERE org_id = $1", [orgId]);
    return NextResponse.json({ configs: toCamelRows(rows) });
  } catch (error) {
    console.error("[Bot Configs API] GET error:", error);
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

    switch (action) {
      case "create": {
        const { config } = body;
        await query(
          `INSERT INTO bot_configs (id, org_id, name, is_active, prompt, questions, objections, objection_keywords, context_variables, qualification_criteria, persona_engine_enabled, product_intelligence_enabled, social_proof_enabled, pre_research_enabled, memory_recall_enabled, voice, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)`,
          [
            config.id,
            orgId,
            config.name || "",
            config.isActive ?? false,
            config.prompt || "",
            JSON.stringify(config.questions || []),
            JSON.stringify(config.objections || []),
            JSON.stringify(config.objectionKeywords || {}),
            JSON.stringify(config.contextVariables || {}),
            JSON.stringify(config.qualificationCriteria || {}),
            config.personaEngineEnabled ?? false,
            config.productIntelligenceEnabled ?? false,
            config.socialProofEnabled ?? false,
            config.preResearchEnabled ?? false,
            config.memoryRecallEnabled ?? false,
            config.voice || "",
            config.createdBy || null,
            config.createdAt || new Date().toISOString(),
          ]
        );
        return NextResponse.json({ success: true });
      }

      case "update": {
        const { configId, updates } = body;
        const sets: string[] = [];
        const vals: unknown[] = [];
        let idx = 1;

        const fieldMap: Record<string, string> = {
          name: "name",
          isActive: "is_active",
          prompt: "prompt",
          questions: "questions",
          objections: "objections",
          objectionKeywords: "objection_keywords",
          contextVariables: "context_variables",
          qualificationCriteria: "qualification_criteria",
          personaEngineEnabled: "persona_engine_enabled",
          productIntelligenceEnabled: "product_intelligence_enabled",
          socialProofEnabled: "social_proof_enabled",
          preResearchEnabled: "pre_research_enabled",
          memoryRecallEnabled: "memory_recall_enabled",
          voice: "voice",
        };

        const jsonCols = new Set([
          "questions", "objections", "objection_keywords",
          "context_variables", "qualification_criteria",
        ]);

        for (const [key, value] of Object.entries(updates || {})) {
          const col = fieldMap[key];
          if (col) {
            sets.push(`${col} = $${idx++}`);
            vals.push(jsonCols.has(col) ? JSON.stringify(value) : value);
          }
        }
        sets.push(`updated_at = $${idx++}`);
        vals.push(new Date().toISOString());
        vals.push(configId);
        vals.push(orgId);

        await query(
          `UPDATE bot_configs SET ${sets.join(", ")} WHERE id = $${idx} AND org_id = $${idx + 1}`,
          vals
        );
        return NextResponse.json({ success: true });
      }

      case "delete": {
        const { configId } = body;
        await query("DELETE FROM bot_configs WHERE id = $1 AND org_id = $2", [configId, orgId]);
        return NextResponse.json({ success: true });
      }

      case "setActive": {
        const { configId } = body;
        // Deactivate all, then activate the chosen one
        await query("UPDATE bot_configs SET is_active = false WHERE org_id = $1", [orgId]);
        await query("UPDATE bot_configs SET is_active = true WHERE id = $1 AND org_id = $2", [configId, orgId]);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Bot Configs API] POST error:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
