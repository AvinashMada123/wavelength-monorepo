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
    const botConfigId = request.nextUrl.searchParams.get("botConfigId");

    const baseFilter = botConfigId
      ? { sql: "org_id = $1 AND bot_config_id = $2", params: [orgId, botConfigId] }
      : { sql: "org_id = $1", params: [orgId] };

    const [companies, cities, roles] = await Promise.all([
      query(`SELECT * FROM ui_social_proof_companies WHERE ${baseFilter.sql}`, baseFilter.params),
      query(`SELECT * FROM ui_social_proof_cities WHERE ${baseFilter.sql}`, baseFilter.params),
      query(`SELECT * FROM ui_social_proof_roles WHERE ${baseFilter.sql}`, baseFilter.params),
    ]);

    return NextResponse.json({
      companies: toCamelRows(companies),
      cities: toCamelRows(cities),
      roles: toCamelRows(roles),
    });
  } catch (error) {
    console.error("[Social Proof API] GET error:", error);
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
      case "upsertCompany": {
        const { company, botConfigId } = body;
        await query(
          `INSERT INTO ui_social_proof_companies (id, org_id, bot_config_id, company_name, enrollments_count, notable_outcomes, trending, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET company_name = $4, enrollments_count = $5, notable_outcomes = $6, trending = $7, updated_at = $8`,
          [company.id, orgId, botConfigId || null, company.companyName, company.enrollmentsCount || 0, company.notableOutcomes || "", company.trending ?? false, now]
        );
        return NextResponse.json({ success: true });
      }
      case "deleteCompany": {
        const { companyId } = body;
        await query("DELETE FROM ui_social_proof_companies WHERE id = $1 AND org_id = $2", [companyId, orgId]);
        return NextResponse.json({ success: true });
      }

      case "upsertCity": {
        const { city, botConfigId } = body;
        await query(
          `INSERT INTO ui_social_proof_cities (id, org_id, bot_config_id, city_name, enrollments_count, trending, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET city_name = $4, enrollments_count = $5, trending = $6, updated_at = $7`,
          [city.id, orgId, botConfigId || null, city.cityName, city.enrollmentsCount || 0, city.trending ?? false, now]
        );
        return NextResponse.json({ success: true });
      }
      case "deleteCity": {
        const { cityId } = body;
        await query("DELETE FROM ui_social_proof_cities WHERE id = $1 AND org_id = $2", [cityId, orgId]);
        return NextResponse.json({ success: true });
      }

      case "upsertRole": {
        const { role, botConfigId } = body;
        await query(
          `INSERT INTO ui_social_proof_roles (id, org_id, bot_config_id, role_name, enrollments_count, success_stories, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET role_name = $4, enrollments_count = $5, success_stories = $6, updated_at = $7`,
          [role.id, orgId, botConfigId || null, role.roleName, role.enrollmentsCount || 0, role.successStories || "", now]
        );
        return NextResponse.json({ success: true });
      }
      case "deleteRole": {
        const { roleId } = body;
        await query("DELETE FROM ui_social_proof_roles WHERE id = $1 AND org_id = $2", [roleId, orgId]);
        return NextResponse.json({ success: true });
      }

      case "bulkImport": {
        const { data, botConfigId } = body;
        const backendRes = await fetch(`${BACKEND_BASE_URL}/social-proof/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!backendRes.ok) {
          const errText = await backendRes.text();
          console.error("[Social Proof API] Backend bulk import error:", backendRes.status, errText);
          return NextResponse.json({ error: "Backend bulk import failed" }, { status: 502 });
        }

        // Also upsert into frontend DB for consistency
        for (const c of data.companies || []) {
          const id = `comp_${crypto.randomUUID().slice(0, 8)}`;
          await query(
            `INSERT INTO ui_social_proof_companies (id, org_id, bot_config_id, company_name, enrollments_count, notable_outcomes, trending, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, false, $7)
             ON CONFLICT (id) DO UPDATE SET company_name = $4, enrollments_count = $5, notable_outcomes = $6, updated_at = $7`,
            [id, orgId, botConfigId || null, c.company_name, c.enrollments_count || 0, c.notable_outcomes || "", now]
          );
        }
        for (const c of data.cities || []) {
          const id = `city_${crypto.randomUUID().slice(0, 8)}`;
          await query(
            `INSERT INTO ui_social_proof_cities (id, org_id, bot_config_id, city_name, enrollments_count, trending, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET city_name = $4, enrollments_count = $5, trending = $6, updated_at = $7`,
            [id, orgId, botConfigId || null, c.city_name, c.enrollments_count || 0, c.trending ? true : false, now]
          );
        }
        for (const r of data.roles || []) {
          const id = `role_${crypto.randomUUID().slice(0, 8)}`;
          await query(
            `INSERT INTO ui_social_proof_roles (id, org_id, bot_config_id, role_name, enrollments_count, success_stories, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET role_name = $4, enrollments_count = $5, success_stories = $6, updated_at = $7`,
            [id, orgId, botConfigId || null, r.role_name, r.enrollments_count || 0, r.success_stories || "", now]
          );
        }

        return NextResponse.json({ success: true, message: "Bulk import completed" });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Social Proof API] POST error:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
