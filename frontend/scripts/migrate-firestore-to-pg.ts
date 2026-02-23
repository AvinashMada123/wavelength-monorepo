/**
 * Migrate all data from Firestore to PostgreSQL.
 *
 * Firestore structure (from old code):
 *   - users/{uid}                                → users table
 *   - organizations/{orgId}                      → organizations table
 *   - organizations/{orgId}/botConfigs/{id}      → bot_configs table
 *   - organizations/{orgId}/leads/{id}           → leads table
 *   - organizations/{orgId}/calls/{id}           → ui_calls table
 *   - organizations/{orgId}/personas/{id}        → personas table
 *   - organizations/{orgId}/situations/{id}      → situations table
 *   - organizations/{orgId}/productSections/{id} → product_sections table
 *   - organizations/{orgId}/socialProofCompanies/{id} → ui_social_proof_companies
 *   - organizations/{orgId}/socialProofCities/{id}    → ui_social_proof_cities
 *   - organizations/{orgId}/socialProofRoles/{id}     → ui_social_proof_roles
 *   - organizations/{orgId}/usage/{period}       → usage table
 *
 * Usage:
 *   npx tsx scripts/migrate-firestore-to-pg.ts
 *
 * Requires:
 *   FIREBASE_SERVICE_ACCOUNT_KEY env var (JSON string)
 *   DATABASE_URL env var (or uses default)
 */

import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { Pool } from "pg";

// ---------- Config ----------

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://devuser:dev%402026@140.245.206.162:5432/devdb";

const saKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!saKey) {
  console.error("ERROR: FIREBASE_SERVICE_ACCOUNT_KEY env var not set.");
  console.error("Export it or add to .env.local, then run:");
  console.error("  source .env.local && npx tsx scripts/migrate-firestore-to-pg.ts");
  process.exit(1);
}

const serviceAccount = JSON.parse(saKey) as ServiceAccount;
const app = initializeApp({ credential: cert(serviceAccount) });
const firestore = getFirestore(app);
const auth = getAuth(app);
const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

// ---------- Helpers ----------

function toIso(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "string") return val;
  if (val && typeof val === "object" && "toDate" in val) {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

async function upsert(sql: string, params: unknown[]) {
  try {
    await pool.query(sql, params);
  } catch (err) {
    console.error("  SQL error:", (err as Error).message);
    console.error("  SQL:", sql.slice(0, 120));
  }
}

// ---------- Migrate Users from Firebase Auth ----------

async function migrateUsers() {
  console.log("\n=== Migrating Firebase Auth users ===");

  // First get user docs from Firestore (they have orgId, role, etc.)
  const usersSnap = await firestore.collection("users").get();
  console.log(`  Found ${usersSnap.size} user docs in Firestore`);

  let count = 0;
  for (const doc of usersSnap.docs) {
    const d = doc.data();
    const uid = doc.id;

    // Try to get email from Firebase Auth if not in doc
    let email = d.email || "";
    if (!email) {
      try {
        const authUser = await auth.getUser(uid);
        email = authUser.email || "";
      } catch {
        // user may have been deleted from Auth
      }
    }

    await upsert(
      `INSERT INTO users (uid, email, display_name, role, org_id, status, created_at, last_login_at, invited_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (uid) DO UPDATE SET
         email = EXCLUDED.email, display_name = EXCLUDED.display_name,
         role = EXCLUDED.role, org_id = EXCLUDED.org_id,
         status = EXCLUDED.status, invited_by = EXCLUDED.invited_by`,
      [
        uid,
        email,
        d.displayName || d.display_name || "",
        d.role || "client_admin",
        d.orgId || d.org_id || "",
        d.status || "active",
        toIso(d.createdAt || d.created_at) || new Date().toISOString(),
        toIso(d.lastLoginAt || d.last_login_at),
        d.invitedBy || d.invited_by || null,
      ]
    );
    count++;
  }

  // If no user docs in Firestore, try listing from Firebase Auth
  if (usersSnap.size === 0) {
    console.log("  No user docs in Firestore — listing from Firebase Auth...");
    const listResult = await auth.listUsers(100);
    console.log(`  Found ${listResult.users.length} users in Firebase Auth`);
    for (const user of listResult.users) {
      await upsert(
        `INSERT INTO users (uid, email, display_name, role, org_id, status, created_at, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (uid) DO NOTHING`,
        [
          user.uid,
          user.email || "",
          user.displayName || "",
          "client_admin",
          "", // no orgId — will need to be linked after org creation
          "active",
          user.metadata.creationTime || new Date().toISOString(),
          user.metadata.lastSignInTime || null,
        ]
      );
      count++;
    }
  }

  console.log(`  Migrated ${count} users`);
}

// ---------- Migrate Organizations ----------

async function migrateOrganizations() {
  console.log("\n=== Migrating Organizations ===");
  const snap = await firestore.collection("organizations").get();
  console.log(`  Found ${snap.size} organizations in Firestore`);

  let count = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const orgId = doc.id;

    await upsert(
      `INSERT INTO organizations (id, name, slug, plan, status, webhook_url, settings, usage, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, slug = EXCLUDED.slug, plan = EXCLUDED.plan,
         settings = EXCLUDED.settings, usage = EXCLUDED.usage,
         updated_at = EXCLUDED.updated_at`,
      [
        orgId,
        d.name || "",
        d.slug || "",
        d.plan || "free",
        d.status || "active",
        d.webhookUrl || d.webhook_url || "",
        JSON.stringify(d.settings || {}),
        JSON.stringify(d.usage || {}),
        d.createdBy || d.created_by || null,
        toIso(d.createdAt || d.created_at) || new Date().toISOString(),
        toIso(d.updatedAt || d.updated_at) || new Date().toISOString(),
      ]
    );
    count++;

    // ---- Sub-collections ----
    await migrateBotConfigs(orgId);
    await migrateLeads(orgId);
    await migrateCalls(orgId);
    await migratePersonas(orgId);
    await migrateSituations(orgId);
    await migrateProductSections(orgId);
    await migrateSocialProof(orgId);
    await migrateUsage(orgId);
  }

  console.log(`  Migrated ${count} organizations`);
}

