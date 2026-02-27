import { query, queryOne, pool } from "@/lib/db";
import {
  triggerCall,
  checkConcurrencySlot,
  ConcurrencyLimitError,
} from "@/lib/call-trigger";
import type { TriggerCallParams } from "@/lib/call-trigger";

/**
 * Enqueue a call for later processing (when at concurrency capacity).
 * Returns the queue entry ID.
 */
export async function enqueueCall(params: {
  orgId: string;
  payload: TriggerCallParams;
  source: "api" | "webhook";
  leadId?: string;
  botConfigId?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO call_queue (id, org_id, payload, source, status, lead_id, bot_config_id)
     VALUES ($1, $2, $3, $4, 'queued', $5, $6)`,
    [
      id,
      params.orgId,
      JSON.stringify(params.payload),
      params.source,
      params.leadId || null,
      params.botConfigId || null,
    ]
  );
  console.log(
    `[call-queue] Enqueued call ${id} for org ${params.orgId} (source: ${params.source})`
  );
  return id;
}

/**
 * Process queued calls for an org. Called from call-ended webhook.
 * Uses a non-blocking advisory lock to prevent thundering herd when
 * multiple calls end simultaneously for the same org.
 * Returns the number of calls successfully triggered.
 */
export async function drainQueue(orgId: string): Promise<number> {
  const client = await pool.connect();
  let triggered = 0;

  try {
    // Try to acquire a non-blocking session-level advisory lock.
    // If another drain is in progress for this org, skip.
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1 || '_drain'))",
      [orgId]
    );
    const gotLock = lockResult.rows[0]?.pg_try_advisory_lock;
    if (!gotLock) {
      client.release();
      return 0; // Another drain is already running
    }

    try {
      // Process up to 5 queued calls per drain cycle
      for (let i = 0; i < 5; i++) {
        // Atomically dequeue the next call
        const next = await queryOne<{
          id: string;
          org_id: string;
          payload: TriggerCallParams;
          source: string;
          lead_id: string | null;
          bot_config_id: string | null;
        }>(
          `UPDATE call_queue
           SET status = 'processing', attempts = attempts + 1
           WHERE id = (
             SELECT id FROM call_queue
             WHERE org_id = $1 AND status = 'queued' AND attempts < max_attempts
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
           )
           RETURNING *`,
          [orgId]
        );

        if (!next) break; // No more queued calls

        const payload = next.payload;

        // Resolve bot config name for call log display
        let botConfigName: string | undefined;
        const cfgId = next.bot_config_id || payload.botConfigId;
        if (cfgId) {
          const cfg = await queryOne<{ name: string }>(
            "SELECT name FROM bot_configs WHERE id = $1",
            [cfgId]
          );
          botConfigName = cfg?.name;
        }

        try {
          // Reserve a concurrency slot
          const slot = await checkConcurrencySlot({
            orgId,
            phoneNumber: payload.phoneNumber,
            contactName: payload.contactName,
            botConfigId: payload.botConfigId,
            botConfigName,
            leadId: next.lead_id || payload.leadId,
            initiatedBy: next.source === "webhook" ? "api" : next.source,
            requestPayload: payload as unknown as Record<string, unknown>,
          });

          // Trigger the call
          const result = await triggerCall(payload);

          // Update the reserved ui_calls row
          await query(
            "UPDATE ui_calls SET call_uuid = $1, response = $2, status = 'in-progress' WHERE id = $3",
            [
              result.callUuid,
              JSON.stringify(result.rawResponse),
              slot.uiCallId,
            ]
          );

          // Mark queue entry as completed
          await query(
            "UPDATE call_queue SET status = 'completed', processed_at = NOW(), call_uuid = $1 WHERE id = $2",
            [result.callUuid, next.id]
          );

          triggered++;
          console.log(
            `[call-queue] Drained queued call ${next.id} → call ${result.callUuid}`
          );
        } catch (err) {
          if (err instanceof ConcurrencyLimitError) {
            // Still at capacity — put it back and stop trying
            await query(
              "UPDATE call_queue SET status = 'queued', attempts = attempts - 1 WHERE id = $1",
              [next.id]
            );
            break;
          }
          // Other error — mark as failed
          await query(
            "UPDATE call_queue SET status = 'failed', error_message = $1, processed_at = NOW() WHERE id = $2",
            [err instanceof Error ? err.message : String(err), next.id]
          );
          console.error(
            `[call-queue] Failed to process queued call ${next.id}:`,
            err
          );
        }
      }
    } finally {
      // Release the session-level advisory lock
      await client.query(
        "SELECT pg_advisory_unlock(hashtext($1 || '_drain'))",
        [orgId]
      );
    }
  } finally {
    client.release();
  }

  return triggered;
}
