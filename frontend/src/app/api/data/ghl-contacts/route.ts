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
  customFields?: Array<{ id: string; value: unknown }>;
}

interface GHLCustomFieldDef {
  id: string;
  name: string;
  fieldKey: string;
  dataType: string;
}

interface GHLResponse {
  contacts: GHLContact[];
  meta: { startAfterId?: string; total?: number };
}

interface GHLSearchResult {
  contacts: GHLContact[];
  total: number;
  hasMore: boolean;
}

// Cache which search filter format works for this GHL account
// (persists across requests within the same process)
let _searchFormatIdx: number | null = null;

/**
 * Search GHL contacts by tags using POST /contacts/search.
 * Tries multiple filter formats and caches the one that works.
 * Returns null if the search endpoint is unavailable (caller should fallback).
 */
async function searchGHLContacts(
  apiKey: string, locationId: string, tags: string[], page: number
): Promise<GHLSearchResult | null> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Version: GHL_API_VERSION,
    "Content-Type": "application/json",
  };

  // Build filter entries for each tag
  const buildBody = (formatIdx: number) => {
    const tagFilters = tags.map((tag) => ({
      field: "tags",
      operator: formatIdx >= 2 ? "eq" : "contains",
      value: tag,
    }));

    const base = { locationId, page, pageLimit: GHL_PAGE_LIMIT };

    if (formatIdx === 0) {
      // Format 1: nested group with OR logic
      return { ...base, filters: [{ group: "OR", filters: tagFilters }] };
    }
    // Format 2 & 3: flat filters array (with contains or eq)
    return { ...base, filters: tagFilters };
  };

  const url = `${GHL_API_BASE}/contacts/search`;
  const formatsToTry = _searchFormatIdx !== null
    ? [_searchFormatIdx]
    : [0, 1, 2]; // try all formats

  for (const idx of formatsToTry) {
    const body = buildBody(idx);
    console.log(`[GHL Search] Trying format ${idx} (page ${page}):`, JSON.stringify(body).slice(0, 200));

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (res.status === 400 || res.status === 422) {
        const errText = await res.text();
        console.log(`[GHL Search] Format ${idx} rejected (${res.status}): ${errText.slice(0, 200)}`);
        continue; // try next format
      }

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[GHL Search] Endpoint error ${res.status}: ${errText.slice(0, 200)}`);
        return null; // endpoint issue, fall back to GET
      }

      const data = await res.json();
      const contacts: GHLContact[] = data.contacts || [];
      const total = data.meta?.total ?? data.total ?? contacts.length;

      // Cache the working format
      if (_searchFormatIdx === null) {
        _searchFormatIdx = idx;
        console.log(`[GHL Search] Format ${idx} works! Caching for future requests.`);
      }

      const hasMore = contacts.length >= GHL_PAGE_LIMIT;
      console.log(`[GHL Search] Got ${contacts.length} contacts (total: ${total}, hasMore: ${hasMore})`);
      return { contacts, total, hasMore };
    } catch (err) {
      console.error(`[GHL Search] Format ${idx} network error:`, err);
      return null; // network issue, fall back to GET
    }
  }

  console.warn("[GHL Search] All formats rejected, falling back to GET + client-side filter");
  return null; // all formats failed
}

/**
 * Upsert a batch of GHL contacts into our leads table.
 * Returns the number of contacts synced.
 */
async function upsertGHLContacts(
  contacts: GHLContact[], orgId: string, selectedFieldIds?: string[]
): Promise<number> {
  if (contacts.length === 0) return 0;

  const ghlIds = contacts.map((c) => c.id);
  const placeholders = ghlIds.map((_, i) => `$${i + 2}`).join(", ");
  const existingRows = await query<{ id: string; ghl_contact_id: string }>(
    `SELECT id, ghl_contact_id FROM fwai_aicall_leads WHERE org_id = $1 AND ghl_contact_id IN (${placeholders})`,
    [orgId, ...ghlIds]
  );
  const existingByGhlId = new Map<string, string>();
  for (const row of existingRows) {
    existingByGhlId.set(row.ghl_contact_id, row.id);
  }

  let synced = 0;
  for (const contact of contacts) {
    const existingDocId = existingByGhlId.get(contact.id);
    const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unknown";

    // Extract selected custom field values
    const customFieldValues: Record<string, unknown> = {};
    if (selectedFieldIds?.length && contact.customFields) {
      for (const cf of contact.customFields) {
        if (selectedFieldIds.includes(cf.id) && cf.value != null && cf.value !== "") {
          customFieldValues[cf.id] = cf.value;
        }
      }
    }
    const customFieldsJson = JSON.stringify(customFieldValues);

    if (existingDocId) {
      await query(
        `UPDATE fwai_aicall_leads SET contact_name = $1, phone_number = $2, email = $3, company = $4, location = $5, tags = $6, custom_fields = $7, updated_at = NOW()
         WHERE id = $8 AND org_id = $9`,
        [contactName, contact.phone || "", contact.email || null, contact.companyName || null, contact.city || null, JSON.stringify(contact.tags || []), customFieldsJson, existingDocId, orgId]
      );
    } else {
      const id = crypto.randomUUID();
      await query(
        `INSERT INTO fwai_aicall_leads (id, org_id, contact_name, phone_number, email, company, location, tags, custom_fields, status, call_count, source, ghl_contact_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', 0, 'ghl', $10, NOW(), NOW())`,
        [id, orgId, contactName, contact.phone || "", contact.email || null, contact.companyName || null, contact.city || null, JSON.stringify(contact.tags || []), customFieldsJson, contact.id]
      );
    }
    synced++;
  }
  return synced;
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
      "SELECT DISTINCT tags FROM fwai_aicall_leads WHERE org_id = $1 AND source = 'ghl' AND tags IS NOT NULL AND tags != '[]'",
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
      "SELECT settings FROM fwai_aicall_organizations WHERE id = $1",
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

    if (body.action === "fetchCustomFields") {
      try {
        const res = await fetch(
          `${GHL_API_BASE}/locations/${ghlLocationId}/customFields`,
          {
            headers: {
              Authorization: `Bearer ${ghlApiKey}`,
              Version: GHL_API_VERSION,
            },
          }
        );
        if (!res.ok) {
          const errText = await res.text();
          console.error(`[GHL CustomFields] API error ${res.status}: ${errText.slice(0, 200)}`);
          return NextResponse.json(
            { success: false, message: `GHL API error: ${res.status}` },
            { status: 502 }
          );
        }
        const data = await res.json();
        const fields: GHLCustomFieldDef[] = (data.customFields || []).map(
          (f: { id: string; name: string; fieldKey: string; dataType: string }) => ({
            id: f.id,
            name: f.name,
            fieldKey: f.fieldKey || "",
            dataType: f.dataType || "TEXT",
          })
        );
        console.log(`[GHL CustomFields] Found ${fields.length} custom fields`);
        return NextResponse.json({ success: true, customFields: fields });
      } catch (err) {
        console.error("[GHL CustomFields] Error:", err);
        return NextResponse.json(
          { success: false, message: "Failed to fetch custom fields from GHL" },
          { status: 502 }
        );
      }
    }

    if (body.action === "saveCustomFieldSelection") {
      const selectedFields: GHLCustomFieldDef[] = body.fields || [];
      await query(
        `UPDATE fwai_aicall_organizations SET settings = jsonb_set(
          COALESCE(settings, '{}'::jsonb),
          '{ghlCustomFields}',
          $1::jsonb
        ), updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(selectedFields), orgId]
      );
      return NextResponse.json({ success: true });
    }

    // Count contacts matching tags (quick preview before import)
    if (body.action === "countByTags") {
      const tags: string[] = body.tags || [];
      if (tags.length === 0) {
        return NextResponse.json({ success: true, total: 0 });
      }

      // Try search endpoint with pageLimit=1 to get just the total
      const result = await searchGHLContacts(ghlApiKey, ghlLocationId, tags, 1);
      if (result) {
        return NextResponse.json({ success: true, total: result.total });
      }

      // Fallback: can't count efficiently without search endpoint
      return NextResponse.json({ success: true, total: null, fallback: true });
    }

    if (body.action !== "sync") {
      return NextResponse.json({ success: false, message: "Unknown action" }, { status: 400 });
    }

    // Sync contacts
    const filterTags: string[] = body.tags?.length ? body.tags : body.tag ? [body.tag] : [];
    const cursor: string | undefined = body.cursor || undefined;

    // Read selected custom field IDs from org settings
    const ghlCustomFields: GHLCustomFieldDef[] = (settings as Record<string, unknown>).ghlCustomFields as GHLCustomFieldDef[] || [];
    const selectedFieldIds = ghlCustomFields.map((f) => f.id);

    // --- TAG-FILTERED SYNC: use search endpoint, auto-paginate all pages ---
    if (filterTags.length > 0) {
      console.log(`[GHL Sync] Tag-filtered sync for org: ${orgId}, tags: ${JSON.stringify(filterTags)}`);

      // First try the search endpoint
      const firstPage = await searchGHLContacts(ghlApiKey, ghlLocationId, filterTags, 1);

      if (firstPage) {
        // Search endpoint works — auto-paginate through all results
        let totalSynced = await upsertGHLContacts(firstPage.contacts, orgId, selectedFieldIds);
        let currentPage = 1;
        let hasMore = firstPage.hasMore;
        const totalInGHL = firstPage.total;
        const MAX_PAGES = 50; // safety limit: 50 * 100 = 5000 contacts max

        while (hasMore && currentPage < MAX_PAGES) {
          currentPage++;
          const nextPageResult = await searchGHLContacts(ghlApiKey, ghlLocationId, filterTags, currentPage);
          if (!nextPageResult || nextPageResult.contacts.length === 0) break;
          totalSynced += await upsertGHLContacts(nextPageResult.contacts, orgId, selectedFieldIds);
          hasMore = nextPageResult.hasMore;
        }

        // Update last sync time
        const nowIso = new Date().toISOString();
        await query(
          `UPDATE fwai_aicall_organizations SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{ghlLastSyncAt}', to_jsonb($1::text)), updated_at = NOW() WHERE id = $2`,
          [nowIso, orgId]
        );

        console.log(`[GHL Sync] Tag search complete. Synced: ${totalSynced}/${totalInGHL} across ${currentPage} pages`);
        return NextResponse.json({
          success: true, synced: totalSynced, totalInGHL, hasMore: false,
          searchMode: true, ghlLastSyncAt: nowIso,
        });
      }

      // Search endpoint failed — fall through to GET + client-side filter
      console.warn("[GHL Sync] Search endpoint unavailable, falling back to GET + client-side filter");
    }

    // --- UNFILTERED SYNC (or fallback): single page via GET /contacts/ ---
    console.log(`[GHL Sync] Fetching batch for org: ${orgId}${filterTags.length ? ` (tags: ${JSON.stringify(filterTags)} — fallback mode)` : ""}${cursor ? ` (cursor: ${cursor})` : " (first batch)"}`);

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

    // Client-side tag filter (fallback path)
    const contacts = filterTags.length > 0
      ? ghlData.contacts.filter((c) => c.tags?.some((t) => filterTags.includes(t)))
      : ghlData.contacts;

    console.log(`[GHL Sync] Got ${ghlData.contacts.length} contacts from GHL, ${contacts.length} matched${filterTags.length ? ` tags ${JSON.stringify(filterTags)}` : ""} (total in GHL: ${totalInGHL})`);

    const synced = await upsertGHLContacts(contacts, orgId, selectedFieldIds);
    console.log(`[GHL Sync] Saved ${synced} leads to PostgreSQL`);

    // Update last sync time
    const nowIso = new Date().toISOString();
    await query(
      `UPDATE fwai_aicall_organizations SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{ghlLastSyncAt}', to_jsonb($1::text)), updated_at = NOW() WHERE id = $2`,
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
      "SELECT settings FROM fwai_aicall_organizations WHERE id = $1",
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
