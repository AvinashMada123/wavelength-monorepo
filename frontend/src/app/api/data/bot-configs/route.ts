import { NextRequest, NextResponse } from "next/server";
import { getUidAndOrgFromToken, query, toCamelRows } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const result = await getUidAndOrgFromToken(request);
    if (result instanceof NextResponse) return result;
    const { orgId } = result;

    const rows = await query("SELECT * FROM fwai_aicall_bot_configs WHERE org_id = $1", [orgId]);
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
          `INSERT INTO fwai_aicall_bot_configs (id, org_id, name, is_active, prompt, questions, objections, objection_keywords, context_variables, qualification_criteria, persona_engine_enabled, product_intelligence_enabled, social_proof_enabled, social_proof_min_turn, pre_research_enabled, memory_recall_enabled, voice, pipeline_mode, language, languages, tts_provider, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $23)`,
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
            config.socialProofMinTurn ?? 0,
            config.preResearchEnabled ?? false,
            config.memoryRecallEnabled ?? false,
            config.voice || "",
            config.pipelineMode || "live_api",
            config.language || config.languages?.[0] || "",
            JSON.stringify(config.languages || []),
            config.ttsProvider || "",
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
          socialProofMinTurn: "social_proof_min_turn",
          preResearchEnabled: "pre_research_enabled",
          memoryRecallEnabled: "memory_recall_enabled",
          maxCallDuration: "max_call_duration",
          ghlWorkflows: "ghl_workflows",
          voice: "voice",
          callProvider: "call_provider",
          pipelineMode: "pipeline_mode",
          language: "language",
          languages: "languages",
          ttsProvider: "tts_provider",
          conversationFlowMermaid: "conversation_flow_mermaid",
          microMomentsConfig: "micro_moments_config",
          retryConfig: "retry_config",
          responseGuidelines: "response_guidelines",
          ttsFormattingRules: "tts_formatting_rules",
          inactivityTimeoutSeconds: "inactivity_timeout_seconds",
        };

        const jsonCols = new Set([
          "questions", "objections", "objection_keywords",
          "context_variables", "qualification_criteria", "ghl_workflows",
          "micro_moments_config", "retry_config", "languages",
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
          `UPDATE fwai_aicall_bot_configs SET ${sets.join(", ")} WHERE id = $${idx} AND org_id = $${idx + 1}`,
          vals
        );
        return NextResponse.json({ success: true });
      }

      case "delete": {
        const { configId } = body;
        await query("DELETE FROM fwai_aicall_bot_configs WHERE id = $1 AND org_id = $2", [configId, orgId]);
        return NextResponse.json({ success: true });
      }

      case "setActive": {
        const { configId } = body;
        await query("UPDATE fwai_aicall_bot_configs SET is_active = true WHERE id = $1 AND org_id = $2", [configId, orgId]);
        return NextResponse.json({ success: true });
      }

      case "toggleActive": {
        const { configId } = body;
        // Check current state
        const current = await query("SELECT is_active FROM fwai_aicall_bot_configs WHERE id = $1 AND org_id = $2", [configId, orgId]);
        if (current.length === 0) {
          return NextResponse.json({ error: "Config not found" }, { status: 404 });
        }
        const isCurrentlyActive = current[0].is_active;
        // Simply toggle this config — multiple configs can be active simultaneously
        await query(
          "UPDATE fwai_aicall_bot_configs SET is_active = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3",
          [!isCurrentlyActive, configId, orgId]
        );
        return NextResponse.json({ success: true });
      }

      case "export": {
        // Export a bot config with all related data (personas, situations, products, social proof)
        const { configId } = body;
        const [configRows, personas, situations, productSections, companies, cities, roles] = await Promise.all([
          query("SELECT * FROM fwai_aicall_bot_configs WHERE id = $1 AND org_id = $2", [configId, orgId]),
          query("SELECT name, content, keywords FROM fwai_aicall_personas WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT name, content, keywords FROM fwai_aicall_situations WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT name, content, keywords FROM fwai_aicall_product_sections WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT company_name, enrollments_count FROM fwai_aicall_social_proof_companies WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT city_name, enrollments_count FROM fwai_aicall_social_proof_cities WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT role_name, enrollments_count FROM fwai_aicall_social_proof_roles WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
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
          socialProofMinTurn: cfg.social_proof_min_turn,
          preResearchEnabled: cfg.pre_research_enabled,
          memoryRecallEnabled: cfg.memory_recall_enabled,
          maxCallDuration: cfg.max_call_duration,
          ghlWorkflows: cfg.ghl_workflows,
          voice: cfg.voice,
          pipelineMode: cfg.pipeline_mode,
          language: cfg.language,
          languages: cfg.languages || [],
          ttsProvider: cfg.tts_provider,
          responseGuidelines: cfg.response_guidelines,
          ttsFormattingRules: cfg.tts_formatting_rules,
          inactivityTimeoutSeconds: cfg.inactivity_timeout_seconds,
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
          `INSERT INTO fwai_aicall_bot_configs (id, org_id, name, is_active, prompt, questions, objections, objection_keywords, context_variables, qualification_criteria, persona_engine_enabled, product_intelligence_enabled, social_proof_enabled, social_proof_min_turn, pre_research_enabled, memory_recall_enabled, max_call_duration, ghl_workflows, voice, pipeline_mode, language, languages, tts_provider, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $25)`,
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
            importConfig.socialProofMinTurn ?? 0,
            importConfig.preResearchEnabled ?? false,
            importConfig.memoryRecallEnabled ?? false,
            importConfig.maxCallDuration ?? 480,
            JSON.stringify(importConfig.ghlWorkflows || []),
            importConfig.voice || "",
            importConfig.pipelineMode || "live_api",
            importConfig.language || importConfig.languages?.[0] || "",
            JSON.stringify(importConfig.languages || []),
            importConfig.ttsProvider || "",
            importConfig.createdBy || null,
            now,
          ]
        );

        // Import personas
        for (const p of importConfig.personas || []) {
          await query(
            "INSERT INTO fwai_aicall_personas (id, org_id, bot_config_id, name, content, keywords, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
            [`imp_p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newConfigId, p.name, p.content, JSON.stringify(p.keywords || []), now]
          );
        }

        // Import situations
        for (const s of importConfig.situations || []) {
          await query(
            "INSERT INTO fwai_aicall_situations (id, org_id, bot_config_id, name, content, keywords, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
            [`imp_s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newConfigId, s.name, s.content, JSON.stringify(s.keywords || []), now]
          );
        }

        // Import product sections
        for (const ps of importConfig.productSections || []) {
          await query(
            "INSERT INTO fwai_aicall_product_sections (id, org_id, bot_config_id, name, content, keywords, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
            [`imp_ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newConfigId, ps.name, ps.content, JSON.stringify(ps.keywords || []), now]
          );
        }

        // Import social proof
        const sp = importConfig.socialProof || {};
        for (const c of sp.companies || []) {
          await query(
            "INSERT INTO fwai_aicall_social_proof_companies (id, org_id, bot_config_id, company_name, enrollments_count) VALUES ($1, $2, $3, $4, $5)",
            [`imp_c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newConfigId, c.name, c.count ?? 0]
          );
        }
        for (const c of sp.cities || []) {
          await query(
            "INSERT INTO fwai_aicall_social_proof_cities (id, org_id, bot_config_id, city_name, enrollments_count) VALUES ($1, $2, $3, $4, $5)",
            [`imp_ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newConfigId, c.name, c.count ?? 0]
          );
        }
        for (const r of sp.roles || []) {
          await query(
            "INSERT INTO fwai_aicall_social_proof_roles (id, org_id, bot_config_id, role_name, enrollments_count) VALUES ($1, $2, $3, $4, $5)",
            [`imp_r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newConfigId, r.name, r.count ?? 0]
          );
        }

        return NextResponse.json({ success: true });
      }

      case "duplicate": {
        const { configId } = body;
        const newId = `dup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();

        // Fetch original config and all related data
        const [configRows, personas, situations, productSections, companies, cities, roles] = await Promise.all([
          query("SELECT * FROM fwai_aicall_bot_configs WHERE id = $1 AND org_id = $2", [configId, orgId]),
          query("SELECT name, content, keywords FROM fwai_aicall_personas WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT name, content, keywords FROM fwai_aicall_situations WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT name, content, keywords FROM fwai_aicall_product_sections WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT company_name, enrollments_count FROM fwai_aicall_social_proof_companies WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT city_name, enrollments_count FROM fwai_aicall_social_proof_cities WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
          query("SELECT role_name, enrollments_count FROM fwai_aicall_social_proof_roles WHERE org_id = $1 AND bot_config_id = $2", [orgId, configId]),
        ]);
        if (configRows.length === 0) {
          return NextResponse.json({ error: "Config not found" }, { status: 404 });
        }
        const src = configRows[0];

        // Create duplicate config (inactive, with "(Copy)" suffix)
        await query(
          `INSERT INTO fwai_aicall_bot_configs (id, org_id, name, is_active, prompt, questions, objections, objection_keywords, context_variables, qualification_criteria, persona_engine_enabled, product_intelligence_enabled, social_proof_enabled, social_proof_min_turn, pre_research_enabled, memory_recall_enabled, max_call_duration, ghl_workflows, voice, call_provider, pipeline_mode, language, languages, tts_provider, micro_moments_config, retry_config, response_guidelines, tts_formatting_rules, inactivity_timeout_seconds, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $31)`,
          [
            newId, orgId, (src.name || "") + " (Copy)", false,
            src.prompt || "", JSON.stringify(src.questions || []),
            JSON.stringify(src.objections || []), JSON.stringify(src.objection_keywords || {}),
            JSON.stringify(src.context_variables || {}), JSON.stringify(src.qualification_criteria || {}),
            src.persona_engine_enabled ?? false, src.product_intelligence_enabled ?? false,
            src.social_proof_enabled ?? false, src.social_proof_min_turn ?? 0,
            src.pre_research_enabled ?? false, src.memory_recall_enabled ?? false,
            src.max_call_duration ?? 480, JSON.stringify(src.ghl_workflows || []),
            src.voice || "", src.call_provider || "plivo",
            src.pipeline_mode || "live_api", src.language || "",
            JSON.stringify(src.languages || []), src.tts_provider || "",
            JSON.stringify(src.micro_moments_config || null),
            JSON.stringify(src.retry_config || null),
            src.response_guidelines || "", src.tts_formatting_rules || "",
            src.inactivity_timeout_seconds ?? null,
            src.created_by || null, now,
          ]
        );

        // Duplicate related data
        for (const p of personas) {
          await query(
            "INSERT INTO fwai_aicall_personas (id, org_id, bot_config_id, name, content, keywords, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
            [`dup_p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newId, p.name, p.content, JSON.stringify(p.keywords || []), now]
          );
        }
        for (const s of situations) {
          await query(
            "INSERT INTO fwai_aicall_situations (id, org_id, bot_config_id, name, content, keywords, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
            [`dup_s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newId, s.name, s.content, JSON.stringify(s.keywords || []), now]
          );
        }
        for (const ps of productSections) {
          await query(
            "INSERT INTO fwai_aicall_product_sections (id, org_id, bot_config_id, name, content, keywords, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
            [`dup_ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newId, ps.name, ps.content, JSON.stringify(ps.keywords || []), now]
          );
        }
        for (const c of companies) {
          await query(
            "INSERT INTO fwai_aicall_social_proof_companies (id, org_id, bot_config_id, company_name, enrollments_count) VALUES ($1, $2, $3, $4, $5)",
            [`dup_c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newId, c.company_name, c.enrollments_count ?? 0]
          );
        }
        for (const c of cities) {
          await query(
            "INSERT INTO fwai_aicall_social_proof_cities (id, org_id, bot_config_id, city_name, enrollments_count) VALUES ($1, $2, $3, $4, $5)",
            [`dup_ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newId, c.city_name, c.enrollments_count ?? 0]
          );
        }
        for (const r of roles) {
          await query(
            "INSERT INTO fwai_aicall_social_proof_roles (id, org_id, bot_config_id, role_name, enrollments_count) VALUES ($1, $2, $3, $4, $5)",
            [`dup_r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, orgId, newId, r.role_name, r.enrollments_count ?? 0]
          );
        }

        return NextResponse.json({ success: true, newConfigId: newId });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Bot Configs API] POST error:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
