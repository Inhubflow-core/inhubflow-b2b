import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { getTagsForTargets } from "@/lib/tags/tags-repository";

export interface PipelineCard {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  profile_image_url: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  degree: number | null;
  stage_id: string | null;
  stage_updated_at: string | null;
  reply_kind: string | null;
  sdr_autopilot: number;
  sdr_intent: string | null;
  sdr_thread_state: string | null;
  channel: "linkedin" | "email" | "both";
  last_interaction_at: string | null;
  last_interaction_type: "reply" | "email_reply" | "message" | "connected" | "contacted" | "none";
  workflow_name: string | null;
  workflow_names: string[];
  list_names: string[];
  tags: Array<{ slug: string; name: string; color: string; source: string }>;
}

export interface PipelineStageWithCount {
  id: string;
  name: string;
  order_index: number;
  color: string;
  trigger_key: string | null;
  is_system: number;
  target_count: number;
}

export interface PipelineFilterOptions {
  listId?: string;
  workflowId?: string;
  /** Multiple lists / campaigns, for the "all my campaigns" view. */
  listIds?: string[];
  workflowIds?: string[];
  tagSlugs?: string[];
  workspaceOwnerId?: string | null;
  search?: string;
  channel?: "linkedin" | "email";
  onlyHumanIntervention?: boolean;
}

/**
 * Targets have no owner column, so workspace isolation is derived by joining the
 * LinkedIn/email accounts that touched them — the same rule already used by
 * `targetBelongsToLinkedInAccount` in lib/authz.ts.
 */
function workspaceClause(filters: PipelineFilterOptions): { sql: string; params: unknown[] } {
  if (!filters.workspaceOwnerId) return { sql: "", params: [] };
  return {
    sql: `(
      EXISTS (
        SELECT 1 FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
        JOIN accounts a ON a.id = r.account_id
        WHERE rp.target_id = t.id AND a.owner_id = ?
      )
      OR EXISTS (
        SELECT 1 FROM linkedin_inbox_messages m
        JOIN accounts a ON a.id = m.account_id
        WHERE m.target_id = t.id AND a.owner_id = ?
      )
      OR EXISTS (
        SELECT 1 FROM email_replies er
        JOIN email_accounts ea ON ea.id = er.email_account_id
        WHERE er.target_id = t.id AND ea.owner_id = ?
      )
    )`,
    params: [filters.workspaceOwnerId, filters.workspaceOwnerId, filters.workspaceOwnerId],
  };
}

function listClause(filters: PipelineFilterOptions): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const ids = [filters.listId, ...(filters.listIds ?? [])].filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  if (ids.length > 0) {
    clauses.push(`EXISTS (
      SELECT 1 FROM list_targets lt WHERE lt.target_id = t.id AND lt.list_id IN (${ids.map(() => "?").join(",")})
    )`);
    params.push(...ids);
  }
  return { clauses, params };
}

function workflowClause(filters: PipelineFilterOptions): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const ids = [filters.workflowId, ...(filters.workflowIds ?? [])].filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  if (ids.length > 0) {
    clauses.push(`EXISTS (
      SELECT 1 FROM run_profiles rp JOIN runs r ON r.id = rp.run_id
      WHERE rp.target_id = t.id AND r.workflow_id IN (${ids.map(() => "?").join(",")})
    )`);
    params.push(...ids);
  }
  return { clauses, params };
}

function tagClause(filters: PipelineFilterOptions): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const slugs = (filters.tagSlugs ?? []).filter((s) => typeof s === "string" && s.length > 0);
  if (slugs.length > 0) {
    // OR semantics: a card matches if it carries any of the selected tags.
    clauses.push(`EXISTS (
      SELECT 1 FROM target_tags tt JOIN tags tg ON tg.id = tt.tag_id
      WHERE tt.target_id = t.id AND tg.slug IN (${slugs.map(() => "?").join(",")})
    )`);
    params.push(...slugs);
  }
  return { clauses, params };
}

