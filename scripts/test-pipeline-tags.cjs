/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Verifies the tag system and its integration with campaigns, lists and the
 * funnel. Creates its own leads and cleans everything up at the end.
 *
 * Usage: node scripts/test-pipeline-tags.cjs
 */
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

const { applyPipelineSchema } = require("../lib/pipeline/schema.ts");
const { applyTagsSchema } = require("../lib/tags/schema.ts");
const {
  applyTag,
  removeTag,
  applyDecisionTags,
  getTargetTags,
  getTagsForTargets,
  listTags,
  resolveTagBySlug,
} = require("../lib/tags/tags-service.ts");
const { getPipelineCardsByStage, getPipelineStagesWithCounts } = require("../lib/pipeline/pipeline-service.ts");

console.log("=== Testing Tag System + Pipeline Integration ===");

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

const failures = [];
function check(label, fn) {
  try {
    fn();
    console.log("  ✓ " + label);
  } catch (err) {
    console.log("  ✗ " + label + " → " + err.message);
    failures.push(label + ": " + err.message);
  }
}

console.log("\n1. Schemas");
applyPipelineSchema(db);
applyTagsSchema(db);
// Idempotency: applying twice must not fail nor duplicate.
applyTagsSchema(db);
const tagCount = db.prepare("SELECT COUNT(*) n FROM tags").get().n;
const sysCount = db.prepare("SELECT COUNT(*) n FROM tags WHERE kind = 'system'").get().n;
check("system taxonomy seeded idempotently (9 tags)", () => {
  assert.ok(sysCount >= 9, `expected >=9 system tags, got ${sysCount}`);
  assert.equal(tagCount, db.prepare("SELECT COUNT(*) n FROM tags").get().n);
});

console.log("\n2. Tag → stage progression");
const leadA = "tagtest_a_" + Date.now();
const leadB = "tagtest_b_" + Date.now();
const leadC = "tagtest_c_" + Date.now();
db.prepare(
  `INSERT INTO targets (id, full_name, email, created_at)
   VALUES (?, 'Lead Etiquetas A', 'tags-a@test.com', datetime('now'))`
).run(leadA);
db.prepare(
  `INSERT INTO targets (id, full_name, email, created_at)
   VALUES (?, 'Lead Etiquetas B', 'tags-b@test.com', datetime('now'))`
).run(leadB);
db.prepare(
  `INSERT INTO targets (id, full_name, email, created_at)
   VALUES (?, 'Lead Etiquetas C', 'tags-c@test.com', datetime('now'))`
).run(leadC);

const stageOf = (id) => db.prepare("SELECT stage_id FROM targets WHERE id = ?").get(id).stage_id;

check("enrolment tag 'contacted' puts the lead in the funnel", () => {
  const res = applyTag(db, leadA, "contacted", { source: "rule", appliedBy: "campaign" });
  assert.equal(res.applied, true);
  assert.equal(res.advanced, true);
  assert.equal(stageOf(leadA), "stage_contacted");
});

check("'connected' advances Contactado → Conexión Aceptada", () => {
  applyTag(db, leadA, "connected", { source: "rule", appliedBy: "unipile" });
  assert.equal(stageOf(leadA), "stage_connected");
});

check("'replied' advances to En Conversación", () => {
  applyTag(db, leadA, "replied", { source: "rule", appliedBy: "inbox" });
  assert.equal(stageOf(leadA), "stage_replied");
});

check("AI tag 'interested' advances to Interesado", () => {
  const applied = applyDecisionTags(db, leadA, ["interested", "pricing"], {
    confidence: 0.91,
    decisionId: "dec-test-1",
    threadId: "thr-test-1",
    reasoning: "Pregunta por precios con interés",
  });
  assert.deepEqual(applied.sort(), ["interested", "pricing"]);
  assert.equal(stageOf(leadA), "stage_interested");
});

check("tag persisted with source='ai' and confidence", () => {
  const row = db
    .prepare(
      `SELECT tt.source, tt.confidence FROM target_tags tt
       JOIN tags tg ON tg.id = tt.tag_id
       WHERE tt.target_id = ? AND tg.slug = 'interested'`
    )
    .get(leadA);
  assert.equal(row.source, "ai");
  assert.equal(row.confidence, 0.91);
});

check("tag_events recorded for audit", () => {
  const n = db.prepare("SELECT COUNT(*) n FROM tag_events WHERE target_id = ?").get(leadA).n;
  assert.ok(n >= 4, `expected >=4 events, got ${n}`);
});

