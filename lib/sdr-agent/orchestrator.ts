import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { recordSdrAuditEvent } from "@/lib/audit";
import { createAppNotification } from "@/lib/notifications/service";
import { cancelSdrJob, completeSdrJob, failSdrJob, renewSdrJobLease, type LeasedSdrJob } from "./jobs";
import { createHumanHandoff, markThreadDoNotContact, resolveHandoffAssignee } from "./handoff";
import { evaluatePostProviderGuardrails } from "./guardrails/post-provider";
import { evaluatePreProviderGuardrails } from "./guardrails/pre-provider";
import { policyDecision, type SdrPolicyResult, type ThreadPolicyContext } from "./guardrails/types";
import { retrieveApprovedKnowledge } from "./knowledge/retrieval";
import { GeminiSdrProvider } from "./providers/gemini";
import {
  SdrProviderError,
  type SdrDecisionOutput,
  type SdrProvider,
  type SdrProviderResult,
} from "./providers/provider";
import { getSdrThread, listSdrMessages, type SdrMessageRecord, type SdrThreadRecord } from "./repository";
import { resolveSdrOperationalStatus, type SdrOperationalStatus } from "./runtime";
import { type SdrAgentRecord, type SdrAgentVersionRecord } from "./seed";
import { hasProviderBudget, recordProviderFailure, recordProviderSuccess } from "./usage";
import { autoAdvanceTargetByTrigger } from "@/lib/pipeline/pipeline-service";
import { applyDecisionTags } from "@/lib/tags/tags-service";

interface TargetContext {
  full_name: string | null;
  first_name: string | null;
  company: string | null;
  title: string | null;
}

interface LoadedExecutionContext {
  thread: SdrThreadRecord;
  message: SdrMessageRecord;
  agent: SdrAgentRecord;
  version: SdrAgentVersionRecord;
  runtime: SdrOperationalStatus;
  target: TargetContext;
  policy: { company_context?: string; handoff_rules?: string };
  config: { custom_instructions?: string };
}

export interface ProcessClassificationDependencies {
  provider?: SdrProvider;
  workerId?: string;
  calendarEnabled?: boolean;
}

export interface ProcessClassificationResult {
  jobId: string;
  threadId: string;
  messageId: string;
  status: "completed" | "retry_scheduled" | "cancelled";
  decisionId?: string;
  actionId?: string;
  handoffId?: string;
  decision?: SdrDecisionOutput;
  policy?: SdrPolicyResult;
  latencyMs?: number;
}

function parseObject<T extends Record<string, unknown>>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...fallback, ...parsed } as T : fallback;
  } catch {
    return fallback;
  }
}

function loadExecutionContext(
  db: Database.Database,
  job: LeasedSdrJob,
): LoadedExecutionContext {
  if (job.job_type !== "classify" || !job.thread_id || !job.message_id) {
    throw new Error(`Unsupported SDR job ${job.id}`);
  }
  const thread = getSdrThread(db, job.thread_id);
  if (!thread) throw new Error(`SDR thread ${job.thread_id} not found`);
  const message = db.prepare(
    "SELECT * FROM sdr_messages WHERE id = ? AND thread_id = ?",
  ).get(job.message_id, thread.id) as SdrMessageRecord | undefined;
  if (!message) throw new Error(`SDR message ${job.message_id} not found`);
  if (!thread.agent_id) throw new Error("SDR thread has no assigned agent");
  const agent = db.prepare(
    "SELECT * FROM sdr_agents WHERE id = ?",
  ).get(thread.agent_id) as SdrAgentRecord | undefined;
  if (!agent) throw new Error(`SDR agent ${thread.agent_id} not found`);
  const versionId = thread.agent_version_id ?? agent.active_version_id;
  if (!versionId) throw new Error("SDR thread has no assigned agent version");
  const version = db.prepare(
    "SELECT * FROM sdr_agent_versions WHERE id = ? AND agent_id = ?",
  ).get(versionId, agent.id) as SdrAgentVersionRecord | undefined;
  if (!version) throw new Error(`SDR agent version ${versionId} not found`);
  const target = db.prepare(
    "SELECT full_name, first_name, company, title FROM targets WHERE id = ?",
  ).get(thread.target_id) as TargetContext | undefined;
  if (!target) throw new Error(`Target ${thread.target_id} not found`);

  return {
    thread,
    message,
    agent,
    version,
    runtime: resolveSdrOperationalStatus(db, agent, version),
    target,
    policy: parseObject(version.policy_json, {}),
    config: parseObject(version.config_json, {}),
  };
}