function searchClause(filters: PipelineFilterOptions): { clauses: string[]; params: unknown[] } {
  if (!filters.search || !filters.search.trim()) return { clauses: [], params: [] };
  const q = `%${filters.search.trim().toLowerCase()}%`;
  return {
    clauses: [
      "(LOWER(t.full_name) LIKE ? OR LOWER(t.company) LIKE ? OR LOWER(t.email) LIKE ? OR LOWER(t.title) LIKE ?)",
    ],
    params: [q, q, q, q],
  };
}

function channelClause(filters: PipelineFilterOptions): string[] {
  if (filters.channel === "linkedin") {
    return ["(t.linkedin_url IS NOT NULL OR t.connection_requested_at IS NOT NULL)"];
  }
  if (filters.channel === "email") {
    return ["(t.email IS NOT NULL AND t.email != '')"];
  }
  return [];
}

function humanInterventionClause(filters: PipelineFilterOptions): string[] {
  if (!filters.onlyHumanIntervention) return [];
  return [
    `EXISTS (
      SELECT 1 FROM sdr_threads st
      WHERE st.target_id = t.id AND st.state IN ('HUMAN_REVIEW', 'HUMAN_ACTIVE')
    )`,
  ];
}

/** Builds the shared WHERE clause used by both the counts and the cards query. */
function buildWhere(
  filters: PipelineFilterOptions,
  extra: string[] = [],
  extraParams: unknown[] = []
): { sql: string; params: unknown[] } {
  const ws = workspaceClause(filters);
  const list = listClause(filters);
  const wf = workflowClause(filters);
  const tag = tagClause(filters);
  const search = searchClause(filters);

  const clauses = [
    ...extra,
    ...(ws.sql ? [ws.sql] : []),
    ...list.clauses,
    ...wf.clauses,
    ...tag.clauses,
    ...search.clauses,
    ...channelClause(filters),
    ...humanInterventionClause(filters),
  ];
  const params = [...extraParams, ...ws.params, ...list.params, ...wf.params, ...tag.params, ...search.params];
  return { sql: clauses.length ? clauses.join(" AND ") : "1=1", params };
}

/**
 * Move a target to a specific pipeline stage manually or programmatically.
 */
export function moveTargetToStage(
  db: Database.Database,
  targetId: string,
  stageId: string,
  note?: string
): boolean {
  const stage = db.prepare("SELECT id, name FROM pipeline_stages WHERE id = ?").get(stageId) as
    | { id: string; name: string }
    | undefined;
  if (!stage) return false;

  const target = db.prepare("SELECT id, stage_id FROM targets WHERE id = ?").get(targetId) as
    | { id: string; stage_id: string | null }
    | undefined;
  if (!target) return false;

  if (target.stage_id === stageId) return true;

  db.transaction(() => {
    db.prepare(`
      UPDATE targets
      SET stage_id = ?, stage_updated_at = datetime('now')
      WHERE id = ?
    `).run(stageId, targetId);

    if (note) {
      db.prepare(`
        INSERT INTO activity_logs (id, target_id, type, body, logged_at, created_at)
        VALUES (?, ?, 'other', ?, datetime('now'), datetime('now'))
      `).run(randomUUID(), targetId, note);
    }
  })();

  return true;
}

/**
 * Automatically advances a target based on a system or SDR trigger.
 * Prevents regressions (e.g., Won or Meeting booked won't be downgraded to Connected).
 */
