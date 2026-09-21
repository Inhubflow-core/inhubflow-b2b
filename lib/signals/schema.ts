import type Database from "better-sqlite3";

export const SIGNAL_TYPES = [
  "post_engagement",
  "competitor_reactions",
  "high_intent_comments",
  "competitor_audience",
  "new_in_role",
  "internal_promotion",
  "profile_viewers",
  "active_poster",
  "keyword_intent",
  "hiring_spree",
  "company_growth",
  "funding_round",
  "company_news",
  "acquisition_event",
  "industry_event",
] as const;

export type SignalType = typeof SIGNAL_TYPES[number]
  | "competitor_followers"
  | "post_engagement"
  | "influencer_activity"
  | "job_changes"
  | "ask_query";
export type SignalMode = "review" | "autopilot";
export type SignalStatus = "active" | "paused" | "completed";
export type SignalScanState = "idle" | "running" | "error";
export type SignalLeadStatus = "pending" | "approved" | "rejected" | "imported" | "enrolled" | "failed";
export type SignalPromotionState = "pending" | "promoting" | "imported" | "enrolled" | "blocked" | "failed";

export interface SignalIcpFilters {
  titles?: string[];
  locations?: string[];
  company_sizes?: string[];
  company?: string;
  industries?: string[];
  exclusions?: string[];
  time_window_days?: number;
  result_limit?: number;
  source_strategy?: "linkedin" | "web" | "hybrid";
  event_kinds?: string[];
}

export interface SignalMessageConfig {
  objective?: "conversation" | "demo" | "resource";
  tone?: "consultive" | "professional" | "direct";
  custom_template?: string;
  language?: "es" | "en" | "pt-BR";
  max_words?: number;
}

export interface SignalMonitor {
  id: string;
  workspace_owner_id: string | null;
  name: string;
  type: SignalType;
  target_url: string | null;
  competitor_name: string | null;
  keywords_json: string | null;
  icp_filters_json: string | null;
  mode: SignalMode;
  status: SignalStatus;
  account_id: string | null;
  target_list_id: string | null;
  target_workflow_id: string | null;
  message_config_json: string | null;
  scan_interval_minutes: number;
  next_scan_at: string | null;
  scan_state: SignalScanState;
  scan_lease_owner: string | null;
  scan_lease_expires_at: string | null;
  cursor_json: string | null;
  capabilities_json: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** 'ask' = investigación puntual creada por Ask AI (no es un monitor recurrente). */
  kind: "monitor" | "ask";
}

export interface SignalLead {
  id: string;
  workspace_owner_id: string | null;
  monitor_id: string;
  linkedin_url: string;
  identity_key: string;
  provider_id: string | null;
  full_name: string;
  headline: string | null;
  company: string | null;
  location: string | null;
  profile_image_url?: string | null;
  signal_type: string;
  signal_snippet: string | null;
  icebreaker_preview: string | null;
  status: SignalLeadStatus;
  score: number;
  signal_count: number;
  first_detected_at: string;
  last_detected_at: string;
  message_generation_state: string;
  message_metadata_json: string | null;
  promotion_state: SignalPromotionState;
  promotion_error: string | null;
  imported_target_id: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignalEvent {
  id: string;
  monitor_id: string;
  event_type: string;
  details_json: string | null;
  created_at: string;
}

function tableSql(db: Database.Database, table: string): string {
  return (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql?: string } | undefined)?.sql || "";
}

function columns(db: Database.Database, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
}

