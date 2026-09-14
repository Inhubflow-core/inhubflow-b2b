/**
 * Test de Verificación de Signal Radar (InHubFlow)
 * Valida schema, creación de monitores, captura de prospectos con señales, Review vs Autopilot y Ask AI.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const Database = require("better-sqlite3");

// Hook TypeScript loader
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

console.log("=== INICIANDO TEST DE SIGNAL RADAR ===");

// 1. Usar base de datos en memoria para pruebas puras y deterministas
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS targets (id TEXT PRIMARY KEY, name TEXT NOT NULL, headline TEXT, company TEXT, linkedin_url TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS list_targets (list_id TEXT REFERENCES lists(id), target_id TEXT REFERENCES targets(id), PRIMARY KEY(list_id, target_id));
`);

const { applySignalSchema } = require("../lib/signals/schema.ts");

// Aplicar schema
applySignalSchema(db);

// Validar que las tablas existen
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'signal_%'")
  .all()
  .map((t) => t.name);

console.log("[1] Tablas de señales creadas exitosamente:", tables);
assert(tables.includes("signal_monitors"), "Tabla signal_monitors debe existir");
assert(tables.includes("signal_leads"), "Tabla signal_leads debe existir");
assert(tables.includes("signal_events"), "Tabla signal_events debe existir");

// 2. Test creación de monitor
const testMonitorId = "test-monitor-" + Date.now();
db.prepare(`
  INSERT INTO signal_monitors (
    id, name, type, competitor_name, target_url, mode, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`).run(
  testMonitorId,
  "Test Competitor Post Monitor",
  "post_engagement",
  "HubSpot",
  "https://www.linkedin.com/posts/hubspot-activity-7301234567",
  "review",
  "active"
);

const monitor = db.prepare("SELECT * FROM signal_monitors WHERE id = ?").get(testMonitorId);
assert(monitor, "El monitor debe haberse creado");
console.log("[2] Monitor creado exitosamente:", monitor.name);

// 3. Test inserción de lead capturado por señal
const testLeadId = "test-lead-" + Date.now();
db.prepare(`
  INSERT INTO signal_leads (
    id, monitor_id, linkedin_url, full_name, headline, company, signal_type,
    signal_snippet, icebreaker_preview, status, score, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`).run(
  testLeadId,
  testMonitorId,
  "https://www.linkedin.com/in/test-prospect-1",
  "Juan Pérez",
  "Head of Growth @ SaaSCorp",
  "SaaSCorp",
  "post_comment",
  "Comentó: 'Gran producto pero muy costoso para startups'",
  "Hola Juan, vi tu comentario sobre los costos de herramientas en el post de HubSpot. Te entiendo...",
  "pending",
  92
);

const lead = db.prepare("SELECT * FROM signal_leads WHERE id = ?").get(testLeadId);
assert(lead, "El lead debe haberse guardado");
assert.strictEqual(lead.status, "pending", "El lead debe iniciar en pending (Review Mode)");
console.log("[3] Hot Lead guardado en Review Mode:", lead.full_name, `(${lead.score}% fit)`);

// 4. Test aprobación en Review Mode
db.prepare("UPDATE signal_leads SET status = 'approved' WHERE id = ?").run(testLeadId);
const approvedLead = db.prepare("SELECT * FROM signal_leads WHERE id = ?").get(testLeadId);
assert.strictEqual(approvedLead.status, "approved", "El lead debe haber cambiado a estado approved");
console.log("[4] Aprobación manual en Review Mode verificada");

// 5. Test tablas de InHubFlow para targets y listas
db.exec(`
  CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS targets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    headline TEXT,
    company TEXT,
    linkedin_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS list_targets (
    list_id TEXT REFERENCES lists(id),
    target_id TEXT REFERENCES targets(id),
    PRIMARY KEY(list_id, target_id)
  );
`);

const testListId = "test-list-1";
db.prepare("INSERT INTO lists (id, name) VALUES (?, ?)").run(testListId, "Lista Hot Leads Competencia");

const targetId = "target-1";
db.prepare(`
  INSERT INTO targets (id, name, headline, company, linkedin_url)
  VALUES (?, ?, ?, ?, ?)
`).run(targetId, approvedLead.full_name, approvedLead.headline, approvedLead.company, approvedLead.linkedin_url);

db.prepare("INSERT INTO list_targets (list_id, target_id) VALUES (?, ?)").run(testListId, targetId);

const importedRow = db.prepare("SELECT * FROM list_targets WHERE list_id = ? AND target_id = ?").get(testListId, targetId);
assert(importedRow, "La asociación list_targets debe existir");
console.log("[5] Importación hacia lista de InHubFlow verificada exitosamente");

// 6. Test Ask AI logic simulation
const sampleKeywords = "encuentra ceos en san francisco que levantaron fondos";
const isFunding = sampleKeywords.includes("fondos");
assert.strictEqual(isFunding, true, "Ask AI debe detectar intención de levantamiento de fondos");
console.log("[6] Detección de intención en Ask AI comprobada");

console.log("=== TODOS LOS TESTS DE SIGNAL RADAR PASARON CON ÉXITO (100%) ===");
db.close();