console.log("\n3. No-regression rules");
check("AI 'meeting' advances Interesado → Reunión Agendada", () => {
  applyDecisionTags(db, leadA, ["meeting"], { confidence: 0.8 });
  assert.equal(stageOf(leadA), "stage_meeting");
});

check("an ambiguous reply does NOT downgrade Reunión", () => {
  applyTag(db, leadA, "replied", { source: "rule", appliedBy: "inbox" });
  assert.equal(stageOf(leadA), "stage_meeting");
});

check("'not_interested' always overrides", () => {
  applyTag(db, leadA, "not_interested", { source: "rule" });
  assert.equal(stageOf(leadA), "stage_not_interested");
});

check("won is never downgraded", () => {
  db.prepare("UPDATE targets SET stage_id = 'stage_won' WHERE id = ?").run(leadB);
  applyTag(db, leadB, "connected", { source: "rule" });
  assert.equal(stageOf(leadB), "stage_won");
});

console.log("\n4. Unknown / invalid input");
check("unknown slug is ignored without throwing", () => {
  const res = applyTag(db, leadA, "no_existe", { source: "ai" });
  assert.equal(res.applied, false);
  assert.equal(res.tag, null);
});

check("applyDecisionTags tolerates garbage from the model", () => {
  const applied = applyDecisionTags(db, leadC, ["interested", "inventada", "", "  "], {});
  assert.deepEqual(applied, ["interested"]);
  assert.equal(stageOf(leadC), "stage_interested");
});

check("tagging a non-existent target is a no-op", () => {
  const res = applyTag(db, "no-such-target", "interested", { source: "manual" });
  assert.equal(res.applied, false);
});

console.log("\n5. Removal");
check("removeTag deletes the association and logs it", () => {
  const removed = removeTag(db, leadA, "pricing", { source: "manual", appliedBy: "user" });
  assert.equal(removed, true);
  const still = getTargetTags(db, leadA).some((t) => t.slug === "pricing");
  assert.equal(still, false);
  const ev = db
    .prepare("SELECT 1 FROM tag_events WHERE target_id = ? AND action = 'removed'")
    .get(leadA);
  assert.ok(ev);
});

console.log("\n6. Cards expose tags, lists and campaigns");
const listId = "tagtest_list_" + Date.now();
const wfId = "tagtest_wf_" + Date.now();
const runId = "tagtest_run_" + Date.now();
db.prepare("INSERT INTO lists (id, name, created_at) VALUES (?, 'Lista Test Tags', datetime('now'))").run(listId);
db.prepare("INSERT INTO workflows (id, name, created_at) VALUES (?, 'Campaña Test Tags', datetime('now'))").run(wfId);
db.prepare(
  `INSERT INTO runs (id, workflow_id, list_id, status, created_at)
   VALUES (?, ?, ?, 'running', datetime('now'))`
).run(runId, wfId, listId);
db.prepare("INSERT INTO list_targets (list_id, target_id) VALUES (?, ?)").run(listId, leadA);
db.prepare(
  "INSERT INTO run_profiles (id, run_id, target_id) VALUES (?, ?, ?)"
).run("tagtest_rp_" + Date.now(), runId, leadA);

check("card carries tags, list and campaign names", () => {
  const cards = getPipelineCardsByStage(db, "stage_not_interested", { listId });
  const card = cards.find((c) => c.id === leadA);
  assert.ok(card, "card not returned for its list");
  assert.ok(card.tags.some((t) => t.slug === "interested"), "tags missing");
  assert.deepEqual(card.list_names, ["Lista Test Tags"]);
  assert.deepEqual(card.workflow_names, ["Campaña Test Tags"]);
  assert.equal(card.workflow_name, "Campaña Test Tags");
});

check("filtering by tag returns only tagged leads", () => {
  const cards = getPipelineCardsByStage(db, "stage_not_interested", { tagSlugs: ["interested"] });
  assert.ok(cards.some((c) => c.id === leadA));
  const none = getPipelineCardsByStage(db, "stage_not_interested", { tagSlugs: ["qualified"] });
  assert.equal(none.some((c) => c.id === leadA), false);
});

check("filtering by campaign excludes non-enrolled leads", () => {
  const cards = getPipelineCardsByStage(db, "stage_not_interested", { workflowId: wfId });
  assert.ok(cards.some((c) => c.id === leadA));
});

check("getTagsForTargets batches correctly", () => {
  const map = getTagsForTargets(db, [leadA, leadB, leadC]);
  assert.ok(map[leadA].some((t) => t.slug === "interested"));
  assert.ok(map[leadC].some((t) => t.slug === "interested"));
});

