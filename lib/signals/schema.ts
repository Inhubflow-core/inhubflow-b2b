import type Database from "better-sqlite3";

export type SignalType =
  | "competitor_reactions"   // Grupo A: Reacciones a posts de competidores
  | "high_intent_comments"   // Grupo A: Comentarios de alta intención
  | "competitor_followers"   // Grupo A: Seguidores de competidor / referente
  | "new_in_role"            // Grupo B: Nuevo en el cargo (<90 días)
  | "internal_promotion"     // Grupo B: Ascenso interno a decisor
  | "active_poster"          // Grupo C: Creadores activos (<30 días)
  | "keyword_intent"         // Grupo C: Búsqueda por palabras clave de compra
  | "hiring_spree"           // Grupo D: Empresas con vacantes / contratación activa
  | "company_growth"         // Grupo D: Empresas en hipercrecimiento
  // Compatibilidad con tipos anteriores:
  | "post_engagement"
  | "influencer_activity"
  | "job_changes"
  | "ask_query";
export type SignalMode = "review" | "autopilot";
export type SignalStatus = "active" | "paused" | "completed";
export type SignalLeadStatus = "pending" | "approved" | "rejected" | "imported";

export interface SignalMonitor {
  id: string;
  name: string;
  type: SignalType;
  target_url: string | null;
  competitor_name: string | null;
  keywords_json: string | null; // string[]
  icp_filters_json: string | null; // { titles?: string[], locations?: string[], company_sizes?: string[], exclusions?: string[] }
  mode: SignalMode;
  status: SignalStatus;
  account_id: string | null;
  target_list_id: string | null;
  target_workflow_id: string | null;
  message_config_json?: string | null;
  last_checked_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignalLead {
  id: string;
  monitor_id: string;
  linkedin_url: string;
  full_name: string;
  headline: string | null;
  company: string | null;
  location: string | null;
  signal_type: string;
  signal_snippet: string | null;
  icebreaker_preview: string | null;
  status: SignalLeadStatus;
  score: number;
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

export function applySignalSchema(db: Database.Database): void {
  db.transaction(() => {
    // 1. Tablas de monitores de señales (con migración para eliminar CHECK antiguo)
    const tableInfo = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'signal_monitors'")
      .get() as { sql: string } | undefined;

    if (tableInfo?.sql && tableInfo.sql.includes("CHECK(type IN")) {
      db.pragma("foreign_keys = OFF");
      db.exec(`
        CREATE TABLE IF NOT EXISTS signal_monitors_migrated (
          id TEXT PRIMARY KEY,
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
          last_checked_at TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO signal_monitors_migrated (
          id, name, type, target_url, competitor_name, keywords_json, icp_filters_json,
          mode, status, account_id, target_list_id, target_workflow_id, last_checked_at,
          created_by, created_at, updated_at
        ) SELECT 
          id, name, type, target_url, competitor_name, keywords_json, icp_filters_json,
          mode, status, account_id, target_list_id, target_workflow_id, last_checked_at,
          created_by, created_at, updated_at
        FROM signal_monitors;
        DROP TABLE signal_monitors;
        ALTER TABLE signal_monitors_migrated RENAME TO signal_monitors;
        CREATE INDEX IF NOT EXISTS idx_signal_monitors_status ON signal_monitors(status);
        CREATE INDEX IF NOT EXISTS idx_signal_monitors_type ON signal_monitors(type);
      `);
      db.pragma("foreign_keys = ON");
    } else {
      db.exec(`
        CREATE TABLE IF NOT EXISTS signal_monitors (
          id TEXT PRIMARY KEY,
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
          last_checked_at TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_signal_monitors_status ON signal_monitors(status);
        CREATE INDEX IF NOT EXISTS idx_signal_monitors_type ON signal_monitors(type);
      `);
    }

    try {
      const cols = db.prepare("PRAGMA table_info(signal_monitors)").all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "message_config_json")) {
        db.exec("ALTER TABLE signal_monitors ADD COLUMN message_config_json TEXT");
      }
    } catch {
      // ignore
    }

    // 2. Tablas de prospectos detectados por señales (Hot Leads)
    db.exec(`
      CREATE TABLE IF NOT EXISTS signal_leads (
        id TEXT PRIMARY KEY,
        monitor_id TEXT NOT NULL REFERENCES signal_monitors(id) ON DELETE CASCADE,
        linkedin_url TEXT NOT NULL,
        full_name TEXT NOT NULL,
        headline TEXT,
        company TEXT,
        location TEXT,
        signal_type TEXT NOT NULL,
        signal_snippet TEXT,
        icebreaker_preview TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'imported')),
        score INTEGER NOT NULL DEFAULT 85,
        imported_target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_signal_leads_monitor ON signal_leads(monitor_id);
      CREATE INDEX IF NOT EXISTS idx_signal_leads_status ON signal_leads(status);
      CREATE INDEX IF NOT EXISTS idx_signal_leads_linkedin ON signal_leads(linkedin_url);
    `);

    // 3. Registro de auditoría y eventos de señales
    db.exec(`
      CREATE TABLE IF NOT EXISTS signal_events (
        id TEXT PRIMARY KEY,
        monitor_id TEXT NOT NULL REFERENCES signal_monitors(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_signal_events_monitor ON signal_events(monitor_id);
    `);
  })();
}