function threadPolicy(context: LoadedExecutionContext): ThreadPolicyContext {
  return {
    state: context.thread.state,
    automationEnabled: context.thread.automation_enabled === 1,
    controlEpoch: context.thread.control_epoch,
    aiTurnCount: context.thread.ai_turn_count,
    maxAutoTurns: context.agent.max_auto_turns,
    confidenceThreshold: context.agent.confidence_threshold,
    effectiveMode: context.runtime.effectiveMode,
  };
}

export function deterministicDecision(policy: SdrPolicyResult): SdrDecisionOutput {
  return {
    intent: policy.forcedIntent ?? "ambiguous",
    confidence: 1,
    risk_level: policy.outcome === "stop" ? "medium" : "high",
    language: "es",
    reasoning_summary: `Política determinista: ${policy.reasons.join(", ") || policy.outcome}.`,
    recommended_action: policy.forcedAction ?? (policy.outcome === "stop" ? "stop_outreach" : "handoff"),
    requires_human: policy.requiresHuman,
    reason_code: policy.reasons[0] ?? policy.outcome,
    reply_draft: null,
    knowledge_status: "missing",
    knowledge_citations: [],
    missing_information: policy.outcome === "handoff" ? ["Se requiere intervención humana."] : [],
  };
}

function insertDecision(
  db: Database.Database,
  input: {
    context: LoadedExecutionContext;
    job: LeasedSdrJob;
    decision: SdrDecisionOutput;
    provider: string;
    model: string;
    knowledgeRevision: string;
    policy: SdrPolicyResult;
    latencyMs: number;
    usage?: SdrProviderResult["usage"];
  },
): { id: string; duplicate: boolean } {
  const existing = db.prepare(
    "SELECT id FROM sdr_decisions WHERE job_id = ?",
  ).get(input.job.id) as { id: string } | undefined;
  if (existing) return { id: existing.id, duplicate: true };
  const id = randomUUID();
  db.prepare(`
    INSERT INTO sdr_decisions (
      id, workspace_owner_id, job_id, thread_id, message_id, agent_version_id,
      intent, confidence, risk_level, language, recommended_action,
      requires_human, reason_code, reply_draft, citations_json, decision_json,
      provider, model, input_tokens, output_tokens, latency_ms,
      knowledge_status, knowledge_revision, missing_information_json,
      policy_outcome, policy_reasons_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.context.thread.workspace_owner_id,
    input.job.id,
    input.context.thread.id,
    input.context.message.id,
    input.context.version.id,
    input.decision.intent,
    input.decision.confidence,
    input.decision.risk_level,
    input.decision.language,
    input.decision.recommended_action,
    input.decision.requires_human ? 1 : 0,
    input.decision.reason_code ?? null,
    input.decision.reply_draft ?? null,
    JSON.stringify(input.decision.knowledge_citations),
    JSON.stringify(input.decision),
    input.provider,
    input.model,
    input.usage?.inputTokens ?? null,
    input.usage?.outputTokens ?? null,
    input.latencyMs,
    input.decision.knowledge_status,
    input.knowledgeRevision,
    JSON.stringify(input.decision.missing_information),
    input.policy.outcome,
    JSON.stringify(input.policy.reasons),
  );
  return { id, duplicate: false };
}

function createDecisionAction(
  db: Database.Database,
  input: {
    context: LoadedExecutionContext;
    decisionId: string;
    decision: SdrDecisionOutput;
    policy: SdrPolicyResult;
  },
): string | null {
  if (!input.decision.reply_draft || !["allow", "require_approval"].includes(input.policy.outcome)) return null;
  const idempotencyKey = `reply:${input.context.message.id}:${input.context.version.id}`;
  const existing = db.prepare(
    "SELECT id FROM sdr_actions WHERE idempotency_key = ?",
  ).get(idempotencyKey) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  const requiresApproval = input.context.runtime.effectiveMode !== "auto" || !input.context.runtime.outboundEnabled;
  const state = input.context.runtime.effectiveMode === "shadow"
    ? "proposed"
    : requiresApproval
      ? "waiting_approval"
      : "approved";
  db.prepare(`
    INSERT INTO sdr_actions (
      id, workspace_owner_id, decision_id, thread_id, message_id,
      action_type, state, idempotency_key, requires_approval,
      control_epoch, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.context.thread.workspace_owner_id,
    input.decisionId,
    input.context.thread.id,
    input.context.message.id,
    input.decision.recommended_action,
    state,
    idempotencyKey,
    requiresApproval ? 1 : 0,
    input.context.thread.control_epoch,
    JSON.stringify({ body: input.decision.reply_draft, language: input.decision.language }),
  );

  if (state === "waiting_approval" && input.context.thread.workspace_owner_id) {
    const assignee = resolveHandoffAssignee(db, input.context.thread.id);
    createAppNotification(db, {
      workspaceOwnerId: input.context.thread.workspace_owner_id,
      userId: assignee.userId,
      notificationType: "sdr_approval",
      priority: "normal",
      title: "Respuesta SDR pendiente de aprobación",
      body: `${input.context.target.full_name || "Lead"}: revisa el borrador antes de enviarlo.`,
      href: `/inbox?thread=${encodeURIComponent(input.context.thread.id)}&message=${encodeURIComponent(input.context.message.id)}`,
      entityType: "sdr_action",
      entityId: id,
      threadId: input.context.thread.id,
      messageId: input.context.message.id,
      idempotencyKey: `notification:approval:${id}`,
      queueWebPush: false,
    });
  }
  return id;
}

function finishDecision(
  db: Database.Database,
  input: {
    job: LeasedSdrJob;
    context: LoadedExecutionContext;
    decision: SdrDecisionOutput;
    policy: SdrPolicyResult;
    provider: string;
    model: string;
    knowledgeRevision?: string;
    latencyMs: number;
    providerResult?: SdrProviderResult;
  },
): ProcessClassificationResult {
  return db.transaction(() => {
    const current = getSdrThread(db, input.context.thread.id);
    if (!current || current.control_epoch !== input.job.control_epoch || current.state !== input.context.thread.state) {
      cancelSdrJob(db, input.job.id, input.job.lease_token);
      return {
        jobId: input.job.id,
        threadId: input.context.thread.id,
        messageId: input.context.message.id,
        status: "cancelled" as const,
      };
    }

    const persisted = insertDecision(db, {
      context: input.context,
      job: input.job,
      decision: input.decision,
      provider: input.provider,
      model: input.model,
      knowledgeRevision: input.knowledgeRevision ?? "",
      policy: input.policy,
      latencyMs: input.latencyMs,
      usage: input.providerResult?.usage,
    });

    // Auto-advance target in CRM pipeline based on SDR AI intent
    try {
      const intent = input.decision.intent;
      if (intent === "interested" || intent === "pricing_question" || intent === "proposal_request") {
        autoAdvanceTargetByTrigger(db, input.context.thread.target_id, "sdr_interested");
      } else if (intent === "meeting_request") {
        autoAdvanceTargetByTrigger(db, input.context.thread.target_id, "sdr_meeting");
      } else if (intent === "not_interested" || intent === "unsubscribe") {
        autoAdvanceTargetByTrigger(db, input.context.thread.target_id, "sdr_not_interested");
      } else {
        autoAdvanceTargetByTrigger(db, input.context.thread.target_id, "replied");
      }
    } catch {
      // Non-blocking pipeline trigger
    }

    // Persist the AI-emitted conversation labels. Each tag that maps to a stage
    // advances the lead through the funnel (no-regression rules included).
    try {
      const tags = input.decision.tags ?? [];
      if (tags.length > 0) {
        applyDecisionTags(db, input.context.thread.target_id, tags, {
          confidence: input.decision.confidence,
          decisionId: persisted.id,
          threadId: input.context.thread.id,
          reasoning: input.decision.tag_reasoning ?? null,
        });
      }
    } catch {
      // Non-blocking tag persistence
    }

    let handoffId: string | undefined;
    let actionId: string | undefined;

    if (input.policy.outcome === "stop") {
      markThreadDoNotContact(db, {
        threadId: input.context.thread.id,
        messageId: input.context.message.id,
        reason: input.policy.reasons[0] ?? "stop_outreach",
      });
    } else if (input.policy.outcome === "handoff") {
      const handoff = createHumanHandoff(db, {
        threadId: input.context.thread.id,
        messageId: input.context.message.id,
        decisionId: persisted.id,
        reasonCodes: input.policy.reasons,
        summary: `${input.policy.reasons.join(", ")}. Mensaje: ${input.context.message.body.slice(0, 500)}`,
        recommendedReply: null,
        priority: input.decision.risk_level === "high" ? "critical" : "urgent",
      });
      handoffId = handoff.handoffId;
    } else {
      actionId = createDecisionAction(db, {
        context: input.context,
        decisionId: persisted.id,
        decision: input.decision,
        policy: input.policy,
      }) ?? undefined;
      db.prepare(`
        UPDATE sdr_threads
        SET latest_processed_message_id = ?, agent_id = ?, agent_version_id = ?,
          language = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        input.context.message.id,
        input.context.agent.id,
        input.context.version.id,
        input.decision.language,
        input.context.thread.id,
      );
    }

    if (input.providerResult && input.context.thread.workspace_owner_id && !persisted.duplicate) {
      recordProviderSuccess(db, {
        workspaceOwnerId: input.context.thread.workspace_owner_id,
        agentId: input.context.agent.id,
        decisionId: persisted.id,
        result: input.providerResult,
      });
    }

    const completed = completeSdrJob(db, input.job.id, input.job.lease_token);
    if (!completed && input.policy.outcome !== "stop" && input.policy.outcome !== "handoff") {
      throw new Error(`Lost lease while completing SDR job ${input.job.id}`);
    }
    recordSdrAuditEvent(db, {
      workspaceOwnerId: input.context.thread.workspace_owner_id,
      actorType: "worker",
      entityType: "decision",
      entityId: persisted.id,
      eventType: "decision_completed",
      threadId: input.context.thread.id,
      actionId: actionId ?? null,
      handoffId: handoffId ?? null,
      correlationId: input.context.message.id,
      idempotencyKey: `audit:decision:${persisted.id}`,
      payload: { policyOutcome: input.policy.outcome, policyReasons: input.policy.reasons },
    });

    return {
      jobId: input.job.id,
      threadId: input.context.thread.id,
      messageId: input.context.message.id,
      status: "completed" as const,
      decisionId: persisted.id,
      actionId,
      handoffId,
      decision: input.decision,
      policy: input.policy,
      latencyMs: input.latencyMs,
    };
  })();
}

async function callProviderWithLease(
  db: Database.Database,
  job: LeasedSdrJob,
  provider: SdrProvider,
  input: Parameters<SdrProvider["classifyAndDraft"]>[0],
): Promise<SdrProviderResult> {
  const renew = () => {
    if (!renewSdrJobLease(db, job.id, job.lease_token, 300_000)) {
      throw new Error(`Lost lease for SDR job ${job.id}`);
    }
  };
  renew();
  const timer = setInterval(() => {
    try { renew(); } catch { /* post-call epoch/lease checks fail closed */ }
  }, 30_000);
  timer.unref?.();
  try {
    return await provider.classifyAndDraft(input);
  } finally {
    clearInterval(timer);
  }
}

export async function processLeasedClassificationJob(
  db: Database.Database,
  job: LeasedSdrJob,
  dependencies: ProcessClassificationDependencies = {},
): Promise<ProcessClassificationResult> {
  const startedAt = Date.now();
  const context = loadExecutionContext(db, job);
  const policyContext = threadPolicy(context);
  const calendarEnabled = dependencies.calendarEnabled ?? context.runtime.calendarEnabled;
  const prePolicy = evaluatePreProviderGuardrails({
    message: context.message.body,
    thread: policyContext,
    calendarEnabled,
  });

  if (["stop", "handoff", "block"].includes(prePolicy.outcome)) {
    if (prePolicy.outcome === "block") {
      cancelSdrJob(db, job.id, job.lease_token);
      return {
        jobId: job.id,
        threadId: context.thread.id,
        messageId: context.message.id,
        status: "cancelled",
        policy: prePolicy,
      };
    }
    const decision = deterministicDecision(prePolicy);
    return finishDecision(db, {
      job,
      context,
      decision,
      policy: prePolicy,
      provider: "policy",
      model: "deterministic-guardrails-v1",
      latencyMs: Date.now() - startedAt,
    });
  }

  const workspaceOwnerId = context.thread.workspace_owner_id;
  if (!workspaceOwnerId) throw new Error("SDR thread has no workspace owner");
  const knowledge = retrieveApprovedKnowledge(db, {
    workspaceOwnerId,
    agentId: context.agent.id,
    query: context.message.body,
  });
  if (knowledge.chunks.length === 0) {
    const missingPolicy: SdrPolicyResult = {
      outcome: "handoff",
      reasons: ["missing_approved_knowledge"],
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
    return finishDecision(db, {
      job,
      context,
      decision: deterministicDecision(missingPolicy),
      policy: missingPolicy,
      provider: "policy",
      model: "knowledge-gate-v1",
      knowledgeRevision: knowledge.revision,
      latencyMs: Date.now() - startedAt,
    });
  }

  if (!hasProviderBudget(db, workspaceOwnerId, context.agent.id, context.agent.daily_budget_usd)) {
    const budgetPolicy: SdrPolicyResult = {
      outcome: "handoff",
      reasons: ["provider_budget_exhausted"],
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
    return finishDecision(db, {
      job,
      context,
      decision: deterministicDecision(budgetPolicy),
      policy: budgetPolicy,
      provider: "policy",
      model: "budget-gate-v1",
      knowledgeRevision: knowledge.revision,
      latencyMs: Date.now() - startedAt,
    });
  }

  if (!dependencies.provider && !context.runtime.providerEnabled) {
    const providerBlocker = context.runtime.blockers.find((blocker) => blocker.startsWith("provider_") || blocker.includes("version"))
      ?? "provider_unavailable";
    const unavailablePolicy: SdrPolicyResult = {
      outcome: "handoff",
      reasons: [providerBlocker],
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
    return finishDecision(db, {
      job,
      context,
      decision: deterministicDecision(unavailablePolicy),
      policy: unavailablePolicy,
      provider: "policy",
      model: "provider-gate-v1",
      knowledgeRevision: knowledge.revision,
      latencyMs: Date.now() - startedAt,
    });
  }

  let provider: SdrProvider;
  try {
    provider = dependencies.provider ?? new GeminiSdrProvider({ modelName: context.version.model ?? context.agent.model ?? undefined });
  } catch (error) {
    const reason = error instanceof SdrProviderError ? error.code : "provider_unavailable";
    const unavailablePolicy: SdrPolicyResult = {
      outcome: "handoff",
      reasons: [reason],
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
    return finishDecision(db, {
      job,
      context,
      decision: deterministicDecision(unavailablePolicy),
      policy: unavailablePolicy,
      provider: "gemini",
      model: context.version.model ?? context.agent.model ?? "unknown",
      knowledgeRevision: knowledge.revision,
      latencyMs: Date.now() - startedAt,
    });
  }

  let providerResult: SdrProviderResult;
  try {
    const history = listSdrMessages(db, context.thread.id)
      .filter((message) => message.id !== context.message.id)
      .slice(-20)
      .map((message) => ({ direction: message.direction, body: message.body.slice(0, 5_000), sentAt: message.sent_at }));
    providerResult = await callProviderWithLease(db, job, provider, {
      inboundMessage: context.message.body,
      senderName: context.target.full_name ?? context.target.first_name ?? "Prospecto",
      conversationHistory: history,
      systemPrompt: context.version.system_prompt,
      companyContext: context.policy.company_context,
      customInstructions: context.config.custom_instructions,
      handoffRules: context.policy.handoff_rules,
      knowledgeChunks: knowledge.chunks,
    });
  } catch (error) {
    const providerError = error instanceof SdrProviderError
      ? error
      : new SdrProviderError("Provider call failed", "unknown", false, { cause: error });
    recordProviderFailure(db, {
      workspaceOwnerId,
      agentId: context.agent.id,
      provider: provider.providerName,
      model: provider.modelName,
      errorCode: providerError.code,
    });
    if (providerError.retryable && job.attempts < job.max_attempts) {
      failSdrJob(db, job.id, {
        leaseToken: job.lease_token,
        error: providerError.code,
        retryDelayMs: Math.min(60_000, 2_000 * 2 ** Math.max(0, job.attempts - 1)),
      });
      return {
        jobId: job.id,
        threadId: context.thread.id,
        messageId: context.message.id,
        status: "retry_scheduled",
      };
    }
    const unavailablePolicy: SdrPolicyResult = {
      outcome: "handoff",
      reasons: [`provider_${providerError.code}`],
      forcedAction: "handoff",
      requiresHuman: true,
      replyDraft: null,
    };
    return finishDecision(db, {
      job,
      context,
      decision: deterministicDecision(unavailablePolicy),
      policy: unavailablePolicy,
      provider: provider.providerName,
      model: provider.modelName,
      knowledgeRevision: knowledge.revision,
      latencyMs: Date.now() - startedAt,
    });
  }

  const latestThread = getSdrThread(db, context.thread.id);
  if (!latestThread || latestThread.control_epoch !== job.control_epoch || latestThread.state !== context.thread.state) {
    cancelSdrJob(db, job.id, job.lease_token);
    return {
      jobId: job.id,
      threadId: context.thread.id,
      messageId: context.message.id,
      status: "cancelled",
    };
  }
  const postPolicy = evaluatePostProviderGuardrails({
    decision: providerResult.decision,
    thread: { ...policyContext, state: latestThread.state, controlEpoch: latestThread.control_epoch },
    knowledgeChunks: knowledge.chunks,
    availableCitationIds: knowledge.availableCitationIds,
    calendarEnabled,
  });
  const decision = policyDecision(providerResult.decision, postPolicy);
  return finishDecision(db, {
    job,
    context: { ...context, thread: latestThread },
    decision,
    policy: postPolicy,
    provider: providerResult.provider,
    model: providerResult.model,
    knowledgeRevision: knowledge.revision,
    latencyMs: Date.now() - startedAt,
    providerResult,
  });
}