export function autoAdvanceTargetByTrigger(
  db: Database.Database,
  targetId: string,
  triggerKey: string
): boolean {
  // Find matching stage
  const destStage = db.prepare(`
    SELECT id, name, order_index FROM pipeline_stages WHERE trigger_key = ? LIMIT 1
  `).get(triggerKey) as { id: string; name: string; order_index: number } | undefined;

  if (!destStage) return false;

  const target = db.prepare(`
    SELECT t.id, t.stage_id, ps.order_index, ps.trigger_key as current_trigger
    FROM targets t
    LEFT JOIN pipeline_stages ps ON ps.id = t.stage_id
    WHERE t.id = ?
  `).get(targetId) as {
    id: string;
    stage_id: string | null;
    order_index: number | null;
    current_trigger: string | null;
  } | undefined;

  if (!target) return false;

  // Never automatically downgrade Closed/Won
  if (target.current_trigger === "manual" && target.stage_id === "stage_won") {
    return false;
  }

  // If already at this stage, nothing to do
  if (target.stage_id === destStage.id) {
    return false;
  }

  // If target already reached meeting, don't downgrade on new message/connection
  if (target.current_trigger === "sdr_meeting" && triggerKey !== "sdr_not_interested") {
    return false;
  }

  // Not interested always overrides unless already closed
  if (triggerKey === "sdr_not_interested") {
    return moveTargetToStage(
      db,
      targetId,
      destStage.id,
      `Etapa actualizada automáticamente a: ${destStage.name} (IA detectó desinterés)`
    );
  }

  // General progression: only move forward if new stage has a higher order_index or target had no stage
  if (target.order_index === null || destStage.order_index > target.order_index) {
    return moveTargetToStage(
      db,
      targetId,
      destStage.id,
      `Etapa actualizada automáticamente a: ${destStage.name}`
    );
  }

  return false;
}

/**
 * Returns all pipeline stages along with current target counts according to active filters.
 */
export function getPipelineStagesWithCounts(
  db: Database.Database,
  filters: PipelineFilterOptions = {}
): PipelineStageWithCount[] {
  const { sql: whereSql, params } = buildWhere(filters);

  const stages = db.prepare(`
    SELECT
      ps.id,
      ps.name,
      ps.order_index,
      ps.color,
      ps.trigger_key,
      ps.is_system,
      COUNT(t.id) as target_count
    FROM pipeline_stages ps
    LEFT JOIN targets t ON t.stage_id = ps.id
      AND t.id IN (SELECT t.id FROM targets t WHERE ${whereSql})
    WHERE ps.workspace_owner_id IS NULL ${filters.workspaceOwnerId ? "OR ps.workspace_owner_id = ?" : ""}
    GROUP BY ps.id
    ORDER BY ps.order_index ASC
  `).all(...(filters.workspaceOwnerId ? [...params, filters.workspaceOwnerId] : params)) as PipelineStageWithCount[];

  return stages;
}

/**
 * Returns cards belonging to a specific stage, paginated or capped.
 */
