import { NextRequest, NextResponse } from "next/server";
import { getUidAndOrgFromToken, query, toCamelRows } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const result = await getUidAndOrgFromToken(request);
    if (result instanceof NextResponse) return result;
    const { orgId } = result;

    const [companies, cities, roles] = await Promise.all([
      query("SELECT * FROM ui_social_proof_companies WHERE org_id = $1", [orgId]),
      query("SELECT * FROM ui_social_proof_cities WHERE org_id = $1", [orgId]),
      query("SELECT * FROM ui_social_proof_roles WHERE org_id = $1", [orgId]),
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
        const { company } = body;
        await query(
          `INSERT INTO ui_social_proof_companies (id, org_id, company_name, enrollments_count, notable_outcomes, trending, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET company_name = $3, enrollments_count = $4, notable_outcomes = $5, trending = $6, updated_at = $7`,
          [company.id, orgId, company.companyName, company.enrollmentsCount || 0, company.notableOutcomes || "", company.trending ?? false, now]
        );
        return NextResponse.json({ success: true });
      }
      case "deleteCompany": {
        const { companyId } = body;
        await query("DELETE FROM ui_social_proof_companies WHERE id = $1 AND org_id = $2", [companyId, orgId]);
        return NextResponse.json({ success: true });
      }

      case "upsertCity": {
        const { city } = body;
        await query(
          `INSERT INTO ui_social_proof_cities (id, org_id, city_name, enrollments_count, trending, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET city_name = $3, enrollments_count = $4, trending = $5, updated_at = $6`,
          [city.id, orgId, city.cityName, city.enrollmentsCount || 0, city.trending ?? false, now]
        );
        return NextResponse.json({ success: true });
      }
      case "deleteCity": {
        const { cityId } = body;
        await query("DELETE FROM ui_social_proof_cities WHERE id = $1 AND org_id = $2", [cityId, orgId]);
        return NextResponse.json({ success: true });
      }

      case "upsertRole": {
        const { role } = body;
        await query(
          `INSERT INTO ui_social_proof_roles (id, org_id, role_name, enrollments_count, success_stories, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET role_name = $3, enrollments_count = $4, success_stories = $5, updated_at = $6`,
          [role.id, orgId, role.roleName, role.enrollmentsCount || 0, role.successStories || "", now]
        );
        return NextResponse.json({ success: true });
      }
      case "deleteRole": {
        const { roleId } = body;
        await query("DELETE FROM ui_social_proof_roles WHERE id = $1 AND org_id = $2", [roleId, orgId]);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[Social Proof API] POST error:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
