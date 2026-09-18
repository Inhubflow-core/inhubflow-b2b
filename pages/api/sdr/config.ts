import crypto from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor, canManageSdrAgent } from "@/lib/authz";
import { ensureSdrAgent } from "@/lib/sdr-agent/seed";
import { SdrModeSchema } from "@/lib/sdr-agent/contracts";
import { resolveSdrOperationalStatus } from "@/lib/sdr-agent/runtime";

interface ConfigBody {
  name?: unknown;
  mode?: unknown;
  model?: unknown;
  default_language?: unknown;
  confidence_threshold?: unknown;
  max_auto_turns?: unknown;
  handoff_email?: unknown;
  system_prompt?: unknown;
  company_context?: unknown;
  custom_instructions?: unknown;
  handoff_rules?: unknown;
  runtime_enabled?: unknown;
  provider_enabled?: unknown;
  outbound_enabled?: unknown;
  auto_publish?: unknown;
}

function jsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseOptionalString(value: unknown, field: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) throw new Error(`${field} is invalid`);
  return value.trim();
}

function loadStats(db: ReturnType<typeof getDb>, workspaceOwnerId: string) {
  const scalar = (sql: string, params: string[] = []) =>
    (db.prepare(sql).get(...params) as { count: number }).count;
  return {
    totalDecisions: scalar("SELECT COUNT(*) AS count FROM sdr_decisions WHERE workspace_owner_id = ?", [workspaceOwnerId]),
    totalHandoffs: scalar("SELECT COUNT(*) AS count FROM sdr_handoffs WHERE workspace_owner_id = ?", [workspaceOwnerId]),
    openHandoffs: scalar("SELECT COUNT(*) AS count FROM sdr_handoffs WHERE workspace_owner_id = ? AND state IN ('open', 'acknowledged')", [workspaceOwnerId]),
    unreadNotifications: scalar("SELECT COUNT(*) AS count FROM app_notifications WHERE workspace_owner_id = ? AND state = 'unread'", [workspaceOwnerId]),
    totalThreads: scalar("SELECT COUNT(*) AS count FROM sdr_threads WHERE workspace_owner_id = ?", [workspaceOwnerId]),
    activeThreads: scalar("SELECT COUNT(*) AS count FROM sdr_threads WHERE workspace_owner_id = ? AND state = 'AI_ACTIVE'", [workspaceOwnerId]),
    queueDepth: scalar("SELECT COUNT(*) AS count FROM sdr_jobs WHERE workspace_owner_id = ? AND state IN ('queued', 'leased', 'waiting')", [workspaceOwnerId]),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const db = getDb();
  const { agent, activeVersion } = ensureSdrAgent(db, actor.workspaceOwnerId);
  if (!canManageSdrAgent(db, actor, agent.id)) {
    return res.status(403).json({ error: "No autorizado para gestionar el Asistente SDR" });
  }

  if (req.method === "GET") {
    const policy = jsonObject(activeVersion?.policy_json);
    const config = jsonObject(activeVersion?.config_json);
    const recentDecisions = db.prepare(`
      SELECT d.id, d.intent, d.confidence, d.risk_level, d.language,
        d.recommended_action, d.requires_human, d.reason_code, d.reply_draft,
        d.model, d.provider, d.latency_ms, d.policy_outcome, d.knowledge_status,
        d.created_at, t.full_name AS target_name, t.company AS target_company
      FROM sdr_decisions d
      JOIN sdr_threads th ON th.id = d.thread_id
      LEFT JOIN targets t ON t.id = th.target_id
      WHERE d.workspace_owner_id = ?
      ORDER BY d.created_at DESC LIMIT 20
    `).all(actor.workspaceOwnerId);
    return res.status(200).json({
      agent,
      activeVersion: activeVersion ? {
        id: activeVersion.id,
        version_number: activeVersion.version_number,
        model: activeVersion.model,
        system_prompt: activeVersion.system_prompt,
        policy,
        config,
        publication_state: activeVersion.publication_state,
      } : null,
      runtime: resolveSdrOperationalStatus(db, agent, activeVersion),
      stats: loadStats(db, actor.workspaceOwnerId),
      recentDecisions,
    });
  }

  if (req.method !== "POST" && req.method !== "PUT") {
    res.setHeader("Allow", ["GET", "POST", "PUT"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = (req.body ?? {}) as ConfigBody;
    const mode = body.mode === undefined ? undefined : SdrModeSchema.parse(body.mode);
    const model = parseOptionalString(body.model, "model", 120);
    const name = parseOptionalString(body.name, "name", 200);
    const defaultLanguage = body.default_language === undefined ? undefined : body.default_language;
    if (defaultLanguage !== undefined && !["en", "es", "pt-BR"].includes(String(defaultLanguage))) throw new Error("default_language is invalid");
    const threshold = body.confidence_threshold === undefined ? undefined : Number(body.confidence_threshold);
    if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) throw new Error("confidence_threshold must be between 0 and 1");
    const turns = body.max_auto_turns === undefined ? undefined : Number(body.max_auto_turns);
    if (turns !== undefined && (!Number.isInteger(turns) || turns < 0 || turns > 20)) throw new Error("max_auto_turns must be an integer between 0 and 20");
    const handoffEmail = parseOptionalString(body.handoff_email, "handoff_email", 320);
    const systemPrompt = parseOptionalString(body.system_prompt, "system_prompt", 20_000);
    const companyContext = parseOptionalString(body.company_context, "company_context", 20_000);
    const customInstructions = parseOptionalString(body.custom_instructions, "custom_instructions", 10_000);
    const handoffRules = parseOptionalString(body.handoff_rules, "handoff_rules", 10_000);
    
    // Operational toggles
    const runtimeEnabled = body.runtime_enabled === undefined ? undefined : (body.runtime_enabled ? 1 : 0);
    const providerEnabled = body.provider_enabled === undefined ? undefined : (body.provider_enabled ? 1 : 0);
    const outboundEnabled = body.outbound_enabled === undefined ? undefined : (body.outbound_enabled ? 1 : 0);
    const autoPublish = body.auto_publish !== false;

    if (mode === "auto") {
      const autoGates = [
        "shadow_evaluated",
        "approval_canary_passed",
        "takeover_race_passed",
        "kill_switch_drill_passed",
      ];
      const unpassed = autoGates.filter((gate) => {
        const row = db.prepare("SELECT passed FROM sdr_promotion_gates WHERE agent_id = ? AND capability = 'auto' AND gate_key = ?").get(agent.id, gate) as { passed?: number } | undefined;
        return row?.passed !== 1;
      });
      if (unpassed.length > 0) {
        return res.status(409).json({ error: `El modo automático requiere completar los gates de promoción (${unpassed.join(", ")}).` });
      }
    }

    db.transaction(() => {
      db.prepare(`
        UPDATE sdr_agents SET
          name = COALESCE(?, name),
          mode = COALESCE(?, mode),
          model = COALESCE(?, model),
          default_language = COALESCE(?, default_language),
          confidence_threshold = COALESCE(?, confidence_threshold),
          max_auto_turns = COALESCE(?, max_auto_turns),
          handoff_email = ?,
          runtime_enabled = COALESCE(?, runtime_enabled),
          provider_enabled = COALESCE(?, provider_enabled),
          outbound_enabled = COALESCE(?, outbound_enabled),
          status = 'active',
          config_revision = config_revision + 1,
          updated_at = datetime('now')
        WHERE id = ? AND workspace_owner_id = ?
      `).run(
        name,
        mode,
        model,
        defaultLanguage,
        threshold,
        turns,
        handoffEmail,
        runtimeEnabled,
        providerEnabled,
        outboundEnabled,
        agent.id,
        actor.workspaceOwnerId,
      );

      const currentPolicy = jsonObject(activeVersion?.policy_json);
      const currentConfig = jsonObject(activeVersion?.config_json);
      const nextPolicy = {
        ...currentPolicy,
        ...(companyContext !== undefined ? { company_context: companyContext } : {}),
        ...(handoffRules !== undefined ? { handoff_rules: handoffRules } : {}),
      };
      const nextConfig = {
        ...currentConfig,
        ...(customInstructions !== undefined ? { custom_instructions: customInstructions } : {}),
      };

      if (systemPrompt !== undefined || companyContext !== undefined || customInstructions !== undefined || handoffRules !== undefined || model !== undefined) {
        const effectivePrompt = systemPrompt ?? activeVersion?.system_prompt ?? "";
        const effectiveModel = model ?? activeVersion?.model ?? agent.model ?? "gemini-3.7-flash";
        const approvedKnowledge = (db.prepare(`
          SELECT COUNT(*) AS count FROM sdr_knowledge_sources
          WHERE agent_id = ? AND workspace_owner_id = ? AND status = 'approved'
            AND content IS NOT NULL AND length(trim(content)) > 0
        `).get(agent.id, actor.workspaceOwnerId) as { count: number }).count;

        // Auto-publish if system prompt is valid and approved knowledge exists, preventing provider shutdown (A1 fix)
        const willPublish = autoPublish && approvedKnowledge > 0 && effectivePrompt.trim().length > 0;
        const versionId = crypto.randomUUID();
        const nextVersion = ((db.prepare("SELECT COALESCE(MAX(version_number), 0) AS count FROM sdr_agent_versions WHERE agent_id = ?").get(agent.id) as { count: number }).count) + 1;
        const revisionHash = willPublish
          ? crypto.createHash("sha256").update(JSON.stringify({ model: effectiveModel, prompt: effectivePrompt, policy: nextPolicy, config: nextConfig, approvedKnowledge }), "utf8").digest("hex")
          : null;

        db.prepare(`
          INSERT INTO sdr_agent_versions (
            id, agent_id, version_number, model, system_prompt, policy_json,
            config_json, publication_state, revision_hash, published_by_user_id, published_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          versionId,
          agent.id,
          nextVersion,
          effectiveModel,
          effectivePrompt,
          JSON.stringify(nextPolicy),
          JSON.stringify(nextConfig),
          willPublish ? "published" : "draft",
          revisionHash,
          actor.id,
        );

        db.prepare("UPDATE sdr_agents SET active_version_id = ?, updated_at = datetime('now') WHERE id = ?").run(versionId, agent.id);
      }

      db.prepare(`
        INSERT INTO sdr_audit_events (
          id, workspace_owner_id, actor_type, actor_user_id, entity_type,
          entity_id, event_type, payload_json
        ) VALUES (?, ?, 'user', ?, 'agent', ?, 'configuration_updated', ?)
      `).run(crypto.randomUUID(), actor.workspaceOwnerId, actor.id, agent.id, JSON.stringify({ mode, model, runtimeEnabled, providerEnabled, outboundEnabled }));
    })();

    return res.status(200).json({ ok: true, message: "Configuración guardada y sincronizada correctamente" });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid SDR configuration" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "100kb" } } };
