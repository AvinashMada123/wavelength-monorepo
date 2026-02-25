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
          maxCallDuration: "max_call_duration",
          ghlWorkflows: "ghl_workflows",
          voice: "voice",
        };

        const jsonCols = new Set([
          "questions", "objections", "objection_keywords",
          "context_variables", "qualification_criteria", "ghl_workflows",
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
        await query("UPDATE bot_configs SET is_active = true WHERE id = $1 AND org_id = $2", [configId, orgId]);
        return NextResponse.json({ success: true });
      }

      case "toggleActive": {
        const { configId } = body;
        // Check current state
        const current = await query("SELECT is_active FROM bot_configs WHERE id = $1 AND org_id = $2", [configId, orgId]);
        if (current.length === 0) {
          return NextResponse.json({ error: "Config not found" }, { status: 404 });
        }
        const isCurrentlyActive = current[0].is_active;
        // Simply toggle this config — multiple configs can be active simultaneously
        await query(
          "UPDATE bot_configs SET is_active = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3",
          [!isCurrentlyActive, configId, orgId]
        );
        return NextResponse.json({ success: true });
      }

      case "export": {
        // Export a bot config with all related data (personas, situations, products, social proof)
        const { configId } = body;
        const [configRows, personas, situations, productSections, companies, cities, roles] = await Promise.all([
          query("SELECT * FROM bot_configs WHERE id = $1 AND org_id = $2", [configId, orgId]),
          query("SELECT name, content, keywords FROM personas WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT name, content, keywords FROM situations WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT name, content, keywords FROM product_sections WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT company_name, enrollments_count FROM ui_social_proof_companies WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT city_name, enrollments_count FROM ui_social_proof_cities WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT role_name, enrollments_count FROM ui_social_proof_roles WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
        ]);
        if (configRows.length === 0) {
          return NextResponse.json({ error: "Config not found" }, { status: 404 });
        }
        const cfg = configRows[0];
        return NextResponse.json({
          _format: "wavelength-bot-config-v1",
          name: cfg.name,
          prompt: cfg.prompt,
          questions: cfg.questions,
          objections: cfg.objections,
          objectionKeywords: cfg.objection_keywords,
          contextVariables: cfg.context_variables,
          qualificationCriteria: cfg.qualification_criteria,
          personaEngineEnabled: cfg.persona_engine_enabled,
          productIntelligenceEnabled: cfg.product_intelligence_enabled,
          socialProofEnabled: cfg.social_proof_enabled,
          preResearchEnabled: cfg.pre_research_enabled,
          memoryRecallEnabled: cfg.memory_recall_enabled,
          maxCallDuration: cfg.max_call_duration,
          ghlWorkflows: cfg.ghl_workflows,
          voice: cfg.voice,
          personas: personas.map((p: Record<string, unknown>) => ({ name: p.name, content: p.content, keywords: p.keywords })),
          situations: situations.map((s: Record<string, unknown>) => ({ name: s.name, content: s.content, keywords: s.keywords })),
          productSections: productSections.map((s: Record<string, unknown>) => ({ name: s.name, content: s.content, keywords: s.keywords })),
          socialProof: {
            companies: companies.map((c: Record<string, unknown>) => ({ name: c.company_name, count: c.enrollments_count })),
            cities: cities.map((c: Record<string, unknown>) => ({ name: c.city_name, count: c.enrollments_count })),
            roles: roles.map((r: Record<string, unknown>) => ({ name: r.role_name, count: r.enrollments_count })),
          },
        });
      }

      case "import": {
        // Import a bot config with all related data
        const { config: importConfig, configId: newConfigId } = body;
        const now = new Date().toISOString();

        // Create the bot config
        await query(
          `INSERT INTO bot_configs (id, org_id, name, is_active, prompt, questions, objections, objection_keywords, context_variables, qualification_criteria, persona_engine_enabled, product_intelligence_enabled, social_proof_enabled, pre_research_enabled, memory_recall_enabled, max_call_duration, ghl_workflows, voice, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $20)`,
          [
            newConfigId,
            orgId,
            importConfig.name || "Imported Config",
            false,
            importConfig.prompt || "",
            JSON.stringify(importConfig.questions || []),
            JSON.stringify(importConfig.objections || []),
            JSON.stringify(importConfig.objectionKeywords || {}),
            JSON.stringify(importConfig.contextVariables || {}),
            JSON.stringify(importConfig.qualificationCriteria || {}),
            importConfig.personaEngineEnabled ?? false,
            importConfig.productIntelligenceEnabled ?? false,
            importConfig.socialProofEnabled ?? false,
            importConfig.preResearchEnabled ?? false,
            importConfig.memoryRecallEnabled ?? false,
            importConfig.maxCallDuration ?? 480,
            JSON.stringify(importConfig.ghlWorkflows || []),
            importConfig.voice || "",
            importConfig.createdBy || null,
            now,
          ]
        );

        // Import personas
        for (const p of importConfig.personas || []) {
          await query(
            "INSERT INTO personas (id, org_id, bot_config_id, name, content, keywords, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
            [`imp_p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newConfigId, p.name, p.content, JSON.stringify(p.keywords || []), now]
          );
        }

        // Import situations
        for (const s of importConfig.situations || []) {
          await query(
            "INSERT INTO situations (id, org_id, bot_config_id, name, content, keywords, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
            [`imp_s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newConfigId, s.name, s.content, JSON.stringify(s.keywords || []), now]
          );
        }

        // Import product sections
        for (const ps of importConfig.productSections || []) {
          await query(
            "INSERT INTO product_sections (id, org_id, bot_config_id, name, content, keywords, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
            [`imp_ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newConfigId, ps.name, ps.content, JSON.stringify(ps.keywords || []), now]
          );
        }

        // Import social proof
        const sp = importConfig.socialProof || {};
        for (const c of sp.companies || []) {
          await query(
            "INSERT INTO ui_social_proof_companies (id, org_id, bot_config_id, company_name, enrollments_count) VALUES ($1, $2, $3, $4, $5)",
            [`imp_c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newConfigId, c.name, c.count ?? 0]
          );
        }
        for (const c of sp.cities || []) {
          await query(
            "INSERT INTO ui_social_proof_cities (id, org_id, bot_config_id, city_name, enrollments_count) VALUES ($1, $2, $3, $4, $5)",
            [`imp_ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newConfigId, c.name, c.count ?? 0]
          );
        }
        for (const r of sp.roles || []) {
          await query(
            "INSERT INTO ui_social_proof_roles (id, org_id, bot_config_id, role_name, enrollments_count) VALUES ($1, $2, $3, $4, $5)",
            [`imp_r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newConfigId, r.name, r.count ?? 0]
          );
        }

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
