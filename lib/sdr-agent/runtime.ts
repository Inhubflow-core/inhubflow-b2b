import type Database from "better-sqlite3";
import type { SdrAgentRecord, SdrAgentVersionRecord } from "./seed";
import type { SdrMode } from "./contracts";

const MODE_RANK: Record<SdrMode, number> = {
  off: 0,
  shadow: 1,
  approval: 2,
  auto: 3,
};

function envEnabled(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function lowerMode(requested: SdrMode, maximum: SdrMode): SdrMode {
  return MODE_RANK[requested] <= MODE_RANK[maximum] ? requested : maximum;
}

function configuredModeCap(): SdrMode | null {
  const value = process.env.SDR_AGENT_MODE?.trim().toLowerCase();
  return value === "off" || value === "shadow" || value === "approval" || value === "auto"
    ? value
    : null;
}

function gatePassed(
  db: Database.Database,
  agentId: string,
  capability: string,
  gateKey: string,
): boolean {
  const row = db.prepare(`
    SELECT passed FROM sdr_promotion_gates
    WHERE agent_id = ? AND capability = ? AND gate_key = ?
  `).get(agentId, capability, gateKey) as { passed: number } | undefined;
  return row?.passed === 1;
}

export function circuitClosed(
  db: Database.Database,
  workspaceOwnerId: string | null,
  agentId: string,
  capability: string,
): boolean {
  const row = db.prepare(`
    SELECT state, retry_after FROM sdr_circuit_breakers
    WHERE workspace_owner_id IS ? AND agent_id = ? AND capability = ?
  `).get(workspaceOwnerId, agentId, capability) as
    | { state: "closed" | "open" | "half_open"; retry_after: string | null }
    | undefined;
  if (!row || row.state === "closed") return true;
  if (row.state === "open" && row.retry_after && Date.parse(row.retry_after) <= Date.now()) return true;
  return false;
}

export interface SdrOperationalStatus {
  available: boolean;
  requestedMode: SdrMode;
  effectiveMode: SdrMode;
  inboundEnabled: boolean;
  providerEnabled: boolean;
  outboundEnabled: boolean;
  linkedinOutboundEnabled: boolean;
  emailOutboundEnabled: boolean;
  calendarEnabled: boolean;
  reason: "ready" | "disabled" | "module_unavailable" | "invalid_configuration";
  blockers: string[];
  agentId: string;
  workspaceOwnerId: string | null;
  activeVersionId: string | null;
}

export function resolveSdrOperationalStatus(
  db: Database.Database,
  agent: SdrAgentRecord,
  activeVersion: SdrAgentVersionRecord | null,
  options?: { accountId?: string },
): SdrOperationalStatus {
  const blockers: string[] = [];
  const runtimeMaster = envEnabled("SDR_RUNTIME_ENABLED");
  const providerMaster = envEnabled("SDR_PROVIDER_ENABLED");
  const outboundMaster = envEnabled("SDR_OUTBOUND_ENABLED");
  const linkedinOutboundMaster = envEnabled("SDR_LINKEDIN_OUTBOUND_ENABLED");
  const emailOutboundMaster = envEnabled("SDR_EMAIL_OUTBOUND_ENABLED");
  const requestedMode = agent.mode;
  let effectiveMode: SdrMode = requestedMode;

  if (requestedMode === "off") blockers.push("agent_mode_off");
  if (!runtimeMaster) blockers.push("runtime_master_disabled");
  if (agent.runtime_enabled !== 1) blockers.push("agent_runtime_disabled");
  if (agent.status !== "active") blockers.push("agent_not_active");

  const modeCap = configuredModeCap();
  if (modeCap) {
    effectiveMode = lowerMode(effectiveMode, modeCap);
    if (MODE_RANK[requestedMode] > MODE_RANK[effectiveMode]) {
      blockers.push(`mode_capped_to_${effectiveMode}`);
    }
  }

  const providerNeeded = modeAllowsProvider(effectiveMode);
  const versionPublished = activeVersion?.publication_state === "published";
  const hasCredentials = Boolean(process.env.GEMINI_API_KEY?.trim());
  const providerCircuitClosed = circuitClosed(
    db,
    agent.workspace_owner_id,
    agent.id,
    "provider",
  );
  const knowledgeCount = (db.prepare(`
    SELECT COUNT(*) AS count FROM sdr_knowledge_sources
    WHERE agent_id = ? AND workspace_owner_id IS ? AND status = 'approved'
  `).get(agent.id, agent.workspace_owner_id) as { count: number }).count;

  if (providerNeeded) {
    if (!providerMaster) blockers.push("provider_master_disabled");
    if (agent.provider_enabled !== 1) blockers.push("agent_provider_disabled");
    if (!hasCredentials) blockers.push("provider_credentials_missing");
    if (!versionPublished) blockers.push("active_version_not_published");
    if (knowledgeCount === 0) blockers.push("approved_knowledge_missing");
    if (!providerCircuitClosed) blockers.push("provider_circuit_open");
  }

  const hardOff =
    requestedMode === "off" ||
    !runtimeMaster ||
    agent.runtime_enabled !== 1 ||
    agent.status !== "active";
  if (hardOff) effectiveMode = "off";

  if (effectiveMode === "auto") {
    const autoGates = [
      "shadow_evaluated",
      "approval_canary_passed",
      "takeover_race_passed",
      "kill_switch_drill_passed",
    ];
    const missing = autoGates.filter((gate) => !gatePassed(db, agent.id, "auto", gate));
    if (missing.length > 0) {
      blockers.push(...missing.map((gate) => `promotion_gate_${gate}`));
      effectiveMode = "approval";
    }
  }

  const agentOutbound = agent.outbound_enabled === 1;
  let accountOutbound = true;
  if (options?.accountId) {
    const accRow = db.prepare(
      "SELECT sdr_outbound_enabled FROM accounts WHERE id = ?",
    ).get(options.accountId) as { sdr_outbound_enabled?: number } | undefined;
    if (accRow && accRow.sdr_outbound_enabled === 0) {
      accountOutbound = false;
      blockers.push("account_outbound_disabled");
    }
  }

  const outboundEnabled =
    MODE_RANK[effectiveMode] >= MODE_RANK.approval &&
    outboundMaster &&
    agentOutbound &&
    accountOutbound;
  if (MODE_RANK[effectiveMode] >= MODE_RANK.approval && !outboundMaster) {
    blockers.push("outbound_master_disabled");
  }
  if (MODE_RANK[effectiveMode] >= MODE_RANK.approval && !agentOutbound) {
    blockers.push("agent_outbound_disabled");
  }

  return {
    available: effectiveMode !== "off",
    requestedMode,
    effectiveMode,
    inboundEnabled: runtimeMaster && agent.runtime_enabled === 1,
    providerEnabled:
      effectiveMode !== "off" &&
      providerMaster &&
      agent.provider_enabled === 1 &&
      hasCredentials &&
      versionPublished &&
      knowledgeCount > 0 &&
      providerCircuitClosed,
    outboundEnabled,
    linkedinOutboundEnabled: outboundEnabled && linkedinOutboundMaster,
    emailOutboundEnabled: outboundEnabled && emailOutboundMaster,
    calendarEnabled: process.env.NATIVE_CALENDAR_ENABLED === "true" || process.env.NATIVE_CALENDAR_ENABLED === "1",
    reason: effectiveMode === "off" ? (requestedMode === "off" ? "disabled" : "module_unavailable") : "ready",
    blockers: [...new Set(blockers)],
    agentId: agent.id,
    workspaceOwnerId: agent.workspace_owner_id,
    activeVersionId: activeVersion?.id ?? null,
  };
}

export function modeAllowsProvider(mode: SdrMode): boolean {
  return MODE_RANK[mode] >= MODE_RANK.shadow;
}

export function modeAllowsOutbound(mode: SdrMode): boolean {
  return MODE_RANK[mode] >= MODE_RANK.approval;
}
