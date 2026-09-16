#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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

async function run() {
  const tempPath = path.join(os.tmpdir(), `inhubflow-unipile-migration-${process.pid}-${Date.now()}.db`);
  const sourcePath = path.join(root, "linki.db");
  if (fs.existsSync(sourcePath)) {
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    await source.backup(tempPath);
    source.close();
  }
  if (fs.existsSync(tempPath)) {
    const fixture = new Database(tempPath);
    try {
      fixture.prepare(`
        INSERT OR REPLACE INTO logs (id, run_id, target_id, level, message)
        VALUES ('provider-branding-test', NULL, NULL, 'info', '[INFO] Mensaje enviado a Prueba vía Unipile')
      `).run();
    } finally {
      fixture.close();
    }
  }
  process.env.INHUBFLOW_DB_PATH = tempPath;
  try {
    const { getDb } = require("../lib/db.ts");
    const db = getDb();
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    assert.ok(tables.has("linkedin_target_accounts"));
    assert.ok(tables.has("linkedin_step_deliveries"));
    assert.ok(tables.has("linkedin_connection_attempts"));
    assert.ok(tables.has("runtime_leases"));
    const accountColumns = new Set(db.prepare("PRAGMA table_info(accounts)").all().map((row) => row.name));
    assert.ok(accountColumns.has("unipile_account_id"));
    assert.ok(accountColumns.has("unipile_status"));
    const targetColumns = new Set(db.prepare("PRAGMA table_info(targets)").all().map((row) => row.name));
    assert.ok(targetColumns.has("unipile_provider_id"));
    assert.ok(targetColumns.has("unipile_chat_id"));
    const sanitizedLog = db.prepare("SELECT message FROM logs WHERE id = 'provider-branding-test'").get();
    assert.equal(sanitizedLog.message, "[INFO] Mensaje enviado a Prueba con éxito!");
    assert.equal(sanitizedLog.message.includes("Unipile"), false);
    db.close();
    console.log("✅ MIGRACIONES UNIPILE VALIDADAS SOBRE UNA COPIA DE LA BASE EXISTENTE");
  } finally {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(tempPath + suffix); } catch { /* already absent */ }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
