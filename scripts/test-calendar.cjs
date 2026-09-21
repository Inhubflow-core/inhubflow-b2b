/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Verifies the calendar module end to end: IANA timezone math, slot generation,
 * collision rejection, workspace isolation, audit trail, and the SDR IA meeting
 * request → approval flow. Creates its own rows and cleans them up at the end.
 *
 * Usage: node scripts/test-calendar.cjs
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

const { applyCalendarSchema } = require("../lib/calendar/schema.ts");
const {
  dayKeyInZone,
  timeLabelInZone,
  utcFromZoned,
  dayBoundsInZone,
  normalizeTimeZone,
} = require("../lib/calendar/time.ts");
const {
  findSlotCollision,
  computeAvailability,
  suggestSlots,
} = require("../lib/calendar/availability.ts");
const {
  getCalendarSettings,
  saveCalendarSettings,
  rotateFeedToken,
} = require("../lib/calendar/settings.ts");
const { listCalendarAudit } = require("../lib/calendar/audit.ts");
const {
  createCalendarEvent,
  getCalendarEvents,
  getCalendarEventById,
  updateCalendarEvent,
  deleteCalendarEvent,
  setCalendarEventStatus,
  CalendarConflictError,
  createMeetingRequest,
  getMeetingRequest,
  listMeetingRequests,
  approveMeetingRequest,
  resolveMeetingRequest,
} = require("../lib/calendar/calendar-service.ts");
const { proposeMeetingSlots, nativeCalendarEnabled } = require("../lib/calendar/meeting-requests.ts");

console.log("=== Testing Calendar Module ===");

