// Server-side in-memory store for pending call updates from n8n webhook.
// The /api/call-ended endpoint writes here, and /api/call-updates reads + clears.
// Updates are keyed by orgId for multi-tenant isolation.

import type { CallEndedData } from "@/types/call";

interface PendingUpdate {
  callUuid: string;
  data: CallEndedData;
  receivedAt: string;
}

const pendingUpdates: Map<string, PendingUpdate[]> = new Map();

export function addCallUpdate(orgId: string, data: CallEndedData) {
  const key = orgId || "__default__";
  if (!pendingUpdates.has(key)) {
    pendingUpdates.set(key, []);
  }
  const updates = pendingUpdates.get(key)!;
  updates.push({
    callUuid: data.call_uuid,
    data,
    receivedAt: new Date().toISOString(),
  });
  console.log(
    `[call-updates-store] Added update for call ${data.call_uuid} (org: ${key}). Pending for org: ${updates.length}`
  );
}

export function getPendingUpdates(orgId: string): PendingUpdate[] {
  const key = orgId || "__default__";
  const updates = pendingUpdates.get(key) || [];
  pendingUpdates.set(key, []); // clear after reading
  return updates;
}
