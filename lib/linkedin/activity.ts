import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type CampaignActivityLevel = "info" | "warn" | "error";

export interface CampaignActivityInput {
  runId: string;
  targetId?: string | null;
  level: CampaignActivityLevel;
  message: string;
}

function writeOperationalLog(input: CampaignActivityInput): void {
  const rendered = `[campaign-runner] [${input.level.toUpperCase()}] run=${input.runId} target=${input.targetId || "-"} ${input.message}`;
  if (input.level === "error") console.error(rendered);
  else if (input.level === "warn") console.warn(rendered);
  else console.log(rendered);
}

export function recordCampaignActivity(
  db: Database.Database,
  input: CampaignActivityInput,
): string | null {
  writeOperationalLog(input);
  try {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO logs (id, run_id, target_id, level, message, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(id, input.runId, input.targetId ?? null, input.level, input.message);
    return id;
  } catch {
    return null;
  }
}

/**
 * Records a state transition once per campaign, target, and exact message.
 * This keeps webhook retries and periodic reconciliation from flooding the UI.
 */
export function recordCampaignActivityOnce(
  db: Database.Database,
  input: CampaignActivityInput,
): { inserted: boolean; id: string | null } {
  try {
    const existing = db.prepare(`
      SELECT id FROM logs
      WHERE run_id = ? AND target_id IS ? AND message = ?
      LIMIT 1
    `).get(input.runId, input.targetId ?? null, input.message) as { id: string } | undefined;
    if (existing) return { inserted: false, id: existing.id };

    const id = recordCampaignActivity(db, input);
    return { inserted: Boolean(id), id };
  } catch {
    return { inserted: false, id: null };
  }
}
