import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { webSearchClient, WebSearchClient } from "@/lib/serper/client";
import { unipile, UnipileClient } from "@/lib/unipile/client";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import type { ApiActor } from "@/lib/authz";
import {
  SIGNAL_TYPES,
  type SignalIcpFilters,
  type SignalLead,
  type SignalLeadStatus,
  type SignalMessageConfig,
  type SignalMode,
  type SignalMonitor,
  type SignalType,
} from "./schema";
import { scanRealSignals, accountHasSalesNavigator, type SignalScannerClient } from "./scanners";
import { SignalScanError, type DiscoveredSignalLead, type SignalScanCursor } from "./scanners/contracts";
import { canonicalLinkedInProfileUrl, passesIcp, scoreSignalLead, signalIdentity } from "./scanners/scoring";
import { generateSignalMessage } from "./message-generator";
import { promoteSignalLead, signalAutopilotReadiness } from "./promotion";
import { planSignalResearch } from "./research-planner";

export interface SignalActorScope {
  actorId: string;
  workspaceOwnerId: string;
  isSuperAdmin: boolean;
}

export interface CreateMonitorInput {
  name: string;
  type: SignalType;
  target_url?: string;
  competitor_name?: string;
  keywords?: string[];
  icp_filters?: SignalIcpFilters;
  mode?: SignalMode;
  account_id?: string;
  target_list_id?: string;
  target_workflow_id?: string;
  message_config?: SignalMessageConfig;
  scan_interval_minutes?: number;
  created_by?: string;
  workspace_owner_id?: string;
}

