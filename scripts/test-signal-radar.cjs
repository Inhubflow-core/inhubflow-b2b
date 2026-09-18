#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const Database = require("better-sqlite3");

const root = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) request = path.join(root, request.slice(2));
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
Module._extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

const { applySignalSchema } = require("../lib/signals/schema.ts");
const { SignalRadarService } = require("../lib/signals/service.ts");
const { scanRealSignals, accountHasSalesNavigator } = require("../lib/signals/scanners/index.ts");
const { deterministicAntiStalkerMessage, validateAntiStalkerMessage } = require("../lib/signals/message-template.ts");
const { deterministicSignalResearchPlan } = require("../lib/signals/research-planner.ts");
const { scanWebSignals, companyMatches } = require("../lib/signals/scanners/web.ts");
const { extractCompanyFromHeadline } = require("../lib/signals/scanners/scoring.ts");
const { WebSearchClient } = require("../lib/serper/client.ts");

function baseDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, owner_id TEXT);
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, owner_id TEXT, assigned_user_id TEXT,
      unipile_account_id TEXT, unipile_status TEXT, is_authenticated INTEGER DEFAULT 1,
      sdr_enabled INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, is_archived INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE workflow_steps (
      id TEXT PRIMARY KEY, workflow_id TEXT, track TEXT, step_order INTEGER, step_type TEXT,
      delay_seconds INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, message_body TEXT
    );
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, linkedin_url TEXT UNIQUE, first_name TEXT, last_name TEXT,
      full_name TEXT, headline TEXT, title TEXT, company TEXT, location TEXT,
      unipile_provider_id TEXT, sdr_autopilot INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE list_targets (list_id TEXT, target_id TEXT, PRIMARY KEY(list_id,target_id));
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, workflow_id TEXT, list_id TEXT, account_id TEXT, email_account_id TEXT,
      status TEXT DEFAULT 'pending', started_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE run_profiles (
      id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT, email_account_id TEXT,
      created_at TEXT DEFAULT (datetime('now')), UNIQUE(run_id,target_id)
    );
    CREATE TABLE run_profile_tracks (
      id TEXT PRIMARY KEY, run_profile_id TEXT, track TEXT, state TEXT DEFAULT 'pending',
      current_step INTEGER DEFAULT 0, next_step_at TEXT, created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(run_profile_id,track)
    );
    CREATE TABLE runtime_leases (lease_key TEXT PRIMARY KEY, owner_id TEXT, expires_at_ms INTEGER, updated_at TEXT);
  `);
  return db;
}

function mockClient(overrides = {}) {
  let searchCalls = 0;
  return {
    isConfigured: () => true,
    listAccounts: async () => ({ items: [] }),
    getAccount: async () => ({ id: "remote-1", type: "LINKEDIN", sources: [{ status: "OK" }], connection_params: {} }),
    searchLinkedIn: async () => {
      searchCalls++;
      return {
        object: "LinkedinSearch",
        items: [{
          type: "POST", id: "post-1", social_id: "urn:li:activity:12345",
          share_url: "https://www.linkedin.com/posts/example-activity-12345",
          parsed_datetime: "2026-09-16T10:00:00.000Z", text: "Busco mejorar la prospección B2B",
          author: { id: "provider-1", public_identifier: "ana-real", name: "Ana Real", headline: "VP Sales" },
        }],
        cursor: null,
      };
    },
    listLinkedInSearchParameters: async () => ({ items: [] }),
    getPostComments: async () => ({ items: [] }),
    getPostReactions: async () => ({ items: [] }),
    resolveProfile: async () => ({
      object: "UserProfile", provider: "LINKEDIN", provider_id: "provider-1",
      public_identifier: "ana-real", public_profile_url: "https://www.linkedin.com/in/ana-real/",
      first_name: "Ana", last_name: "Real", headline: "VP Sales", location: "Madrid, España",
      work_experience: [{ company: "Real SaaS", position: "VP Sales", current: true, start: "2026-08-01" }],
    }),
    get searchCalls() { return searchCalls; },
    ...overrides,
  };
}

async function run() {
  console.log("▶ Ask AI interpreta consultas claras incluso si Gemini está saturado");
  {
    const plan = deterministicSignalResearchPlan("Encuentra 10 CEOs que levantaron fondos de inversión");
    assert.ok(["funding_round", "keyword_intent"].includes(plan.signalType));
    assert.equal(plan.resultLimit, 10);
    assert.ok(plan.titles.includes("CEO"));
    assert.ok(plan.keywords.some((keyword) => /inversi[oó]n|funding/i.test(keyword)));
    assert.equal(plan.model, "deterministic-fallback");
  }

  console.log("▶ Migración preserva monitores y leads legacy");
  {
    const db = baseDb();
    db.exec(`
      CREATE TABLE signal_monitors (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('post_engagement','job_changes')),
        target_url TEXT, competitor_name TEXT, keywords_json TEXT, icp_filters_json TEXT,
        mode TEXT DEFAULT 'review', status TEXT DEFAULT 'active', account_id TEXT,
        target_list_id TEXT, target_workflow_id TEXT, last_checked_at TEXT, created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE signal_leads (
        id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL, linkedin_url TEXT NOT NULL,
        full_name TEXT NOT NULL, headline TEXT, company TEXT, location TEXT,
        signal_type TEXT NOT NULL, signal_snippet TEXT, icebreaker_preview TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','imported')),
        score INTEGER DEFAULT 85, imported_target_id TEXT, metadata_json TEXT,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO signal_monitors (id,name,type,created_by) VALUES ('legacy-monitor','Legacy','post_engagement','owner-1');
      INSERT INTO signal_leads (id,monitor_id,linkedin_url,full_name,signal_type) VALUES ('legacy-lead','legacy-monitor','https://www.linkedin.com/in/legacy/','Legacy Lead','post_comment');
    `);
    applySignalSchema(db);
    assert.equal(db.prepare("SELECT name FROM signal_monitors WHERE id='legacy-monitor'").get().name, "Legacy");
    assert.equal(db.prepare("SELECT full_name FROM signal_leads WHERE id='legacy-lead'").get().full_name, "Legacy Lead");
    assert.ok(db.prepare("PRAGMA table_info(signal_monitors)").all().some((column) => column.name === "workspace_owner_id"));
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='signal_observations'").get());
    db.close();
  }

  console.log("▶ Scanner usa resultados reales y jamás genera fixtures");
  {
    const client = mockClient();
    const monitor = {
      id: "m1", workspace_owner_id: "owner-1", name: "Keywords", type: "keyword_intent",
      target_url: null, competitor_name: null, keywords_json: '["prospección b2b"]',
      icp_filters_json: '{}', mode: "review", status: "active", account_id: "a1",
      target_list_id: "l1", target_workflow_id: null, message_config_json: '{}',
      scan_interval_minutes: 360, next_scan_at: null, scan_state: "idle", scan_lease_owner: null,
      scan_lease_expires_at: null, cursor_json: null, capabilities_json: null,
      last_checked_at: null, last_success_at: null, last_error: null, consecutive_failures: 0,
      created_by: "user-1", created_at: "2026-09-16", updated_at: "2026-09-16",
    };
    const result = await scanRealSignals(client, {
      monitor, remoteAccountId: "remote-1", icp: { titles: ["VP Sales"] }, keywords: ["prospección b2b"], cursor: null, limit: 10, hasSalesNavigator: false,
    });
    assert.equal(result.leads.length, 1);
    assert.equal(result.leads[0].fullName, "Ana Real");
    const failing = mockClient({ searchLinkedIn: async () => { throw new Error("provider down"); } });
    await assert.rejects(() => scanRealSignals(failing, {
      monitor, remoteAccountId: "remote-1", icp: {}, keywords: ["real"], cursor: null, limit: 10, hasSalesNavigator: false,
    }), /provider down/);
  }

  console.log("▶ Servicio persiste evidencia real, deduplica y genera mensaje seguro");
  {
    const db = baseDb(); applySignalSchema(db);
    db.exec(`
      INSERT INTO users (id) VALUES ('owner-1');
      INSERT INTO accounts (id,name,email,owner_id,unipile_account_id,unipile_status,is_authenticated) VALUES ('a1','Cuenta','a@x.com','owner-1','remote-1','OK',1);
      INSERT INTO lists (id,name) VALUES ('l1','Hot Leads');
      INSERT INTO workflows (id,name) VALUES ('w1','Outreach');
      INSERT INTO workflow_steps (id,workflow_id,track,step_order,step_type,enabled) VALUES ('step-connect','w1','linkedin',1,'connect',1),('step-message','w1','linkedin',2,'message',1);
    `);
    const client = mockClient();
    const service = new SignalRadarService({
      getDatabase: () => db,
      client,
      now: () => Date.parse("2026-09-16T12:00:00Z"),
      generateMessage: async (_db, monitor, lead) => ({
        body: deterministicAntiStalkerMessage(monitor, lead), mode: "deterministic", model: null,
        knowledgeRevision: null, knowledgeCitations: [], validationReasons: [], rationale: "test",
      }),
    });
    const monitor = service.createMonitor({
      name: "Intent real", type: "keyword_intent", keywords: ["prospección b2b"],
      icp_filters: { titles: ["VP Sales"], locations: ["España"], time_window_days: 7 },
      account_id: "a1", target_list_id: "l1", target_workflow_id: "w1",
      workspace_owner_id: "owner-1", created_by: "user-1", mode: "review",
    });
    const first = await service.scanMonitor(monitor.id, "manual", { actorId: "user-1", workspaceOwnerId: "owner-1", isSuperAdmin: false });
    assert.equal(first.newLeads, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM signal_leads").get().c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM signal_observations").get().c, 1);
    const lead = db.prepare("SELECT * FROM signal_leads").get();
    assert.equal(validateAntiStalkerMessage(lead.icebreaker_preview).valid, true);
    db.prepare("UPDATE signal_monitors SET scan_lease_owner=NULL, scan_lease_expires_at=NULL, scan_state='idle'").run();
    await service.scanMonitor(monitor.id, "manual", { actorId: "user-1", workspaceOwnerId: "owner-1", isSuperAdmin: false });
    assert.equal(db.prepare("SELECT COUNT(*) c FROM signal_leads").get().c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM signal_observations").get().c, 1);

    const promotion = service.promoteLead(lead.id, { trigger: "manual" }, { actorId: "user-1", workspaceOwnerId: "owner-1", isSuperAdmin: false });
    assert.equal(promotion.state, "enrolled");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM targets").get().c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM list_targets WHERE list_id='l1'").get().c, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM run_profiles").get().c, 1);
    assert.equal(db.prepare("SELECT body FROM run_profile_step_messages WHERE step_id='step-message'").get().body, lead.icebreaker_preview);
    const repeated = service.promoteLead(lead.id, { trigger: "manual" }, { actorId: "user-1", workspaceOwnerId: "owner-1", isSuperAdmin: false });
    assert.equal(repeated.targetId, promotion.targetId);
    const preservedTargetId = promotion.targetId;
    const deletion = service.deleteLeads([lead.id], { actorId: "user-1", workspaceOwnerId: "owner-1", isSuperAdmin: false });
    assert.equal(deletion.deleted, 1);
    assert.equal(deletion.preservedTargets, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM signal_leads").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM signal_observations").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM signal_promotions").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM targets WHERE id = ?").get(preservedTargetId).c, 1);
    db.close();
  }

  console.log("▶ Autopilot se bloquea cuando faltan gates SDR");
  {
    const db = baseDb(); applySignalSchema(db);
    db.exec(`
      INSERT INTO users (id) VALUES ('owner-1');
      INSERT INTO accounts (id,name,email,owner_id,unipile_account_id,unipile_status,is_authenticated) VALUES ('a1','Cuenta','a@x.com','owner-1','remote-1','OK',1);
      INSERT INTO lists (id,name) VALUES ('l1','Hot Leads');
      INSERT INTO workflows (id,name) VALUES ('w1','Outreach');
      INSERT INTO workflow_steps (id,workflow_id,track,step_order,step_type,enabled) VALUES ('msg','w1','linkedin',1,'message',1);
      INSERT INTO signal_monitors (id,workspace_owner_id,name,type,mode,status,account_id,target_list_id,target_workflow_id,keywords_json,icp_filters_json,message_config_json) VALUES ('m1','owner-1','Auto','keyword_intent','autopilot','active','a1','l1','w1','[]','{}','{}');
      INSERT INTO signal_leads (id,workspace_owner_id,monitor_id,linkedin_url,identity_key,full_name,signal_type,status,score,icebreaker_preview) VALUES ('lead1','owner-1','m1','https://www.linkedin.com/in/real/','url:real','Real Lead','keyword_intent','pending',90,'Hola Real, ¿cómo gestionan la prospección?');
    `);
    const service = new SignalRadarService({ getDatabase: () => db, client: mockClient() });
    const result = service.promoteLead("lead1", { trigger: "autopilot" }, { actorId: "user-1", workspaceOwnerId: "owner-1", isSuperAdmin: false });
    assert.equal(result.state, "blocked");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM targets").get().c, 0);
    assert.equal(db.prepare("SELECT status FROM signal_leads WHERE id='lead1'").get().status, "pending");
    db.close();
  }

  console.log("▶ Eliminar monitor limpia Radar pero conserva recursos promovidos");
  {
    const db = baseDb(); applySignalSchema(db);
    db.exec(`
      INSERT INTO users (id) VALUES ('owner-1');
      INSERT INTO accounts (id,name,email,owner_id) VALUES ('a1','Cuenta','a@x.com','owner-1');
      INSERT INTO lists (id,name) VALUES ('l1','Lista');
      INSERT INTO targets (id,linkedin_url,full_name) VALUES ('target-kept','https://www.linkedin.com/in/kept/','Contacto preservado');
      INSERT INTO signal_monitors (id,workspace_owner_id,name,type,mode,status,account_id,target_list_id,keywords_json,icp_filters_json,message_config_json,scan_state) VALUES ('m-delete','owner-1','Eliminar','keyword_intent','review','active','a1','l1','[]','{}','{}','idle');
      INSERT INTO signal_leads (id,workspace_owner_id,monitor_id,linkedin_url,identity_key,full_name,signal_type,status,score,imported_target_id) VALUES ('lead-delete','owner-1','m-delete','https://www.linkedin.com/in/kept/','url:kept','Contacto preservado','keyword_intent','imported',90,'target-kept');
      INSERT INTO signal_observations (id,workspace_owner_id,monitor_id,lead_id,fingerprint,source_type) VALUES ('obs-delete','owner-1','m-delete','lead-delete','fingerprint-delete','post_search');
    `);
    const service = new SignalRadarService({ getDatabase: () => db, client: mockClient() });
    assert.equal(service.deleteMonitor("m-delete", { actorId: "user-1", workspaceOwnerId: "owner-1", isSuperAdmin: false }), true);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM signal_monitors WHERE id='m-delete'").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM signal_leads WHERE id='lead-delete'").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM signal_observations WHERE id='obs-delete'").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM targets WHERE id='target-kept'").get().c, 1);
    db.close();
  }

  console.log("▶ extractCompanyFromHeadline infiere empresas correctamente");
  {
    assert.equal(extractCompanyFromHeadline("VP of Sales at Acme Corp"), "Acme Corp");
    assert.equal(extractCompanyFromHeadline("Founder & CEO @ TechStart"), "TechStart");
    assert.equal(extractCompanyFromHeadline("Director Comercial en Globex"), "Globex");
    assert.equal(extractCompanyFromHeadline("Head of Growth | InhubFlow"), "InhubFlow");
    assert.equal(extractCompanyFromHeadline("Senior Developer - BigTech"), "BigTech");
    assert.equal(extractCompanyFromHeadline("Just a title"), null);
  }

  console.log("▶ accountHasSalesNavigator evita falsos positivos por substring");
  {
    assert.equal(accountHasSalesNavigator({}), false);
    assert.equal(accountHasSalesNavigator({ premiumFeatures: [] }), false);
    assert.equal(accountHasSalesNavigator({ company: "sales_navigator_experts" }), false);
    assert.equal(accountHasSalesNavigator({ premiumFeatures: ["sales_navigator"] }), true);
    assert.equal(accountHasSalesNavigator({ salesNavigator: true }), true);
  }

  console.log("▶ Plan B: scanWebSignals rescata leads con work_experience vacío si el headline verifica");
  {
    const webMock = {
      isConfigured: () => true,
      search: async () => ({
        items: [{
          link: "https://techcrunch.com/article-1",
          title: "FintechLab raises $5M Seed Round",
          snippet: "FintechLab secured funding to expand in Europe",
          source: "techcrunch.com",
          date: "2 days ago",
        }],
      }),
    };
    const linkedInMock = {
      searchLinkedIn: async () => ({
        object: "LinkedinSearch",
        items: [{
          type: "PEOPLE",
          id: "p-fl-1",
          name: "Carlos Founder",
          profile_url: "https://www.linkedin.com/in/carlos-founder/",
        }],
      }),
      listLinkedInSearchParameters: async () => ({ items: [] }),
      getPostComments: async () => ({ items: [] }),
      getPostReactions: async () => ({ items: [] }),
      resolveProfile: async () => ({
        object: "UserProfile",
        provider: "LINKEDIN",
        provider_id: "p-fl-1",
        public_profile_url: "https://www.linkedin.com/in/carlos-founder/",
        first_name: "Carlos",
        last_name: "Founder",
        headline: "CEO at FintechLab",
        work_experience: [], // throttled
        throttled_sections: ["experience"],
      }),
    };
    const context = {
      monitor: { id: "m-web", type: "funding_round" },
      remoteAccountId: "remote-1",
      icp: { titles: ["CEO"], time_window_days: 30 },
      keywords: ["FintechLab"],
      cursor: null,
      limit: 5,
      hasSalesNavigator: false,
    };
    const result = await scanWebSignals(webMock, linkedInMock, context);
    assert.equal(result.leads.length, 1);
    assert.equal(result.leads[0].company, "FintechLab");
    assert.equal(result.leads[0].headline, "CEO at FintechLab");
    assert.equal(result.leads[0].evidence.metadata.throttledExperience, true);
  }

  console.log("▶ Manejo de error 403 feature_not_subscribed como no reintentable");
  {
    const db = baseDb(); applySignalSchema(db);
    db.exec(`
      INSERT INTO users (id) VALUES ('owner-1');
      INSERT INTO accounts (id,name,email,owner_id,unipile_account_id,unipile_status,is_authenticated) VALUES ('a1','Cuenta','a@x.com','owner-1','remote-1','OK',1);
      INSERT INTO signal_monitors (id,workspace_owner_id,name,type,mode,status,account_id,keywords_json,icp_filters_json,message_config_json,scan_state) VALUES ('m-403','owner-1','Growth','company_growth','review','active','a1','[]','{}','{}','idle');
    `);
    const failingClient = {
      isConfigured: () => true,
      getAccount: async () => ({ id: "remote-1", type: "LINKEDIN", sources: [{ status: "OK" }], connection_params: { premiumFeatures: [] } }),
      searchLinkedIn: async () => {
        const err = new Error("feature_not_subscribed");
        err.status = 403;
        throw err;
      },
      listLinkedInSearchParameters: async () => ({ items: [] }),
      getPostComments: async () => ({ items: [] }),
      getPostReactions: async () => ({ items: [] }),
      resolveProfile: async () => ({ object: "UserProfile", provider_id: "x" }),
    };
    const service = new SignalRadarService({ getDatabase: () => db, client: failingClient });
    await assert.rejects(
      () => service.scanMonitor("m-403", "manual", { actorId: "user-1", workspaceOwnerId: "owner-1", isSuperAdmin: false }),
      (err) => err.message.includes("Sales Navigator") || err.message.includes("feature_not_subscribed")
    );
    const run = db.prepare("SELECT * FROM signal_scan_runs WHERE monitor_id='m-403'").get();
    assert.equal(run.state, "unsupported");
    assert.equal(run.error_code, "unsupported_capability");
    db.close();
  }

  console.log("▶ companyMatches previene falsos positivos con palabras genéricas");
  {
    assert.equal(companyMatches("Tapiz Decoración Integral", "Integral"), false);
    assert.equal(companyMatches("DiAlma Centro Integral Familiar", "Integral"), false);
    assert.equal(companyMatches("Integral Data Vision", "Integral"), false);
    assert.equal(companyMatches("Integral Chile S.A.", "Integral"), true);
    assert.equal(companyMatches("Integral Inc", "Integral"), true);
    assert.equal(companyMatches("Integral Tech S.P.A.", "Integral"), true);
    assert.equal(companyMatches("Betterfly Health", "Betterfly"), true);
  }

  console.log("✅ SIGNAL RADAR REAL, DEDUPLICADO E INTEGRADO VALIDADO");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