function ensureColumn(db: Database.Database, table: string, name: string, definition: string): void {
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function expression(existing: Set<string>, name: string, fallback: string): string {
  return existing.has(name) ? name : `${fallback} AS ${name}`;
}

function rebuildSignalMonitors(db: Database.Database): void {
  const existing = columns(db, "signal_monitors");
  if (existing.size === 0) return;
  const fields: Array<[string, string]> = [
    ["id", "lower(hex(randomblob(16)))"], ["workspace_owner_id", "NULL"], ["name", "'Monitor'"],
    ["type", "'keyword_intent'"], ["target_url", "NULL"], ["competitor_name", "NULL"],
    ["keywords_json", "NULL"], ["icp_filters_json", "NULL"], ["mode", "'review'"],
    ["status", "'active'"], ["account_id", "NULL"], ["target_list_id", "NULL"],
    ["target_workflow_id", "NULL"], ["message_config_json", "NULL"], ["scan_interval_minutes", "360"],
    ["next_scan_at", "datetime('now')"], ["scan_state", "'idle'"], ["scan_lease_owner", "NULL"],
    ["scan_lease_expires_at", "NULL"], ["cursor_json", "NULL"], ["capabilities_json", "NULL"],
    ["last_checked_at", "NULL"], ["last_success_at", "NULL"], ["last_error", "NULL"],
    ["consecutive_failures", "0"], ["created_by", "NULL"], ["created_at", "datetime('now')"],
    ["updated_at", "datetime('now')"], ["kind", "'monitor'"],
  ];
  const names = fields.map(([name]) => name).join(", ");
  const selects = fields.map(([name, fallback]) => expression(existing, name, fallback)).join(", ");

  const foreignKeys = db.pragma("foreign_keys", { simple: true }) as number;
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec("DROP TABLE IF EXISTS signal_monitors_new");
      db.exec(`
        CREATE TABLE signal_monitors_new (
          id TEXT PRIMARY KEY,
          workspace_owner_id TEXT,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          target_url TEXT,
          competitor_name TEXT,
          keywords_json TEXT,
          icp_filters_json TEXT,
          mode TEXT NOT NULL DEFAULT 'review' CHECK(mode IN ('review', 'autopilot')),
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed')),
          account_id TEXT,
          target_list_id TEXT REFERENCES lists(id) ON DELETE SET NULL,
          target_workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
          message_config_json TEXT,
          scan_interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK(scan_interval_minutes BETWEEN 15 AND 10080),
          next_scan_at TEXT,
          scan_state TEXT NOT NULL DEFAULT 'idle' CHECK(scan_state IN ('idle', 'running', 'error')),
          scan_lease_owner TEXT,
          scan_lease_expires_at TEXT,
          cursor_json TEXT,
          capabilities_json TEXT,
          last_checked_at TEXT,
          last_success_at TEXT,
          last_error TEXT,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          kind TEXT NOT NULL DEFAULT 'monitor' CHECK(kind IN ('monitor', 'ask'))
        )
      `);
      db.exec(`INSERT INTO signal_monitors_new (${names}) SELECT ${selects} FROM signal_monitors`);
      db.exec("DROP TABLE signal_monitors");
      db.exec("ALTER TABLE signal_monitors_new RENAME TO signal_monitors");
    })();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
  }
}