export interface ListLeadsQuery {
  monitor_id?: string;
  status?: SignalLeadStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SignalRadarServiceOptions {
  getDatabase?: () => Database.Database;
  client?: SignalScannerClient & Pick<UnipileClient, "isConfigured" | "listAccounts" | "getAccount">;
  webClient?: WebSearchClient;
  generateMessage?: typeof generateSignalMessage;
  now?: () => number;
}

function scopeFromActor(actor: ApiActor): SignalActorScope {
  return { actorId: actor.id, workspaceOwnerId: actor.workspaceOwnerId, isSuperAdmin: actor.isSuperAdmin };
}

function normalizeArray(values?: string[]): string[] {
  return [...new Set((values || []).map((value) => value.trim()).filter(Boolean))].slice(0, 50);
}

function parseJson<T>(value: string | null, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function nextScanAt(intervalMinutes: number, nowMs: number): string {
  return new Date(nowMs + intervalMinutes * 60_000).toISOString();
}

function providerErrorCode(error: unknown): string {
  if (error instanceof SignalScanError) return error.code;
  if (typeof error === "object" && error !== null && "status" in error) return `provider_http_${String((error as { status?: number }).status || "unknown")}`;
  return "scan_failed";
}

function actorScope(actor?: ApiActor | SignalActorScope): SignalActorScope | null {
  if (!actor) return null;
  return "workspaceOwnerId" in actor && "actorId" in actor
    ? actor
    : scopeFromActor(actor as ApiActor);
}

function fullName(profile: { first_name?: string | null; last_name?: string | null }, fallback: string): string {
  return `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || fallback;
}

export class SignalRadarService {
  private readonly database: () => Database.Database;
  private readonly client: SignalRadarServiceOptions["client"];
  private readonly webClient: WebSearchClient;
  private readonly messageGenerator: typeof generateSignalMessage;
  private readonly now: () => number;

  constructor(options: SignalRadarServiceOptions = {}) {
    this.database = options.getDatabase || getDb;
    this.client = options.client || unipile;
    this.webClient = options.webClient || webSearchClient;
    this.messageGenerator = options.generateMessage || generateSignalMessage;
    this.now = options.now || Date.now;
  }

  listMonitors(actor?: ApiActor | SignalActorScope): Array<SignalMonitor & { total_leads: number; pending_leads: number }> {
    const db = this.database();
    const scope = actorScope(actor);
    const condition = scope && !scope.isSuperAdmin ? "WHERE m.workspace_owner_id = ?" : "";
    const params = scope && !scope.isSuperAdmin ? [scope.workspaceOwnerId] : [];
    return db.prepare(`
      SELECT m.*,
        COUNT(sl.id) AS total_leads,
        SUM(CASE WHEN sl.status = 'pending' THEN 1 ELSE 0 END) AS pending_leads
      FROM signal_monitors m
      LEFT JOIN signal_leads sl ON sl.monitor_id = m.id
      ${condition}
      GROUP BY m.id
      ORDER BY datetime(m.created_at) DESC
    `).all(...params) as Array<SignalMonitor & { total_leads: number; pending_leads: number }>;
  }

  getMonitor(id: string, actor?: ApiActor | SignalActorScope): (SignalMonitor & { total_leads: number; pending_leads: number }) | null {
    const db = this.database();
    const scope = actorScope(actor);
    const row = db.prepare(`
      SELECT m.*,
        COUNT(sl.id) AS total_leads,
        SUM(CASE WHEN sl.status = 'pending' THEN 1 ELSE 0 END) AS pending_leads
      FROM signal_monitors m
      LEFT JOIN signal_leads sl ON sl.monitor_id = m.id
      WHERE m.id = ? ${scope && !scope.isSuperAdmin ? "AND m.workspace_owner_id = ?" : ""}
      GROUP BY m.id
    `).get(id, ...(scope && !scope.isSuperAdmin ? [scope.workspaceOwnerId] : [])) as
      | SignalMonitor & { total_leads: number; pending_leads: number }
      | undefined;
    return row || null;
  }

  createMonitor(input: CreateMonitorInput): SignalMonitor {
    const db = this.database();
    const id = randomUUID();
    const interval = Math.max(15, Math.min(Number(input.scan_interval_minutes || 360), 10_080));
    const now = new Date(this.now()).toISOString();
    const type = input.type === "competitor_followers" ? "competitor_audience" : input.type === "job_changes" ? "new_in_role" : input.type;
    if (!SIGNAL_TYPES.includes(type as typeof SIGNAL_TYPES[number])) throw new Error("Tipo de señal no permitido");
    const monitor: SignalMonitor = {
      id,
      workspace_owner_id: input.workspace_owner_id || null,
      name: input.name.trim(),
      type,
      target_url: input.target_url?.trim() || null,
      competitor_name: input.competitor_name?.trim() || null,
      keywords_json: JSON.stringify(normalizeArray(input.keywords)),
      icp_filters_json: JSON.stringify({
        titles: normalizeArray(input.icp_filters?.titles),
        locations: normalizeArray(input.icp_filters?.locations),
        company_sizes: normalizeArray(input.icp_filters?.company_sizes),
        company: input.icp_filters?.company?.trim() || undefined,
        industries: normalizeArray(input.icp_filters?.industries),
        exclusions: normalizeArray(input.icp_filters?.exclusions),
        time_window_days: Math.max(1, Math.min(input.icp_filters?.time_window_days || 90, 365)),
        result_limit: Math.max(1, Math.min(input.icp_filters?.result_limit || 50, 100)),
        source_strategy: input.icp_filters?.source_strategy || "linkedin",
        event_kinds: normalizeArray(input.icp_filters?.event_kinds),
      }),
      mode: input.mode || "review",
      status: "active",
      account_id: input.account_id || null,
      target_list_id: input.target_list_id || null,
      target_workflow_id: input.target_workflow_id || null,
      message_config_json: JSON.stringify(input.message_config || {}),
      scan_interval_minutes: interval,
      next_scan_at: now,
      scan_state: "idle",
      scan_lease_owner: null,
      scan_lease_expires_at: null,
      cursor_json: null,
      capabilities_json: null,
      last_checked_at: null,
      last_success_at: null,
      last_error: null,
      consecutive_failures: 0,
      created_by: input.created_by || null,
      created_at: now,
      updated_at: now,
    };
    db.prepare(`
      INSERT INTO signal_monitors (
        id, workspace_owner_id, name, type, target_url, competitor_name,
        keywords_json, icp_filters_json, mode, status, account_id,
        target_list_id, target_workflow_id, message_config_json,
        scan_interval_minutes, next_scan_at, scan_state, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?)
    `).run(
      monitor.id, monitor.workspace_owner_id, monitor.name, monitor.type,
      monitor.target_url, monitor.competitor_name, monitor.keywords_json,
      monitor.icp_filters_json, monitor.mode, monitor.status, monitor.account_id,
      monitor.target_list_id, monitor.target_workflow_id, monitor.message_config_json,
      monitor.scan_interval_minutes, monitor.next_scan_at, monitor.created_by,
      monitor.created_at, monitor.updated_at,
    );
    this.logEvent(id, "monitor_created", { type: monitor.type, mode: monitor.mode });
    return monitor;
  }

  updateMonitor(id: string, updates: Partial<SignalMonitor>, actor?: ApiActor | SignalActorScope): SignalMonitor | null {
    const db = this.database();
    const current = this.getMonitor(id, actor);
    if (!current) return null;
    const allowed = [
      "name", "status", "mode", "target_url", "competitor_name", "keywords_json",
      "icp_filters_json", "target_list_id", "target_workflow_id", "message_config_json",
      "scan_interval_minutes", "next_scan_at", "account_id",
    ] as const;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    }
    if (fields.length === 0) return current;
    values.push(id);
    db.prepare(`UPDATE signal_monitors SET ${fields.join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(...values);
    return this.getMonitor(id, actor);
  }

  deleteMonitor(id: string, actor?: ApiActor | SignalActorScope): boolean {
    const monitor = this.getMonitor(id, actor);
    if (!monitor) return false;
    if (
      monitor.scan_state === "running"
      && monitor.scan_lease_expires_at
      && Date.parse(monitor.scan_lease_expires_at) > this.now()
    ) {
      throw new Error("El monitor se está escaneando. Espera a que finalice antes de eliminarlo.");
    }
    return this.database().prepare("DELETE FROM signal_monitors WHERE id = ?").run(id).changes > 0;
  }

  listLeads(query: ListLeadsQuery = {}, actor?: ApiActor | SignalActorScope): { items: SignalLead[]; total: number } {
    const db = this.database();
    const scope = actorScope(actor);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (scope && !scope.isSuperAdmin) { conditions.push("sl.workspace_owner_id = ?"); params.push(scope.workspaceOwnerId); }
    if (query.monitor_id) { conditions.push("sl.monitor_id = ?"); params.push(query.monitor_id); }
    if (query.status) { conditions.push("sl.status = ?"); params.push(query.status); }
    if (query.search) {
      conditions.push("(sl.full_name LIKE ? OR sl.headline LIKE ? OR sl.company LIKE ?)");
      const term = `%${query.search}%`;
      params.push(term, term, term);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM signal_leads sl ${where}`).get(...params) as { count: number }).count;
    const limit = Math.max(1, Math.min(query.limit || 50, 200));
    const offset = Math.max(0, query.offset || 0);
    const items = db.prepare(`
      SELECT sl.* FROM signal_leads sl ${where}
      ORDER BY datetime(sl.last_detected_at) DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as SignalLead[];
    return { items, total };
  }

  getLead(id: string, actor?: ApiActor | SignalActorScope): SignalLead | null {
    const scope = actorScope(actor);
    return (this.database().prepare(`
      SELECT * FROM signal_leads WHERE id = ?
      ${scope && !scope.isSuperAdmin ? "AND workspace_owner_id = ?" : ""}
    `).get(id, ...(scope && !scope.isSuperAdmin ? [scope.workspaceOwnerId] : [])) as SignalLead | undefined) || null;
  }

  updateLeadStatus(id: string, status: SignalLeadStatus, icebreakerPreview: string | undefined, actor?: ApiActor | SignalActorScope): boolean {
    const lead = this.getLead(id, actor);
    if (!lead) return false;
    const result = this.database().prepare(`
      UPDATE signal_leads SET status = ?, icebreaker_preview = COALESCE(?, icebreaker_preview), updated_at = datetime('now')
      WHERE id = ?
    `).run(status, icebreakerPreview ?? null, id);
    return result.changes > 0;
  }

  deleteLeads(ids: string[], actor?: ApiActor | SignalActorScope): { deleted: number; skipped: number; preservedTargets: number } {
    const db = this.database();
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, 500);
    if (uniqueIds.length === 0) return { deleted: 0, skipped: 0, preservedTargets: 0 };
    const authorized = uniqueIds
      .map((id) => this.getLead(id, actor))
      .filter((lead): lead is SignalLead => Boolean(lead));
    const authorizedIds = authorized.map((lead) => lead.id);
    if (authorizedIds.length === 0) return { deleted: 0, skipped: uniqueIds.length, preservedTargets: 0 };
    const placeholders = authorizedIds.map(() => "?").join(",");
    const preservedTargets = authorized.filter((lead) => Boolean(lead.imported_target_id)).length;
    const monitorCounts = new Map<string, number>();
    for (const lead of authorized) monitorCounts.set(lead.monitor_id, (monitorCounts.get(lead.monitor_id) || 0) + 1);
    const deleted = db.transaction(() => {
      for (const [monitorId, count] of monitorCounts) {
        this.logEvent(monitorId, "leads_deleted", { count, leadIds: authorized.filter((lead) => lead.monitor_id === monitorId).map((lead) => lead.id), preservedTargets });
      }
      return db.prepare(`DELETE FROM signal_leads WHERE id IN (${placeholders})`).run(...authorizedIds).changes;
    })();
    return { deleted, skipped: uniqueIds.length - authorizedIds.length, preservedTargets };
  }

  promoteLead(id: string, input: { trigger: "manual" | "autopilot"; listId?: string | null; workflowId?: string | null }, actor?: ApiActor | SignalActorScope) {
    const lead = this.getLead(id, actor);
    if (!lead) throw new Error("Lead no encontrado");
    return promoteSignalLead(this.database(), id, input);
  }

  async importLeads(ids: string[], target: { list_id?: string; workflow_id?: string }, actor?: ApiActor | SignalActorScope) {
    const results = [];
    for (const id of ids) {
      if (!this.getLead(id, actor)) continue;
      results.push(this.promoteLead(id, { trigger: "manual", listId: target.list_id, workflowId: target.workflow_id }, actor));
    }
    return {
      imported: results.filter((result) => ["imported", "enrolled"].includes(result.state)).length,
      targetIds: results.map((result) => result.targetId).filter((id): id is string => Boolean(id)),
      results,
    };
  }

  private acquireScanLease(db: Database.Database, monitorId: string): string | null {
    const owner = randomUUID();
    const expires = new Date(this.now() + 10 * 60_000).toISOString();
    const result = db.prepare(`
      UPDATE signal_monitors
      SET scan_state = 'running', scan_lease_owner = ?, scan_lease_expires_at = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'active'
        AND (scan_lease_expires_at IS NULL OR datetime(scan_lease_expires_at) <= datetime('now'))
    `).run(owner, expires, monitorId);
    return result.changes === 1 ? owner : null;
  }

  async scanMonitor(monitorId: string, trigger: "manual" | "scheduled" | "initial" = "manual", actor?: ApiActor | SignalActorScope) {
    const db = this.database();
    const monitor = this.getMonitor(monitorId, actor);
    if (!monitor) throw new Error("Monitor no encontrado");
    if (!monitor.account_id) throw new SignalScanError("Selecciona una cuenta de LinkedIn para escanear", "invalid_configuration", false);
    const leaseOwner = this.acquireScanLease(db, monitor.id);
    if (!leaseOwner) throw new SignalScanError("El monitor ya se está escaneando", "provider_error", true);
    const scanRunId = randomUUID();
    db.prepare(`
      INSERT INTO signal_scan_runs (id, monitor_id, trigger, state, cursor_before)
      VALUES (?, ?, ?, 'running', ?)
    `).run(scanRunId, monitor.id, trigger, monitor.cursor_json);
    this.logEvent(monitor.id, "scan_started", { scanRunId, trigger });

    try {
      if (!this.client?.isConfigured()) throw new SignalScanError("El motor de búsqueda de LinkedIn no está configurado", "provider_error", true);
      const resolved = await resolveUnipileAccount(db, monitor.account_id, this.client as UnipileClient);
      const account = resolved.account || await this.client.getAccount(resolved.unipileAccountId);
      const capabilities = {
        salesNavigator: accountHasSalesNavigator(account.connection_params),
        webEvidence: this.webClient.isConfigured(),
      };
      const icp = parseJson<SignalIcpFilters>(monitor.icp_filters_json, {});
      const keywords = parseJson<string[]>(monitor.keywords_json, []);
      const cursor = parseJson<SignalScanCursor | null>(monitor.cursor_json, null);
      const requestedLimit = Math.max(1, Math.min(icp.result_limit || 50, 100));
      const raw = await scanRealSignals(this.client, {
        monitor,
        remoteAccountId: resolved.unipileAccountId,
        icp,
        keywords,
        cursor,
        limit: requestedLimit,
        hasSalesNavigator: capabilities.salesNavigator,
      }, this.webClient);
      const enriched: DiscoveredSignalLead[] = [];
      for (const candidate of raw.leads.slice(0, requestedLimit)) {
        const lead = await this.enrichCandidate(candidate, resolved.unipileAccountId);
        if (lead && passesIcp(lead, icp)) enriched.push(lead);
      }
      const persisted = await this.persistDiscoveredLeads(monitor, enriched, scanRunId, icp);
      const completedAt = new Date(this.now()).toISOString();
      const next = nextScanAt(monitor.scan_interval_minutes, this.now());
      const state = enriched.length === 0 ? "no_results" : "completed";
      db.transaction(() => {
        db.prepare(`
          UPDATE signal_scan_runs SET state = ?, cursor_after = ?, found_count = ?,
            new_lead_count = ?, new_observation_count = ?, completed_at = ? WHERE id = ?
        `).run(state, JSON.stringify(raw.cursor || null), enriched.length, persisted.newLeads, persisted.newObservations, completedAt, scanRunId);
        db.prepare(`
          UPDATE signal_monitors SET scan_state = 'idle', scan_lease_owner = NULL,
            scan_lease_expires_at = NULL, cursor_json = ?, capabilities_json = ?,
            last_checked_at = ?, last_success_at = ?, last_error = NULL,
            consecutive_failures = 0, next_scan_at = ?, updated_at = datetime('now')
          WHERE id = ? AND scan_lease_owner = ?
        `).run(JSON.stringify(raw.cursor || null), JSON.stringify(capabilities), completedAt, completedAt, next, monitor.id, leaseOwner);
      })();
      this.logEvent(monitor.id, "scan_completed", { scanRunId, found: enriched.length, ...persisted, state });
      return {
        success: true,
        state,
        found: enriched.length,
        newLeads: persisted.newLeads,
        newObservations: persisted.newObservations,
        promoted: persisted.promoted,
        message: enriched.length
          ? `Escaneo completado: ${enriched.length} señales reales verificadas, ${persisted.newLeads} nuevos prospectos.`
          : "Escaneo completado sin nuevas señales reales.",
      };
    } catch (error) {
      const code = providerErrorCode(error);
      const message = error instanceof Error ? error.message : String(error);
      const retryable = error instanceof SignalScanError ? error.retryable : true;
      const failures = monitor.consecutive_failures + 1;
      const backoffMinutes = retryable ? Math.min(24 * 60, 15 * 2 ** Math.min(failures, 6)) : monitor.scan_interval_minutes;
      const state = error instanceof SignalScanError && error.code === "unsupported_capability" ? "unsupported" : "failed";
      db.transaction(() => {
        db.prepare(`
          UPDATE signal_scan_runs SET state = ?, error_code = ?, error_message = ?, completed_at = datetime('now') WHERE id = ?
        `).run(state, code, message, scanRunId);
        db.prepare(`
          UPDATE signal_monitors SET scan_state = 'error', scan_lease_owner = NULL,
            scan_lease_expires_at = NULL, last_checked_at = datetime('now'), last_error = ?,
            consecutive_failures = ?, next_scan_at = ?, updated_at = datetime('now')
          WHERE id = ? AND scan_lease_owner = ?
        `).run(message, failures, nextScanAt(backoffMinutes, this.now()), monitor.id, leaseOwner);
      })();
      this.logEvent(monitor.id, "scan_failed", { scanRunId, code, error: message, retryable });
      throw error;
    }
  }

  private async enrichCandidate(candidate: DiscoveredSignalLead, remoteAccountId: string): Promise<DiscoveredSignalLead | null> {
    const canonical = canonicalLinkedInProfileUrl(candidate.linkedinUrl);
    if (!canonical) return null;
    try {
      const profile = await this.client!.resolveProfile(canonical, remoteAccountId);
      const current = profile.work_experience?.find((item) => item.current) || profile.work_experience?.[0];
      return {
        ...candidate,
        linkedinUrl: profile.public_profile_url || profile.profile_url || canonical,
        providerId: profile.provider_id || candidate.providerId,
        fullName: fullName(profile, candidate.fullName),
        headline: profile.headline || candidate.headline || current?.position || null,
        company: current?.company || candidate.company || null,
        location: profile.location || candidate.location || current?.location || null,
      };
    } catch {
      return { ...candidate, linkedinUrl: canonical };
    }
  }

  private async persistDiscoveredLeads(monitor: SignalMonitor, leads: DiscoveredSignalLead[], scanRunId: string, icp: SignalIcpFilters) {
    const db = this.database();
    let newLeads = 0;
    let newObservations = 0;
    let promoted = 0;
    const touched: string[] = [];
    for (const discovered of leads) {
      const identity = signalIdentity(discovered);
      const score = scoreSignalLead(discovered, icp, this.now());
      let lead = db.prepare("SELECT * FROM signal_leads WHERE monitor_id = ? AND identity_key = ?")
        .get(monitor.id, identity) as SignalLead | undefined;
      const observationExists = db.prepare("SELECT 1 FROM signal_observations WHERE monitor_id = ? AND fingerprint = ?")
        .get(monitor.id, discovered.evidence.fingerprint);
      if (!lead) {
        const id = randomUUID();
        db.prepare(`
          INSERT INTO signal_leads (
            id, workspace_owner_id, monitor_id, linkedin_url, identity_key, provider_id,
            full_name, headline, company, location, signal_type, signal_snippet,
            status, score, signal_count, first_detected_at, last_detected_at,
            message_generation_state, promotion_state, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?, ?, 'pending', 'pending', ?, ?, ?)
        `).run(
          id, monitor.workspace_owner_id, monitor.id, canonicalLinkedInProfileUrl(discovered.linkedinUrl) || discovered.linkedinUrl,
          identity, discovered.providerId || null, discovered.fullName, discovered.headline || null,
          discovered.company || null, discovered.location || null, discovered.signalType,
          discovered.evidence.snippet || null, score.total,
          discovered.evidence.occurredAt || new Date(this.now()).toISOString(),
          discovered.evidence.occurredAt || new Date(this.now()).toISOString(),
          JSON.stringify({
            score: score.breakdown,
            matches: score.matches,
            scanRunId,
            latestEvidence: {
              sourceType: discovered.evidence.sourceType,
              sourceUrl: discovered.evidence.sourceUrl || null,
              occurredAt: discovered.evidence.occurredAt || null,
              ...discovered.evidence.metadata,
            },
          }),
          new Date(this.now()).toISOString(), new Date(this.now()).toISOString(),
        );
        lead = db.prepare("SELECT * FROM signal_leads WHERE id = ?").get(id) as SignalLead;
        newLeads++;
      } else if (!observationExists) {
        db.prepare(`
          UPDATE signal_leads SET provider_id = COALESCE(provider_id, ?),
            full_name = COALESCE(NULLIF(full_name, ''), ?), headline = COALESCE(?, headline),
            company = COALESCE(?, company), location = COALESCE(?, location),
            signal_type = ?, signal_snippet = ?, score = MAX(score, ?),
            signal_count = signal_count + 1, last_detected_at = ?, metadata_json = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(discovered.providerId || null, discovered.fullName, discovered.headline || null,
          discovered.company || null, discovered.location || null, discovered.signalType,
          discovered.evidence.snippet || null, score.total,
          discovered.evidence.occurredAt || new Date(this.now()).toISOString(),
          JSON.stringify({
            score: score.breakdown,
            matches: score.matches,
            scanRunId,
            latestEvidence: {
              sourceType: discovered.evidence.sourceType,
              sourceUrl: discovered.evidence.sourceUrl || null,
              occurredAt: discovered.evidence.occurredAt || null,
              ...discovered.evidence.metadata,
            },
          }), lead.id);
        lead = db.prepare("SELECT * FROM signal_leads WHERE id = ?").get(lead.id) as SignalLead;
      }
      if (!observationExists) {
        db.prepare(`
          INSERT INTO signal_observations (
            id, workspace_owner_id, monitor_id, lead_id, fingerprint, source_type,
            source_id, source_url, occurred_at, snippet, score, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), monitor.workspace_owner_id, monitor.id, lead.id,
          discovered.evidence.fingerprint, discovered.evidence.sourceType,
          discovered.evidence.sourceId || null, discovered.evidence.sourceUrl || null,
          discovered.evidence.occurredAt || null, discovered.evidence.snippet || null,
          score.total, JSON.stringify(discovered.evidence.metadata || {}));
        newObservations++;
      }
      touched.push(lead.id);
    }

    for (const leadId of [...new Set(touched)]) {
      let lead = db.prepare("SELECT * FROM signal_leads WHERE id = ?").get(leadId) as SignalLead;
      if (!lead.icebreaker_preview || lead.message_generation_state !== "generated") {
        const generation = await this.messageGenerator(db, monitor, lead);
        db.prepare(`
          UPDATE signal_leads SET icebreaker_preview = ?, message_generation_state = 'generated',
            message_metadata_json = ?, updated_at = datetime('now') WHERE id = ?
        `).run(generation.body, JSON.stringify(generation), lead.id);
        lead = db.prepare("SELECT * FROM signal_leads WHERE id = ?").get(lead.id) as SignalLead;
      }
      if (monitor.mode === "autopilot") {
        const result = promoteSignalLead(db, lead.id, { trigger: "autopilot" });
        if (result.state === "enrolled") promoted++;
      }
    }
    return { newLeads, newObservations, promoted };
  }

  async executeAskResearch(query: string, input: {
    accountId: string;
    workspaceOwnerId: string;
    actorId: string;
    listId?: string | null;
    workflowId?: string | null;
    isSuperAdmin?: boolean;
  }) {
    const plan = await planSignalResearch(query);
    const monitor = this.createMonitor({
      name: `Ask AI · ${plan.monitorName}`,
      type: plan.signalType,
      keywords: plan.keywords,
      icp_filters: {
        titles: plan.titles,
        locations: plan.locations,
        company_sizes: plan.companySizes,
        exclusions: plan.exclusions,
        time_window_days: plan.timeWindowDays,
        result_limit: plan.resultLimit,
        source_strategy: plan.sourceStrategy,
        event_kinds: plan.eventKinds,
      },
      mode: "review",
      account_id: input.accountId,
      target_list_id: input.listId || undefined,
      target_workflow_id: input.workflowId || undefined,
      message_config: { objective: "conversation", tone: "consultive", language: "es", max_words: 90 },
      scan_interval_minutes: 10_080,
      created_by: input.actorId,
      workspace_owner_id: input.workspaceOwnerId,
    });
    this.logEvent(monitor.id, "ask_query_planned", { query, plan });
    const scan = await this.scanMonitor(monitor.id, "initial", {
      actorId: input.actorId,
      workspaceOwnerId: input.workspaceOwnerId,
      isSuperAdmin: Boolean(input.isSuperAdmin),
    });
    this.database().prepare("UPDATE signal_monitors SET status = 'completed', next_scan_at = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(monitor.id);
    const leads = this.listLeads({ monitor_id: monitor.id, limit: 100 }, {
      actorId: input.actorId,
      workspaceOwnerId: input.workspaceOwnerId,
      isSuperAdmin: Boolean(input.isSuperAdmin),
    }).items;
    return { query, plan, monitorId: monitor.id, scan, leads };
  }

  getAutopilotReadiness(monitorId: string, actor?: ApiActor | SignalActorScope) {
    const monitor = this.getMonitor(monitorId, actor);
    if (!monitor) throw new Error("Monitor no encontrado");
    return signalAutopilotReadiness(this.database(), monitor);
  }

  getDueMonitorIds(limit = 5): string[] {
    return (this.database().prepare(`
      SELECT id FROM signal_monitors
      WHERE status = 'active' AND datetime(COALESCE(next_scan_at, '1970-01-01')) <= datetime('now')
        AND (scan_lease_expires_at IS NULL OR datetime(scan_lease_expires_at) <= datetime('now'))
      ORDER BY datetime(COALESCE(next_scan_at, created_at)) ASC LIMIT ?
    `).all(Math.max(1, Math.min(limit, 20))) as Array<{ id: string }>).map((row) => row.id);
  }

  logEvent(monitorId: string, eventType: string, details: Record<string, unknown>): void {
    try {
      this.database().prepare(`
        INSERT INTO signal_events (id, monitor_id, event_type, details_json, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(randomUUID(), monitorId, eventType, JSON.stringify(details));
    } catch (error) {
      console.warn("[SignalRadar] No se pudo guardar evento:", error);
    }
  }
}

export const signalRadarService = new SignalRadarService();
export { scopeFromActor };