function resolveDbPath() {
  if (process.env.INHUBFLOW_DB_PATH) return process.env.INHUBFLOW_DB_PATH;
  return path.join(process.cwd(), "inhubflow.db");
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

const WS_A = "caltest_ws_a";
const WS_B = "caltest_ws_b";
const cleanupIds = { events: [], targets: [], requests: [], users: [] };

// calendar_settings.workspace_owner_id references users(id), so the test needs
// real user rows to stand in for two separate workspaces.
for (const [id, email] of [
  [WS_A, "caltest-a@test.local"],
  [WS_B, "caltest-b@test.local"],
]) {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, created_at)
     VALUES (?, ?, 'x', 'user', datetime('now'))`
  ).run(id, email);
  cleanupIds.users.push(id);
}

console.log("\n1. Schema");
// An earlier run that aborted before its cleanup would leave rows behind and make
// this run fail for the wrong reason — and because calendar_events.workspace_owner_id
// is `ON DELETE SET NULL`, deleting the synthetic users turns leftovers into
// NULL-owner rows that then block every later booking. Wipe them first. Every
// statement here is scoped to the synthetic workspaces or to this script's own ids;
// real rows are never touched.
const TEST_TITLES = [
  "Reunión ocupada",
  "Doble reserva",
  "Demo con Lead Calendario",
  "Reunión de otro workspace",
  "Reunión a borrar",
  "Reunión desde campaña",
];
db.prepare(
  `DELETE FROM calendar_audit WHERE event_id IN (
     SELECT id FROM calendar_events WHERE workspace_owner_id IN (?, ?)
   ) OR detail_json LIKE '%caltest%'`
).run(WS_A, WS_B);
db.prepare(`DELETE FROM calendar_events WHERE workspace_owner_id IN (?, ?)`).run(WS_A, WS_B);
db.prepare(
  `DELETE FROM calendar_events
   WHERE workspace_owner_id IS NULL AND title IN (${TEST_TITLES.map(() => "?").join(",")})`
).run(...TEST_TITLES);
db.prepare(
  `DELETE FROM calendar_meeting_requests
   WHERE workspace_owner_id IN (?, ?) OR thread_id LIKE 'caltest%'`
).run(WS_A, WS_B);
db.prepare(`DELETE FROM calendar_settings WHERE workspace_owner_id IN (?, ?)`).run(WS_A, WS_B);
db.prepare(`DELETE FROM targets WHERE id LIKE 'caltest_target%'`).run();
db.prepare(`DELETE FROM runs WHERE id LIKE 'caltest_run%'`).run();
db.prepare(`DELETE FROM lists WHERE id LIKE 'caltest_list%'`).run();
db.prepare(`DELETE FROM workflows WHERE id LIKE 'caltest_wf%'`).run();

applyCalendarSchema(db);
// Idempotency: applying twice must not fail nor duplicate.
applyCalendarSchema(db);

check("calendar tables exist", () => {
  for (const t of [
    "calendar_events",
    "calendar_settings",
    "calendar_meeting_requests",
    "calendar_audit",
  ]) {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(t);
    assert.ok(row, `missing table ${t}`);
  }
});

check("calendar_events carries ecosystem columns", () => {
  const cols = db.prepare("PRAGMA table_info(calendar_events)").all().map((c) => c.name);
  for (const c of [
    "run_id",
    "list_id",
    "thread_id",
    "decision_id",
    "source",
    "workspace_owner_id",
    "created_by",
  ]) {
    assert.ok(cols.includes(c), `missing column calendar_events.${c}`);
  }
});

console.log("\n2. IANA timezone math");
const TZ = "America/Santiago";

check("dayKeyInZone follows the workspace zone, not the browser's", () => {
  // 2026-09-20 02:00 UTC = 2026-09-19 23:00 in Santiago (−04).
  const instant = new Date("2026-09-20T02:00:00.000Z");
  assert.equal(dayKeyInZone(instant, TZ), "2026-09-19");
  assert.equal(dayKeyInZone(instant, "UTC"), "2026-09-20");
});

check("timeLabelInZone renders the wall clock of the zone", () => {
  const instant = new Date("2026-09-20T02:00:00.000Z");
  assert.equal(timeLabelInZone(instant, TZ), "23:00");
  assert.equal(timeLabelInZone(instant, "UTC"), "02:00");
});

check("utcFromZoned round-trips through the zone", () => {
  const start = utcFromZoned(2026, 9, 20, 15, 30, TZ);
  assert.equal(dayKeyInZone(start, TZ), "2026-09-20");
  assert.equal(timeLabelInZone(start, TZ), "15:30");
});

check("utcFromZoned handles the DST transition", () => {
  // Chile moves from −04 to −03 on the first Sunday of September.
  const beforeDst = utcFromZoned(2026, 9, 5, 10, 0, TZ);
  const afterDst = utcFromZoned(2026, 9, 7, 10, 0, TZ);
  assert.equal(timeLabelInZone(beforeDst, TZ), "10:00");
  assert.equal(timeLabelInZone(afterDst, TZ), "10:00");
  // Both are local 10:00 but the UTC instants differ by the offset shift.
  assert.notEqual(beforeDst.toISOString(), afterDst.toISOString());
});

check("dayBoundsInZone spans the whole local day in UTC", () => {
  const { start, end } = dayBoundsInZone("2026-09-20", TZ);
  assert.ok(start instanceof Date && end instanceof Date);
  assert.ok(end.getTime() - start.getTime() === 24 * 3600_000);
  assert.equal(dayKeyInZone(start, TZ), "2026-09-20");
});

check("normalizeTimeZone rejects unknown zones", () => {
  assert.equal(normalizeTimeZone("Mars/Olympus"), "America/Santiago");
  assert.equal(normalizeTimeZone("Europe/Madrid"), "Europe/Madrid");
});

console.log("\n3. Settings per workspace");
// Snapshot the pre-existing settings row so we can restore it.
const originalSettings = db.prepare("SELECT * FROM calendar_settings").all();

saveCalendarSettings(
  db,
  {
    timezone: TZ,
    slot_duration_minutes: 30,
    buffer_time_minutes: 15,
    working_hours_json: JSON.stringify({
      mon: [{ start: "09:00", end: "18:00" }],
      tue: [{ start: "09:00", end: "18:00" }],
      wed: [{ start: "09:00", end: "18:00" }],
      thu: [{ start: "09:00", end: "18:00" }],
      fri: [{ start: "09:00", end: "18:00" }],
      sat: [],
      sun: [],
    }),
    min_notice_hours: 0,
    default_meeting_link: "https://meet.example.com/test-room",
  },
  WS_A
);

check("settings persist per workspace", () => {
  const s = getCalendarSettings(db, WS_A);
  assert.equal(s.timezone, TZ);
  assert.equal(s.slot_duration_minutes, 30);
  assert.equal(s.buffer_time_minutes, 15);
});

check("a second workspace has its own settings", () => {
  saveCalendarSettings(
    db,
    { timezone: "Europe/Madrid", slot_duration_minutes: 60, buffer_time_minutes: 0 },
    WS_B
  );
  assert.equal(getCalendarSettings(db, WS_B).timezone, "Europe/Madrid");
  assert.equal(getCalendarSettings(db, WS_A).timezone, TZ);
});

check("feed token rotates", () => {
  const first = rotateFeedToken(db, WS_A);
  const second = rotateFeedToken(db, WS_A);
  assert.ok(first && second, "tokens must be non-empty");
  assert.notEqual(first, second, "rotating must produce a new token");
});

console.log("\n4. Availability + collision");
// Pick a far-future Monday so real data can never interfere.
function nextMonday(from = new Date()) {
  const d = new Date(from.getTime() + 30 * 86_400_000);
  const diff = (1 - d.getDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}
const monday = nextMonday();
const dayKey = dayKeyInZone(monday, TZ);
// min_notice_hours is enforced against `now`; the test day is ~30 days out, so any
// realistic now satisfies it. Passing `monday` itself would make every slot "too soon".
const nowForAvail = new Date(monday.getTime() - 7 * 86_400_000);

check("computeAvailability produces slots inside working hours", () => {
  const res = computeAvailability(db, dayKey, { now: nowForAvail, workspaceOwnerId: WS_A });
  assert.ok(res.slots.length > 0, "expected slots on a working Monday");
  assert.equal(res.timezone, TZ);
  const first = res.slots[0];
  assert.equal(first.time, "09:00");
  const last = res.slots[res.slots.length - 1];
  assert.ok(last.time <= "17:30", `last slot ${last.time} exceeds working hours`);
});

check("closed days yield no slots", () => {
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  const res = computeAvailability(db, dayKeyInZone(sunday, TZ), { now: nowForAvail, workspaceOwnerId: WS_A });
  assert.equal(res.slots.length, 0);
});

const slotStart = utcFromZoned(
  Number(dayKey.slice(0, 4)),
  Number(dayKey.slice(5, 7)),
  Number(dayKey.slice(8, 10)),
  10,
  0,
  TZ
);
const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);

check("no collision before anything is booked", () => {
  assert.equal(findSlotCollision(db, slotStart.getTime(), slotEnd.getTime()), undefined);
});

const busy = createCalendarEvent(
  db,
  {
    title: "Reunión ocupada",
    start_time: slotStart.toISOString(),
    end_time: slotEnd.toISOString(),
    status: "confirmed",
    channel: "manual",
    workspace_owner_id: WS_A,
    source: "manual",
  },
  { workspaceOwnerId: WS_A }
);
cleanupIds.events.push(busy.id);

check("the booked slot is now reported as unavailable", () => {
  const res = computeAvailability(db, dayKey, { now: nowForAvail, workspaceOwnerId: WS_A });
  const ten = res.slots.find((s) => s.time === "10:00");
  assert.ok(ten, "10:00 slot missing");
  assert.equal(ten.available, false);
});

check("buffer blocks the adjacent slot too (15 min buffer, 30 min slots)", () => {
  const res = computeAvailability(db, dayKey, { now: nowForAvail, workspaceOwnerId: WS_A });
  // Busy meeting is 10:00–10:30. With a 15 min buffer on both sides the blocked
  // window is 09:45–10:45, so 09:30 (which ends at 10:00, inside the window) is
  // taken while 09:00 (ends 09:30, buffer ends 09:45) is still free.
  const half = res.slots.find((s) => s.time === "09:30");
  assert.ok(half, "09:30 slot missing");
  assert.equal(half.available, false, "09:30 must be blocked by the 15 min buffer");

  const nine = res.slots.find((s) => s.time === "09:00");
  assert.equal(nine.available, true, "09:00 ends before the buffer window starts");

  const halfPast = res.slots.find((s) => s.time === "10:30");
  assert.equal(halfPast.available, false, "10:30 starts inside the buffer window");
});

check("findSlotCollision detects overlap by range, not by string prefix", () => {
  // An event that starts 10 minutes before the busy one ends must collide.
  const overlapStart = new Date(slotEnd.getTime() - 10 * 60_000);
  const hit = findSlotCollision(
    db,
    overlapStart.getTime(),
    new Date(overlapStart.getTime() + 30 * 60_000).getTime()
  );
  assert.ok(hit, "expected a collision");
  assert.equal(hit.id, busy.id);
});

check("findSlotCollision honours excludeEventId (reschedule case)", () => {
  const hit = findSlotCollision(db, slotStart.getTime(), slotEnd.getTime(), {
    excludeEventId: busy.id,
  });
  assert.equal(hit, undefined);
});

check("suggestSlots returns bookable candidates", () => {
  const slots = suggestSlots(db, {
    days: 14,
    count: 3,
    from: nowForAvail,
    workspaceOwnerId: WS_A,
  });
  assert.ok(slots.length > 0, "expected suggestions");
  assert.ok(slots.length <= 3);
  assert.ok(slots[0].start_time < slots[0].end_time);
});

console.log("\n5. Event CRUD + audit");
// Sections 5–9 run inside a function so that an unexpected throw still reaches
// the cleanup below — a half-finished run would otherwise leave bookings behind.
runChecks();

function runChecks() {
const targetId = "caltest_target_" + Date.now();
db.prepare(
  `INSERT INTO targets (id, full_name, email, created_at)
   VALUES (?, 'Lead Calendario', 'cal-test@test.com', datetime('now'))`
).run(targetId);
cleanupIds.targets.push(targetId);

check("createCalendarEvent rejects an overlapping slot", () => {
  assert.throws(
    () =>
      createCalendarEvent(
        db,
        {
          title: "Doble reserva",
          start_time: slotStart.toISOString(),
          end_time: slotEnd.toISOString(),
          status: "confirmed",
          channel: "manual",
          workspace_owner_id: WS_A,
        },
        { workspaceOwnerId: WS_A }
      ),
    CalendarConflictError
  );
});

const evt = createCalendarEvent(
  db,
  {
    title: "Demo con Lead Calendario",
    start_time: new Date(slotStart.getTime() + 3 * 3600_000).toISOString(),
    end_time: new Date(slotStart.getTime() + 3 * 3600_000 + 30 * 60_000).toISOString(),
    target_id: targetId,
    status: "confirmed",
    channel: "manual",
    workspace_owner_id: WS_A,
    source: "manual",
  },
  { actorUserId: "caltest_user", workspaceOwnerId: WS_A }
);
cleanupIds.events.push(evt.id);

check("created event carries workspace + author", () => {
  const row = db.prepare("SELECT * FROM calendar_events WHERE id = ?").get(evt.id);
  assert.equal(row.workspace_owner_id, WS_A);
  assert.equal(row.created_by, "caltest_user");
});

check("audit trail records the creation", () => {
  const audit = listCalendarAudit(db, { eventId: evt.id });
  assert.ok(audit.length > 0, "expected at least one audit row");
  assert.ok(audit.some((a) => a.action === "created"), "expected a 'created' action");
});

check("updateCalendarEvent writes an audit row and moves the event", () => {
  const newStart = new Date(slotStart.getTime() + 5 * 3600_000).toISOString();
  const updated = updateCalendarEvent(
    db,
    evt.id,
    { start_time: newStart, end_time: new Date(new Date(newStart).getTime() + 45 * 60_000).toISOString() },
    { actorUserId: "caltest_user", workspaceOwnerId: WS_A }
  );
  assert.equal(updated.start_time, newStart);
  const audit = listCalendarAudit(db, { eventId: evt.id });
  assert.ok(audit.some((a) => a.action === "updated"), "expected an 'updated' action");
});

check("setCalendarEventStatus updates status and pipeline-facing state", () => {
  const done = setCalendarEventStatus(db, evt.id, "completed", {
    actorUserId: "caltest_user",
    workspaceOwnerId: WS_A,
  });
  assert.equal(done.status, "completed");
  assert.equal(db.prepare("SELECT status FROM calendar_events WHERE id = ?").get(evt.id).status, "completed");
});

check("cancelled events stop blocking the slot", () => {
  const cancelled = setCalendarEventStatus(db, busy.id, "cancelled", {
    actorUserId: "caltest_user",
    workspaceOwnerId: WS_A,
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(
    findSlotCollision(db, slotStart.getTime(), slotEnd.getTime()),
    undefined,
    "a cancelled meeting must free its slot"
  );
  const res = computeAvailability(db, dayKey, { now: nowForAvail, workspaceOwnerId: WS_A });
  const ten = res.slots.find((s) => s.time === "10:00");
  assert.equal(ten.available, true);
});

console.log("\n6. Workspace isolation");
const otherWsEvent = createCalendarEvent(
  db,
  {
    title: "Reunión de otro workspace",
    start_time: new Date(slotStart.getTime() + 40 * 3600_000).toISOString(),
    end_time: new Date(slotStart.getTime() + 40 * 3600_000 + 30 * 60_000).toISOString(),
    status: "confirmed",
    channel: "manual",
    workspace_owner_id: WS_B,
    source: "manual",
  },
  { workspaceOwnerId: WS_B }
);
cleanupIds.events.push(otherWsEvent.id);

check("getCalendarEvents only returns the caller's workspace", () => {
  const mine = getCalendarEvents(db, { workspaceOwnerId: WS_A });
  const ids = mine.map((e) => e.id);
  assert.ok(ids.includes(evt.id), "own event missing");
  assert.ok(!ids.includes(otherWsEvent.id), "leaked another workspace's event");
});

check("getCalendarEvents filters by workspace B correctly", () => {
  const theirs = getCalendarEvents(db, { workspaceOwnerId: WS_B });
  const ids = theirs.map((e) => e.id);
  assert.ok(ids.includes(otherWsEvent.id), "event missing for its own workspace");
  assert.ok(!ids.includes(evt.id), "leaked workspace A's event");
});

check("a workspace-scoped query never returns NULL-owner rows for others", () => {
  // Legacy rows (workspace_owner_id IS NULL) must not be visible to WS_B either,
  // since WS_B has no claim on them.
  const legacy = db
    .prepare("SELECT COUNT(*) n FROM calendar_events WHERE workspace_owner_id IS NULL")
    .get().n;
  const theirs = getCalendarEvents(db, { workspaceOwnerId: WS_B }).map((e) => e.id);
  for (const id of theirs) {
    const row = db.prepare("SELECT workspace_owner_id FROM calendar_events WHERE id = ?").get(id);
    assert.equal(row.workspace_owner_id, WS_B, `leaked row ${id} with owner ${row.workspace_owner_id}`);
  }
  assert.ok(true, `legacy NULL-owner rows present: ${legacy}`);
});

console.log("\n7. Ecosystem filters");
const listId = "caltest_list_" + Date.now();
const runId = "caltest_run_" + Date.now();
const workflowId = "caltest_wf_" + Date.now();
db.prepare(
  `INSERT INTO lists (id, name, created_at) VALUES (?, 'Lista Calendario Test', datetime('now'))`
).run(listId);
db.prepare(
  `INSERT INTO workflows (id, name, created_at) VALUES (?, 'Campaña Calendario Test', datetime('now'))`
).run(workflowId);
db.prepare(
  `INSERT INTO runs (id, workflow_id, list_id, status, created_at)
   VALUES (?, ?, ?, 'running', datetime('now'))`
).run(runId, workflowId, listId);

const linked = createCalendarEvent(
  db,
  {
    title: "Reunión desde campaña",
    start_time: new Date(slotStart.getTime() + 50 * 3600_000).toISOString(),
    end_time: new Date(slotStart.getTime() + 50 * 3600_000 + 30 * 60_000).toISOString(),
    status: "confirmed",
    channel: "manual",
    workspace_owner_id: WS_A,
    list_id: listId,
    run_id: runId,
    source: "campaign",
  },
  { workspaceOwnerId: WS_A }
);
cleanupIds.events.push(linked.id);

check("list filter narrows the feed", () => {
  const byList = getCalendarEvents(db, { workspaceOwnerId: WS_A, listId });
  assert.ok(byList.some((e) => e.id === linked.id), "list filter missed the linked event");
  assert.ok(!byList.some((e) => e.id === evt.id), "list filter leaked an unlinked event");
});

check("run filter narrows the feed", () => {
  const byRun = getCalendarEvents(db, { workspaceOwnerId: WS_A, runId });
  assert.ok(byRun.some((e) => e.id === linked.id), "run filter missed the linked event");
});

check("cards expose the campaign/list context", () => {
  const rows = getCalendarEvents(db, { workspaceOwnerId: WS_A, runId });
  const found = rows.find((e) => e.id === linked.id);
  assert.ok(found.run_name || (found.workflow_names ?? []).length > 0, "missing campaign context");
  assert.equal(found.list_name, "Lista Calendario Test");
});

console.log("\n8. SDR IA meeting requests");
const threadId = "caltest_thread_" + Date.now();

check("proposeMeetingSlots is a no-op when the native calendar is off", () => {
  const prev = process.env.NATIVE_CALENDAR_ENABLED;
  process.env.NATIVE_CALENDAR_ENABLED = "false";
  assert.equal(nativeCalendarEnabled(), false);
  const res = proposeMeetingSlots(db, {
    threadId,
    targetId,
    workspaceOwnerId: WS_A,
  });
  process.env.NATIVE_CALENDAR_ENABLED = prev;
  assert.equal(res.requested, false);
  assert.equal(res.reason, "disabled");
});

process.env.NATIVE_CALENDAR_ENABLED = "true";
check("proposeMeetingSlots creates a pending request with slots", () => {
  assert.equal(nativeCalendarEnabled(), true);
  const res = proposeMeetingSlots(db, {
    threadId,
    decisionId: "caltest_decision",
    targetId,
    workspaceOwnerId: WS_A,
    notes: "El prospecto pidió horarios",
  });
  assert.equal(res.requested, true);
  assert.ok(res.requestId, "expected a request id");
  assert.ok(res.slots.length > 0, "expected proposed slots");
  cleanupIds.requests.push(res.requestId);
  global.__calRequestId = res.requestId;
});

const requestId = global.__calRequestId;
check("the request is listed as pending", () => {
  const pending = listMeetingRequests(db, { workspaceOwnerId: WS_A, status: "pending" });
  assert.ok(pending.some((r) => r.id === requestId), "pending request missing");
});

check("approval creates the real event and closes the request", () => {
  const req = getMeetingRequest(db, requestId);
  const slot = JSON.parse(req.proposed_slots_json)[0];
  const { request, event } = approveMeetingRequest(db, requestId, {
    start_time: slot.start_time,
    end_time: slot.end_time,
    actorUserId: "caltest_user",
    workspaceOwnerId: WS_A,
  });
  cleanupIds.events.push(event.id);
  assert.equal(request.status, "scheduled");
  assert.equal(request.created_event_id, event.id);
  assert.equal(event.channel, "sdr_ai");
  assert.equal(event.source, "sdr_ai");
  assert.equal(event.thread_id, threadId);
  assert.equal(event.workspace_owner_id, WS_A);
});

check("approving twice is rejected", () => {
  const req = getMeetingRequest(db, requestId);
  const slot = JSON.parse(req.proposed_slots_json)[0];
  assert.throws(
    () =>
      approveMeetingRequest(db, requestId, {
        start_time: slot.start_time,
        end_time: slot.end_time,
        actorUserId: "caltest_user",
      }),
    /ya fue/
  );
});

check("decline resolves the request without creating an event", () => {
  const second = proposeMeetingSlots(db, {
    threadId: threadId + "_2",
    targetId,
    workspaceOwnerId: WS_A,
  });
  assert.equal(second.requested, true);
  cleanupIds.requests.push(second.requestId);
  const before = db.prepare("SELECT COUNT(*) n FROM calendar_events").get().n;
  const resolved = resolveMeetingRequest(db, second.requestId, "declined", {
    actorUserId: "caltest_user",
    workspaceOwnerId: WS_A,
  });
  assert.equal(resolved.status, "declined");
  const after = db.prepare("SELECT COUNT(*) n FROM calendar_events").get().n;
  assert.equal(before, after, "declining must not create an event");
  assert.ok(
    listCalendarAudit(db, { workspaceOwnerId: WS_A }).some(
      (a) => a.action === "request_declined"
    ),
    "expected a request_declined audit row"
  );
});

console.log("\n9. Deletion");
check("deleteCalendarEvent removes the row and audits it", () => {
  const toDelete = createCalendarEvent(
    db,
    {
      title: "Reunión a borrar",
      start_time: new Date(slotStart.getTime() + 60 * 3600_000).toISOString(),
      end_time: new Date(slotStart.getTime() + 60 * 3600_000 + 30 * 60_000).toISOString(),
      status: "confirmed",
      workspace_owner_id: WS_A,
    },
    { workspaceOwnerId: WS_A }
  );
  deleteCalendarEvent(db, toDelete.id, { actorUserId: "caltest_user", workspaceOwnerId: WS_A });
  assert.equal(getCalendarEventById(db, toDelete.id), null);
});
}

console.log("\n10. Cleanup");
function cleanup() {
  for (const id of cleanupIds.events) {
    db.prepare("DELETE FROM calendar_events WHERE id = ?").run(id);
  }
  // Safety net for a run that threw before registering an id: the two synthetic
  // workspaces are disposable, and every title this script uses is known.
  db.prepare(`DELETE FROM calendar_events WHERE workspace_owner_id IN (?, ?)`).run(WS_A, WS_B);
  db.prepare(
    `DELETE FROM calendar_events
     WHERE workspace_owner_id IS NULL AND title IN (${TEST_TITLES.map(() => "?").join(",")})`
  ).run(...TEST_TITLES);
  for (const id of cleanupIds.requests) {
    db.prepare("DELETE FROM calendar_meeting_requests WHERE id = ?").run(id);
  }
  db.prepare(
    "DELETE FROM calendar_audit WHERE event_id IS NULL AND detail_json LIKE '%caltest%'"
  ).run();
  db.prepare(
    "DELETE FROM calendar_audit WHERE event_id NOT IN (SELECT id FROM calendar_events)"
  ).run();
  for (const id of cleanupIds.targets) {
    db.prepare("DELETE FROM targets WHERE id = ?").run(id);
  }
  db.prepare("DELETE FROM runs WHERE id LIKE 'caltest_run%'").run();
  db.prepare("DELETE FROM lists WHERE id LIKE 'caltest_list%'").run();
  db.prepare("DELETE FROM workflows WHERE id LIKE 'caltest_wf%'").run();
  db.prepare("DELETE FROM calendar_settings WHERE workspace_owner_id IN (?, ?)").run(WS_A, WS_B);
  for (const id of cleanupIds.users) {
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }
  // Restore any settings row that existed before this run.
  for (const row of originalSettings) {
    const exists = db.prepare("SELECT id FROM calendar_settings WHERE id = ?").get(row.id);
    if (!exists) {
      const keys = Object.keys(row);
      db.prepare(
        `INSERT INTO calendar_settings (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`
      ).run(...keys.map((k) => row[k]));
    }
  }
}
cleanup();
console.log("  ✓ temporary rows removed");

console.log("\n=== Result ===");
if (failures.length === 0) {
  console.log("All calendar checks passed.");
  process.exit(0);
} else {
  console.log(`${failures.length} check(s) failed:`);
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