function rebuildSignalLeads(db: Database.Database): void {
  const existing = columns(db, "signal_leads");
  if (existing.size === 0) return;
  const fields: Array<[string, string]> = [
    ["id", "lower(hex(randomblob(16)))"], ["workspace_owner_id", "NULL"], ["monitor_id", "''"],
    ["linkedin_url", "''"], ["identity_key", "lower(linkedin_url)"], ["provider_id", "NULL"],
    ["full_name", "'Contacto'"], ["headline", "NULL"], ["company", "NULL"], ["location", "NULL"],
    ["profile_image_url", "NULL"],
    ["signal_type", "'signal_detected'"], ["signal_snippet", "NULL"], ["icebreaker_preview", "NULL"],
    ["status", "'pending'"], ["score", "0"], ["signal_count", "1"],
    ["first_detected_at", "created_at"], ["last_detected_at", "updated_at"],
    ["message_generation_state", "'pending'"], ["message_metadata_json", "NULL"],
    ["promotion_state", "'pending'"], ["promotion_error", "NULL"], ["imported_target_id", "NULL"],
    ["metadata_json", "NULL"], ["created_at", "datetime('now')"], ["updated_at", "datetime('now')"],
  ];
  const names = fields.map(([name]) => name).join(", ");
  const selects = fields.map(([name, fallback]) => expression(existing, name, fallback)).join(", ");

  const foreignKeys = db.pragma("foreign_keys", { simple: true }) as number;
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec("DROP TABLE IF EXISTS signal_leads_new");
      db.exec(`
        CREATE TABLE signal_leads_new (
          id TEXT PRIMARY KEY,
          workspace_owner_id TEXT,
          monitor_id TEXT NOT NULL REFERENCES signal_monitors(id) ON DELETE CASCADE,
          linkedin_url TEXT NOT NULL,
          identity_key TEXT NOT NULL,
          provider_id TEXT,
          full_name TEXT NOT NULL,
          headline TEXT,
          company TEXT,
          location TEXT,
          signal_type TEXT NOT NULL,
          signal_snippet TEXT,
          icebreaker_preview TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'imported', 'enrolled', 'failed')),
          score INTEGER NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 100),
          signal_count INTEGER NOT NULL DEFAULT 1,
          first_detected_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_detected_at TEXT NOT NULL DEFAULT (datetime('now')),
          message_generation_state TEXT NOT NULL DEFAULT 'pending',
          message_metadata_json TEXT,
          promotion_state TEXT NOT NULL DEFAULT 'pending' CHECK(promotion_state IN ('pending', 'promoting', 'imported', 'enrolled', 'blocked', 'failed')),
          promotion_error TEXT,
          imported_target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
          profile_image_url TEXT,
          metadata_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`INSERT INTO signal_leads_new (${names}) SELECT ${selects} FROM signal_leads`);
      db.exec("DROP TABLE signal_leads");
      db.exec("ALTER TABLE signal_leads_new RENAME TO signal_leads");
    })();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
  }
}

export function applySignalSchema(db: Database.Database): void {
  if (db.inTransaction) {
    throw new Error("applySignalSchema must run outside an active transaction");
  }
  const monitorSql = tableSql(db, "signal_monitors");
  if (monitorSql && (!columns(db, "signal_monitors").has("workspace_owner_id") || monitorSql.includes("CHECK(type IN"))) {
    rebuildSignalMonitors(db);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS signal_monitors (
      id TEXT PRIMARY KEY,
      workspace_owner_id TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      target_url TEXT,
      competitor_name TEXT,
      keywords_json TEXT,
      icp_filters_json TEXT,
      mode TEXT NOT NULL DEFAULT 'review' CHECK(mode IN ('review', 'autopilot')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed')),
      account_id TEXT,
      target_list_id TEXT REFERENCES lists(id) ON DELETE SET NULL,
      target_workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
      message_config_json TEXT,
      scan_interval_minutes INTEGER NOT NULL DEFAULT 360,
      next_scan_at TEXT,
      scan_state TEXT NOT NULL DEFAULT 'idle',
      scan_lease_owner TEXT,
      scan_lease_expires_at TEXT,
      cursor_json TEXT,
      capabilities_json TEXT,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      kind TEXT NOT NULL DEFAULT 'monitor' CHECK(kind IN ('monitor', 'ask'))
    )
  `);

  const monitorColumns: Array<[string, string]> = [
    ["workspace_owner_id", "TEXT"], ["message_config_json", "TEXT"],
    ["scan_interval_minutes", "INTEGER NOT NULL DEFAULT 360"], ["next_scan_at", "TEXT"],
    ["scan_state", "TEXT NOT NULL DEFAULT 'idle'"], ["scan_lease_owner", "TEXT"],
    ["scan_lease_expires_at", "TEXT"], ["cursor_json", "TEXT"], ["capabilities_json", "TEXT"],
    ["last_success_at", "TEXT"], ["last_error", "TEXT"], ["consecutive_failures", "INTEGER NOT NULL DEFAULT 0"],
    ["kind", "TEXT NOT NULL DEFAULT 'monitor'"],
  ];
  for (const [name, definition] of monitorColumns) ensureColumn(db, "signal_monitors", name, definition);
  db.exec("UPDATE signal_monitors SET kind = 'ask' WHERE name LIKE 'Ask AI · %' AND (kind IS NULL OR kind != 'ask')");

  if (tableSql(db, "signal_leads") && !columns(db, "signal_leads").has("identity_key")) rebuildSignalLeads(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS signal_leads (
      id TEXT PRIMARY KEY,
      workspace_owner_id TEXT,
      monitor_id TEXT NOT NULL REFERENCES signal_monitors(id) ON DELETE CASCADE,
      linkedin_url TEXT NOT NULL,
      identity_key TEXT NOT NULL,
      provider_id TEXT,
      full_name TEXT NOT NULL,
      headline TEXT,
      company TEXT,
      location TEXT,
      signal_type TEXT NOT NULL,
      signal_snippet TEXT,
      icebreaker_preview TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      score INTEGER NOT NULL DEFAULT 0,
      signal_count INTEGER NOT NULL DEFAULT 1,
      first_detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      message_generation_state TEXT NOT NULL DEFAULT 'pending',
      message_metadata_json TEXT,
      promotion_state TEXT NOT NULL DEFAULT 'pending',
      promotion_error TEXT,
      imported_target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
      profile_image_url TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signal_observations (
      id TEXT PRIMARY KEY,
      workspace_owner_id TEXT,
      monitor_id TEXT NOT NULL REFERENCES signal_monitors(id) ON DELETE CASCADE,
      lead_id TEXT NOT NULL REFERENCES signal_leads(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      source_url TEXT,
      occurred_at TEXT,
      snippet TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(monitor_id, fingerprint)
    );

    CREATE TABLE IF NOT EXISTS signal_scan_runs (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL REFERENCES signal_monitors(id) ON DELETE CASCADE,
      trigger TEXT NOT NULL CHECK(trigger IN ('manual', 'scheduled', 'initial')),
      state TEXT NOT NULL CHECK(state IN ('running', 'completed', 'no_results', 'unsupported', 'failed')),
      cursor_before TEXT,
      cursor_after TEXT,
      found_count INTEGER NOT NULL DEFAULT 0,
      new_lead_count INTEGER NOT NULL DEFAULT 0,
      new_observation_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS signal_promotions (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL REFERENCES signal_leads(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
      list_id TEXT REFERENCES lists(id) ON DELETE SET NULL,
      workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      run_profile_id TEXT REFERENCES run_profiles(id) ON DELETE SET NULL,
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'promoting', 'imported', 'enrolled', 'blocked', 'failed')),
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(lead_id, workflow_id)
    );

    CREATE TABLE IF NOT EXISTS run_profile_step_messages (
      run_profile_id TEXT NOT NULL REFERENCES run_profiles(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'signal_radar',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (run_profile_id, step_id)
    );

    CREATE TABLE IF NOT EXISTS signal_events (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL REFERENCES signal_monitors(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureColumn(db, "signal_leads", "profile_image_url", "TEXT");

  db.exec(`
    UPDATE signal_monitors
    SET workspace_owner_id = COALESCE(
      workspace_owner_id,
      (SELECT owner_id FROM accounts WHERE accounts.id = signal_monitors.account_id),
      (SELECT COALESCE(owner_id, id) FROM users WHERE users.id = signal_monitors.created_by),
      created_by
    ),
      next_scan_at = COALESCE(next_scan_at, datetime('now'));
    UPDATE signal_leads
    SET workspace_owner_id = COALESCE(
      workspace_owner_id,
      (SELECT workspace_owner_id FROM signal_monitors WHERE signal_monitors.id = signal_leads.monitor_id)
    ),
      identity_key = COALESCE(NULLIF(identity_key, ''), lower(trim(linkedin_url))),
      first_detected_at = COALESCE(first_detected_at, created_at),
      last_detected_at = COALESCE(last_detected_at, updated_at, created_at);
  `);

  // Consolidate any legacy duplicates before applying the unique identity index.
  db.exec(`
    DELETE FROM signal_leads
    WHERE rowid NOT IN (
      SELECT MIN(rowid) FROM signal_leads GROUP BY monitor_id, identity_key
    );
    CREATE INDEX IF NOT EXISTS idx_signal_monitors_workspace ON signal_monitors(workspace_owner_id, status);
    CREATE INDEX IF NOT EXISTS idx_signal_monitors_due ON signal_monitors(status, next_scan_at, scan_lease_expires_at);
    CREATE INDEX IF NOT EXISTS idx_signal_leads_workspace ON signal_leads(workspace_owner_id, status, last_detected_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_leads_identity ON signal_leads(monitor_id, identity_key);
    CREATE INDEX IF NOT EXISTS idx_signal_observations_lead ON signal_observations(lead_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_signal_scan_runs_monitor ON signal_scan_runs(monitor_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_signal_promotions_state ON signal_promotions(state, updated_at);
    CREATE INDEX IF NOT EXISTS idx_signal_events_monitor ON signal_events(monitor_id, created_at DESC);
  `);
}