// ---------- Sub-collection migrations ----------

async function migrateBotConfigs(orgId: string) {
  const snap = await firestore.collection("organizations").doc(orgId).collection("botConfigs").get();
  if (snap.empty) return;
  console.log(`    botConfigs: ${snap.size}`);

  for (const doc of snap.docs) {
    const d = doc.data();
    await upsert(
      `INSERT INTO bot_configs (id, org_id, name, is_active, prompt, questions, objections, objection_keywords, context_variables, qualification_criteria, persona_engine_enabled, product_intelligence_enabled, social_proof_enabled, pre_research_enabled, memory_recall_enabled, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, is_active=EXCLUDED.is_active, prompt=EXCLUDED.prompt,
         questions=EXCLUDED.questions, objections=EXCLUDED.objections,
         updated_at=EXCLUDED.updated_at`,
      [
        doc.id, orgId,
        d.name || "",
        d.isActive ?? false,
        d.prompt || "",
        JSON.stringify(d.questions || []),
        JSON.stringify(d.objections || []),
        JSON.stringify(d.objectionKeywords || {}),
        JSON.stringify(d.contextVariables || {}),
        JSON.stringify(d.qualificationCriteria || {}),
        d.personaEngineEnabled ?? false,
        d.productIntelligenceEnabled ?? false,
        d.socialProofEnabled ?? false,
        d.preResearchEnabled ?? false,
        d.memoryRecallEnabled ?? false,
        d.createdBy || null,
        toIso(d.createdAt) || new Date().toISOString(),
        toIso(d.updatedAt) || new Date().toISOString(),
      ]
    );
  }
}

async function migrateLeads(orgId: string) {
  const snap = await firestore.collection("organizations").doc(orgId).collection("leads").get();
  if (snap.empty) return;
  console.log(`    leads: ${snap.size}`);

  for (const doc of snap.docs) {
    const d = doc.data();
    await upsert(
      `INSERT INTO leads (id, org_id, phone_number, contact_name, email, company, location, tags, status, call_count, last_call_date, source, ghl_contact_id, qualification_level, qualification_confidence, last_qualified_at, bot_notes, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (id) DO UPDATE SET
         phone_number=EXCLUDED.phone_number, contact_name=EXCLUDED.contact_name,
         email=EXCLUDED.email, company=EXCLUDED.company, status=EXCLUDED.status,
         call_count=EXCLUDED.call_count, updated_at=EXCLUDED.updated_at`,
      [
        doc.id, orgId,
        d.phoneNumber || "",
        d.contactName || "",
        d.email || null,
        d.company || null,
        d.location || null,
        JSON.stringify(d.tags || []),
        d.status || "new",
        d.callCount || 0,
        d.lastCallDate || null,
        d.source || "manual",
        d.ghlContactId || null,
        d.qualificationLevel || null,
        d.qualificationConfidence ?? null,
        d.lastQualifiedAt || null,
        d.botNotes || "",
        d.createdBy || null,
        toIso(d.createdAt) || new Date().toISOString(),
        toIso(d.updatedAt) || new Date().toISOString(),
      ]
    );
  }
}

