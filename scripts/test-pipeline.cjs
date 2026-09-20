/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const Database = require("better-sqlite3");

// TypeScript on-the-fly transpiler
// NOTE: the replacement must emit forward slashes — a Windows path with
// backslashes would be parsed as escape sequences inside the require() literal.
const LIB_ROOT = path.resolve(__dirname, "../lib").replace(/\\/g, "/");
Module._extensions[".ts"] = (module, filename) => {
  let source = fs.readFileSync(filename, "utf8");
  // replace alias "@/lib/" with relative paths
  source = source.replace(/@\/lib\//g, () => LIB_ROOT + "/");
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

const { applyPipelineSchema, DEFAULT_PIPELINE_STAGES } = require("../lib/pipeline/schema.ts");
const {
  moveTargetToStage,
  autoAdvanceTargetByTrigger,
  getPipelineStagesWithCounts,
  getPipelineCardsByStage,
} = require("../lib/pipeline/pipeline-service.ts");

console.log("=== Testing Pipeline & Kanban Module ===");

function resolveDbPath() {
  const inhubflowDb = path.join(process.cwd(), "inhubflow.db");
  const linkiDb = path.join(process.cwd(), "linki.db");
  if (fs.existsSync(inhubflowDb) && fs.statSync(inhubflowDb).size > 4096) return inhubflowDb;
  if (fs.existsSync(linkiDb)) return linkiDb;
  if (fs.existsSync(inhubflowDb)) return inhubflowDb;
  return inhubflowDb;
}

const db = new Database(resolveDbPath());
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// 1. Run schema migration
console.log("1. Applying Pipeline Schema...");
applyPipelineSchema(db);
console.log("✓ Pipeline schema applied successfully.");

// 2. Verify pipeline_stages
const stages = db.prepare("SELECT * FROM pipeline_stages ORDER BY order_index ASC").all();
console.log(`✓ Verified ${stages.length} pipeline stages in database:`);
stages.forEach((s) => {
  console.log(`   [${s.order_index}] ${s.name} (${s.id}) color=${s.color}`);
});
assert.ok(stages.length >= 7, "Expected at least 7 default stages");

// 3. Verify targets table columns
const targetCols = db.prepare("PRAGMA table_info(targets)").all().map((c) => c.name);
assert.ok(targetCols.includes("stage_id"), "targets table should have stage_id column");
assert.ok(targetCols.includes("stage_updated_at"), "targets table should have stage_updated_at column");
console.log("✓ targets table has stage_id and stage_updated_at columns.");

// 4. Test getPipelineStagesWithCounts
const stagesWithCounts = getPipelineStagesWithCounts(db);
console.log("✓ getPipelineStagesWithCounts executed successfully:");
console.table(
  stagesWithCounts.map((s) => ({
    id: s.id,
    name: s.name,
    leads: s.target_count,
  }))
);

// 5. Test autoAdvanceTargetByTrigger on a dummy target
const testTargetId = "test_lead_" + Date.now();
db.prepare(`
  INSERT INTO targets (id, full_name, email, created_at)
  VALUES (?, 'Test Kanban Lead', 'test@kanban.com', datetime('now'))
`).run(testTargetId);

try {
  // Test auto-advancing to 'connected'
  let advanced = autoAdvanceTargetByTrigger(db, testTargetId, "connected");
  assert.equal(advanced, true, "Should advance newly created lead to connected");
  let t1 = db.prepare("SELECT stage_id FROM targets WHERE id = ?").get(testTargetId);
  assert.equal(t1.stage_id, "stage_connected");
  console.log("✓ autoAdvanceTargetByTrigger('connected') moved target to stage_connected.");

  // Test auto-advancing to 'sdr_interested'
  advanced = autoAdvanceTargetByTrigger(db, testTargetId, "sdr_interested");
  assert.equal(advanced, true, "Should advance connected lead to interested");
  let t2 = db.prepare("SELECT stage_id FROM targets WHERE id = ?").get(testTargetId);
  assert.equal(t2.stage_id, "stage_interested");
  console.log("✓ autoAdvanceTargetByTrigger('sdr_interested') moved target to stage_interested.");

  // Test that lower trigger does NOT downgrade (e.g. connected shouldn't overwrite interested)
  advanced = autoAdvanceTargetByTrigger(db, testTargetId, "connected");
  assert.equal(advanced, false, "Should NOT downgrade interested lead to connected");
  let t3 = db.prepare("SELECT stage_id FROM targets WHERE id = ?").get(testTargetId);
  assert.equal(t3.stage_id, "stage_interested");
  console.log("✓ autoAdvanceTargetByTrigger prevents lead regression.");

  // Test manual move
  const moved = moveTargetToStage(db, testTargetId, "stage_meeting", "Manual move for demo");
  assert.equal(moved, true, "moveTargetToStage should succeed");
  let t4 = db.prepare("SELECT stage_id FROM targets WHERE id = ?").get(testTargetId);
  assert.equal(t4.stage_id, "stage_meeting");
  console.log("✓ moveTargetToStage manually moved lead to stage_meeting.");

  // Test card retrieval
  const cards = getPipelineCardsByStage(db, "stage_meeting");
  const foundCard = cards.find((c) => c.id === testTargetId);
  assert.ok(foundCard, "Lead should be returned in getPipelineCardsByStage");
  assert.equal(foundCard.full_name, "Test Kanban Lead");
  console.log("✓ getPipelineCardsByStage returned formatted card correctly.");
} finally {
  // Clean up test target
  db.prepare("DELETE FROM activity_logs WHERE target_id = ?").run(testTargetId);
  db.prepare("DELETE FROM targets WHERE id = ?").run(testTargetId);
  console.log("✓ Test lead cleaned up.");
}

console.log("\n>>> ALL PIPELINE TESTS PASSED! <<<");
