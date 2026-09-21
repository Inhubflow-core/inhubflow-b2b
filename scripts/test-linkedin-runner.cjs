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
  if (typeof request === "string" && request.startsWith("@/")) {
    request = path.join(root, request.slice(2));
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
Module._extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, filename);
};

const { UnipileClient } = require("../lib/unipile/client.ts");
const { processSingleTrack } = require("../lib/linkedin/runner.ts");
const { resolveUnipileAccount } = require("../lib/unipile/account.ts");
const { ensureLinkedInTargetAccountState, markLinkedInTargetState } = require("../lib/linkedin/account-state.ts");
const { nextAllowedLinkedInTime } = require("../lib/linkedin/schedule.ts");
const { createHostedAuthState, verifyHostedAuthState } = require("../lib/unipile/callback-state.ts");
const { syncLinkedInInbox } = require("../lib/unipile/inbox-sync.ts");
const { createUnipileSignature, verifyUnipileSignature, handleUnipileWebhook } = require("../lib/unipile/webhooks.ts");

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
      is_authenticated INTEGER DEFAULT 0, unipile_account_id TEXT, unipile_status TEXT,
      daily_connection_limit INTEGER DEFAULT 20, daily_message_limit INTEGER DEFAULT 20,
      active_hours_start INTEGER DEFAULT 0, active_hours_end INTEGER DEFAULT 24,
      timezone TEXT DEFAULT 'UTC', working_days TEXT DEFAULT '1,2,3,4,5,6,7', linkedin_inbox_synced_at TEXT,
      linkedin_inbox_sync_error TEXT
    );
    CREATE TABLE workflows (id TEXT PRIMARY KEY);
    CREATE TABLE workflow_steps (
      id TEXT PRIMARY KEY, workflow_id TEXT, track TEXT, step_order INTEGER,
      step_type TEXT, template_id TEXT, delay_seconds INTEGER DEFAULT 0,
      connect_note TEXT, message_body TEXT, email_subject TEXT, email_body TEXT,
      enabled INTEGER DEFAULT 1
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, workflow_id TEXT, account_id TEXT, email_account_id TEXT,
      status TEXT DEFAULT 'running', created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, linkedin_url TEXT UNIQUE, first_name TEXT, last_name TEXT,
      full_name TEXT, title TEXT, headline TEXT, company TEXT, location TEXT,
      profile_image_url TEXT, linkedin_member_urn TEXT, messaging_urn TEXT,
      unipile_provider_id TEXT, unipile_chat_id TEXT, email TEXT, degree INTEGER,
      connection_requested_at TEXT, connected_at TEXT, message_sent_at TEXT,
      last_replied_at TEXT, last_replied_account_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE run_profiles (
      id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE run_profile_tracks (
      id TEXT PRIMARY KEY, run_profile_id TEXT, track TEXT,
      state TEXT DEFAULT 'pending', current_step INTEGER DEFAULT 0,
      last_step_at TEXT, next_step_at TEXT, error_message TEXT,
      force_run_once INTEGER DEFAULT 0
    );
    CREATE TABLE logs (
      id TEXT PRIMARY KEY, run_id TEXT, target_id TEXT, level TEXT DEFAULT 'info',
      message TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE linkedin_connection_attempts (
      id TEXT PRIMARY KEY, account_id TEXT, run_id TEXT, target_id TEXT,
      outcome TEXT DEFAULT 'prepared', error_message TEXT, attempted_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE linkedin_inbox_messages (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, target_id TEXT NOT NULL,
      run_id TEXT, workflow_id TEXT, external_thread_id TEXT NOT NULL,
      external_message_id TEXT NOT NULL, direction TEXT NOT NULL,
      sender_external_id TEXT, sender_name TEXT, body TEXT NOT NULL,
      sent_at TEXT NOT NULL, captured_at TEXT DEFAULT (datetime('now')),
      identity_mode TEXT NOT NULL, metadata_json TEXT DEFAULT '{}',
      UNIQUE(account_id, external_thread_id, external_message_id)
    );
    CREATE TABLE linkedin_target_accounts (
      account_id TEXT NOT NULL, target_id TEXT NOT NULL,
      unipile_provider_id TEXT, unipile_chat_id TEXT, degree INTEGER,
      connection_requested_at TEXT, connected_at TEXT, message_sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, target_id)
    );
    CREATE TABLE linkedin_step_deliveries (
      id TEXT PRIMARY KEY, track_id TEXT NOT NULL, step_id TEXT NOT NULL,
      run_id TEXT NOT NULL, target_id TEXT NOT NULL, account_id TEXT NOT NULL,
      action_type TEXT NOT NULL, state TEXT DEFAULT 'prepared', external_id TEXT,
      external_thread_id TEXT, payload_hash TEXT, error_message TEXT,
      attempted_at TEXT DEFAULT (datetime('now')), confirmed_at TEXT,
      updated_at TEXT DEFAULT (datetime('now')), UNIQUE(track_id, step_id)
    );
    CREATE TABLE list_targets (list_id TEXT, target_id TEXT, PRIMARY KEY(list_id, target_id));
    CREATE TABLE runtime_leases (lease_key TEXT PRIMARY KEY, owner_id TEXT, expires_at_ms INTEGER, updated_at TEXT);
    CREATE TABLE run_profile_step_messages (run_profile_id TEXT NOT NULL, step_id TEXT NOT NULL, body TEXT NOT NULL, source TEXT DEFAULT 'signal_radar', metadata_json TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (run_profile_id, step_id));
  `);
  return db;
}

function seed(db, type, targetOverrides = {}, stepOverrides = {}) {
  db.prepare("INSERT INTO accounts (id, name, email, daily_connection_limit, unipile_account_id, unipile_status) VALUES ('a1','Cuenta','a@example.com',20,'remote-1','OK')").run();
  db.prepare("INSERT INTO workflows (id) VALUES ('w1')").run();
  db.prepare(`INSERT INTO workflow_steps (id, workflow_id, track, step_order, step_type, delay_seconds, connect_note, message_body, enabled) VALUES ('s1','w1','linkedin',1,?,0,?,?,1)`).run(type, stepOverrides.connect_note || null, stepOverrides.message_body || null);
  db.prepare("INSERT INTO runs (id, workflow_id, account_id, status) VALUES ('r1','w1','a1','running')").run();
  const target = {
    id: "t1", linkedin_url: "https://www.linkedin.com/in/test-user", full_name: null,
    degree: null, connected_at: null, connection_requested_at: null, company: null,
    unipile_provider_id: null, unipile_chat_id: null, message_sent_at: null,
    ...targetOverrides,
  };
  db.prepare(`INSERT INTO targets (id, linkedin_url, full_name, company, degree, connected_at, connection_requested_at, unipile_provider_id, unipile_chat_id, message_sent_at) VALUES (@id,@linkedin_url,@full_name,@company,@degree,@connected_at,@connection_requested_at,@unipile_provider_id,@unipile_chat_id,@message_sent_at)`).run(target);
  db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES ('rp1','r1','t1')").run();
  db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step, force_run_once) VALUES ('tr1','rp1','linkedin','pending',0,0)").run();
  return db.prepare("SELECT * FROM run_profile_tracks WHERE id='tr1'").get();
}

function client(overrides = {}) {
  const calls = { resolve: 0, invite: 0, send: 0, start: 0 };
  return {
    calls,
    isConfigured: () => true,
    listAccounts: async () => ({ items: [] }),
    resolveProfile: async () => {
      calls.resolve++;
      return { object: "UserProfile", provider: "LINKEDIN", provider_id: "provider-1", first_name: "Ada", last_name: "Lovelace", headline: "CTO", profile_picture_url: "https://img.test/ada.jpg", location: "London", work_experience: [{ company: "Analytical", position: "CTO", current: true }] };
    },
    sendInvitation: async () => { calls.invite++; return { object: "UserInvitationSent", invitation_id: "inv-1" }; },
    sendMessage: async () => { calls.send++; return { object: "MessageSent", message_id: "msg-1" }; },
    startChat: async () => { calls.start++; return { object: "ChatStarted", chat_id: "chat-1", message_id: "msg-1" }; },
    ...overrides,
  };
}

const deps = (mock) => ({ client: mock, now: () => Date.parse("2026-09-15T12:00:00Z"), resolveAccount: async () => ({ unipileAccountId: "remote-1" }) });

async function run() {
  console.log("▶ Cliente Unipile: contratos JSON/multipart correctos");
  {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      const path = String(url);
      const body = path.includes("/users/invite")
        ? { object: "UserInvitationSent", invitation_id: "inv-1" }
        : path.endsWith("/api/v1/chats")
          ? { object: "ChatStarted", chat_id: "chat-1", message_id: "msg-1" }
          : { object: "MessageSent", message_id: "msg-2" };
      return new Response(JSON.stringify(body), { status: path.includes("messages") || path.endsWith("/chats") ? 201 : 200, headers: { "Content-Type": "application/json" } });
    };
    try {
      const api = new UnipileClient("https://unit.test", "token");
      await api.resolveProfile("https://cl.linkedin.com/in/test-user/?trk=profile", "remote-1");
      await api.sendInvitation({ account_id: "remote-1", provider_id: "provider-1", message: "Hola" });
      await api.startChat({ account_id: "remote-1", attendees_ids: ["provider-1"], text: "Hola" });
      await api.sendMessage({ chat_id: "chat-1", text: "Hola de nuevo" });
      assert.match(requests[0].url, /\/api\/v1\/users\/test-user\?/);
      assert.equal(typeof requests[1].options.body, "string");
      assert.ok(requests[2].options.body instanceof FormData);
      assert.equal(requests[2].options.body.get("account_id"), "remote-1");
      assert.equal(requests[2].options.body.get("attendees_ids[]"), "provider-1");
      assert.ok(requests[3].options.body instanceof FormData);
      const multipartHeaders = requests[3].options.headers;
      assert.equal(Object.keys(multipartHeaders).some((name) => name.toLowerCase() === "content-type"), false);
    } finally {
      global.fetch = originalFetch;
    }
  }

  console.log("▶ Ventanas horarias: respeta zona y días laborables");
  {
    const schedule = { timezone: "America/Santiago", workingDays: "1,2,3,4,5", activeHoursStart: 9, activeHoursEnd: 18 };
    const inside = nextAllowedLinkedInTime(schedule, Date.parse("2026-09-15T14:00:00Z"));
    assert.equal(inside.allowed, true);
    const weekend = nextAllowedLinkedInTime(schedule, Date.parse("2026-09-19T14:00:00Z"));
    assert.equal(weekend.allowed, false);
    assert.ok(weekend.nextAt && Date.parse(weekend.nextAt) > Date.parse("2026-09-19T14:00:00Z"));
  }
  {
    const db = makeDb(); const tr = seed(db, "visit"); const mock = client();
    db.prepare("UPDATE accounts SET timezone='America/Santiago', working_days='1,2,3,4,5', active_hours_start=9, active_hours_end=18 WHERE id='a1'").run();
    await processSingleTrack(db, tr, { ...deps(mock), now: () => Date.parse("2026-09-19T14:00:00Z") });
    assert.equal(mock.calls.resolve, 0);
    assert.ok(db.prepare("SELECT next_step_at FROM run_profile_tracks WHERE id='tr1'").get().next_step_at);
    db.close();
  }

  console.log("▶ Visit: resolución obligatoria y enriquecimiento conservador");
  {
    const db = makeDb(); const tr = seed(db, "visit", { company: "Conservar" }); const mock = client();
    await processSingleTrack(db, tr, deps(mock));
    const target = db.prepare("SELECT * FROM targets WHERE id='t1'").get();
    const track = db.prepare("SELECT * FROM run_profile_tracks WHERE id='tr1'").get();
    assert.equal(mock.calls.resolve, 1); assert.equal(target.unipile_provider_id, "provider-1");
    assert.equal(target.full_name, "Ada Lovelace"); assert.equal(target.title, "CTO");
    assert.equal(target.company, "Conservar"); assert.equal(target.profile_image_url, "https://img.test/ada.jpg");
    assert.equal(track.state, "completed");
    db.close();
  }

  console.log("▶ Connect: conectado avanza, pendiente real espera y marcador local obsoleto se repara");
  {
    const db = makeDb(); const tr = seed(db, "connect", { degree: 1, connected_at: "2026-09-01" }); const mock = client();
    await processSingleTrack(db, tr, deps(mock));
    assert.equal(mock.calls.invite, 0); assert.equal(db.prepare("SELECT state FROM run_profile_tracks WHERE id='tr1'").get().state, "completed"); db.close();
  }
  {
    const db = makeDb(); const tr = seed(db, "connect", { connection_requested_at: "2026-09-14", unipile_provider_id: "provider-1" }); const mock = client({ resolveProfile: async () => ({ provider_id: "provider-1", provider: "LINKEDIN", object: "UserProfile", network_distance: "SECOND_DEGREE" }) });
    await processSingleTrack(db, tr, deps(mock));
    assert.equal(mock.calls.invite, 1, "A stale local marker must not suppress the real invitation");
    assert.equal(db.prepare("SELECT state FROM run_profile_tracks WHERE id='tr1'").get().state, "in_progress");
    assert.equal(db.prepare("SELECT state FROM linkedin_step_deliveries WHERE track_id='tr1'").get().state, "confirmed");
    db.close();
  }
  {
    const db = makeDb(); const tr = seed(db, "connect", { connection_requested_at: "2026-09-14", unipile_provider_id: "provider-1" }); const mock = client({ resolveProfile: async () => ({ provider_id: "provider-1", provider: "LINKEDIN", object: "UserProfile", network_distance: "SECOND_DEGREE", invitation: { type: "SENT", status: "PENDING" } }) });
    await processSingleTrack(db, tr, deps(mock));
    const nextRun = db.prepare("SELECT * FROM run_profile_tracks WHERE id='tr1'").get();
    await processSingleTrack(db, nextRun, deps(mock));
    assert.equal(mock.calls.invite, 0, "A real pending invitation must never be duplicated");
    assert.equal(db.prepare("SELECT state FROM run_profile_tracks WHERE id='tr1'").get().state, "in_progress");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM logs WHERE run_id='r1' AND target_id='t1' AND message LIKE '%Esperando aceptación%'").get().c, 1, "Repeated pending checks must keep one activity row");
    db.close();
  }

  console.log("▶ Connect: cuota, éxito y fallo confirmado");
  {
    const db = makeDb(); const tr = seed(db, "connect", { unipile_provider_id: "provider-1" });
    db.prepare("UPDATE accounts SET daily_connection_limit=1 WHERE id='a1'").run();
    db.prepare("INSERT INTO linkedin_connection_attempts (id,account_id,run_id,target_id,outcome,attempted_at) VALUES ('old','a1','r1','other','submitted','2026-09-15T10:00:00.000Z')").run();
    const mock = client(); await processSingleTrack(db, tr, deps(mock));
    assert.equal(mock.calls.invite, 0); assert.equal(db.prepare("SELECT connection_requested_at FROM targets WHERE id='t1'").get().connection_requested_at, null); db.close();
  }
  {
    const db = makeDb(); const tr = seed(db, "connect", { unipile_provider_id: "provider-1" }); const mock = client();
    await processSingleTrack(db, tr, deps(mock));
    assert.equal(mock.calls.invite, 1); assert.ok(db.prepare("SELECT connection_requested_at FROM targets WHERE id='t1'").get().connection_requested_at);
    assert.equal(db.prepare("SELECT outcome FROM linkedin_connection_attempts").get().outcome, "submitted");
    const activities = db.prepare("SELECT level, message FROM logs WHERE run_id='r1' AND target_id='t1'").all();
    assert.equal(activities.length, 1);
    assert.equal(activities[0].level, "info");
    assert.equal(activities[0].message, "Solicitud de conexión enviada a https://www.linkedin.com/in/test-user con éxito. Esperando aceptación; el sistema verificará automáticamente el estado cada 6 horas.");
    assert.equal(activities[0].message.startsWith("[INFO]"), false);
    db.close();
  }
  {
    const db = makeDb(); const tr = seed(db, "connect", { unipile_provider_id: "provider-1" }); const mock = client({ sendInvitation: async () => ({ object: "Error", status: "failed" }) });
    await processSingleTrack(db, tr, deps(mock));
    assert.equal(db.prepare("SELECT connection_requested_at FROM targets WHERE id='t1'").get().connection_requested_at, null);
    assert.equal(db.prepare("SELECT state FROM run_profile_tracks WHERE id='tr1'").get().state, "failed"); db.close();
  }
  {
    const db = makeDb(); const tr = seed(db, "connect", { unipile_provider_id: "provider-1" }); const mock = client();
    db.prepare(`INSERT INTO linkedin_step_deliveries (id,track_id,step_id,run_id,target_id,account_id,action_type,state,payload_hash) VALUES ('interrupted','tr1','s1','r1','t1','a1','connect','prepared','hash')`).run();
    await processSingleTrack(db, tr, deps(mock));
    assert.equal(mock.calls.invite, 0, "An interrupted prepared action must not be resent");
    assert.equal(db.prepare("SELECT state FROM linkedin_step_deliveries WHERE id='interrupted'").get().state, "uncertain");
    db.close();
  }

  console.log("▶ Message: conexión requerida y confirmación provider obligatoria");
  {
    const db = makeDb(); const tr = seed(db, "message", { unipile_provider_id: "provider-1" }, { message_body: "Hola" }); const mock = client();
    await processSingleTrack(db, tr, deps(mock)); assert.equal(mock.calls.start, 0); assert.equal(db.prepare("SELECT message_sent_at FROM targets WHERE id='t1'").get().message_sent_at, null); db.close();
  }
  {
    const db = makeDb(); const tr = seed(db, "message", { connected_at: "2026-09-01", unipile_chat_id: "chat-old", unipile_provider_id: "provider-1" }, { message_body: "Hola" }); const mock = client();
    await processSingleTrack(db, tr, deps(mock)); assert.equal(mock.calls.send, 1); assert.ok(db.prepare("SELECT message_sent_at FROM targets WHERE id='t1'").get().message_sent_at); assert.equal(db.prepare("SELECT COUNT(*) c FROM linkedin_inbox_messages").get().c, 1);
    await processSingleTrack(db, tr, deps(mock));
    assert.equal(mock.calls.send, 1, "A confirmed step must not send twice");
    db.close();
  }
  {
    const db = makeDb(); const tr = seed(db, "message", { connected_at: "2026-09-01", unipile_provider_id: "provider-1" }, { message_body: "Hola" }); const mock = client({ startChat: async () => ({ object: "ChatStarted", chat_id: "chat-1", message_id: null }) });
    await processSingleTrack(db, tr, deps(mock)); const target = db.prepare("SELECT message_sent_at, unipile_chat_id FROM targets WHERE id='t1'").get(); assert.equal(target.message_sent_at, null); assert.equal(target.unipile_chat_id, null); db.close();
  }
  {
    const db = makeDb(); const tr = seed(db, "message", { connected_at: "2026-09-01", unipile_chat_id: "chat-stale", unipile_provider_id: "provider-1" }, { message_body: "Hola" });
    const stale = new Error("resource_not_found"); stale.status = 404; stale.body = "errors/resource_not_found";
    const mock = client({ sendMessage: async () => { throw stale; } });
    await processSingleTrack(db, tr, deps(mock));
    const target = db.prepare("SELECT message_sent_at, unipile_chat_id FROM targets WHERE id='t1'").get();
    assert.ok(target.message_sent_at);
    assert.equal(target.unipile_chat_id, "chat-1");
    assert.equal(mock.calls.start, 1);
    db.close();
  }
  {
    const db = makeDb();
    const tr = seed(db, "message", { connected_at: "2026-09-01", unipile_chat_id: "chat-old", unipile_provider_id: "provider-1" }, { message_body: "Primer mensaje" });
    db.prepare(`INSERT INTO workflow_steps (id, workflow_id, track, step_order, step_type, delay_seconds, message_body, enabled) VALUES ('s2','w1','linkedin',2,'message',0,'Segundo mensaje',1)`).run();
    let counter = 0;
    const mock = client({ sendMessage: async () => {
      counter++;
      return { object: "MessageSent", message_id: `msg-${counter}` };
    } });
    await processSingleTrack(db, tr, deps(mock));
    const secondTrack = db.prepare("SELECT * FROM run_profile_tracks WHERE id='tr1'").get();
    await processSingleTrack(db, secondTrack, deps(mock));
    assert.equal(counter, 2, "Cada paso de mensaje debe enviarse exactamente una vez");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM linkedin_step_deliveries WHERE state='confirmed'").get().c, 2);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM linkedin_inbox_messages").get().c, 2);
    db.close();
  }

  console.log("▶ Estado LinkedIn: aislamiento por cuenta local");
  {
    const db = makeDb();
    db.prepare("INSERT INTO accounts (id,name,email) VALUES ('a1','Cuenta 1','a1@example.com'),('a2','Cuenta 2','a2@example.com')").run();
    db.prepare("INSERT INTO targets (id,linkedin_url,degree,connected_at) VALUES ('t1','https://www.linkedin.com/in/scope-test',NULL,NULL)").run();
    const target = db.prepare("SELECT * FROM targets WHERE id='t1'").get();
    ensureLinkedInTargetAccountState(db, "a1", target);
    ensureLinkedInTargetAccountState(db, "a2", target);
    markLinkedInTargetState(db, "a1", "t1", { degree: 1, connected_at: "2026-09-15T12:00:00.000Z", unipile_provider_id: "provider-a1" });
    const a1 = ensureLinkedInTargetAccountState(db, "a1", target);
    const a2 = ensureLinkedInTargetAccountState(db, "a2", target);
    assert.equal(a1.degree, 1);
    assert.equal(a2.degree, null);
    assert.equal(a2.connected_at, null);
    db.close();
  }

  console.log("▶ Cuenta remota: fallback solo a LinkedIn OK y bloqueo de CREDENTIALS");
  {
    const db = makeDb(); db.prepare("INSERT INTO accounts (id,name,email) VALUES ('a1','Cuenta','a@example.com')").run();
    const mock = { isConfigured: () => true, listAccounts: async () => ({ items: [{ id: "bad", type: "LINKEDIN", sources: [{ status: "CREDENTIALS" }] }, { id: "good", type: "LINKEDIN", sources: [{ status: "OK" }] }] }) };
    const result = await resolveUnipileAccount(db, "a1", mock); assert.equal(result.unipileAccountId, "good"); assert.equal(db.prepare("SELECT unipile_account_id FROM accounts WHERE id='a1'").get().unipile_account_id, "good"); db.close();
  }
  {
    const db = makeDb(); db.prepare("INSERT INTO accounts (id,name,email,unipile_account_id,unipile_status) VALUES ('a1','Cuenta','a@example.com','remote-bad','CREDENTIALS')").run();
    const mock = { isConfigured: () => true, getAccount: async () => ({ id: "remote-bad", type: "LINKEDIN", sources: [{ status: "CREDENTIALS" }] }) };
    await assert.rejects(() => resolveUnipileAccount(db, "a1", mock), /CREDENTIALS/);
    assert.equal(db.prepare("SELECT is_authenticated FROM accounts WHERE id='a1'").get().is_authenticated, 0); db.close();
  }

  console.log("▶ Webhook: HMAC, estado de Hosted Auth y alcance por cuenta");
  {
    const secret = "test-secret"; const body = Buffer.from('{"event":"new_relation"}'); const signature = createUnipileSignature(body, secret, 1000);
    assert.equal(verifyUnipileSignature(body, signature, secret, 1000), true);
    assert.equal(verifyUnipileSignature(body, signature, "other", 1000), false);
    assert.equal(verifyUnipileSignature(body, signature, secret, 1400), false);
    const state = createHostedAuthState("a1", secret, 2000);
    assert.equal(verifyHostedAuthState(state, secret, 1500).accountId, "a1");
    assert.equal(verifyHostedAuthState(state, secret, 2500), null);
  }
  {
    const db = makeDb(); seed(db, "connect", { unipile_provider_id: "provider-1", connection_requested_at: "2026-09-14" });
    const result = await handleUnipileWebhook({ event: "new_relation", account_id: "remote-1", user_provider_id: "provider-1" }, db);
    const repeated = await handleUnipileWebhook({ event: "new_relation", account_id: "remote-1", user_provider_id: "provider-1" }, db);
    assert.equal(result.handled, true); assert.equal(repeated.handled, true); assert.equal(db.prepare("SELECT degree FROM targets WHERE id='t1'").get().degree, 1);
    const acceptanceActivities = db.prepare("SELECT message FROM logs WHERE run_id='r1' AND target_id='t1' AND message LIKE '%aceptó la solicitud de conexión%'").all();
    assert.equal(acceptanceActivities.length, 1, "Webhook retries must not duplicate the acceptance activity");
    assert.equal(acceptanceActivities[0].message, "https://www.linkedin.com/in/test-user aceptó la solicitud de conexión. La secuencia continuará automáticamente.");
    assert.ok(db.prepare("SELECT next_step_at FROM run_profile_tracks WHERE id='tr1'").get().next_step_at);
    db.prepare("UPDATE targets SET unipile_chat_id = 'chat-webhook' WHERE id = 't1'").run();
    db.prepare("UPDATE linkedin_target_accounts SET unipile_chat_id = 'chat-webhook' WHERE account_id = 'a1' AND target_id = 't1'").run();
    const messageResult = await handleUnipileWebhook({
      event: "message_received", account_id: "remote-1", chat_id: "chat-webhook",
      message_id: "webhook-msg-1", message: "Respuesta enviada", timestamp: "2026-09-15T12:00:00Z",
      account_info: { user_id: "self-provider" },
      sender: { attendee_provider_id: "self-provider", attendee_name: "Cuenta" },
    }, db);
    assert.equal(messageResult.handled, true);
    assert.equal(db.prepare("SELECT direction FROM linkedin_inbox_messages WHERE external_message_id='webhook-msg-1'").get().direction, "outbound");
    const statusResult = await handleUnipileWebhook({
      AccountStatus: { account_id: "remote-1", account_type: "LINKEDIN", message: "CREDENTIALS" },
    }, db);
    assert.equal(statusResult.handled, true);
    assert.equal(db.prepare("SELECT unipile_status FROM accounts WHERE id='a1'").get().unipile_status, "CREDENTIALS");
    db.close();
  }

  console.log("▶ Inbox unificado: paginación, target y deduplicación");
  {
    const db = makeDb();
    db.prepare("INSERT INTO accounts (id,name,email,unipile_account_id,unipile_status) VALUES ('a1','Cuenta','a@example.com','remote-1','OK')").run();
    db.prepare("INSERT INTO workflows (id) VALUES ('w1')").run();
    db.prepare("INSERT INTO runs (id, account_id, workflow_id, status) VALUES ('r1', 'a1', 'w1', 'running')").run();
    db.prepare("INSERT INTO targets (id, full_name, linkedin_url) VALUES ('t1', 'Contacto chat-1', 'https://www.linkedin.com/in/chat-1')").run();
    db.prepare("INSERT INTO targets (id, full_name, linkedin_url) VALUES ('t2', 'Contacto chat-2', 'https://www.linkedin.com/in/chat-2')").run();
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES ('rp1', 'r1', 't1'), ('rp2', 'r1', 't2')").run();
    const calls = { chats: 0, messages: 0 };
    const mock = {
      isConfigured: () => true,
      getAccount: async () => ({ id: "remote-1", type: "LINKEDIN", sources: [{ status: "OK" }] }),
      listAccounts: async () => ({ items: [] }),
      listChats: async (_account, _limit, cursor) => {
        calls.chats++;
        return cursor
          ? { items: [{ id: "chat-2", account_id: "remote-1" }, { id: "chat-uber", account_id: "remote-1" }], cursor: null }
          : { items: [{ id: "chat-1", account_id: "remote-1" }], cursor: "next" };
      },
      listChatAttendees: async (chatId) => ({ items: [{ id: `att-${chatId}`, account_id: "remote-1", provider_id: `provider-${chatId}`, name: chatId === 'chat-uber' ? 'Uber para Empresas' : `Contacto ${chatId}`, is_self: 0, profile_url: `https://www.linkedin.com/in/${chatId}` }], cursor: null }),
      listMessages: async (chatId, _limit, cursor) => {
        calls.messages++;
        if (cursor) return { items: [{ id: `${chatId}-m2`, chat_id: chatId, account_id: "remote-1", sender_id: `provider-${chatId}`, text: "Segundo", timestamp: "2026-09-15T11:00:00Z", is_sender: 1 }], cursor: null };
        return { items: [{ id: `${chatId}-m1`, chat_id: chatId, account_id: "remote-1", sender_id: `provider-${chatId}`, text: "Primero", timestamp: "2026-09-15T10:00:00Z", is_sender: 1 }], cursor: "more" };
      },
    };
    const first = await syncLinkedInInbox(db, "a1", mock);
    assert.equal(first.chats, 3); assert.equal(first.messages, 4); assert.equal(calls.chats, 2);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM targets").get().c, 2);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM linkedin_inbox_messages").get().c, 4);
    const second = await syncLinkedInInbox(db, "a1", mock);
    assert.equal(second.messages, 0); assert.equal(db.prepare("SELECT COUNT(*) c FROM linkedin_inbox_messages").get().c, 4);
    db.close();
  }

  console.log("\n✅ MOTOR LINKEDIN/UNIPILE VALIDADO SIN LLAMADAS REALES");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
