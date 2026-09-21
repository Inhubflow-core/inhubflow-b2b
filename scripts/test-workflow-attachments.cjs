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

const { processSingleTrack } = require("../lib/linkedin/runner.ts");

function makeTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
      is_authenticated INTEGER DEFAULT 1, unipile_account_id TEXT, unipile_status TEXT,
      daily_connection_limit INTEGER DEFAULT 20, daily_message_limit INTEGER DEFAULT 20,
      active_hours_start INTEGER DEFAULT 0, active_hours_end INTEGER DEFAULT 24,
      timezone TEXT DEFAULT 'UTC', working_days TEXT DEFAULT '1,2,3,4,5,6,7',
      linkedin_inbox_synced_at TEXT, linkedin_inbox_sync_error TEXT
    );
    CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT, description TEXT);
    CREATE TABLE workflow_steps (
      id TEXT PRIMARY KEY, workflow_id TEXT, track TEXT DEFAULT 'linkedin', step_order INTEGER,
      step_type TEXT, template_id TEXT, delay_seconds INTEGER DEFAULT 0,
      connect_note TEXT, message_body TEXT, email_subject TEXT, email_body TEXT,
      enabled INTEGER DEFAULT 1,
      attachment_url TEXT, attachment_name TEXT, attachment_type TEXT, attachment_size INTEGER
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, workflow_id TEXT, account_id TEXT, email_account_id TEXT,
      status TEXT DEFAULT 'running', created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, linkedin_url TEXT UNIQUE, first_name TEXT, last_name TEXT,
      full_name TEXT, title TEXT, headline TEXT, company TEXT, location TEXT,
      profile_image_url TEXT, linkedin_member_urn TEXT, messaging_urn TEXT,
      unipile_provider_id TEXT, unipile_chat_id TEXT, email TEXT, degree INTEGER DEFAULT 1,
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

async function runTests() {
  console.log("▶ Test 1: Crear y consultar paso de mensaje con nota de voz adjunta");
  {
    const db = makeTestDb();
    db.prepare("INSERT INTO workflows (id, name) VALUES ('w1', 'Campaña con Audio')").run();
    db.prepare(`
      INSERT INTO workflow_steps (
        id, workflow_id, track, step_order, step_type, message_body,
        attachment_url, attachment_name, attachment_type, attachment_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "s1", "w1", "linkedin", 1, "message", "Hola {{first_name}}, te dejo un audio!",
      "/uploads/workflow-attachments/test-audio.mp3", "Nota de voz de LinkedIn", "audio/mp3", 102400
    );

    const step = db.prepare("SELECT * FROM workflow_steps WHERE id = 's1'").get();
    assert.equal(step.attachment_url, "/uploads/workflow-attachments/test-audio.mp3");
    assert.equal(step.attachment_name, "Nota de voz de LinkedIn");
    assert.equal(step.attachment_type, "audio/mp3");
    assert.equal(step.attachment_size, 102400);
    console.log("  ✓ Paso guardado y consultado con éxito en SQLite");
    db.close();
  }

  console.log("▶ Test 2: Runner envía mensaje con archivo adjunto a través de Unipile");
  {
    const db = makeTestDb();
    // Crear archivo temporal de audio para simular public/uploads
    const testDir = path.join(root, "public", "uploads", "workflow-attachments");
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    const dummyFilePath = path.join(testDir, "test-runner-voice.mp3");
    fs.writeFileSync(dummyFilePath, Buffer.from("fake-mp3-audio-data-12345"));

    db.prepare("INSERT INTO accounts (id, name, email, unipile_account_id, unipile_status) VALUES ('a1', 'Mi Cuenta', 'test@example.com', 'remote-acc-1', 'OK')").run();
    db.prepare("INSERT INTO workflows (id, name) VALUES ('w1', 'Campaña')").run();
    db.prepare("INSERT INTO runs (id, workflow_id, account_id) VALUES ('r1', 'w1', 'a1')").run();
    db.prepare("INSERT INTO targets (id, full_name, first_name, linkedin_url, degree, connected_at, unipile_chat_id) VALUES ('t1', 'Carlos Sanchez', 'Carlos', 'https://www.linkedin.com/in/carlos-s', 1, datetime('now'), 'chat-carlos-1')").run();
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES ('rp1', 'r1', 't1')").run();
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES ('tr1', 'rp1', 'linkedin', 'pending', 0)").run();

    db.prepare(`
      INSERT INTO workflow_steps (
        id, workflow_id, track, step_order, step_type, message_body,
        attachment_url, attachment_name, attachment_type, attachment_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "s1", "w1", "linkedin", 1, "message", "Hola {{first_name}}, te adjunto mi nota de voz",
      "/uploads/workflow-attachments/test-runner-voice.mp3", "nota-de-voz-demo.mp3", "audio/mp3", 26
    );

    let sentPayload = null;
    const mockClient = {
      isConfigured: () => true,
      getAccount: async () => ({ id: "remote-acc-1", type: "LINKEDIN", sources: [{ status: "OK" }] }),
      listAccounts: async () => ({ items: [{ id: "remote-acc-1", type: "LINKEDIN", sources: [{ status: "OK" }] }] }),
      resolveProfile: async () => ({ provider_id: "prov-1" }),
      sendInvitation: async () => ({ invitation_id: "inv-1" }),
      startChat: async () => ({ chat_id: "chat-new", message_id: "msg-1" }),
      sendMessage: async (params) => {
        sentPayload = params;
        return { message_id: "msg-outbound-123" };
      },
    };

    const tr = db.prepare("SELECT * FROM run_profile_tracks WHERE id = 'tr1'").get();
    await processSingleTrack(db, tr, { client: mockClient });

    assert.ok(sentPayload !== null, "sendMessage debió ser llamado");
    assert.equal(sentPayload.chat_id, "chat-carlos-1");
    assert.equal(sentPayload.text, "Hola Carlos, te adjunto mi nota de voz");
    assert.ok(Array.isArray(sentPayload.attachments), "attachments debe ser un array");
    assert.equal(sentPayload.attachments.length, 1);
    assert.equal(sentPayload.attachments[0].filename, "nota-de-voz-demo.mp3");
    assert.equal(sentPayload.attachments[0].mime_type, "audio/mp3");
    assert.equal(sentPayload.attachments[0].file.toString(), "fake-mp3-audio-data-12345");

    // Verificar que el mensaje saliente se registró con metadata del adjunto
    const savedMsg = db.prepare("SELECT * FROM linkedin_inbox_messages WHERE target_id = 't1'").get();
    assert.ok(savedMsg, "El mensaje saliente debe existir en linkedin_inbox_messages");
    const meta = JSON.parse(savedMsg.metadata_json);
    assert.ok(meta.attachment, "metadata_json debe contener la info del adjunto");
    assert.equal(meta.attachment.name, "nota-de-voz-demo.mp3");

    // Limpiar archivo temporal
    try { fs.unlinkSync(dummyFilePath); } catch {}
    console.log("  ✓ Mensaje con nota de voz procesado y enviado con éxito al cliente Unipile");
    db.close();
  }

  console.log("▶ Test 3: Runner procesa paso 'follow' (seguir perfil) a través de Unipile");
  {
    const db = makeTestDb();
    db.prepare("INSERT INTO accounts (id, name, email, unipile_account_id, unipile_status) VALUES ('a1', 'Mi Cuenta', 'test@example.com', 'remote-acc-1', 'OK')").run();
    db.prepare("INSERT INTO workflows (id, name) VALUES ('w1', 'Campaña Seguir Perfil')").run();
    db.prepare("INSERT INTO runs (id, workflow_id, account_id) VALUES ('r1', 'w1', 'a1')").run();
    db.prepare("INSERT INTO targets (id, full_name, first_name, linkedin_url, unipile_provider_id) VALUES ('t1', 'Carlos Sanchez', 'Carlos', 'https://www.linkedin.com/in/carlos-s', 'prov-carlos')").run();
    db.prepare("INSERT INTO run_profiles (id, run_id, target_id) VALUES ('rp1', 'r1', 't1')").run();
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track, state, current_step) VALUES ('tr1', 'rp1', 'linkedin', 'pending', 0)").run();

    db.prepare(`
      INSERT INTO workflow_steps (
        id, workflow_id, track, step_order, step_type
      ) VALUES (?, ?, ?, ?, ?)
    `).run("s1", "w1", "linkedin", 1, "follow");

    let followPayload = null;
    const mockClient = {
      isConfigured: () => true,
      getAccount: async () => ({ id: "remote-acc-1", type: "LINKEDIN", sources: [{ status: "OK" }] }),
      listAccounts: async () => ({ items: [{ id: "remote-acc-1", type: "LINKEDIN", sources: [{ status: "OK" }] }] }),
      resolveProfile: async () => ({ provider_id: "prov-carlos" }),
      followUser: async (params) => {
        followPayload = params;
        return { success: true };
      },
    };

    const tr = db.prepare("SELECT * FROM run_profile_tracks WHERE id = 'tr1'").get();
    await processSingleTrack(db, tr, { client: mockClient });

    assert.ok(followPayload !== null, "followUser debió ser llamado");
    assert.equal(followPayload.account_id, "remote-acc-1");
    assert.equal(followPayload.provider_id, "prov-carlos");

    const updatedTr = db.prepare("SELECT * FROM run_profile_tracks WHERE id = 'tr1'").get();
    assert.equal(updatedTr.state, "completed", "Track debió completarse al terminar el único paso");

    const logs = db.prepare("SELECT * FROM logs WHERE run_id = 'r1'").all();
    const followLog = logs.find(l => l.message.includes("seguido en LinkedIn"));
    assert.ok(followLog, "Debe registrar log de confirmación de seguimiento");

    console.log("  ✓ Paso 'follow' ejecutado, perfil seguido con éxito y registrado en logs");
    db.close();
  }

  console.log("\n✅ TODAS LAS PRUEBAS DE SECUENCIAS (ADJUNTOS, AUDIOS Y SEGUIR PERFIL) COMPLETADAS CON ÉXITO");
}

runTests().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
