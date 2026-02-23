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

async function fetchGHLTags(apiKey: string, locationId: string): Promise<string[]> {
  console.log("[GHL Tags] Fetching tags for location:", locationId);
  const res = await fetch(`${GHL_API_BASE}/locations/${locationId}/tags`, {
    headers: { Authorization: `Bearer ${apiKey}`, Version: GHL_API_VERSION },
  });
  if (!res.ok) {
    const errorText = await res.text();
    console.error(`[GHL Tags] API error: ${res.status} - ${errorText}`);
    throw new Error(`GHL Tags API error ${res.status}: ${errorText}`);
  }
  const data = await res.json();
  const tags: string[] = (data.tags ?? [])
    .map((t: { name?: string } | string) => (typeof t === "string" ? t : t.name ?? ""))
    .filter(Boolean);
  console.log(`[GHL Tags] Found ${tags.length} tags`);
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
      const tags = await fetchGHLTags(ghlApiKey, ghlLocationId);
      return NextResponse.json({ success: true, tags });
    }

    if (body.action !== "sync") {
      return NextResponse.json({ success: false, message: "Unknown action" }, { status: 400 });
    }

    // Sync: fetch ONE page of 100 contacts
    const filterTag: string | undefined = body.tag || undefined;
    const cursor: string | undefined = body.cursor || undefined;

    console.log(`[GHL Sync] Fetching batch for org: ${orgId}${filterTag ? ` (tag: "${filterTag}")` : ""}${cursor ? ` (cursor: ${cursor})` : " (first batch)"}`);

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

    const contacts = filterTag
      ? ghlData.contacts.filter((c) => c.tags?.includes(filterTag))
      : ghlData.contacts;

    console.log(`[GHL Sync] Got ${ghlData.contacts.length} contacts from GHL, ${contacts.length} matched${filterTag ? ` tag "${filterTag}"` : ""} (total in GHL: ${totalInGHL})`);

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