check("stage counts respect filters", () => {
  const stages = getPipelineStagesWithCounts(db, { tagSlugs: ["interested"] });
  const interested = stages.find((s) => s.id === "stage_interested");
  assert.ok(interested.target_count >= 1, "expected the tagged lead C to be counted");
});

console.log("\n6b. Workspace isolation");
// Attach lead A to an owned LinkedIn account and verify a foreign workspace
// cannot see it. Isolation is derived by joining accounts, since targets have
// no owner column.
const ownerId = "tagtest_owner_" + Date.now();
const foreignId = "tagtest_foreign_" + Date.now();
const acctId = "tagtest_acct_" + Date.now();
db.prepare("INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, 'x', 'admin', datetime('now'))").run(ownerId, `owner+${ownerId}@test.com`);
db.prepare("INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, 'x', 'admin', datetime('now'))").run(foreignId, `foreign+${foreignId}@test.com`);
db.prepare("INSERT INTO accounts (id, name, email, owner_id, created_at) VALUES (?, 'Cuenta Test', ?, ?, datetime('now'))").run(acctId, `acct+${acctId}@test.com`, ownerId);
db.prepare(
  "INSERT INTO linkedin_inbox_messages (id, account_id, target_id, external_thread_id, external_message_id, direction, body, sent_at, identity_mode, captured_at) VALUES (?, ?, ?, ?, ?, 'inbound', 'hola', datetime('now'), 'profile_url', datetime('now'))"
).run("tagtest_msg_" + Date.now(), acctId, leadA, "thread-1", "msg-1");

check("owner workspace sees the lead", () => {
  const cards = getPipelineCardsByStage(db, "stage_not_interested", { workspaceOwnerId: ownerId });
  assert.ok(cards.some((c) => c.id === leadA), "owner should see the lead");
});

check("foreign workspace does NOT see the lead", () => {
  const cards = getPipelineCardsByStage(db, "stage_not_interested", { workspaceOwnerId: foreignId });
  assert.equal(cards.some((c) => c.id === leadA), false, "foreign workspace leaked a lead");
});

check("global stages are still visible to every workspace", () => {
  const stages = getPipelineStagesWithCounts(db, { workspaceOwnerId: foreignId });
  assert.ok(stages.length >= 7, `expected >=7 stages, got ${stages.length}`);
});

console.log("\n7. Catalogue helpers");
check("listTags returns the system taxonomy", () => {
  const tags = listTags(db, "some-workspace");
  assert.ok(tags.some((t) => t.slug === "interested"));
});
check("resolveTagBySlug finds global tags for any workspace", () => {
  assert.ok(resolveTagBySlug(db, "meeting", "some-workspace"));
  assert.equal(resolveTagBySlug(db, "nope"), undefined);
});

// Cleanup — children first: run_profile_tracks → run_profiles → runs.
db.transaction(() => {
  db.prepare(
    "DELETE FROM run_profile_tracks WHERE run_profile_id IN (SELECT id FROM run_profiles WHERE run_id = ?)"
  ).run(runId);
  db.prepare("DELETE FROM run_profiles WHERE run_id = ?").run(runId);
  db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
  db.prepare("DELETE FROM workflow_steps WHERE workflow_id = ?").run(wfId);
  db.prepare("DELETE FROM workflows WHERE id = ?").run(wfId);
  db.prepare("DELETE FROM list_targets WHERE list_id = ?").run(listId);
  db.prepare("DELETE FROM lists WHERE id = ?").run(listId);
  db.prepare("DELETE FROM linkedin_inbox_messages WHERE account_id = ?").run(acctId);
  db.prepare("DELETE FROM accounts WHERE id = ?").run(acctId);
  db.prepare("DELETE FROM users WHERE id IN (?, ?)").run(ownerId, foreignId);
  for (const id of [leadA, leadB, leadC]) {
    db.prepare("DELETE FROM tag_events WHERE target_id = ?").run(id);
    db.prepare("DELETE FROM target_tags WHERE target_id = ?").run(id);
    db.prepare("DELETE FROM activity_logs WHERE target_id = ?").run(id);
    db.prepare("DELETE FROM targets WHERE id = ?").run(id);
  }
})();
console.log("\n✓ Test data cleaned up.");

if (failures.length > 0) {
  console.log("\nFALLOS:");
  for (const f of failures) console.log(" - " + f);
  process.exit(1);
}
console.log("\n>>> ALL TAG + PIPELINE TESTS PASSED! <<<");