async function migrateCalls(orgId: string) {
  const snap = await firestore.collection("organizations").doc(orgId).collection("calls").get();
  if (snap.empty) return;
  console.log(`    calls: ${snap.size}`);

  for (const doc of snap.docs) {
    const d = doc.data();
    await upsert(
      `INSERT INTO ui_calls (id, org_id, call_uuid, lead_id, request, response, status, initiated_at, initiated_by, ended_data, duration_seconds, interest_level, completion_rate, call_summary, qualification, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET
         status=EXCLUDED.status, ended_data=EXCLUDED.ended_data,
         duration_seconds=EXCLUDED.duration_seconds, call_summary=EXCLUDED.call_summary,
         completed_at=EXCLUDED.completed_at`,
      [
        doc.id, orgId,
        d.callUuid || null,
        d.leadId || null,
        JSON.stringify(d.request || {}),
        d.response ? JSON.stringify(d.response) : null,
        d.status || "initiating",
        toIso(d.initiatedAt) || new Date().toISOString(),
        d.initiatedBy || null,
        d.endedData ? JSON.stringify(d.endedData) : null,
        d.durationSeconds ?? null,
        d.interestLevel || null,
        d.completionRate ?? null,
        d.callSummary || null,
        d.qualification ? JSON.stringify(d.qualification) : null,
        toIso(d.completedAt) || null,
      ]
    );
  }
}

async function migratePersonas(orgId: string) {
  const snap = await firestore.collection("organizations").doc(orgId).collection("personas").get();
  if (snap.empty) return;
  console.log(`    personas: ${snap.size}`);

  for (const doc of snap.docs) {
    const d = doc.data();
    await upsert(
      `INSERT INTO personas (id, org_id, name, content, keywords, phrases, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, content=EXCLUDED.content, keywords=EXCLUDED.keywords,
         phrases=EXCLUDED.phrases, updated_at=EXCLUDED.updated_at`,
      [
        doc.id, orgId,
        d.name || "",
        d.content || "",
        JSON.stringify(d.keywords || []),
        JSON.stringify(d.phrases || []),
        toIso(d.createdAt) || new Date().toISOString(),
        toIso(d.updatedAt) || new Date().toISOString(),
      ]
    );
  }
}

async function migrateSituations(orgId: string) {
  const snap = await firestore.collection("organizations").doc(orgId).collection("situations").get();
  if (snap.empty) return;
  console.log(`    situations: ${snap.size}`);

  for (const doc of snap.docs) {
    const d = doc.data();
    await upsert(
      `INSERT INTO situations (id, org_id, name, content, keywords, hint, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, content=EXCLUDED.content, keywords=EXCLUDED.keywords,
         hint=EXCLUDED.hint, updated_at=EXCLUDED.updated_at`,
      [
        doc.id, orgId,
        d.name || "",
        d.content || "",
        JSON.stringify(d.keywords || []),
        d.hint || "",
        toIso(d.createdAt) || new Date().toISOString(),
        toIso(d.updatedAt) || new Date().toISOString(),
      ]
    );
  }
}

async function migrateProductSections(orgId: string) {
  const snap = await firestore.collection("organizations").doc(orgId).collection("productSections").get();
  if (snap.empty) return;
  console.log(`    productSections: ${snap.size}`);

  for (const doc of snap.docs) {
    const d = doc.data();
    await upsert(
      `INSERT INTO product_sections (id, org_id, name, content, keywords, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, content=EXCLUDED.content, keywords=EXCLUDED.keywords,
         updated_at=EXCLUDED.updated_at`,
      [
        doc.id, orgId,
        d.name || "",
        d.content || "",
        JSON.stringify(d.keywords || []),
        toIso(d.createdAt) || new Date().toISOString(),
        toIso(d.updatedAt) || new Date().toISOString(),
      ]
    );
  }
}

