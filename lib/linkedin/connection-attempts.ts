import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type LinkedInConnectionAttemptOutcome =
  | "prepared"
  | "submitted"
  | "confirmed"
  | "uncertain"
  | "rejected";

interface CreateAttemptInput {
  accountId: string;
  runId: string;
  targetId: string;
  attemptedAt: string;
}

export function createLinkedInConnectionAttempt(
  db: Database.Database,
  input: CreateAttemptInput
): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO linkedin_connection_attempts (
      id, account_id, run_id, target_id, outcome, attempted_at, updated_at
    ) VALUES (?, ?, ?, ?, 'prepared', ?, ?)
  `).run(id, input.accountId, input.runId, input.targetId, input.attemptedAt, input.attemptedAt);
  return id;
}

export function updateLinkedInConnectionAttempt(
  db: Database.Database,
  id: string,
  outcome: LinkedInConnectionAttemptOutcome,
  errorMessage?: string
): void {
  db.prepare(`
    UPDATE linkedin_connection_attempts
    SET outcome = ?, error_message = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(outcome, errorMessage ?? null, id);
}

export function countLinkedInConnectionAttemptsToday(
  db: Database.Database,
  accountId: string,
  bounds?: { start: string; end: string },
): number {
  const row = bounds
    ? db.prepare(`
        SELECT COUNT(*) AS count
        FROM linkedin_connection_attempts
        WHERE account_id = ? AND datetime(attempted_at) >= datetime(?) AND datetime(attempted_at) < datetime(?)
      `).get(accountId, bounds.start, bounds.end) as { count: number }
    : db.prepare(`
        SELECT COUNT(*) AS count
        FROM linkedin_connection_attempts
        WHERE account_id = ? AND date(attempted_at) = date('now')
      `).get(accountId) as { count: number };
  return row.count;
}

/**
 * Imports pre-ledger success logs without duplicating attempts already recorded
 * by the new runtime. Safe to run on every startup.
 */
export function backfillLinkedInConnectionAttempts(db: Database.Database): void {
  // One predecessor release used "confirmed" as the prefix. Normalize it so
  // existing dashboards and workflow analytics retain those historical sends.
  db.exec(`
    UPDATE logs
    SET message = 'Connection request sent and confirmed' ||
      substr(message, length('Connection request confirmed') + 1)
    WHERE message LIKE 'Connection request confirmed%'
  `);

  db.exec(`
    INSERT OR IGNORE INTO linkedin_connection_attempts (
      id, account_id, run_id, target_id, outcome, attempted_at, updated_at
    )
    SELECT 'legacy-log:' || l.id, r.account_id, l.run_id, l.target_id,
           'confirmed', l.created_at, l.created_at
    FROM logs l
    JOIN runs r ON r.id = l.run_id
    WHERE (
        l.message LIKE 'Connection request sent%'
        OR l.message LIKE 'Connection request confirmed%'
      )
      AND r.account_id IS NOT NULL
      AND l.created_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM linkedin_connection_attempts existing
        WHERE existing.account_id = r.account_id
          AND COALESCE(existing.run_id, '') = COALESCE(l.run_id, '')
          AND COALESCE(existing.target_id, '') = COALESCE(l.target_id, '')
          AND ABS(
            strftime('%s', existing.attempted_at) - strftime('%s', l.created_at)
          ) <= 3600
      )
  `);
}
