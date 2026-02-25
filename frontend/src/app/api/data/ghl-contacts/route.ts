import { NextRequest, NextResponse } from "next/server";
import { requireUidAndOrg, query, queryOne } from "@/lib/db";

export const maxDuration = 60;

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";
const GHL_PAGE_LIMIT = 100;

interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  companyName?: string;
  city?: string;
}

interface GHLResponse {
  contacts: GHLContact[];
  meta: { startAfterId?: string; total?: number };
}

async function fetchGHLTags(apiKey: string, locationId: string, orgId: string): Promise<string[]> {
  const allTags = new Set<string>();

  // Strategy 1: Try the dedicated tags endpoint (fastest, most complete)
  console.log("[GHL Tags] Trying /locations/{id}/tags endpoint...");
  try {
    const res = await fetch(`${GHL_API_BASE}/locations/${locationId}/tags`, {
      headers: { Authorization: `Bearer ${apiKey}`, Version: GHL_API_VERSION },
    });
    if (res.ok) {
      const data = await res.json();
      const tags: string[] = (data.tags ?? [])
        .map((t: { name?: string } | string) => (typeof t === "string" ? t : t.name ?? ""))
        .filter(Boolean);
      console.log(`[GHL Tags] Found ${tags.length} tags via tags endpoint`);
      if (tags.length > 0) return tags.sort();
    } else {
      console.log(`[GHL Tags] Tags endpoint returned ${res.status}, using fallback`);
    }
  } catch (err) {
    console.log("[GHL Tags] Tags endpoint failed:", err);
  }

  // Strategy 2: Read tags from locally synced leads in our DB
  console.log("[GHL Tags] Reading tags from local DB...");
  try {
    const rows = await query<{ tags: string }>(
      "SELECT DISTINCT tags FROM leads WHERE org_id = $1 AND source = 'ghl' AND tags IS NOT NULL AND tags != '[]'",
      [orgId]
    );
    for (const row of rows) {
      try {
        const parsed = typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags;
        if (Array.isArray(parsed)) {
          for (const tag of parsed) {
            if (typeof tag === "string" && tag.trim()) allTags.add(tag.trim());
          }
        }
      } catch { /* skip invalid JSON */ }
    }
    console.log(`[GHL Tags] Found ${allTags.size} tags from local DB`);
  } catch (err) {
    console.log("[GHL Tags] DB query failed:", err);
  }

  // Strategy 3: Also scan a few GHL pages to catch new tags not yet synced
  console.log("[GHL Tags] Scanning GHL contacts for additional tags...");
  let cursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    try {
      const params = new URLSearchParams({ locationId, limit: "100" });
      if (cursor) params.set("startAfterId", cursor);
      const res = await fetch(`${GHL_API_BASE}/contacts/?${params.toString()}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Version: GHL_API_VERSION },
      });
      if (!res.ok) break;
      const data: GHLResponse = await res.json();
      for (const contact of data.contacts) {
        for (const tag of contact.tags || []) allTags.add(tag);
      }
      cursor = data.meta?.startAfterId;
      if (!cursor || data.contacts.length < 100) break;
    } catch { break; }
  }

  const tags = Array.from(allTags).sort();
  console.log(`[GHL Tags] Total: ${tags.length} unique tags (DB + GHL scan)`);
  return tags;
}

export async function POST(request: NextRequest) {
  try {
    const { orgId } = await requireUidAndOrg(request);
    const body = await request.json();

    // Read GHL credentials from org settings
    const orgRow = await queryOne<{ settings: Record<string, string> }>(
      "SELECT settings FROM organizations WHERE id = $1",
      [orgId]
    );
    if (!orgRow) {
      return NextResponse.json({ success: false, message: "Organization not found" }, { status: 404 });
    }

    const settings = orgRow.settings || {};
    const ghlApiKey = settings.ghlApiKey;
    const ghlLocationId = settings.ghlLocationId;

    if (!ghlApiKey || !ghlLocationId) {
      return NextResponse.json(
        { success: false, message: "GHL API Key and Location ID must be configured in Settings" },
        { status: 400 }
      );
    }

    if (body.action === "fetchTags") {
      const tags = await fetchGHLTags(ghlApiKey, ghlLocationId, orgId);
      return NextResponse.json({ success: true, tags });
    }

    if (body.action !== "sync") {
      return NextResponse.json({ success: false, message: "Unknown action" }, { status: 400 });
    }

    // Sync: fetch ONE page of 100 contacts
    // Support both single tag (legacy) and multiple tags
    const filterTags: string[] = body.tags?.length ? body.tags : body.tag ? [body.tag] : [];
    const cursor: string | undefined = body.cursor || undefined;

    console.log(`[GHL Sync] Fetching batch for org: ${orgId}${filterTags.length ? ` (tags: ${JSON.stringify(filterTags)})` : ""}${cursor ? ` (cursor: ${cursor})` : " (first batch)"}`);

    const params = new URLSearchParams({ locationId: ghlLocationId, limit: String(GHL_PAGE_LIMIT) });
    if (cursor) params.set("startAfterId", cursor);

    const ghlRes = await fetch(`${GHL_API_BASE}/contacts/?${params.toString()}`, {
      headers: { Authorization: `Bearer ${ghlApiKey}`, Version: GHL_API_VERSION },
    });

    if (!ghlRes.ok) {
      const errorText = await ghlRes.text();
      console.error(`[GHL Sync] API error: ${ghlRes.status} - ${errorText}`);
      throw new Error(`GHL API error ${ghlRes.status}: ${errorText}`);
    }

    const ghlData: GHLResponse = await ghlRes.json();
    const totalInGHL = ghlData.meta?.total ?? 0;

    // Filter contacts that have ANY of the selected tags
    const contacts = filterTags.length > 0
      ? ghlData.contacts.filter((c) => c.tags?.some((t) => filterTags.includes(t)))
      : ghlData.contacts;

    console.log(`[GHL Sync] Got ${ghlData.contacts.length} contacts from GHL, ${contacts.length} matched${filterTags.length ? ` tags ${JSON.stringify(filterTags)}` : ""} (total in GHL: ${totalInGHL})`);

    // Load existing GHL leads for upsert
    let synced = 0;

    if (contacts.length > 0) {
      // Get existing leads with these GHL IDs
      const ghlIds = contacts.map((c) => c.id);
      const placeholders = ghlIds.map((_, i) => `$${i + 2}`).join(", ");
      const existingRows = await query<{ id: string; ghl_contact_id: string }>(
        `SELECT id, ghl_contact_id FROM leads WHERE org_id = $1 AND ghl_contact_id IN (${placeholders})`,
        [orgId, ...ghlIds]
      );
      const existingByGhlId = new Map<string, string>();
      for (const row of existingRows) {
        existingByGhlId.set(row.ghl_contact_id, row.id);
      }

      for (const contact of contacts) {
        const existingDocId = existingByGhlId.get(contact.id);
        const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unknown";

        if (existingDocId) {
          await query(
            `UPDATE leads SET contact_name = $1, phone_number = $2, email = $3, company = $4, location = $5, tags = $6, updated_at = NOW()
             WHERE id = $7 AND org_id = $8`,
            [contactName, contact.phone || "", contact.email || null, contact.companyName || null, contact.city || null, JSON.stringify(contact.tags || []), existingDocId, orgId]
          );
        } else {
          const id = crypto.randomUUID();
          await query(
            `INSERT INTO leads (id, org_id, contact_name, phone_number, email, company, location, tags, status, call_count, source, ghl_contact_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new', 0, 'ghl', $9, NOW(), NOW())`,
            [id, orgId, contactName, contact.phone || "", contact.email || null, contact.companyName || null, contact.city || null, JSON.stringify(contact.tags || []), contact.id]
          );
        }
        synced++;
      }
      console.log(`[GHL Sync] Saved ${synced} leads to PostgreSQL`);
    }

    // Update last sync time
    const nowIso = new Date().toISOString();
    await query(
      `UPDATE organizations SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{ghlLastSyncAt}', to_jsonb($1::text)), updated_at = NOW() WHERE id = $2`,
      [nowIso, orgId]
    );

    const hasMore = !!(ghlData.meta?.startAfterId && ghlData.contacts.length >= GHL_PAGE_LIMIT);
    const nextCursor = hasMore ? ghlData.meta!.startAfterId : null;

    console.log(`[GHL Sync] Batch done. Synced: ${synced}, hasMore: ${hasMore}`);

    return NextResponse.json({ success: true, synced, totalInGHL, hasMore, nextCursor, ghlLastSyncAt: nowIso });
  } catch (error) {
    console.error("[GHL Contacts API] POST error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireUidAndOrg(request);
    const orgRow = await queryOne<{ settings: Record<string, string> }>(
      "SELECT settings FROM organizations WHERE id = $1",
      [orgId]
    );
    const settings = orgRow?.settings ?? {};

    return NextResponse.json({
      ghlSyncEnabled: settings.ghlSyncEnabled ?? false,
      ghlLastSyncAt: settings.ghlLastSyncAt ?? "",
      ghlConfigured: !!(settings.ghlApiKey && settings.ghlLocationId),
    });
  } catch (error) {
    console.error("[GHL Contacts API] GET error:", error);
    return NextResponse.json(
      { ghlSyncEnabled: false, ghlLastSyncAt: "", ghlConfigured: false },
      { status: 500 }
    );
  }
}
