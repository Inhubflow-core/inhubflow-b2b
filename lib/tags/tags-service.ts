import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { autoAdvanceTargetByTrigger, moveTargetToStage } from "@/lib/pipeline/pipeline-service";
import {
  getTargetTags as getTargetTagsFromRepo,
  getTagsForTargets as getTagsForTargetsFromRepo,
  listTags as listTagsFromRepo,
  resolveTagBySlug as resolveFromRepo,
  type CardTag,
  type Tag,
} from "@/lib/tags/tags-repository";

export type { Tag, CardTag } from "@/lib/tags/tags-repository";

export interface ApplyTagContext {
  source: "ai" | "manual" | "rule";
  confidence?: number | null;
  appliedBy?: string | null;
  reason?: string | null;
  runId?: string | null;
  threadId?: string | null;
  decisionId?: string | null;
}

export function listTags(db: Database.Database, workspaceOwnerId?: string | null): Tag[] {
  return listTagsFromRepo(db, workspaceOwnerId);
}

/**
 * Resolve a tag by slug for a workspace. Global tags (workspace_owner_id NULL)
 * are visible to everyone; custom tags are scoped to their owner.
 */
export function resolveTagBySlug(
  db: Database.Database,
  slug: string,
  workspaceOwnerId?: string | null
): Tag | undefined {
  return resolveFromRepo(db, slug, workspaceOwnerId);
}

/**
 * Apply a tag to a target. If the tag carries `stage_id`, the lead advances to
 * that funnel stage — through the existing no-regression rules when the tag maps
 * to a system trigger, or a forward-only move otherwise.
 */
export function applyTag(
  db: Database.Database,
  targetId: string,
  slug: string,
  ctx: ApplyTagContext
): { applied: boolean; tag: Tag | null; advanced: boolean } {
  const tag = resolveTagBySlug(db, slug);
  if (!tag) return { applied: false, tag: null, advanced: false };

  const exists = db.prepare("SELECT 1 FROM targets WHERE id = ?").get(targetId);
  if (!exists) return { applied: false, tag, advanced: false };

  let advanced = false;

  db.transaction(() => {
    const alreadyApplied = Boolean(
      db.prepare("SELECT 1 FROM target_tags WHERE target_id = ? AND tag_id = ?").get(targetId, tag.id)
    );

    db.prepare(
      `INSERT INTO target_tags (target_id, tag_id, source, confidence, applied_by, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(target_id, tag_id) DO UPDATE SET
         source = excluded.source,
         confidence = COALESCE(excluded.confidence, target_tags.confidence),
         applied_by = excluded.applied_by`
    ).run(targetId, tag.id, ctx.source, ctx.confidence ?? null, ctx.appliedBy ?? ctx.source);

    // Audit only when the tag is genuinely new or being re-applied after removal.
    if (!alreadyApplied) {
      db.prepare(
        `INSERT INTO tag_events (id, target_id, tag_id, action, source, reason, run_id, thread_id, decision_id, created_at)
         VALUES (?, ?, ?, 'added', ?, ?, ?, ?, ?, datetime('now'))`
      ).run(
        randomUUID(),
        targetId,
        tag.id,
        ctx.source,
        ctx.reason ?? null,
        ctx.runId ?? null,
        ctx.threadId ?? null,
        ctx.decisionId ?? null
      );
    }

    if (tag.stage_id) {
      advanced = advanceByTag(db, targetId, tag);
    }
  })();

  return { applied: true, tag, advanced };
}

/**
 * Move the lead to the tag's stage without ever regressing the funnel.
 */
function advanceByTag(db: Database.Database, targetId: string, tag: Tag): boolean {
  const stage = db
    .prepare("SELECT id, name, order_index, trigger_key FROM pipeline_stages WHERE id = ?")
    .get(tag.stage_id) as
    | { id: string; name: string; order_index: number; trigger_key: string | null }
    | undefined;
  if (!stage) return false;

  // System stages keep their well-tested semantics (not_interested override,
  // won never downgraded, meeting not downgraded).
  if (stage.trigger_key) {
    return autoAdvanceTargetByTrigger(db, targetId, stage.trigger_key);
  }

  const current = db
    .prepare(
      `SELECT t.stage_id, ps.order_index
       FROM targets t LEFT JOIN pipeline_stages ps ON ps.id = t.stage_id
       WHERE t.id = ?`
    )
    .get(targetId) as { stage_id: string | null; order_index: number | null } | undefined;
  if (!current) return false;
  if (current.stage_id === stage.id) return false;
  if (current.order_index !== null && stage.order_index <= current.order_index) return false;

  return moveTargetToStage(
    db,
    targetId,
    stage.id,
    `Etapa actualizada automáticamente a: ${stage.name} (etiqueta: ${tag.name})`
  );
}

export function removeTag(
  db: Database.Database,
  targetId: string,
  slug: string,
  ctx: ApplyTagContext
): boolean {
  const tag = resolveTagBySlug(db, slug);
  if (!tag) return false;

  return db.transaction(() => {
    const res = db
      .prepare("DELETE FROM target_tags WHERE target_id = ? AND tag_id = ?")
      .run(targetId, tag.id);
    if (res.changes === 0) return false;

    db.prepare(
      `INSERT INTO tag_events (id, target_id, tag_id, action, source, reason, run_id, thread_id, decision_id, created_at)
       VALUES (?, ?, ?, 'removed', ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      randomUUID(),
      targetId,
      tag.id,
      ctx.source,
      ctx.reason ?? null,
      ctx.runId ?? null,
      ctx.threadId ?? null,
      ctx.decisionId ?? null
    );
    return true;
  })();
}

export function getTargetTags(db: Database.Database, targetId: string): Tag[] {
  return getTargetTagsFromRepo(db, targetId);
}

export function getTagsForTargets(
  db: Database.Database,
  targetIds: string[]
): Record<string, CardTag[]> {
  return getTagsForTargetsFromRepo(db, targetIds);
}

/**
 * Persist the AI-emitted tags for a decision and advance the funnel accordingly.
 * Unknown slugs are ignored — the model must never be able to break the pipeline.
 */
export function applyDecisionTags(
  db: Database.Database,
  targetId: string,
  slugs: string[] | null | undefined,
  ctx: { confidence?: number; decisionId?: string; threadId?: string; reasoning?: string | null }
): string[] {
  if (!slugs || slugs.length === 0) return [];

  const applied: string[] = [];
  // `not_interested` wins over everything else, so it is applied last.
  const ordered = [...new Set(slugs)].sort((a, b) =>
    a === "not_interested" ? 1 : b === "not_interested" ? -1 : 0
  );

  for (const slug of ordered) {
    const res = applyTag(db, targetId, String(slug).trim(), {
      source: "ai",
      confidence: ctx.confidence ?? null,
      appliedBy: "sdr",
      reason: ctx.reasoning ?? null,
      threadId: ctx.threadId ?? null,
      decisionId: ctx.decisionId ?? null,
    });
    if (res.applied) applied.push(slug);
  }
  return applied;
}
