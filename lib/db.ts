import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { scheduleUpdateCheck } from "@/lib/update-check";
import { encryptSecret, isEncrypted } from "@/lib/crypto";
import { autoSeedInstance } from "@/lib/auto-seed";
import { applySdrSchema } from "@/lib/sdr-agent/schema";
import { applyPipelineSchema } from "@/lib/pipeline/schema";
import { applyTagsSchema } from "@/lib/tags/schema";
import { applyCalendarSchema } from "@/lib/calendar/schema";
import { applySignalSchema } from "@/lib/signals/schema";
import { applyCompaniesSchema } from "@/lib/companies/schema";
import { backfillLinkedInConnectionAttempts } from "@/lib/linkedin/connection-attempts";

function resolveDbPath(): string {
  if (process.env.INHUBFLOW_DB_PATH) return process.env.INHUBFLOW_DB_PATH;
  return path.join(process.cwd(), "inhubflow.db");
}

const DB_PATH = resolveDbPath();

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initDb(db);
    runMigrations(db);
    autoSeedInstance(db);
    scheduleUpdateCheck();
    schedulePhotoSyncCheck(db);
  }
  return db;
}

function runParallelTracksMigration(db: Database.Database) {
  // This backfill reads the legacy run_profiles.state column. If that column no longer
  // exists, dropDeprecatedRunProfileColumns has already run (a prior startup) and this
  // migration is moot — skip, otherwise the SELECT rp.state below throws "no such column".
  // (Fresh DBs hit this: state is created, dropped on one startup, then this guard would
  // otherwise re-enter on the next because no email-tracked steps exist yet.)
  try {
    const rpCols = db.prepare("PRAGMA table_info(run_profiles)").all() as { name: string }[];
    if (!rpCols.some(c => c.name === "state")) return;
  } catch { return; }

  // Idempotent: skip if run_profile_tracks already has rows or workflow_steps already has email-tracked rows
  try {
    const alreadyRun = (db.prepare("SELECT COUNT(*) as c FROM run_profile_tracks").get() as { c: number }).c > 0
      || (db.prepare("SELECT COUNT(*) as c FROM workflow_steps WHERE track = 'email'").get() as { c: number }).c > 0;
    if (alreadyRun) return;
  } catch { return; }

  db.transaction(() => {
    // 1. Assign email step_type rows to the email track
    db.exec("UPDATE workflow_steps SET track = 'email' WHERE step_type = 'email'");
    // Also assign delay steps to the email track if the next non-delay step after them is an email step.
    // Without this, delays between email steps default to 'linkedin' and create a ghost linkedin track.
    db.exec(`
      UPDATE workflow_steps SET track = 'email'
      WHERE step_type = 'delay'
      AND (
        SELECT step_type FROM workflow_steps ws2
        WHERE ws2.workflow_id = workflow_steps.workflow_id
          AND ws2.step_order > workflow_steps.step_order
          AND ws2.step_type != 'delay'
        ORDER BY ws2.step_order ASC
        LIMIT 1
      ) = 'email'
    `);

    // 2. Re-number step_order densely within each (workflow_id, track), preserving original order
    const stepGroups = db.prepare(
      "SELECT id, workflow_id, track, step_order FROM workflow_steps ORDER BY workflow_id, track, step_order"
    ).all() as Array<{ id: string; workflow_id: string; track: string; step_order: number }>;

    // Group by (workflow_id, track) and assign dense 1-based order
    const grouped = new Map<string, Array<{ id: string; step_order: number }>>();
    for (const row of stepGroups) {
      const key = `${row.workflow_id}|${row.track}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push({ id: row.id, step_order: row.step_order });
    }
    const updateStep = db.prepare("UPDATE workflow_steps SET step_order = ? WHERE id = ?");
    for (const steps of grouped.values()) {
      steps.sort((a, b) => a.step_order - b.step_order);
      steps.forEach((s, i) => updateStep.run(i + 1, s.id));
    }

    // 3. Backfill run_profile_tracks from existing run_profiles
    // Only backfill if there are run_profiles rows to process
    const allProfiles = db.prepare(
      `SELECT rp.id, rp.run_id, rp.state, rp.current_step, rp.next_step_at,
              rp.error_message, rp.last_email_subject, rp.last_email_body, rp.last_linkedin_message,
              r.workflow_id
       FROM run_profiles rp
       JOIN runs r ON r.id = rp.run_id`
    ).all() as Array<{
      id: string; run_id: string; state: string; current_step: number;
      next_step_at: string | null; error_message: string | null;
      last_email_subject: string | null; last_email_body: string | null;
      last_linkedin_message: string | null; workflow_id: string;
    }>;

    if (allProfiles.length === 0) return;

    // Load all workflow steps grouped by workflow_id, preserving their original ordering
    // We need the ORIGINAL step_order to map legacy current_step (0-based flat index) to tracks.
    // After the re-numbering above, step_order is now per-track. We stored the original order as the
    // sort key inside stepGroups above. Rebuild a per-workflow flat list from the original ordering.
    const workflowStepsOrig = db.prepare(
      "SELECT id, workflow_id, track, step_order FROM workflow_steps ORDER BY workflow_id, step_order"
    ).all() as Array<{ id: string; workflow_id: string; track: string; step_order: number }>;

    // For each workflow, build the flat list of steps in their original order (by new step_order within track, then track order linkedin < email)
    // BUT: we need the ORIGINAL flat order before re-numbering. Since we already re-numbered, we have to reconstruct.
    // Approach: the original flat step_order was cross-track. The re-numbered step_order is per-track and starts at 1.
    // We stored the original step_order in stepGroups (before modification). Use that.
    const origStepOrderMap = new Map<string, number>(); // step id → original flat step_order
    for (const row of stepGroups) {
      origStepOrderMap.set(row.id, row.step_order);
    }

    // Per workflow: flat list of steps sorted by original step_order
    const workflowFlatSteps = new Map<string, Array<{ id: string; track: string; orig_order: number }>>();
    for (const step of workflowStepsOrig) {
      if (!workflowFlatSteps.has(step.workflow_id)) workflowFlatSteps.set(step.workflow_id, []);
      workflowFlatSteps.get(step.workflow_id)!.push({
        id: step.id,
        track: step.track,
        orig_order: origStepOrderMap.get(step.id) ?? step.step_order,
      });
    }
    for (const steps of workflowFlatSteps.values()) {
      steps.sort((a, b) => a.orig_order - b.orig_order);
    }

    // Per workflow: which tracks exist
    const workflowTracks = new Map<string, Set<string>>();
    for (const step of workflowStepsOrig) {
      if (!workflowTracks.has(step.workflow_id)) workflowTracks.set(step.workflow_id, new Set());
      workflowTracks.get(step.workflow_id)!.add(step.track);
    }

    const insertTrack = db.prepare(`
      INSERT OR IGNORE INTO run_profile_tracks
        (id, run_profile_id, track, state, current_step, last_step_at, next_step_at,
         error_message, last_email_subject, last_email_body, last_linkedin_message)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
    `);

    for (const rp of allProfiles) {
      const flatSteps = workflowFlatSteps.get(rp.workflow_id) ?? [];
      const tracks = workflowTracks.get(rp.workflow_id) ?? new Set(["linkedin"]);
      const terminalStates = new Set(["completed", "failed", "skipped"]);

      if (terminalStates.has(rp.state)) {
        // Terminal profile — mark all tracks with the same terminal state
        for (const track of tracks) {
          insertTrack.run(
            randomUUID(), rp.id, track, rp.state, 0,
            null, rp.error_message ?? null, null, null, null
          );
        }
        continue;
      }

      // Active profile — compute per-track completed step count
      // legacy current_step is 0-based index into the flat step list = steps already completed
      const completedCount = rp.current_step;
      const completedSteps = flatSteps.slice(0, completedCount);

      const trackCompletedCount = new Map<string, number>();
      for (const track of tracks) trackCompletedCount.set(track, 0);
      for (const s of completedSteps) {
        trackCompletedCount.set(s.track, (trackCompletedCount.get(s.track) ?? 0) + 1);
      }

      // Which track owned the step we were waiting on (index = completedCount)?
      const currentFlatStep = flatSteps[completedCount];
      const waitingTrack = currentFlatStep?.track ?? null;

      for (const track of tracks) {
        const trackCurrentStep = trackCompletedCount.get(track) ?? 0;
        // next_step_at: only carry over to the track that was waiting; other track starts immediately
        const nextStepAt = track === waitingTrack ? rp.next_step_at : null;
        const lastEmailSubject = track === "email" ? rp.last_email_subject : null;
        const lastEmailBody = track === "email" ? rp.last_email_body : null;
        const lastLinkedinMessage = track === "linkedin" ? rp.last_linkedin_message : null;

        insertTrack.run(
          randomUUID(), rp.id, track, rp.state, trackCurrentStep,
          nextStepAt, rp.error_message ?? null,
          lastEmailSubject, lastEmailBody, lastLinkedinMessage
        );
      }
    }
  })();
}

function dropDeprecatedRunProfileColumns(db: Database.Database) {
  // Idempotent: check if state column still exists on run_profiles
  try {
    const tableInfo = db.prepare("PRAGMA table_info(run_profiles)").all() as { name: string }[];
    const hasState = tableInfo.some(c => c.name === "state");
    if (!hasState) return; // already dropped
  } catch { return; }

  // SQLite requires a table rebuild to drop columns
  try {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE run_profiles_new (
        id TEXT PRIMARY KEY,
        run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
        target_id TEXT REFERENCES targets(id),
        email_account_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(run_id, target_id)
      );
      INSERT INTO run_profiles_new (id, run_id, target_id, email_account_id, created_at)
        SELECT id, run_id, target_id, email_account_id, created_at FROM run_profiles;
      DROP TABLE run_profiles;
      ALTER TABLE run_profiles_new RENAME TO run_profiles;
      PRAGMA foreign_keys = ON;
    `);
  } catch { /* ignore — may already be done */ }
}

function runMigrations(db: Database.Database) {
  // Add columns introduced after initial schema — safe to run on existing DBs
  const migrations = [
    "ALTER TABLE targets ADD COLUMN degree INTEGER",
    "ALTER TABLE targets ADD COLUMN connection_requested_at TEXT",
    "ALTER TABLE targets ADD COLUMN connected_at TEXT",
    "ALTER TABLE targets ADD COLUMN message_sent_at TEXT",
    "ALTER TABLE targets ADD COLUMN last_replied_at TEXT",
    // LinkedIn slot that observed the latest reply. The runner stamps this after
    // each per-account inbox sync so the unified inbox can filter safely.
    "ALTER TABLE targets ADD COLUMN last_replied_account_id TEXT REFERENCES accounts(id)",
    "CREATE INDEX IF NOT EXISTS idx_targets_last_replied_account_id ON targets(last_replied_account_id)",
    "ALTER TABLE targets ADD COLUMN linkedin_member_urn TEXT",
    "ALTER TABLE targets ADD COLUMN sales_nav_url TEXT",
    "ALTER TABLE lists ADD COLUMN sales_nav_url TEXT",
    "ALTER TABLE accounts ADD COLUMN inbox_synced_at TEXT",
    "ALTER TABLE accounts ADD COLUMN active_hours_start INTEGER DEFAULT 9",
    "ALTER TABLE accounts ADD COLUMN active_hours_end INTEGER DEFAULT 18",
    "ALTER TABLE accounts ADD COLUMN timezone TEXT DEFAULT 'UTC'",
    "ALTER TABLE accounts ADD COLUMN working_days TEXT DEFAULT '1,2,3,4,5'",
    "ALTER TABLE workflow_steps ADD COLUMN connect_note TEXT",
    "ALTER TABLE workflow_steps ADD COLUMN message_body TEXT",
    "ALTER TABLE targets ADD COLUMN headline TEXT",
    "ALTER TABLE targets ADD COLUMN summary TEXT",
    "ALTER TABLE accounts ADD COLUMN accepted_sync_at TEXT",
    // Messaging identity (fsd_profile URN, "urn:li:fsd_profile:ACoAA...") — the
    // form the messaging GraphQL API returns. It is NOT convertible to the
    // numeric urn:li:member we store elsewhere, so we capture it on first reply
    // (matched by name) and then join by it directly on every later sync.
    "ALTER TABLE targets ADD COLUMN messaging_urn TEXT",
    "CREATE INDEX IF NOT EXISTS idx_targets_messaging_urn ON targets(messaging_urn)",
    // Boundary for the incremental connections sync: the createdAt of the newest
    // connection seen last run. NULL = never synced (first run does a full pass).
    "ALTER TABLE accounts ADD COLUMN connections_synced_through_ms INTEGER",
    "ALTER TABLE accounts ADD COLUMN li_connections INTEGER",
    "ALTER TABLE accounts ADD COLUMN li_pending INTEGER",
    "ALTER TABLE accounts ADD COLUMN li_profile_views INTEGER",
    "ALTER TABLE accounts ADD COLUMN li_stats_synced_at TEXT",
    `CREATE TABLE IF NOT EXISTS workflow_step_templates (
      step_id TEXT REFERENCES workflow_steps(id) ON DELETE CASCADE,
      template_id TEXT REFERENCES templates(id) ON DELETE CASCADE,
      PRIMARY KEY (step_id, template_id)
    )`,
    // Extended lead data from salesApiLeadSearch
    "ALTER TABLE targets ADD COLUMN object_urn TEXT",
    "ALTER TABLE targets ADD COLUMN open_link INTEGER DEFAULT 0",
    "ALTER TABLE targets ADD COLUMN company_industry TEXT",
    "ALTER TABLE targets ADD COLUMN company_location TEXT",
    "ALTER TABLE targets ADD COLUMN tenure_months INTEGER",
    "ALTER TABLE targets ADD COLUMN spotlight_badges TEXT",
    // Profile enrichment — populated by visiting their Sales Nav profile page
    "ALTER TABLE targets ADD COLUMN positions_json TEXT",
    "ALTER TABLE targets ADD COLUMN skills_json TEXT",
    "ALTER TABLE targets ADD COLUMN enriched_profile_at TEXT",
    // Email & Phone outreach fields
    "ALTER TABLE targets ADD COLUMN email TEXT",
    "ALTER TABLE targets ADD COLUMN phone TEXT",
    "ALTER TABLE targets ADD COLUMN email_replied_at TEXT",
    "ALTER TABLE targets ADD COLUMN company_id TEXT",
    // Email account on runs (nullable — only needed when workflow has email steps)
    "ALTER TABLE runs ADD COLUMN email_account_id TEXT REFERENCES email_accounts(id)",
    // Workflow step email fields
    "ALTER TABLE workflow_steps ADD COLUMN email_subject TEXT",
    "ALTER TABLE workflow_steps ADD COLUMN email_body TEXT",
    // Apollo enrichment fields
    "ALTER TABLE targets ADD COLUMN apollo_id TEXT",
    "ALTER TABLE targets ADD COLUMN seniority TEXT",
    "ALTER TABLE targets ADD COLUMN apollo_functions TEXT",
    "ALTER TABLE targets ADD COLUMN company_description TEXT",
    "ALTER TABLE targets ADD COLUMN company_size INTEGER",
    "ALTER TABLE targets ADD COLUMN apollo_enriched_at TEXT",
    "ALTER TABLE targets ADD COLUMN email_status TEXT",
    // Manual fields
    "ALTER TABLE targets ADD COLUMN notes TEXT",
    // Apollo extra person fields
    "ALTER TABLE targets ADD COLUMN city TEXT",
    "ALTER TABLE targets ADD COLUMN country TEXT",
    "ALTER TABLE targets ADD COLUMN time_zone TEXT",
    "ALTER TABLE targets ADD COLUMN apollo_departments TEXT",
    // Apollo extra company fields on companies table
    "ALTER TABLE companies ADD COLUMN founded_year INTEGER",
    "ALTER TABLE companies ADD COLUMN logo_url TEXT",
    "ALTER TABLE companies ADD COLUMN phone TEXT",
    "ALTER TABLE companies ADD COLUMN annual_revenue TEXT",
    "ALTER TABLE companies ADD COLUMN technology_names TEXT",
    "ALTER TABLE companies ADD COLUMN keywords TEXT",
    "ALTER TABLE companies ADD COLUMN city TEXT",
    "ALTER TABLE companies ADD COLUMN country TEXT",
    // Email signature
    "ALTER TABLE email_accounts ADD COLUMN signature TEXT",
    // Reply-To override — if set, outgoing emails include Reply-To header
    "ALTER TABLE email_accounts ADD COLUMN reply_to TEXT",
    // Ramp-up: start slow and increase sending volume over time
    "ALTER TABLE email_accounts ADD COLUMN ramp_up_enabled INTEGER DEFAULT 1",
    "ALTER TABLE email_accounts ADD COLUMN ramp_start_date TEXT",
    // Company description and employee count moved from targets to companies
    "ALTER TABLE companies ADD COLUMN description TEXT",
    "ALTER TABLE companies ADD COLUMN employee_count INTEGER",
    // AI agent columns on workflow steps
    "ALTER TABLE workflow_steps ADD COLUMN ai_enabled INTEGER DEFAULT 0",
    "ALTER TABLE workflow_steps ADD COLUMN ai_model TEXT",
    "ALTER TABLE workflow_steps ADD COLUMN ai_prompt TEXT",
    "ALTER TABLE workflow_steps ADD COLUMN ai_max_words INTEGER",
    // Email step position — which followup number (1 = cold email, 2 = first followup, etc.)
    "ALTER TABLE workflow_steps ADD COLUMN email_position INTEGER DEFAULT 1",
    // Agent default model (stored on agent_config)
    "ALTER TABLE agent_config ADD COLUMN default_model TEXT",
    // Email threading — store sent email message-id for reply threading (future use)
    "ALTER TABLE run_profiles ADD COLUMN last_email_subject TEXT",
    "ALTER TABLE run_profiles ADD COLUMN last_email_body TEXT",
    // LinkedIn message follow-up tracking
    "ALTER TABLE workflow_steps ADD COLUMN message_position INTEGER DEFAULT 1",
    "ALTER TABLE run_profiles ADD COLUMN last_linkedin_message TEXT",
    // Language for AI-generated content per step
    "ALTER TABLE workflow_steps ADD COLUMN ai_language TEXT DEFAULT 'English'",
    // Campaign-level prompt — per-workflow AI context (USP, persona, tone for this campaign)
    "ALTER TABLE workflows ADD COLUMN prompt TEXT",
    // Email domain invalid flag on companies — set when a bounce is detected for any contact at this company
    "ALTER TABLE companies ADD COLUMN email_domain_invalid INTEGER DEFAULT 0",
    // Apollo extra person fields
    "ALTER TABLE targets ADD COLUMN email_domain_catchall INTEGER DEFAULT 0",
    // Per-profile email account assignment (multi-account routing)
    "ALTER TABLE run_profiles ADD COLUMN email_account_id TEXT",
    // Backfill: copy email_account_id from runs → run_profiles for existing records
    `UPDATE run_profiles SET email_account_id = (SELECT email_account_id FROM runs WHERE runs.id = run_profiles.run_id) WHERE email_account_id IS NULL`,
    // Import job progress tracking
    `CREATE TABLE IF NOT EXISTS list_imports (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      phase TEXT,
      page INTEGER DEFAULT 0,
      total_pages INTEGER DEFAULT 0,
      count INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      imported INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0,
      error TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    )`,
    // Parallel tracks: add track column to workflow_steps
    "ALTER TABLE workflow_steps ADD COLUMN track TEXT NOT NULL DEFAULT 'linkedin' CHECK(track IN ('linkedin', 'email'))",
    // Parallel tracks: create run_profile_tracks table
    `CREATE TABLE IF NOT EXISTS run_profile_tracks (
      id TEXT PRIMARY KEY,
      run_profile_id TEXT NOT NULL REFERENCES run_profiles(id) ON DELETE CASCADE,
      track TEXT NOT NULL CHECK(track IN ('linkedin', 'email')),
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
      current_step INTEGER NOT NULL DEFAULT 0,
      last_step_at TEXT,
      next_step_at TEXT,
      error_message TEXT,
      last_email_subject TEXT,
      last_email_body TEXT,
      last_linkedin_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(run_profile_id, track)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_run_profile_tracks_run_profile_id ON run_profile_tracks(run_profile_id)",
    "CREATE INDEX IF NOT EXISTS idx_run_profile_tracks_state_next ON run_profile_tracks(state, next_step_at)",
    // Drop deprecated columns from run_profiles — all consumers now read from run_profile_tracks
    // SQLite does not support DROP COLUMN directly before 3.35; handled via table rebuild below
    // Separate IMAP credentials for custom mail providers where SMTP ≠ IMAP auth
    "ALTER TABLE email_accounts ADD COLUMN imap_username TEXT",
    "ALTER TABLE email_accounts ADD COLUMN imap_password TEXT",
    "ALTER TABLE workflows ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0",
    // Per-step signature override for email steps (null = use email account default)
    "ALTER TABLE workflow_steps ADD COLUMN email_signature TEXT",
    // CRM: todos per contact
    `CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_todos_target_id ON todos(target_id)",
    "CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status)",
    "ALTER TABLE todos ADD COLUMN description TEXT",
    // CRM: activity log per contact
    `CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'note' CHECK(type IN ('call', 'email', 'meeting', 'note', 'other')),
      body TEXT NOT NULL,
      logged_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_activity_logs_target_id ON activity_logs(target_id)",
    // Reply classifier: captured email replies + classifier verdict + dispatcher result
    `CREATE TABLE IF NOT EXISTS email_replies (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      from_email TEXT NOT NULL,
      subject TEXT,
      body_text TEXT NOT NULL,
      received_at TEXT NOT NULL,
      classified_at TEXT,
      classification_json TEXT,
      classification_error TEXT,
      dispatched_at TEXT,
      dispatch_result_json TEXT,
      manually_edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_email_replies_target_id ON email_replies(target_id)",
    "CREATE INDEX IF NOT EXISTS idx_email_replies_dispatched_at ON email_replies(dispatched_at)",
    // Reply classifier verdict stamped on the target — enables reply-rate-by-kind metrics
    "ALTER TABLE targets ADD COLUMN reply_kind TEXT",
    "ALTER TABLE targets ADD COLUMN inmail_sent_at TEXT",
    "ALTER TABLE targets ADD COLUMN posts_json TEXT",        // recent posts from visit_profile
    "ALTER TABLE targets ADD COLUMN posts_scraped_at TEXT",
    // One-shot OOO reply context for the AI follow-up writer — set by the dispatcher,
    // read + cleared by the runner on the next email send. Distinct from last_email_body
    // (which holds the last email WE sent, used for follow-up threading).
    "ALTER TABLE run_profile_tracks ADD COLUMN pending_reply_context TEXT",
    // Removed the in-app chat agent (replaced by the hosted MCP endpoint at /api/mcp) — drop its tables.
    "DROP TABLE IF EXISTS chat_messages",
    "DROP TABLE IF EXISTS chat_sessions",
    // Batched/scheduled imports — split large lists across days under a daily cap.
    "ALTER TABLE list_imports ADD COLUMN account_id TEXT",
    "ALTER TABLE list_imports ADD COLUMN sales_nav_url TEXT",
    "ALTER TABLE list_imports ADD COLUMN scheduled_for TEXT",      // 'YYYY-MM-DD'; NULL = run now
    "ALTER TABLE list_imports ADD COLUMN start_page INTEGER DEFAULT 1",
    "ALTER TABLE list_imports ADD COLUMN cap INTEGER",             // max contacts for this batch
    "ALTER TABLE list_imports ADD COLUMN cancel_requested INTEGER DEFAULT 0",
    "ALTER TABLE list_imports ADD COLUMN batch_index INTEGER DEFAULT 1",
    "ALTER TABLE list_imports ADD COLUMN enrich INTEGER DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS idx_list_imports_scheduled ON list_imports(status, scheduled_for)",
    // Simple app-wide key/value settings (e.g. daily_import_cap)
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // Sales Nav InMail gets its own daily budget — separate from daily_message_limit,
    // since InMail (non-connections) and regular messages (connections) were being
    // gated off the same counter, starving one whenever the other was busy.
    "ALTER TABLE accounts ADD COLUMN daily_inmail_limit INTEGER DEFAULT 15",
    // Sales Nav search: persistent cache of resolved filter values (typeahead
    // ids). Dedup on (filter_type, id) — LinkedIn ids are stable (e.g. Berlin's
    // geoUrn never changes), so once resolved a value is reused forever with no
    // further live typeahead calls. Lives here (not ee/) per the open-core rule:
    // all migrations stay in lib/db.ts. Consumed only by the ee/ search feature.
    `CREATE TABLE IF NOT EXISTS search_filter_cache (
      id            TEXT NOT NULL,
      filter_type   TEXT NOT NULL,
      display_value TEXT NOT NULL,
      headline      TEXT,
      query         TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (filter_type, id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_sfc_type_query ON search_filter_cache(filter_type, query)",
    "CREATE INDEX IF NOT EXISTS idx_sfc_type_display ON search_filter_cache(filter_type, display_value)",
    // CSV import: lists can be flagged as linkedin- or email-only, so the runner/UI
    // can warn before enrolling a purpose-mismatched list into a campaign.
    "ALTER TABLE lists ADD COLUMN purpose TEXT",
    // Manual/CSV-only field — no automation reads or writes this, reference data only.
    "ALTER TABLE targets ADD COLUMN phone TEXT",
    // Campaign-attributed LinkedIn inbound projection. This is separate from the
    // singleton legacy reply fields so multi-slot history remains auditable.
    `CREATE TABLE IF NOT EXISTS linkedin_inbox_messages (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
      external_thread_id TEXT NOT NULL,
      external_message_id TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'inbound' CHECK(direction IN ('inbound', 'outbound')),
      sender_external_id TEXT,
      sender_name TEXT,
      body TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      captured_at TEXT NOT NULL DEFAULT (datetime('now')),
      identity_mode TEXT NOT NULL CHECK(identity_mode IN ('messaging_urn', 'profile_url', 'messaging_urn+profile_url')),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(account_id, external_thread_id, external_message_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_linkedin_inbox_target_time ON linkedin_inbox_messages(target_id, sent_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_linkedin_inbox_account_time ON linkedin_inbox_messages(account_id, sent_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_linkedin_inbox_thread_time ON linkedin_inbox_messages(account_id, external_thread_id, sent_at ASC)",
    "ALTER TABLE accounts ADD COLUMN linkedin_inbox_synced_at TEXT",
    "ALTER TABLE accounts ADD COLUMN linkedin_inbox_sync_error TEXT",
    "ALTER TABLE accounts ADD COLUMN linkedin_inbox_contract_version TEXT",
    "ALTER TABLE targets ADD COLUMN sdr_autopilot INTEGER NOT NULL DEFAULT 0",
    // SuperAdmin and Subscription Management
    "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'",
    "ALTER TABLE users ADD COLUMN company_name TEXT",
    "ALTER TABLE users ADD COLUMN slots_limit INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'active'",
    "ALTER TABLE users ADD COLUMN plan_tier TEXT DEFAULT 'starter'",
    "ALTER TABLE users ADD COLUMN paddle_customer_id TEXT",
    "ALTER TABLE users ADD COLUMN paddle_subscription_id TEXT",
    "ALTER TABLE users ADD COLUMN lemon_customer_id TEXT",
    "ALTER TABLE users ADD COLUMN lemon_subscription_id TEXT",
    "ALTER TABLE users ADD COLUMN partner_id TEXT",
    "ALTER TABLE users ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))",
    "ALTER TABLE subscription_logs ADD COLUMN customer_email TEXT",
    `CREATE TABLE IF NOT EXISTS subscription_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      customer_email TEXT,
      event_type TEXT NOT NULL,
      plan_tier TEXT,
      slots INTEGER,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_subscription_logs_user ON subscription_logs(user_id, created_at DESC)",
    // InHubFlow Official Partners Program
    `CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      payout_method TEXT DEFAULT 'PayPal',
      payout_account TEXT,
      commission_pct REAL DEFAULT 50.0,
      balance REAL DEFAULT 0.0,
      total_paid REAL DEFAULT 0.0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_partners_code ON partners(code)",
    `CREATE TABLE IF NOT EXISTS partner_referrals (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      customer_email TEXT NOT NULL,
      company_name TEXT,
      plan_id TEXT,
      subscription_id TEXT,
      amount REAL DEFAULT 0.0,
      commission_amount REAL DEFAULT 0.0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_partner_referrals_partner ON partner_referrals(partner_id, created_at DESC)",
    `CREATE TABLE IF NOT EXISTS partner_payouts (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      reference TEXT,
      notes TEXT,
      paid_at TEXT DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner ON partner_payouts(partner_id, paid_at DESC)",
    // Multi-Seat Team Management
    "ALTER TABLE users ADD COLUMN name TEXT",
    "ALTER TABLE users ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE users ADD COLUMN assigned_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL",
    "ALTER TABLE accounts ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE accounts ADD COLUMN assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL",
    `CREATE TABLE IF NOT EXISTS team_invitations (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT DEFAULT 'member' CHECK(role IN ('admin', 'member')),
      assigned_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      invite_code TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'revoked')),
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_team_invitations_code ON team_invitations(invite_code)",
    "CREATE INDEX IF NOT EXISTS idx_team_invitations_owner ON team_invitations(owner_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_users_owner ON users(owner_id)",
    "ALTER TABLE email_accounts ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL",
    // Customer Support & Ticketing System
    `CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      ticket_number INTEGER,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      user_name TEXT,
      company_name TEXT,
      subject TEXT NOT NULL,
      category TEXT DEFAULT 'general' CHECK(category IN ('general', 'campaigns', 'linkedin', 'email', 'sdr_ai', 'billing', 'bug', 'other')),
      priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'waiting_client', 'resolved', 'closed')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_reply_at TEXT DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, updated_at DESC)",
    `CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_email TEXT NOT NULL,
      sender_role TEXT NOT NULL CHECK(sender_role IN ('user', 'admin')),
      sender_name TEXT,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON support_ticket_messages(ticket_id, created_at ASC)",
    // InHubFlow Live Chat & AI Pre-qualifier System
    `CREATE TABLE IF NOT EXISTS live_chat_sessions (
      id TEXT PRIMARY KEY,
      visitor_name TEXT,
      visitor_email TEXT,
      company_name TEXT,
      language TEXT DEFAULT 'es',
      status TEXT DEFAULT 'ai_active' CHECK(status IN ('ai_active', 'human_takeover', 'resolved', 'closed')),
      needs_human INTEGER DEFAULT 0,
      human_notified INTEGER DEFAULT 0,
      page_url TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_visitor_message_at TEXT DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_live_chat_sessions_status ON live_chat_sessions(status, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_live_chat_sessions_needs_human ON live_chat_sessions(needs_human, updated_at DESC)",
    `CREATE TABLE IF NOT EXISTS live_chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES live_chat_sessions(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL CHECK(sender_type IN ('visitor', 'ai', 'human_agent')),
      sender_name TEXT,
      message TEXT NOT NULL,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_live_chat_messages_session ON live_chat_messages(session_id, created_at ASC)",
    // Typing indicators for WhatsApp-like real-time status
    "ALTER TABLE live_chat_sessions ADD COLUMN operator_typing_until TEXT",
    "ALTER TABLE live_chat_sessions ADD COLUMN visitor_typing_until TEXT",
    "ALTER TABLE live_chat_sessions ADD COLUMN visitor_phone TEXT",
    // Web Push subscriptions for mobile PWA push notifications (works when app is closed)
    `CREATE TABLE IF NOT EXISTS live_chat_push_subscriptions (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_email TEXT,
      user_agent TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      last_success_at TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_live_chat_push_active ON live_chat_push_subscriptions(active)",
    // Immutable, account-scoped ledger for LinkedIn connection submissions.
    // Unlike target state or campaign logs, these rows survive profile removal
    // and cannot be attributed to a different LinkedIn account later.
    `CREATE TABLE IF NOT EXISTS linkedin_connection_attempts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      run_id TEXT,
      target_id TEXT,
      outcome TEXT NOT NULL DEFAULT 'prepared' CHECK(outcome IN ('prepared', 'submitted', 'confirmed', 'uncertain', 'rejected')),
      error_message TEXT,
      attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_linkedin_connection_attempts_account_time ON linkedin_connection_attempts(account_id, attempted_at)",
    // Durable one-shot flag used by "Run now" across Next.js workers without
    // mutating the account's configured working hours.
    "ALTER TABLE run_profile_tracks ADD COLUMN force_run_once INTEGER NOT NULL DEFAULT 0",
    // Cross-process leases prevent Next.js workers or API-triggered ticks from
    // running the same browser/session work concurrently.
    `CREATE TABLE IF NOT EXISTS runtime_leases (
      lease_key TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // Extension worker tracking: registers client-side extension status and ping
    "ALTER TABLE accounts ADD COLUMN extension_active INTEGER DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN last_extension_ping_at TEXT",
    // Unipile API Integration
    "ALTER TABLE accounts ADD COLUMN unipile_account_id TEXT",
    "ALTER TABLE accounts ADD COLUMN unipile_status TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_unipile_account_id ON accounts(unipile_account_id) WHERE unipile_account_id IS NOT NULL",
    "ALTER TABLE targets ADD COLUMN unipile_provider_id TEXT",
    "ALTER TABLE targets ADD COLUMN unipile_chat_id TEXT",
    // Account-scoped LinkedIn identity and relationship state. The legacy target
    // columns remain as backwards-compatible projections for single-account data.
    `CREATE TABLE IF NOT EXISTS linkedin_target_accounts (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      unipile_provider_id TEXT,
      unipile_chat_id TEXT,
      degree INTEGER,
      connection_requested_at TEXT,
      connected_at TEXT,
      message_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, target_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_linkedin_target_accounts_provider ON linkedin_target_accounts(account_id, unipile_provider_id)",
    "CREATE INDEX IF NOT EXISTS idx_linkedin_target_accounts_chat ON linkedin_target_accounts(account_id, unipile_chat_id)",
    // One row per workflow action prevents duplicate sends after process restarts
    // while allowing multiple message steps for the same target.
    `CREATE TABLE IF NOT EXISTS linkedin_step_deliveries (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES run_profile_tracks(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL CHECK(action_type IN ('connect', 'message')),
      state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared', 'confirmed', 'uncertain', 'failed')),
      external_id TEXT,
      external_thread_id TEXT,
      payload_hash TEXT,
      error_message TEXT,
      attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
      confirmed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(track_id, step_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_linkedin_step_deliveries_account_time ON linkedin_step_deliveries(account_id, attempted_at)",
    // Workflow step attachments (audio / voice note, PDF, image, video)
    "ALTER TABLE workflow_steps ADD COLUMN attachment_url TEXT",
    "ALTER TABLE workflow_steps ADD COLUMN attachment_name TEXT",
    "ALTER TABLE workflow_steps ADD COLUMN attachment_type TEXT",
    "ALTER TABLE workflow_steps ADD COLUMN attachment_size INTEGER",
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  // Preserve quota history across the ledger migration. This helper also avoids
  // duplicating rows for sends already recorded by the current runtime.
  try { backfillLinkedInConnectionAttempts(db); } catch { /* table/logs unavailable */ }

  // Migrate linkedin_inbox_messages CHECK constraint to allow 'outbound' direction
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='linkedin_inbox_messages'").get() as { sql: string } | undefined;
    if (tableInfo && !tableInfo.sql.includes("'outbound'")) {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE linkedin_inbox_messages_new (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
          external_thread_id TEXT NOT NULL,
          external_message_id TEXT NOT NULL,
          direction TEXT NOT NULL DEFAULT 'inbound' CHECK(direction IN ('inbound', 'outbound')),
          sender_external_id TEXT,
          sender_name TEXT,
          body TEXT NOT NULL,
          sent_at TEXT NOT NULL,
          captured_at TEXT NOT NULL DEFAULT (datetime('now')),
          identity_mode TEXT NOT NULL CHECK(identity_mode IN ('messaging_urn', 'profile_url', 'messaging_urn+profile_url')),
          metadata_json TEXT NOT NULL DEFAULT '{}',
          UNIQUE(account_id, external_thread_id, external_message_id)
        );
        INSERT INTO linkedin_inbox_messages_new SELECT * FROM linkedin_inbox_messages;
        DROP TABLE linkedin_inbox_messages;
        ALTER TABLE linkedin_inbox_messages_new RENAME TO linkedin_inbox_messages;
        CREATE INDEX IF NOT EXISTS idx_linkedin_inbox_target_time ON linkedin_inbox_messages(target_id, sent_at DESC);
        CREATE INDEX IF NOT EXISTS idx_linkedin_inbox_account_time ON linkedin_inbox_messages(account_id, sent_at DESC);
        CREATE INDEX IF NOT EXISTS idx_linkedin_inbox_thread_time ON linkedin_inbox_messages(account_id, external_thread_id, sent_at ASC);
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch { /* ignore */ }

  // Deduplicate any repeated linkedin_inbox_messages rows. Keyed on the provider's
  // message id (plus thread/account), NOT on the body: two genuine replies with the
  // same text ("Gracias", "Ok") are legitimate and must not be collapsed.
  try {
    db.exec(`
      DELETE FROM linkedin_inbox_messages
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM linkedin_inbox_messages
        GROUP BY account_id, external_thread_id, COALESCE(external_message_id, id)
      );
    `);
  } catch { /* ignore */ }

  // Parallel tracks: assign email steps to email track, re-number step_order, backfill run_profile_tracks
  runParallelTracksMigration(db);
  // Drop deprecated run_profiles columns (state, current_step, etc.) — consumers now read track-runs
  dropDeprecatedRunProfileColumns(db);

  // Migrate workflow_steps CHECK constraint to allow 'delay' and 'email' step_types
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='workflow_steps'").get() as { sql: string } | undefined;
    if (tableInfo && (!tableInfo.sql.includes("'delay'") || !tableInfo.sql.includes("'email'"))) {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE workflow_steps_new (
          id TEXT PRIMARY KEY,
          workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE,
          step_order INTEGER NOT NULL,
          step_type TEXT NOT NULL CHECK(step_type IN ('visit', 'connect', 'message', 'delay', 'email')),
          template_id TEXT REFERENCES templates(id),
          delay_seconds INTEGER DEFAULT 0,
          connect_note TEXT,
          message_body TEXT,
          email_subject TEXT,
          email_body TEXT,
          enabled INTEGER DEFAULT 1
        );
        INSERT INTO workflow_steps_new
          SELECT id, workflow_id, step_order, step_type, template_id, delay_seconds,
                 connect_note, message_body,
                 NULL, NULL,
                 enabled
          FROM workflow_steps;
        DROP TABLE workflow_steps;
        ALTER TABLE workflow_steps_new RENAME TO workflow_steps;
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch { /* migration already done */ }

  // Allow the 'sales_inmail' step_type (Sales Navigator InMail). Rebuilds the
  // table preserving EVERY current column (the historical rebuild above only
  // copied the original columns — do NOT reuse it). InMail reuses message_body
  // for the body and email_subject for the required subject.
  try {
    const ti = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='workflow_steps'").get() as { sql: string } | undefined;
    if (ti && !ti.sql.includes("'sales_inmail'")) {
      const cols = (db.prepare("PRAGMA table_info(workflow_steps)").all() as Array<{ name: string }>).map((c) => c.name);
      const colList = cols.join(", ");
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE workflow_steps_new (
          id TEXT PRIMARY KEY,
          workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE,
          step_order INTEGER NOT NULL,
          step_type TEXT NOT NULL CHECK(step_type IN ('visit', 'connect', 'message', 'sales_inmail', 'delay', 'email')),
          template_id TEXT REFERENCES templates(id),
          delay_seconds INTEGER DEFAULT 0,
          connect_note TEXT,
          message_body TEXT,
          email_subject TEXT,
          email_body TEXT,
          enabled INTEGER DEFAULT 1,
          ai_enabled INTEGER DEFAULT 0,
          ai_model TEXT,
          ai_prompt TEXT,
          ai_max_words INTEGER,
          email_position INTEGER DEFAULT 1,
          message_position INTEGER DEFAULT 1,
          ai_language TEXT DEFAULT 'English',
          track TEXT NOT NULL DEFAULT 'linkedin' CHECK(track IN ('linkedin', 'email')),
          email_signature TEXT
        );
        INSERT INTO workflow_steps_new (${colList}) SELECT ${colList} FROM workflow_steps;
        DROP TABLE workflow_steps;
        ALTER TABLE workflow_steps_new RENAME TO workflow_steps;
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch { /* migration already done */ }

  // Allow the 'follow' step_type (Follow Profile). Rebuilds the table preserving
  // every existing column and updates CHECK constraint to include 'follow'.
  try {
    const ti = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='workflow_steps'").get() as { sql: string } | undefined;
    if (ti && !ti.sql.includes("'follow'")) {
      const cols = (db.prepare("PRAGMA table_info(workflow_steps)").all() as Array<{ name: string }>).map((c) => c.name);
      const colList = cols.join(", ");
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE workflow_steps_new (
          id TEXT PRIMARY KEY,
          workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE,
          step_order INTEGER NOT NULL,
          step_type TEXT NOT NULL CHECK(step_type IN ('visit', 'follow', 'connect', 'message', 'sales_inmail', 'delay', 'email')),
          template_id TEXT REFERENCES templates(id),
          delay_seconds INTEGER DEFAULT 0,
          connect_note TEXT,
          message_body TEXT,
          email_subject TEXT,
          email_body TEXT,
          enabled INTEGER DEFAULT 1,
          ai_enabled INTEGER DEFAULT 0,
          ai_model TEXT,
          ai_prompt TEXT,
          ai_max_words INTEGER,
          email_position INTEGER DEFAULT 1,
          message_position INTEGER DEFAULT 1,
          ai_language TEXT DEFAULT 'English',
          track TEXT NOT NULL DEFAULT 'linkedin' CHECK(track IN ('linkedin', 'email')),
          email_signature TEXT,
          attachment_url TEXT,
          attachment_name TEXT,
          attachment_type TEXT,
          attachment_size INTEGER
        );
        INSERT INTO workflow_steps_new (${colList}) SELECT ${colList} FROM workflow_steps;
        DROP TABLE workflow_steps;
        ALTER TABLE workflow_steps_new RENAME TO workflow_steps;
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch (err) {
    console.error("[db migration] Error migrating workflow_steps for 'follow':", err);
  }

  // CSV import: allow email-only targets (no LinkedIn URL). targets.linkedin_url was
  // NOT NULL UNIQUE from the base schema — rebuild to make it nullable (still UNIQUE,
  // SQLite allows multiple NULLs under UNIQUE) preserving EVERY current column, same
  // pattern as the sales_inmail rebuild above (do not reuse the older historical rebuilds
  // that only copied the original columns).
  try {
    const ti = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='targets'").get() as { sql: string } | undefined;
    if (ti && ti.sql.includes("linkedin_url TEXT NOT NULL")) {
      const cols = (db.prepare("PRAGMA table_info(targets)").all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>);
      const colDefs = cols.map((c) => {
        if (c.name === "linkedin_url") return "linkedin_url TEXT UNIQUE";
        if (c.name === "id") return "id TEXT PRIMARY KEY";
        const notnull = c.notnull ? " NOT NULL" : "";
        // Non-literal defaults (e.g. datetime('now')) must be parenthesized in SQLite DDL.
        const isLiteral = c.dflt_value === null || /^-?\d+(\.\d+)?$/.test(c.dflt_value) || /^'.*'$/.test(c.dflt_value);
        const dflt = c.dflt_value !== null ? ` DEFAULT ${isLiteral ? c.dflt_value : `(${c.dflt_value})`}` : "";
        return `${c.name} ${c.type}${notnull}${dflt}`;
      });
      const colList = cols.map((c) => c.name).join(", ");
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE targets_new (
          ${colDefs.join(",\n          ")}
        );
        INSERT INTO targets_new (${colList}) SELECT ${colList} FROM targets;
        DROP TABLE targets;
        ALTER TABLE targets_new RENAME TO targets;
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch { /* migration already done */ }

  // Rebuild users table if plan_tier CHECK constraint is missing 'business' or contains 'scale'
  try {
    const ti = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string } | undefined;
    if (ti && (!ti.sql.includes("'business'") || ti.sql.includes("'scale'"))) {
      const cols = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>);
      const colDefs = cols.map((c) => {
        if (c.name === "id") return "id TEXT PRIMARY KEY";
        if (c.name === "email") return "email TEXT NOT NULL UNIQUE";
        if (c.name === "plan_tier") return "plan_tier TEXT DEFAULT 'starter' CHECK(plan_tier IN ('starter', 'growth', 'business', 'custom'))";
        const notnull = c.notnull ? " NOT NULL" : "";
        const isLiteral = c.dflt_value === null || /^-?\d+(\.\d+)?$/.test(c.dflt_value) || /^'.*'$/.test(c.dflt_value);
        const dflt = c.dflt_value !== null ? ` DEFAULT ${isLiteral ? c.dflt_value : `(${c.dflt_value})`}` : "";
        return `${c.name} ${c.type}${notnull}${dflt}`;
      });
      const colList = cols.map((c) => c.name).join(", ");
      const selectList = cols.map((c) => c.name === "plan_tier" ? "CASE WHEN plan_tier = 'scale' THEN 'business' ELSE plan_tier END AS plan_tier" : c.name).join(", ");
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE users_new (
          ${colDefs.join(",\n          ")}
        );
        INSERT INTO users_new (${colList}) SELECT ${selectList} FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        CREATE INDEX IF NOT EXISTS idx_users_owner ON users(owner_id);
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch (e) {
    console.error("Users table schema rebuild notice:", e);
  }

  // Ensure all existing scale references in users and subscription_logs are upgraded to business
  try {
    db.prepare("UPDATE users SET plan_tier = 'business' WHERE plan_tier = 'scale'").run();
    db.prepare("UPDATE subscription_logs SET plan_tier = 'business' WHERE plan_tier = 'scale'").run();
  } catch { /* ignore */ }

  // Backfill: move company_description and company_size from targets into companies
  try {
    db.exec(`
      UPDATE companies
      SET
        description = COALESCE(description, (
          SELECT t.company_description FROM targets t
          WHERE t.company_id = companies.id AND t.company_description IS NOT NULL
          LIMIT 1
        )),
        employee_count = COALESCE(employee_count, (
          SELECT t.company_size FROM targets t
          WHERE t.company_id = companies.id AND t.company_size IS NOT NULL
          LIMIT 1
        ))
      WHERE description IS NULL OR employee_count IS NULL
    `);
  } catch { /* ignore */ }

  // Backfill: for old records where linkedin_url is a Sales Nav URL, move it to sales_nav_url
  try {
    db.exec(`
      UPDATE targets
      SET sales_nav_url = linkedin_url
      WHERE linkedin_url LIKE '%/sales/lead/%' AND (sales_nav_url IS NULL OR sales_nav_url = '')
    `);
  } catch { /* ignore */ }

  // Create unique index on run_profiles if not already present (idempotent)
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_run_profiles_unique ON run_profiles(run_id, target_id);");
  } catch { /* ignore */ }

  cleanExistingMessyTargetsMigration(db);
  encryptLegacySecretsMigration(db);

  // Optional SDR module: additive tables only. Applying the schema does not
  // initialize a provider, start a worker, or alter existing core behavior.
  applySdrSchema(db);

  // Pipeline CRM module: Kanban stages and target stage associations.
  applyPipelineSchema(db);

  // Tags module: AI/manual conversation labels that drive funnel progression.
  applyTagsSchema(db);

  // Calendar and scheduling module
  applyCalendarSchema(db);

  // Signal Radar module: Intent-based signal monitors, hot leads, and events
  applySignalSchema(db);

  // Companies and Account-Based Marketing (ABM) module
  applyCompaniesSchema(db);

  // Keep provider implementation details out of customer-facing activity and
  // diagnostics, including historical rows written by older releases.
  sanitizePublicProviderBrandingMigration(db);

  // Purge orphan non-campaign contacts (e.g. personal DMs, Uber, spam).
  // Their inbox history is left intact: deleting it on every boot also destroyed
  // legitimate conversations that had simply not been re-imported yet.
  cleanOrphanNonCampaignInboxDataMigration(db);
}

function cleanOrphanNonCampaignInboxDataMigration(db: Database.Database) {
  try {
    db.transaction(() => {
      // 1. Delete sdr_threads for targets that were never enrolled in a campaign run nor part of a list
      db.exec(`
        DELETE FROM sdr_threads
        WHERE target_id IN (
          SELECT t.id FROM targets t
          WHERE NOT EXISTS (SELECT 1 FROM run_profiles rp WHERE rp.target_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM list_targets lt WHERE lt.target_id = t.id)
        );
      `);

      // 2. Inbox history is intentionally preserved. Deleting it here removed real
      //    conversations on every restart, including threads that were still mid-import.
      //    Orphan targets themselves are still removed below, so the contacts do not linger.

      // 3. Delete linkedin_target_accounts for those orphan targets
      db.exec(`
        DELETE FROM linkedin_target_accounts
        WHERE target_id IN (
          SELECT t.id FROM targets t
          WHERE NOT EXISTS (SELECT 1 FROM run_profiles rp WHERE rp.target_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM list_targets lt WHERE lt.target_id = t.id)
        );
      `);

      // 4. Delete the orphan targets themselves (specifically those with last_replied_at or created by inbox sync).
      //    Targets that have real conversation history are kept: linkedin_inbox_messages
      //    cascades on target delete, so removing the contact would silently erase the
      //    conversation too. Only the obvious junk filter (Uber) still applies.
      db.exec(`
        DELETE FROM targets
        WHERE full_name LIKE '%Uber%'
        AND NOT EXISTS (SELECT 1 FROM run_profiles rp WHERE rp.target_id = targets.id)
        AND NOT EXISTS (SELECT 1 FROM list_targets lt WHERE lt.target_id = targets.id)
        AND NOT EXISTS (SELECT 1 FROM linkedin_inbox_messages m WHERE m.target_id = targets.id);
      `);
    })();
  } catch (err) {
    console.error("[db] cleanOrphanNonCampaignInboxDataMigration error:", err);
  }
}

function sanitizePublicProviderBrandingMigration(db: Database.Database) {
  const textColumns = [
    ["logs", "message"],
    ["run_profile_tracks", "error_message"],
    ["linkedin_connection_attempts", "error_message"],
    ["linkedin_step_deliveries", "error_message"],
    ["accounts", "linkedin_inbox_sync_error"],
  ] as const;

  try {
    db.exec(`
      UPDATE logs SET message = substr(message, 8)
      WHERE message LIKE '[INFO] %';
      UPDATE logs SET message = substr(message, 8)
      WHERE message LIKE '[WARN] %';
      UPDATE logs SET message = substr(message, 9)
      WHERE message LIKE '[ERROR] %';
    `);
  } catch { /* legacy logs unavailable */ }

  for (const [table, column] of textColumns) {
    try {
      db.exec(`
        UPDATE ${table}
        SET ${column} = replace(
          replace(
            replace(
              replace(${column},
                'Perfil visitado/sincronizado vía Unipile para ',
                'Perfil visitado y sincronizado con éxito para '
              ),
              ' vía Unipile',
              ' con éxito!'
            ),
            'Unipile/LinkedIn',
            'LinkedIn'
          ),
          'Unipile',
          'motor de LinkedIn'
        )
        WHERE ${column} LIKE '%Unipile%'
      `);
    } catch { /* optional/legacy table or column */ }
  }

  for (const table of ["linkedin_inbox_messages", "sdr_messages"]) {
    try {
      db.exec(`
        UPDATE ${table}
        SET metadata_json = replace(
          replace(metadata_json, 'unipile-webhook', 'linkedin-webhook'),
          'unipile-backfill', 'linkedin-backfill'
        )
        WHERE metadata_json LIKE '%unipile%'
      `);
    } catch { /* optional module */ }
  }
}

// Cleanup migration for previously inserted targets that had concatenated DOM card strings
function cleanExistingMessyTargetsMigration(db: Database.Database) {
  try {
    const dirtyTargets = db.prepare(
      "SELECT id, full_name, title, location, company FROM targets WHERE full_name LIKE '%•%' OR full_name LIKE '%Mensagem%' OR full_name LIKE '%Conectar%' OR length(full_name) > 45"
    ).all() as Array<{ id: string; full_name: string; title: string | null; location: string | null; company: string | null }>;

    if (dirtyTargets.length === 0) return;

    const update = db.prepare(`
      UPDATE targets SET
        full_name = ?,
        first_name = ?,
        last_name = ?,
        title = COALESCE(?, title),
        location = COALESCE(?, location),
        company = COALESCE(?, company)
      WHERE id = ?
    `);

    for (const t of dirtyTargets) {
      let raw = t.full_name;
      let title = t.title;
      const location = t.location;
      let company = t.company;

      if (raw.includes("•")) {
        const parts = raw.split(/\s*•\s*/);
        raw = parts[0].trim();
        if (parts.length > 1 && !title) {
          const rest = parts.slice(1).join(" ").replace(/^\d+(?:º|st|nd|rd)?(?:\s+e|\s+y)?\s*/i, "").trim();
          const actionMatch = rest.match(/(?:Mensagem|Conectar|Seguir|Message|Connect|Follow|Atual:|Current:|Anterior:)/i);
          title = actionMatch && actionMatch.index ? rest.slice(0, actionMatch.index).trim() : rest;
        }
      }

      // De-duplicate repeated names
      const words = raw.split(/\s+/);
      if (words.length >= 2 && words.length % 2 === 0) {
        const half = words.length / 2;
        if (words.slice(0, half).join(" ").toLowerCase() === words.slice(half).join(" ").toLowerCase()) {
          raw = words.slice(0, half).join(" ");
        }
      } else if (words.length >= 4) {
        for (let h = Math.floor(words.length / 2); h >= 2; h--) {
          if (words.slice(0, h).join(" ").toLowerCase() === words.slice(h, h * 2).join(" ").toLowerCase()) {
            raw = words.slice(0, h).join(" ");
            break;
          }
        }
      }

      const nameTokens = raw.split(/\s+/);
      const firstName = nameTokens[0] || null;
      const lastName = nameTokens.slice(1).join(" ") || null;

      if (title) {
        title = title.replace(/^\+\s*/, "").replace(/\s*(?:Mensagem|Conectar|Seguir).*$/i, "").trim();
        const compMatch = title.match(/(?:at|en|@|\|)\s+([^,|•\n]+)/i);
        if (compMatch && !company) company = compMatch[1].trim();
      }

      update.run(raw, firstName, lastName, title, location, company, t.id);
    }
  } catch { /* ignore */ }
}

// One-time (per-row) migration: encrypt any plaintext accounts.cookies_json,
// email_accounts.password/imap_password, integrations.api_key left over from before
// encryption-at-rest was added. isEncrypted() lets this run safely on every boot — already
//-encrypted rows (real "v1:" ciphertext) are skipped, so this is idempotent and cheap once
// migrated. See lib/crypto.ts for the format and lib/premium.ts-style boundary notes.
function encryptLegacySecretsMigration(db: Database.Database) {
  const accounts = db.prepare("SELECT id, cookies_json FROM accounts WHERE cookies_json IS NOT NULL").all() as
    { id: string; cookies_json: string }[];
  for (const row of accounts) {
    if (isEncrypted(row.cookies_json)) continue;
    db.prepare("UPDATE accounts SET cookies_json = ? WHERE id = ?").run(encryptSecret(row.cookies_json), row.id);
  }

  const emailAccounts = db
    .prepare("SELECT id, password, imap_password FROM email_accounts")
    .all() as { id: string; password: string; imap_password: string | null }[];
  for (const row of emailAccounts) {
    const needsPassword = !isEncrypted(row.password);
    const needsImapPassword = row.imap_password !== null && !isEncrypted(row.imap_password);
    if (!needsPassword && !needsImapPassword) continue;
    db.prepare("UPDATE email_accounts SET password = ?, imap_password = ? WHERE id = ?").run(
      needsPassword ? encryptSecret(row.password) : row.password,
      needsImapPassword ? encryptSecret(row.imap_password!) : row.imap_password,
      row.id
    );
  }

  const integrations = db.prepare("SELECT key, api_key FROM integrations WHERE api_key IS NOT NULL").all() as
    { key: string; api_key: string }[];
  for (const row of integrations) {
    if (isEncrypted(row.api_key)) continue;
    db.prepare("UPDATE integrations SET api_key = ? WHERE key = ?").run(encryptSecret(row.api_key), row.key);
  }
}

function initDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      cookies_json TEXT,
      is_authenticated INTEGER DEFAULT 0,
      daily_connection_limit INTEGER DEFAULT 20,
      daily_message_limit INTEGER DEFAULT 50,
      daily_inmail_limit INTEGER DEFAULT 15,
      active_hours_start INTEGER DEFAULT 9,
      active_hours_end INTEGER DEFAULT 18,
      timezone TEXT DEFAULT 'UTC',
      working_days TEXT DEFAULT '1,2,3,4,5',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY,
      linkedin_url TEXT UNIQUE,
      sales_nav_url TEXT,
      first_name TEXT,
      last_name TEXT,
      full_name TEXT,
      title TEXT,
      company TEXT,
      location TEXT,
      profile_image_url TEXT,
      degree INTEGER,
      connection_requested_at TEXT,
      connected_at TEXT,
      message_sent_at TEXT,
      last_replied_at TEXT,
      last_replied_account_id TEXT REFERENCES accounts(id),
      linkedin_member_urn TEXT,
      enriched_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sales_nav_url TEXT,
      purpose TEXT CHECK(purpose IN ('linkedin', 'email')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS list_targets (
      list_id TEXT REFERENCES lists(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES targets(id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_steps (
      id TEXT PRIMARY KEY,
      workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      step_type TEXT NOT NULL CHECK(step_type IN ('visit', 'follow', 'connect', 'message', 'sales_inmail', 'delay', 'email')),
      template_id TEXT REFERENCES templates(id),
      delay_seconds INTEGER DEFAULT 0,
      connect_note TEXT,
      message_body TEXT,
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS workflow_step_templates (
      step_id TEXT REFERENCES workflow_steps(id) ON DELETE CASCADE,
      template_id TEXT REFERENCES templates(id) ON DELETE CASCADE,
      PRIMARY KEY (step_id, template_id)
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT REFERENCES workflows(id),
      list_id TEXT REFERENCES lists(id),
      account_id TEXT REFERENCES accounts(id),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'paused', 'completed', 'failed')),
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      runner_pid INTEGER
    );

    CREATE TABLE IF NOT EXISTS run_profiles (
      id TEXT PRIMARY KEY,
      run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES targets(id),
      state TEXT DEFAULT 'pending' CHECK(state IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
      current_step INTEGER DEFAULT 0,
      last_step_at TEXT,
      next_step_at TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(run_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES targets(id),
      level TEXT DEFAULT 'info' CHECK(level IN ('info', 'warn', 'error')),
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      company_name TEXT,
      slots_limit INTEGER DEFAULT 1,
      subscription_status TEXT DEFAULT 'active' CHECK(subscription_status IN ('active', 'trial', 'past_due', 'canceled')),
      plan_tier TEXT DEFAULT 'starter' CHECK(plan_tier IN ('starter', 'growth', 'business', 'custom')),
      paddle_customer_id TEXT,
      paddle_subscription_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subscription_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      customer_email TEXT,
      event_type TEXT NOT NULL,
      plan_tier TEXT,
      slots INTEGER,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      industry TEXT,
      location TEXT,
      linkedin_url TEXT,
      website TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS integrations (
      key TEXT PRIMARY KEY,
      api_key TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      system_prompt TEXT,
      user_prompt TEXT,
      email_examples TEXT,
      linkedin_examples TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      target_id TEXT,
      step_id TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd REAL,
      prompt TEXT,
      generated_text TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Hosted MCP OAuth 2.1 server: clients (DCR), single-use auth codes, access/refresh tokens.
    -- Tokens/codes are stored only as sha256 hashes. Reuses NEXTAUTH user identity.
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT,
      redirect_uris TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_auth_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      scope TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id TEXT PRIMARY KEY,
      access_hash TEXT NOT NULL UNIQUE,
      refresh_hash TEXT UNIQUE,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scope TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      from_email TEXT NOT NULL,
      from_name TEXT,
      smtp_host TEXT NOT NULL,
      smtp_port INTEGER DEFAULT 587,
      smtp_secure INTEGER DEFAULT 0,
      imap_host TEXT,
      imap_port INTEGER DEFAULT 993,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      daily_email_limit INTEGER DEFAULT 50,
      active_hours_start INTEGER DEFAULT 9,
      active_hours_end INTEGER DEFAULT 18,
      timezone TEXT DEFAULT 'UTC',
      working_days TEXT DEFAULT '1,2,3,4,5',
      is_verified INTEGER DEFAULT 0,
      inbox_synced_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function schedulePhotoSyncCheck(database: Database.Database) {
  setTimeout(async () => {
    try {
      const { unipile } = await import("@/lib/unipile/client");
      if (!unipile.isConfigured()) return;

      const account = database.prepare(
        "SELECT id, unipile_account_id FROM accounts WHERE is_authenticated = 1 LIMIT 1"
      ).get() as { id: string; unipile_account_id?: string | null } | undefined;
      if (!account || !account.unipile_account_id) return;

      // 1. Fast backfill from chat attendees
      const targetsWithChat = database.prepare(
        `SELECT id, unipile_chat_id FROM targets
         WHERE (profile_image_url IS NULL OR profile_image_url = '')
           AND unipile_chat_id IS NOT NULL
         LIMIT 25`
      ).all() as Array<{ id: string; unipile_chat_id: string }>;

      for (const t of targetsWithChat) {
        try {
          const attendees = await unipile.listChatAttendees(t.unipile_chat_id);
          const other = (attendees.items || []).find((a) => !a.is_self) || attendees.items?.[0];
          if (other?.picture_url) {
            database.prepare("UPDATE targets SET profile_image_url = ? WHERE id = ?").run(other.picture_url, t.id);
          }
        } catch {}
      }

      // 2. Backfill targets with linkedin_url
      const targetsWithUrl = database.prepare(
        `SELECT id, linkedin_url FROM targets
         WHERE (profile_image_url IS NULL OR profile_image_url = '')
           AND linkedin_url IS NOT NULL
         ORDER BY last_replied_at DESC NULLS LAST, created_at DESC
         LIMIT 15`
      ).all() as Array<{ id: string; linkedin_url: string }>;

      for (const t of targetsWithUrl) {
        try {
          await new Promise((r) => setTimeout(r, 350));
          const profile = await unipile.resolveProfile(t.linkedin_url, account.unipile_account_id);
          const photoUrl =
            profile.profile_picture_url_large ||
            profile.profile_picture_url ||
            ((profile as unknown as { picture_url?: string }).picture_url ?? null);
          if (photoUrl) {
            database.prepare("UPDATE targets SET profile_image_url = ? WHERE id = ?").run(photoUrl, t.id);
          }
        } catch {}
      }
    } catch {}
  }, 4000);
}

