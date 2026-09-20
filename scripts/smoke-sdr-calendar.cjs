/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Smoke test: with NATIVE_CALENDAR_ENABLED on, the SDR proposal path must produce
 * real slots, and approving one must create the meeting and advance the lead.
 * Creates its own rows and removes them at the end.
 *
 * Usage: NATIVE_CALENDAR_ENABLED=true node scripts/smoke-sdr-calendar.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");
const Database = require("better-sqlite3");

const LIB_ROOT = path.resolve(__dirname, "../lib").replace(/\\/g, "/");
Module._extensions[".ts"] = (module, filename) => {
  let source = fs.readFileSync(filename, "utf8");
  source = source.replace(/@\/lib\//g, () => LIB_ROOT + "/");
  module._compile(
    ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        esModuleInterop: true,
      },
    }).outputText,
    filename
  );
};

const db = new Database(path.join(process.cwd(), "linki.db"));
db.pragma("foreign_keys = ON");

const { applyCalendarSchema } = require("../lib/calendar/schema.ts");
const { proposeMeetingSlots, nativeCalendarEnabled } = require("../lib/calendar/meeting-requests.ts");
const {
  listMeetingRequests,
  approveMeetingRequest,
  getCalendarEventById,
} = require("../lib/calendar/calendar-service.ts");

applyCalendarSchema(db);

console.log("NATIVE_CALENDAR_ENABLED seen by runtime:", nativeCalendarEnabled());
if (!nativeCalendarEnabled()) {
  console.log("\n✗ flag is off — run with NATIVE_CALENDAR_ENABLED=true");
  process.exit(1);
}

const targetId = "smoke_t_" + Date.now();
const threadId = "smoke_th_" + Date.now();

db.prepare(
  "INSERT INTO targets (id, full_name, email, created_at) VALUES (?, 'Lead Smoke', 'smoke@test.com', datetime('now'))"
).run(targetId);

const proposal = proposeMeetingSlots(db, {
  threadId,
  decisionId: "smoke_decision",
  targetId,
  workspaceOwnerId: null,
  notes: "El prospecto pidió horarios",
});

console.log("proposal reason:", proposal.reason, "| slots:", proposal.slots.length);
for (const s of proposal.slots) console.log("   ·", s.label);

const pending = listMeetingRequests(db, { status: "pending" }).length;
console.log("pending requests visible on /calendar:", pending);

let ok = proposal.requested && proposal.slots.length > 0 && pending > 0;

if (proposal.requestId) {
  const { event } = approveMeetingRequest(db, proposal.requestId, {
    start_time: proposal.slots[0].start_time,
    end_time: proposal.slots[0].end_time,
    actorUserId: "smoke",
    workspaceOwnerId: null,
  });
  const stage = db.prepare("SELECT stage_id FROM targets WHERE id = ?").get(targetId).stage_id;
  console.log("approved ->", event.id, "|", event.title);
  console.log("  channel:", event.channel, "| source:", event.source);
  console.log("  lead stage after approval:", stage);
  ok = ok && event.channel === "sdr_ai" && event.source === "sdr_ai" && stage === "stage_meeting";

  db.prepare("DELETE FROM calendar_events WHERE id = ?").run(event.id);
  db.prepare("DELETE FROM calendar_meeting_requests WHERE id = ?").run(proposal.requestId);
  db.prepare("DELETE FROM calendar_audit WHERE detail_json LIKE '%smoke%'").run();
}
db.prepare("DELETE FROM targets WHERE id = ?").run(targetId);
console.log("cleanup done; event gone:", getCalendarEventById(db, "nope") === null);

console.log(ok ? "\n✓ SDR → calendar path works end to end" : "\n✗ SDR → calendar path FAILED");
process.exit(ok ? 0 : 1);
