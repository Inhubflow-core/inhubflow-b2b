import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";

export type LinkedInDeliveryState = "prepared" | "confirmed" | "uncertain" | "failed";

export interface LinkedInStepDelivery {
  id: string;
  track_id: string;
  step_id: string;
  state: LinkedInDeliveryState;
  external_id: string | null;
  external_thread_id: string | null;
  payload_hash: string | null;
  error_message: string | null;
}

export function hashLinkedInPayload(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function getLinkedInStepDelivery(
  db: Database.Database,
  trackId: string,
  stepId: string,
): LinkedInStepDelivery | null {
  return (db.prepare(`
    SELECT id, track_id, step_id, state, external_id, external_thread_id,
      payload_hash, error_message
    FROM linkedin_step_deliveries
    WHERE track_id = ? AND step_id = ?
  `).get(trackId, stepId) as LinkedInStepDelivery | undefined) ?? null;
}

export function prepareLinkedInStepDelivery(
  db: Database.Database,
  input: {
    trackId: string;
    stepId: string;
    runId: string;
    targetId: string;
    accountId: string;
    actionType: "connect" | "message";
    payload: string;
  },
): { delivery: LinkedInStepDelivery; acquired: boolean } {
  const id = randomUUID();
  const payloadHash = hashLinkedInPayload(input.payload);
  const existing = getLinkedInStepDelivery(db, input.trackId, input.stepId);
  let acquired = false;
  if (!existing) {
    const result = db.prepare(`
      INSERT OR IGNORE INTO linkedin_step_deliveries (
        id, track_id, step_id, run_id, target_id, account_id, action_type,
        state, payload_hash, attempted_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, datetime('now'), datetime('now'))
    `).run(id, input.trackId, input.stepId, input.runId, input.targetId, input.accountId, input.actionType, payloadHash);
    acquired = result.changes === 1;
  } else if (existing.state === "failed") {
    const result = db.prepare(`
      UPDATE linkedin_step_deliveries
      SET state = 'prepared', payload_hash = ?, error_message = NULL,
        external_id = NULL, external_thread_id = NULL,
        attempted_at = datetime('now'), confirmed_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND state = 'failed'
    `).run(payloadHash, existing.id);
    acquired = result.changes === 1;
  }
  return {
    delivery: getLinkedInStepDelivery(db, input.trackId, input.stepId)!,
    acquired,
  };
}

export function updateLinkedInStepDelivery(
  db: Database.Database,
  id: string,
  state: LinkedInDeliveryState,
  fields: { externalId?: string | null; externalThreadId?: string | null; errorMessage?: string | null } = {},
): void {
  db.prepare(`
    UPDATE linkedin_step_deliveries
    SET state = ?,
      external_id = COALESCE(?, external_id),
      external_thread_id = COALESCE(?, external_thread_id),
      error_message = ?,
      confirmed_at = CASE WHEN ? = 'confirmed' THEN COALESCE(confirmed_at, datetime('now')) ELSE confirmed_at END,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(state, fields.externalId ?? null, fields.externalThreadId ?? null, fields.errorMessage ?? null, state, id);
}
