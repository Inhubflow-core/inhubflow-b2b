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
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

async function run() {
  const sourcePath = path.join(root, "linki.db");
  const tempPath = path.join(os.tmpdir(), `inhubflow-signal-migration-${process.pid}-${Date.now()}.db`);
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  await source.backup(tempPath);
  source.close();
  const db = new Database(tempPath);
  try {
    const before = {};
    for (const table of ["signal_monitors", "signal_leads", "signal_events"]) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      before[table] = exists ? db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count : 0;
    }
    const { applySignalSchema } = require("../lib/signals/schema.ts");
    applySignalSchema(db);
    applySignalSchema(db);
    for (const table of ["signal_monitors", "signal_leads", "signal_events"]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, before[table]);
    }
    for (const table of ["signal_observations", "signal_scan_runs", "signal_promotions", "run_profile_step_messages"]) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} missing`);
    }
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    console.log("✅ MIGRACIÓN SIGNAL RADAR VALIDADA SOBRE COPIA DE LA BASE EXISTENTE");
  } finally {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tempPath + suffix); } catch {} }
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
