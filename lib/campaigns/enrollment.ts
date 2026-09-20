import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { canonicalLinkedInProfileUrl } from "@/lib/signals/scanners/scoring";
import { resolveOrCreateCompany, linkTargetToCompany } from "@/lib/companies/service";

export interface CampaignTargetInput {
  linkedinUrl: string;
  fullName: string;
  headline?: string | null;
  company?: string | null;
  location?: string | null;
  providerId?: string | null;
}

export interface EnrollmentResult {
  targetId: string;
  runId: string | null;
  runProfileId: string | null;
  enrolled: boolean;
  reason?: string;
}

export function upsertCampaignTarget(db: Database.Database, input: CampaignTargetInput): string {
  const canonical = canonicalLinkedInProfileUrl(input.linkedinUrl);
  if (!canonical) throw new Error("La URL de LinkedIn del prospecto no es válida");
  const existing = db.prepare("SELECT id FROM targets WHERE lower(linkedin_url) = lower(?) LIMIT 1")
    .get(canonical) as { id: string } | undefined;
  const nameParts = input.fullName.trim().split(/\s+/);
  const firstName = nameParts[0] || null;
  const lastName = nameParts.slice(1).join(" ") || null;
  let targetId: string;

  if (existing) {
    db.prepare(`
      UPDATE targets SET
        full_name = COALESCE(NULLIF(full_name, ''), ?),
        first_name = COALESCE(NULLIF(first_name, ''), ?),
        last_name = COALESCE(NULLIF(last_name, ''), ?),
        headline = COALESCE(NULLIF(headline, ''), ?),
        title = COALESCE(NULLIF(title, ''), ?),
        company = COALESCE(NULLIF(company, ''), ?),
        location = COALESCE(NULLIF(location, ''), ?),
        unipile_provider_id = COALESCE(unipile_provider_id, ?)
      WHERE id = ?
    `).run(input.fullName, firstName, lastName, input.headline || null, input.headline || null, input.company || null, input.location || null, input.providerId || null, existing.id);
    targetId = existing.id;
  } else {
    targetId = randomUUID();
    db.prepare(`
      INSERT INTO targets (
        id, linkedin_url, first_name, last_name, full_name, headline, title,
        company, location, unipile_provider_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(targetId, canonical, firstName, lastName, input.fullName, input.headline || null, input.headline || null, input.company || null, input.location || null, input.providerId || null);
  }

  if (input.company) {
    const companyId = resolveOrCreateCompany(db, {
      name: input.company,
      location: input.location,
    });
    if (companyId) {
      linkTargetToCompany(db, targetId, companyId, input.company);
    }
  }

  return targetId;
}

export function attachTargetToList(db: Database.Database, listId: string, targetId: string): void {
  db.prepare("INSERT OR IGNORE INTO list_targets (list_id, target_id) VALUES (?, ?)").run(listId, targetId);
}

function workflowTracks(db: Database.Database, workflowId: string): string[] {
  const tracks = (db.prepare("SELECT DISTINCT track FROM workflow_steps WHERE workflow_id = ? AND enabled = 1")
    .all(workflowId) as Array<{ track: string }>).map((row) => row.track);
  return tracks.length > 0 ? [...new Set(tracks)] : ["linkedin"];
}

function initialNextStepByTrack(db: Database.Database, workflowId: string): Map<string, string | null> {
  const rows = db.prepare(`
    SELECT ws.track, ws.step_type, ws.delay_seconds
    FROM workflow_steps ws
    WHERE ws.workflow_id = ? AND ws.enabled = 1
      AND ws.step_order = (
        SELECT MIN(inner_ws.step_order) FROM workflow_steps inner_ws
        WHERE inner_ws.workflow_id = ws.workflow_id
          AND inner_ws.track = ws.track AND inner_ws.enabled = 1
      )
  `).all(workflowId) as Array<{ track: string; step_type: string; delay_seconds: number }>;
  return new Map(rows.map((row) => [
    row.track,
    row.step_type === "delay" && row.delay_seconds > 0
      ? new Date(Date.now() + row.delay_seconds * 1000).toISOString()
      : null,
  ]));
}

function firstLinkedInMessageStep(db: Database.Database, workflowId: string): string | null {
  const row = db.prepare(`
    SELECT id FROM workflow_steps
    WHERE workflow_id = ? AND track = 'linkedin' AND step_type = 'message' AND enabled = 1
    ORDER BY step_order ASC LIMIT 1
  `).get(workflowId) as { id: string } | undefined;
  return row?.id || null;
}

function ensureRun(db: Database.Database, input: { workflowId: string; listId: string; accountId: string }): string {
  const active = db.prepare(`
    SELECT id, account_id, list_id, status FROM runs
    WHERE workflow_id = ? AND status IN ('running', 'paused')
    ORDER BY datetime(created_at) DESC LIMIT 1
  `).get(input.workflowId) as { id: string; account_id: string | null; list_id: string | null; status: string } | undefined;
  if (active) {
    if (active.account_id !== input.accountId) throw new Error("El workflow ya tiene una campaña activa con otra cuenta de LinkedIn");
    if (active.status === "paused") throw new Error("La campaña asociada está pausada");
    return active.id;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO runs (id, workflow_id, list_id, account_id, status, started_at, created_at)
    VALUES (?, ?, ?, ?, 'running', datetime('now'), datetime('now'))
  `).run(id, input.workflowId, input.listId, input.accountId);
  return id;
}

export function enrollSignalTarget(db: Database.Database, input: {
  targetId: string;
  listId: string;
  workflowId: string;
  accountId: string;
  messageBody?: string | null;
  messageMetadata?: Record<string, unknown>;
}): EnrollmentResult {
  const previous = db.prepare(`
    SELECT rp.id AS run_profile_id, rp.run_id
    FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
    WHERE rp.target_id = ? AND r.workflow_id = ?
    ORDER BY datetime(r.created_at) DESC LIMIT 1
  `).get(input.targetId, input.workflowId) as { run_profile_id: string; run_id: string } | undefined;
  if (previous) {
    return { targetId: input.targetId, runId: previous.run_id, runProfileId: previous.run_profile_id, enrolled: false, reason: "already_enrolled" };
  }
  const activeElsewhere = db.prepare(`
    SELECT r.id FROM run_profiles rp
    JOIN runs r ON r.id = rp.run_id
    WHERE rp.target_id = ? AND r.status IN ('running', 'paused')
      AND EXISTS (
        SELECT 1 FROM run_profile_tracks rt
        WHERE rt.run_profile_id = rp.id AND rt.state NOT IN ('completed', 'failed', 'skipped')
      )
    LIMIT 1
  `).get(input.targetId) as { id: string } | undefined;
  if (activeElsewhere) {
    return { targetId: input.targetId, runId: activeElsewhere.id, runProfileId: null, enrolled: false, reason: "active_elsewhere" };
  }

  attachTargetToList(db, input.listId, input.targetId);
  const runId = ensureRun(db, { workflowId: input.workflowId, listId: input.listId, accountId: input.accountId });
  const runProfileId = randomUUID();
  const tracks = workflowTracks(db, input.workflowId);
  const nextByTrack = initialNextStepByTrack(db, input.workflowId);
  db.transaction(() => {
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id, email_account_id) VALUES (?, ?, ?, NULL)")
      .run(runProfileId, runId, input.targetId);
    const insertTrack = db.prepare(`
      INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step, next_step_at)
      VALUES (?, ?, ?, 'pending', 0, ?)
    `);
    for (const track of tracks) {
      if (track === "email") continue;
      insertTrack.run(randomUUID(), runProfileId, track, nextByTrack.get(track) || null);
    }
    if (input.messageBody?.trim()) {
      const stepId = firstLinkedInMessageStep(db, input.workflowId);
      if (!stepId) throw new Error("El workflow seleccionado no contiene un paso de mensaje de LinkedIn");
      db.prepare(`
        INSERT INTO run_profile_step_messages (run_profile_id, step_id, body, source, metadata_json)
        VALUES (?, ?, ?, 'signal_radar', ?)
        ON CONFLICT(run_profile_id, step_id) DO UPDATE SET
          body = excluded.body, metadata_json = excluded.metadata_json
      `).run(runProfileId, stepId, input.messageBody.trim(), JSON.stringify(input.messageMetadata || {}));
    }
  })();
  return { targetId: input.targetId, runId, runProfileId, enrolled: true };
}