async function migrateSocialProof(orgId: string) {
  // Companies
  const companiesSnap = await firestore.collection("organizations").doc(orgId).collection("socialProofCompanies").get();
  if (!companiesSnap.empty) {
    console.log(`    socialProofCompanies: ${companiesSnap.size}`);
    for (const doc of companiesSnap.docs) {
      const d = doc.data();
      await upsert(
        `INSERT INTO ui_social_proof_companies (id, org_id, company_name, enrollments_count, notable_outcomes, trending, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           company_name=EXCLUDED.company_name, enrollments_count=EXCLUDED.enrollments_count,
           updated_at=EXCLUDED.updated_at`,
        [
          doc.id, orgId,
          d.companyName || d.company_name || "",
          d.enrollmentsCount || d.enrollments_count || 0,
          d.notableOutcomes || d.notable_outcomes || "",
          d.trending ?? false,
          toIso(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
    }
  }

  // Cities
  const citiesSnap = await firestore.collection("organizations").doc(orgId).collection("socialProofCities").get();
  if (!citiesSnap.empty) {
    console.log(`    socialProofCities: ${citiesSnap.size}`);
    for (const doc of citiesSnap.docs) {
      const d = doc.data();
      await upsert(
        `INSERT INTO ui_social_proof_cities (id, org_id, city_name, enrollments_count, trending, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           city_name=EXCLUDED.city_name, enrollments_count=EXCLUDED.enrollments_count,
           updated_at=EXCLUDED.updated_at`,
        [
          doc.id, orgId,
          d.cityName || d.city_name || "",
          d.enrollmentsCount || d.enrollments_count || 0,
          d.trending ?? false,
          toIso(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
    }
  }

  // Roles
  const rolesSnap = await firestore.collection("organizations").doc(orgId).collection("socialProofRoles").get();
  if (!rolesSnap.empty) {
    console.log(`    socialProofRoles: ${rolesSnap.size}`);
    for (const doc of rolesSnap.docs) {
      const d = doc.data();
      await upsert(
        `INSERT INTO ui_social_proof_roles (id, org_id, role_name, enrollments_count, success_stories, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           role_name=EXCLUDED.role_name, enrollments_count=EXCLUDED.enrollments_count,
           updated_at=EXCLUDED.updated_at`,
        [
          doc.id, orgId,
          d.roleName || d.role_name || "",
          d.enrollmentsCount || d.enrollments_count || 0,
          d.successStories || d.success_stories || "",
          toIso(d.updatedAt || d.updated_at) || new Date().toISOString(),
        ]
      );
    }
  }
}

async function migrateUsage(orgId: string) {
  const snap = await firestore.collection("organizations").doc(orgId).collection("usage").get();
  if (snap.empty) return;
  console.log(`    usage: ${snap.size}`);

  for (const doc of snap.docs) {
    const d = doc.data();
    await upsert(
      `INSERT INTO usage (org_id, period, total_calls, completed_calls, failed_calls, total_seconds, total_minutes, hot_leads, warm_leads, cold_leads, daily_breakdown, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (org_id, period) DO UPDATE SET
         total_calls=EXCLUDED.total_calls, completed_calls=EXCLUDED.completed_calls,
         total_seconds=EXCLUDED.total_seconds, total_minutes=EXCLUDED.total_minutes,
         updated_at=EXCLUDED.updated_at`,
      [
        orgId,
        doc.id, // period is the doc ID
        d.totalCalls || d.total_calls || 0,
        d.completedCalls || d.completed_calls || 0,
        d.failedCalls || d.failed_calls || 0,
        d.totalSeconds || d.total_seconds || 0,
        d.totalMinutes || d.total_minutes || 0,
        d.hotLeads || d.hot_leads || 0,
        d.warmLeads || d.warm_leads || 0,
        d.coldLeads || d.cold_leads || 0,
        JSON.stringify(d.dailyBreakdown || d.daily_breakdown || {}),
        toIso(d.updatedAt || d.updated_at) || new Date().toISOString(),
      ]
    );
  }
}

// ---------- Main ----------

async function main() {
  console.log("=== Firestore → PostgreSQL Migration ===");
  console.log(`  Database: ${DATABASE_URL.replace(/:[^@]+@/, ':***@')}`);

  try {
    // Test DB connection
    await pool.query("SELECT 1");
    console.log("  PostgreSQL connection OK");

    await migrateUsers();
    await migrateOrganizations();

    // Fix: if users have empty org_id, try to link them
    const orphanUsers = await pool.query("SELECT uid FROM users WHERE org_id = '' OR org_id IS NULL");
    if (orphanUsers.rows.length > 0) {
      const orgs = await pool.query("SELECT id, created_by FROM organizations LIMIT 1");
      if (orgs.rows.length > 0) {
        const defaultOrgId = orgs.rows[0].id;
        console.log(`\n  Linking ${orphanUsers.rows.length} orphan user(s) to org ${defaultOrgId}`);
        for (const row of orphanUsers.rows) {
          await pool.query("UPDATE users SET org_id = $1 WHERE uid = $2", [defaultOrgId, row.uid]);
        }
      }
    }

    // Final counts
    console.log("\n=== Migration Complete — Row Counts ===");
    const tables = [
      "users", "organizations", "bot_configs", "leads", "ui_calls",
      "personas", "situations", "product_sections",
      "ui_social_proof_companies", "ui_social_proof_cities", "ui_social_proof_roles",
      "usage",
    ];
    for (const t of tables) {
      const { rows } = await pool.query(`SELECT count(*) FROM ${t}`);
      console.log(`  ${t}: ${rows[0].count}`);
    }
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

main();