export function getPipelineCardsByStage(
  db: Database.Database,
  stageId: string,
  filters: PipelineFilterOptions = {},
  limit = 50,
  offset = 0
): PipelineCard[] {
  const { sql: whereSql, params } = buildWhere(filters, ["t.stage_id = ?"], [stageId]);

  const rows = db.prepare(`
    SELECT
      t.id,
      t.full_name,
      t.first_name,
      t.last_name,
      t.title,
      t.company,
      t.location,
      t.profile_image_url,
      t.linkedin_url,
      t.email,
      t.phone,
      t.degree,
      t.stage_id,
      t.stage_updated_at,
      t.reply_kind,
      t.sdr_autopilot,
      t.connected_at,
      t.message_sent_at,
      t.last_replied_at,
      t.email_replied_at,
      (
        SELECT st.state FROM sdr_threads st
        WHERE st.target_id = t.id
        ORDER BY st.updated_at DESC LIMIT 1
      ) as sdr_thread_state,
      (
        SELECT sd.intent FROM sdr_decisions sd
        JOIN sdr_threads st ON st.id = sd.thread_id
        WHERE st.target_id = t.id
        ORDER BY sd.created_at DESC LIMIT 1
      ) as sdr_intent
    FROM targets t
    WHERE ${whereSql}
    ORDER BY COALESCE(t.stage_updated_at, t.last_replied_at, t.email_replied_at, t.created_at) DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<{
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    company: string | null;
    location: string | null;
    profile_image_url: string | null;
    linkedin_url: string | null;
    email: string | null;
    phone: string | null;
    degree: number | null;
    stage_id: string | null;
    stage_updated_at: string | null;
    reply_kind: string | null;
    sdr_autopilot: number;
    connected_at: string | null;
    message_sent_at: string | null;
    last_replied_at: string | null;
    email_replied_at: string | null;
    sdr_thread_state: string | null;
    sdr_intent: string | null;
  }>;

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");

  const tagsByTarget = getTagsForTargets(db, ids);

  const listRows = db
    .prepare(
      `SELECT lt.target_id, l.name
       FROM list_targets lt JOIN lists l ON l.id = lt.list_id
       WHERE lt.target_id IN (${placeholders})
       ORDER BY l.name ASC`
    )
    .all(...ids) as Array<{ target_id: string; name: string }>;
  const listsByTarget: Record<string, string[]> = {};
  for (const row of listRows) (listsByTarget[row.target_id] ??= []).push(row.name);

  const campaignRows = db
    .prepare(
      `SELECT rp.target_id, w.name
       FROM run_profiles rp
       JOIN runs r ON r.id = rp.run_id
       JOIN workflows w ON w.id = r.workflow_id
       WHERE rp.target_id IN (${placeholders})
       ORDER BY rp.created_at DESC`
    )
    .all(...ids) as Array<{ target_id: string; name: string | null }>;
  const campaignsByTarget: Record<string, string[]> = {};
  for (const row of campaignRows) {
    if (!row.name) continue;
    const bucket = (campaignsByTarget[row.target_id] ??= []);
    if (!bucket.includes(row.name)) bucket.push(row.name);
  }

  return rows.map((r) => {
    let channel: "linkedin" | "email" | "both" = "linkedin";
    const hasEmail = Boolean(r.email && r.email.trim().length > 0);
    const hasLi = Boolean(r.linkedin_url && r.linkedin_url.trim().length > 0);
    if (hasEmail && hasLi) channel = "both";
    else if (hasEmail) channel = "email";

    let lastInteractionAt: string | null = null;
    let lastInteractionType: PipelineCard["last_interaction_type"] = "none";

    const interactions = [
      { at: r.last_replied_at, type: "reply" as const },
      { at: r.email_replied_at, type: "email_reply" as const },
      { at: r.message_sent_at, type: "message" as const },
      { at: r.connected_at, type: "connected" as const },
    ].filter((i) => Boolean(i.at));

    if (interactions.length > 0) {
      interactions.sort((a, b) => new Date(b.at!).getTime() - new Date(a.at!).getTime());
      lastInteractionAt = interactions[0].at;
      lastInteractionType = interactions[0].type;
    }

    const campaigns = campaignsByTarget[r.id] ?? [];

    return {
      id: r.id,
      full_name: (r.full_name ?? [r.first_name, r.last_name].filter(Boolean).join(" ")) || "Sin nombre",
      first_name: r.first_name,
      last_name: r.last_name,
      title: r.title,
      company: r.company,
      location: r.location,
      profile_image_url: r.profile_image_url,
      linkedin_url: r.linkedin_url,
      email: r.email,
      phone: r.phone,
      degree: r.degree,
      stage_id: r.stage_id,
      stage_updated_at: r.stage_updated_at,
      reply_kind: r.reply_kind,
      sdr_autopilot: r.sdr_autopilot ?? 0,
      sdr_intent: r.sdr_intent,
      sdr_thread_state: r.sdr_thread_state,
      channel,
      last_interaction_at: lastInteractionAt,
      last_interaction_type: lastInteractionType,
      workflow_name: campaigns[0] ?? null,
      workflow_names: campaigns,
      list_names: listsByTarget[r.id] ?? [],
      tags: tagsByTarget[r.id] ?? [],
    };
  });
}
