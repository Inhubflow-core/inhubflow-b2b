import Head from "next/head";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import {
  RiArrowLeftLine, RiExternalLinkLine, RiMailLine, RiBuilding2Line,
  RiUserFollowLine, RiUserAddLine, RiMapPinLine, RiBriefcaseLine,
  RiTimeLine, RiGlobalLine, RiLinkedinBoxLine, RiCheckboxCircleLine,
  RiEditLine, RiCheckLine, RiCloseLine, RiFlowChart,
  RiCheckboxBlankCircleLine, RiDeleteBinLine, RiCalendarLine,
  RiAddLine, RiCloseCircleLine, RiPhoneLine,
} from "react-icons/ri";
import ProspectAvatar from "@/components/ui/ProspectAvatar";

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  linkedin_url: string | null;
  website: string | null;
}

interface ListRef {
  id: string;
  name: string;
}

interface CampaignRun {
  run_id: string;
  workflow_id: string;
  workflow_name: string;
  state: string;
  current_step: number;
  error_message: string | null;
  enrolled_at: string;
  logs: { id: string; level: string; message: string; created_at: string }[];
}

interface Todo {
  id: string;
  target_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: "open" | "done";
  created_at: string;
}

interface ActivityLog {
  id: string;
  target_id: string;
  type: "call" | "email" | "meeting" | "note" | "other";
  body: string;
  logged_at: string;
  created_at: string;
}

interface Target {
  id: string;
  linkedin_url: string | null;
  sales_nav_url: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  company_name: string | null; // renamed from DB 'company' to avoid collision
  location: string | null;
  degree: number | null;
  headline: string | null;
  summary: string | null;
  email: string | null;
  email_status: string | null;
  phone: string | null;
  seniority: string | null;
  apollo_functions: string | null;
  apollo_id: string | null;
  apollo_enriched_at: string | null;
  profile_image_url?: string | null;
  company_description: string | null;
  company_size: number | null;
  company_industry: string | null;
  company_location: string | null;
  tenure_months: number | null;
  positions_json: string | null;
  connection_requested_at: string | null;
  connected_at: string | null;
  message_sent_at: string | null;
  last_replied_at: string | null;
  created_at: string;
  enriched_profile_at: string | null;
  notes: string | null;
  company_id: string | null;
  companyObj: Company | null;
  lists: ListRef[];
}

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const db = getDb();
  const id = params?.id as string;
  const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(id) as Target | undefined;
  if (!target) return { notFound: true };
  const companyObj = target.company_id
    ? db.prepare("SELECT * FROM companies WHERE id = ?").get(target.company_id) ?? null
    : null;
  const lists = db.prepare(`
    SELECT l.id, l.name FROM lists l
    INNER JOIN list_targets lt ON lt.list_id = l.id
    WHERE lt.target_id = ? ORDER BY l.name COLLATE NOCASE
  `).all(id) as ListRef[];

  const allLists = db.prepare(`SELECT id, name FROM lists ORDER BY name COLLATE NOCASE`).all() as ListRef[];

  const runRows = db.prepare(`
    SELECT rp.run_id, r.workflow_id, w.name as workflow_name,
           COALESCE(rt_li.state, 'pending') as state,
           COALESCE(rt_li.current_step, 0) as current_step,
           rt_li.error_message,
           rp.created_at as enrolled_at
    FROM run_profiles rp
    JOIN runs r ON r.id = rp.run_id
    JOIN workflows w ON w.id = r.workflow_id
    LEFT JOIN run_profile_tracks rt_li ON rt_li.run_profile_id = rp.id AND rt_li.track = 'linkedin'
    WHERE rp.target_id = ?
    ORDER BY rp.created_at DESC
  `).all(id) as Omit<CampaignRun, "logs">[];

  const logRows = db.prepare(`
    SELECT id, run_id, level, message, created_at
    FROM logs
    WHERE target_id = ?
    ORDER BY created_at ASC
  `).all(id) as { id: string; run_id: string; level: string; message: string; created_at: string }[];

  const logsByRun: Record<string, typeof logRows> = {};
  for (const log of logRows) {
    if (!logsByRun[log.run_id]) logsByRun[log.run_id] = [];
    logsByRun[log.run_id].push(log);
  }

  const campaignHistory: CampaignRun[] = runRows.map((r) => ({
    ...r,
    logs: (logsByRun[r.run_id] ?? []).map(({ run_id: _rid, ...l }) => l),
  }));

  const todos = db.prepare(
    "SELECT * FROM todos WHERE target_id = ? ORDER BY status ASC, due_date ASC, created_at DESC"
  ).all(id) as Todo[];

  const activityLogs = db.prepare(
    "SELECT * FROM activity_logs WHERE target_id = ? ORDER BY logged_at DESC"
  ).all(id) as ActivityLog[];

  // rename DB 'company' text field to avoid TS collision with Company object
  const rawTarget = target as unknown as Record<string, unknown>;
  const { company: company_name, ...rest } = rawTarget;
  return { props: { target: { ...rest, company_name, companyObj, lists }, campaignHistory, todos, activityLogs, allLists } };
};

const LOG_TYPE_ICONS: Record<string, string> = {
  call: "📞", email: "✉️", meeting: "🤝", note: "📝", other: "•",
};
const LOG_TYPE_COLORS: Record<string, string> = {
  call: "bg-blue-500/15 text-blue-400",
  email: "bg-violet-500/15 text-violet-400",
  meeting: "bg-emerald-500/15 text-emerald-400",
  note: "bg-base-300 text-base-content/50",
  other: "bg-base-300 text-base-content/50",
};

function TodoDetailModal({ todo, onClose, onSave }: {
  todo: Todo;
  onClose: () => void;
  onSave: (updated: Todo) => void;
}) {
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description ?? "");
  const [dueDate, setDueDate] = useState(todo.due_date ?? "");
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), description: description.trim() || null, due_date: dueDate || null }),
    });
    setSaving(false);
    if (!res.ok) { toast.error("Failed to save"); return; }
    onSave({ ...todo, title: title.trim(), description: description.trim() || null, due_date: dueDate || null });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Edit todo</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <RiCloseLine size={16} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            placeholder="Task title"
            className="w-full bg-transparent text-base font-medium text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none border-b border-gray-200 dark:border-gray-800 pb-3"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a description..."
            rows={5}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 leading-relaxed focus:outline-none focus:border-brand-500 resize-none transition-colors shadow-xs"
          />
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Due date</label>
            <div className="relative w-48">
              <RiCalendarLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 shadow-xs focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!title.trim() || saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LogDetailModal({ log, onClose, onSave }: {
  log: ActivityLog;
  onClose: () => void;
  onSave: (updated: ActivityLog) => void;
}) {
  const [type, setType] = useState<ActivityLog["type"]>(log.type);
  const [body, setBody] = useState(log.body);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bodyRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!body.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/activity-logs?id=${log.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, body: body.trim() }),
    });
    setSaving(false);
    if (!res.ok) { toast.error("Failed to save"); return; }
    onSave({ ...log, type, body: body.trim() });
  }

  const types = ["note", "call", "email", "meeting", "other"] as const;
  const placeholders: Record<string, string> = {
    note: "Write your note...",
    call: "What was discussed on this call?",
    email: "Summary of the email sent or received...",
    meeting: "What happened in this meeting?",
    other: "Describe the activity...",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Edit activity</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <RiCloseLine size={16} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="flex gap-1.5">
            {types.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize ${
                  type === t
                    ? LOG_TYPE_COLORS[t] + " ring-1 ring-inset ring-current/20"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={placeholders[type]}
            rows={6}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 leading-relaxed focus:outline-none focus:border-brand-500 resize-none transition-colors shadow-xs"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!body.trim() || saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TodoModal({ targetId, onClose, onSave }: {
  targetId: string;
  onClose: () => void;
  onSave: (todo: Todo) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_id: targetId, title: title.trim(), description: description.trim() || undefined, due_date: dueDate || undefined }),
    });
    setSaving(false);
    if (!res.ok) { toast.error("Failed to create"); return; }
    onSave(await res.json() as Todo);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">New todo</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <RiCloseLine size={16} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            placeholder="Task title"
            className="w-full bg-transparent text-base font-medium text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none border-b border-gray-200 dark:border-gray-800 pb-3"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a description..."
            rows={4}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 leading-relaxed focus:outline-none focus:border-brand-500 resize-none transition-colors shadow-xs"
          />
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Due date</label>
            <div className="relative w-48">
              <RiCalendarLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 shadow-xs focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!title.trim() || saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Create todo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LogModal({ targetId, onClose, onSave }: {
  targetId: string;
  onClose: () => void;
  onSave: (log: ActivityLog) => void;
}) {
  const [type, setType] = useState<ActivityLog["type"]>("note");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bodyRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!body.trim()) return;
    setSaving(true);
    const res = await fetch("/api/activity-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_id: targetId, type, body: body.trim() }),
    });
    setSaving(false);
    if (!res.ok) { toast.error("Failed to log"); return; }
    onSave(await res.json() as ActivityLog);
    toast.success("Activity logged");
  }

  const types = ["note", "call", "email", "meeting", "other"] as const;
  const placeholders: Record<string, string> = {
    note: "Write your note...",
    call: "What was discussed on this call?",
    email: "Summary of the email sent or received...",
    meeting: "What happened in this meeting?",
    other: "Describe the activity...",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Log activity</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <RiCloseLine size={16} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          {/* Type selector */}
          <div className="flex gap-1.5">
            {types.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize ${
                  type === t
                    ? LOG_TYPE_COLORS[t] + " ring-1 ring-inset ring-current/20"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={placeholders[type]}
            rows={6}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 leading-relaxed focus:outline-none focus:border-brand-500 resize-none transition-colors shadow-xs"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!body.trim() || saving}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Logging..." : "Log activity"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] text-base-content/40 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-sm text-base-content/80">{value}</div>
    </div>
  );
}

function formatDate(s: string | null) {
  if (!s) return null;
  return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatTenure(months: number | null) {
  if (!months) return null;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y > 0 ? `${y}y` : null, m > 0 ? `${m}mo` : null].filter(Boolean).join(" ");
}

export default function ContactDetailPage({
  target, campaignHistory, todos: initialTodos, activityLogs: initialLogs, allLists,
}: {
  target: Target;
  campaignHistory: CampaignRun[];
  todos: Todo[];
  activityLogs: ActivityLog[];
  allLists: ListRef[];
}) {
  const functions: string[] = target.apollo_functions ? JSON.parse(target.apollo_functions) : [];
  const positions: { title: string; companyName: string; startDate?: string; endDate?: string; current?: boolean; description?: string }[] =
    target.positions_json ? JSON.parse(target.positions_json) : [];

  const [email, setEmail] = useState(target.email ?? "");
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState(target.email ?? "");
  const emailInputRef = useRef<HTMLInputElement>(null);

  const [phone, setPhone] = useState(target.phone ?? "");
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState(target.phone ?? "");
  const phoneInputRef = useRef<HTMLInputElement>(null);

  const [notes, setNotes] = useState(target.notes ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(target.notes ?? "");

  const [memberLists, setMemberLists] = useState<ListRef[]>(target.lists);
  const [showAddList, setShowAddList] = useState(false);
  const [addListId, setAddListId] = useState("");
  const [addListLoading, setAddListLoading] = useState(false);
  const [removingListId, setRemovingListId] = useState<string | null>(null);

  const addableLists = allLists.filter((l) => !memberLists.some((ml) => ml.id === l.id));

  async function addToList() {
    if (!addListId) return;
    setAddListLoading(true);
    const res = await fetch(`/api/lists/${addListId}/add-members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_ids: [target.id] }),
    });
    setAddListLoading(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Failed to add to list"); return; }
    const added = allLists.find((l) => l.id === addListId);
    if (added) setMemberLists((prev) => [...prev, added].sort((a, b) => a.name.localeCompare(b.name)));
    toast.success(data.added > 0 ? "Added to list" : "Already in this list");
    setShowAddList(false);
    setAddListId("");
  }

  async function removeFromList(listId: string) {
    setRemovingListId(listId);
    const res = await fetch(`/api/lists/${listId}/remove-members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_ids: [target.id], dry_run: false }),
    });
    setRemovingListId(null);
    if (!res.ok) { toast.error("Failed to remove from list"); return; }
    setMemberLists((prev) => prev.filter((l) => l.id !== listId));
    toast.success("Removed from list");
  }

  // Open-core: Todos + Activity log (CRM) are premium (ee/). Hidden in the public build.
  const [hasPremium, setHasPremium] = useState(true);
  useEffect(() => {
    fetch("/api/premium-status").then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setHasPremium(!!d.hasPremium); }).catch(() => {});
  }, []);

  // Todos state
  const [todos, setTodos] = useState<Todo[]>(initialTodos);
  const [showTodoModal, setShowTodoModal] = useState(false);
  const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);

  // Activity log state
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(initialLogs);
  const [showLogModal, setShowLogModal] = useState(false);
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);

  async function toggleTodo(todo: Todo) {
    const next = todo.status === "open" ? "done" : "open";
    const res = await fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) { toast.error("Failed to update"); return; }
    setTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, status: next } : t));
  }

  async function deleteTodo(id: string) {
    const res = await fetch(`/api/todos/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to delete"); return; }
    setTodos((prev) => prev.filter((t) => t.id !== id));
  }

  async function deleteLog(id: string) {
    const res = await fetch(`/api/activity-logs?id=${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to delete"); return; }
    setActivityLogs((prev) => prev.filter((l) => l.id !== id));
  }

  async function saveEmail() {
    const trimmed = emailDraft.trim();
    const res = await fetch(`/api/targets/${target.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmed }),
    });
    if (!res.ok) { toast.error("Failed to save email"); return; }
    setEmail(trimmed);
    setEditingEmail(false);
    toast.success("Email saved");
  }

  async function savePhone() {
    const trimmed = phoneDraft.trim();
    const res = await fetch(`/api/targets/${target.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: trimmed }),
    });
    if (!res.ok) { toast.error("Failed to save phone"); return; }
    setPhone(trimmed);
    setEditingPhone(false);
    toast.success("Phone saved");
  }

  async function saveNotes() {
    const res = await fetch(`/api/targets/${target.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notesDraft }),
    });
    if (!res.ok) { toast.error("Failed to save notes"); return; }
    setNotes(notesDraft);
    setEditingNotes(false);
    toast.success("Notes saved");
  }

  const connectionStatus = target.degree === 1
    ? { label: "Connected", color: "bg-success/15 text-success" }
    : target.connection_requested_at
    ? { label: "Requested", color: "bg-warning/15 text-warning" }
    : { label: "Not connected", color: "bg-base-300 text-base-content/40" };

  return (
    <>
      <Head>
        <title>{target.full_name ?? "Contact"} — Dashboard B2B</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {showTodoModal && (
        <TodoModal
          targetId={target.id}
          onClose={() => setShowTodoModal(false)}
          onSave={(todo) => { setTodos((prev) => [todo, ...prev]); setShowTodoModal(false); toast.success("Todo created"); }}
        />
      )}
      {selectedTodo && (
        <TodoDetailModal
          todo={selectedTodo}
          onClose={() => setSelectedTodo(null)}
          onSave={(updated) => { setTodos((prev) => prev.map((t) => t.id === updated.id ? updated : t)); setSelectedTodo(null); toast.success("Saved"); }}
        />
      )}
      {showLogModal && (
        <LogModal
          targetId={target.id}
          onClose={() => setShowLogModal(false)}
          onSave={(log) => { setActivityLogs((prev) => [log, ...prev]); setShowLogModal(false); }}
        />
      )}
      {selectedLog && (
        <LogDetailModal
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
          onSave={(updated) => { setActivityLogs((prev) => prev.map((l) => l.id === updated.id ? updated : l)); setSelectedLog(null); toast.success("Saved"); }}
        />
      )}
      <div>
        {/* Back */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => history.back()} className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors">
            <RiArrowLeftLine size={16} />
          </button>
          <span className="text-base-content/40 text-sm">Contact</span>
        </div>

        {/* Header — full width */}
        <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl p-5 mb-4 shadow-xs">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <ProspectAvatar
                imageUrl={target.profile_image_url}
                name={target.full_name}
                size="xl"
                badge={target.degree === 1 ? "linkedin" : null}
              />
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">{target.full_name ?? "—"}</h1>
                {target.title && <p className="text-gray-600 dark:text-gray-300 text-sm mt-0.5">{target.title}</p>}
                {target.headline && target.headline !== target.title && (
                  <p className="text-gray-400 text-xs mt-1 italic">{target.headline}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold ${connectionStatus.color}`}>
                  {target.degree === 1 ? <RiUserFollowLine size={12} /> : target.connection_requested_at ? <RiUserAddLine size={12} /> : null}
                  {connectionStatus.label}
                </span>
                {target.email && (
                  target.email_status === "invalid" ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-error/15 text-error border border-error/20">
                      <RiCloseLine size={12} />
                      Email invalid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                      <RiCheckboxCircleLine size={12} />
                      {target.email_status === "verified" ? "Email verified" : "Email found"}
                    </span>
                  )
                )}
                {target.seniority && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 capitalize">
                    {target.seniority}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
              {target.linkedin_url && (
                <a href={target.linkedin_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#0A66C2] text-white hover:bg-[#004182] transition-colors shadow-xs">
                  <RiLinkedinBoxLine size={15} /> LinkedIn
                </a>
              )}
              {target.sales_nav_url && (
                <a href={target.sales_nav_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors shadow-xs">
                  <RiExternalLinkLine size={13} /> Sales Nav
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="flex gap-4 items-start">

          {/* Left col — 2/3 */}
          <div className="flex-1 min-w-0">

        {/* Contact info */}
        <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl p-5 mb-4 shadow-xs">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Contact info</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Email</p>
                <button
                  onClick={() => { setEmailDraft(email); setEditingEmail(true); setTimeout(() => emailInputRef.current?.focus(), 50); }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                  title="Edit email"
                >
                  <RiEditLine size={12} />
                </button>
              </div>
              {editingEmail ? (
                <div className="flex items-center gap-1.5">
                  <input
                    ref={emailInputRef}
                    type="email"
                    value={emailDraft}
                    onChange={(e) => setEmailDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveEmail(); if (e.key === "Escape") setEditingEmail(false); }}
                    className="flex-1 px-3 py-1 rounded-xl bg-white dark:bg-gray-800 border border-brand-500 text-sm focus:outline-none shadow-xs"
                    placeholder="email@example.com"
                  />
                  <button onClick={saveEmail} className="text-emerald-600 hover:text-emerald-700"><RiCheckLine size={16} /></button>
                  <button onClick={() => setEditingEmail(false)} className="text-gray-400 hover:text-gray-600"><RiCloseLine size={16} /></button>
                </div>
              ) : email ? (
                <div className="flex items-center gap-1.5 text-sm text-gray-800 dark:text-gray-200">
                  <RiMailLine size={14} className="text-gray-400 shrink-0" />
                  <a href={`mailto:${email}`} className="hover:text-brand-600 transition-colors font-mono text-xs">{email}</a>
                  {target.email_status && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      target.email_status === "verified" ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50" :
                      target.email_status === "invalid" ? "bg-error/15 text-error border border-error/20" :
                      "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    }`}>
                      {target.email_status}
                    </span>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => { setEmailDraft(""); setEditingEmail(true); setTimeout(() => emailInputRef.current?.focus(), 50); }}
                  className="text-sm text-gray-400 hover:text-brand-600 transition-colors"
                >
                  + Add email
                </button>
              )}
            </div>
            <Field label="Location" value={
              target.location ? (
                <span className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
                  <RiMapPinLine size={14} className="text-gray-400 shrink-0" />
                  {target.location}
                </span>
              ) : null
            } />
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Phone</p>
                <button
                  onClick={() => { setPhoneDraft(phone); setEditingPhone(true); setTimeout(() => phoneInputRef.current?.focus(), 50); }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                  title="Edit phone"
                >
                  <RiEditLine size={12} />
                </button>
              </div>
              {editingPhone ? (
                <div className="flex items-center gap-1.5">
                  <input
                    ref={phoneInputRef}
                    type="tel"
                    value={phoneDraft}
                    onChange={(e) => setPhoneDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") savePhone(); if (e.key === "Escape") setEditingPhone(false); }}
                    className="flex-1 px-3 py-1 rounded-xl bg-white dark:bg-gray-800 border border-brand-500 text-sm focus:outline-none shadow-xs"
                    placeholder="+49 30 1234567"
                  />
                  <button onClick={savePhone} className="text-emerald-600 hover:text-emerald-700"><RiCheckLine size={16} /></button>
                  <button onClick={() => setEditingPhone(false)} className="text-gray-400 hover:text-gray-600"><RiCloseLine size={16} /></button>
                </div>
              ) : phone ? (
                <div className="flex items-center gap-1.5 text-sm text-gray-800 dark:text-gray-200">
                  <RiPhoneLine size={14} className="text-gray-400 shrink-0" />
                  <a href={`tel:${phone}`} className="hover:text-brand-600 transition-colors font-mono text-xs">{phone}</a>
                </div>
              ) : (
                <button
                  onClick={() => { setPhoneDraft(""); setEditingPhone(true); setTimeout(() => phoneInputRef.current?.focus(), 50); }}
                  className="text-sm text-gray-400 hover:text-brand-600 transition-colors"
                >
                  + Add phone
                </button>
              )}
            </div>
            {functions.length > 0 && (
              <div className="col-span-2">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Functions</p>
                <div className="flex flex-wrap gap-1.5">
                  {functions.map((f) => (
                    <span key={f} className="inline-flex px-2 py-0.5 rounded-md text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 capitalize">{f}</span>
                  ))}
                </div>
              </div>
            )}
            {target.tenure_months != null && (
              <Field label="Tenure at current role" value={
                <span className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
                  <RiTimeLine size={14} className="text-gray-400 shrink-0" />
                  {formatTenure(target.tenure_months)}
                </span>
              } />
            )}
          </div>
        </div>

        {/* Summary */}
        {target.summary && (
          <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl p-5 mb-4 shadow-xs">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">About</p>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">{target.summary}</p>
          </div>
        )}

        {/* Notes */}
        <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl p-5 mb-4 shadow-xs">
          <div className="flex items-center gap-1.5 mb-2">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Notes</p>
            {!editingNotes && (
              <button
                onClick={() => { setNotesDraft(notes); setEditingNotes(true); }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                title="Edit notes"
              >
                <RiEditLine size={12} />
              </button>
            )}
          </div>
          {editingNotes ? (
            <div className="flex flex-col gap-2">
              <textarea
                autoFocus
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setEditingNotes(false); }}
                rows={5}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-sm text-gray-900 dark:text-gray-100 shadow-xs leading-relaxed focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none"
                placeholder="Add any context about this person — talking points, mutual connections, research notes..."
              />
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setEditingNotes(false)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors">
                  <RiCloseLine size={14} /> Cancel
                </button>
                <button onClick={saveNotes} className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-brand-500 hover:bg-brand-600 text-white shadow-xs transition-colors">
                  <RiCheckLine size={14} /> Save
                </button>
              </div>
            </div>
          ) : notes ? (
            <p
              onClick={() => { setNotesDraft(notes); setEditingNotes(true); }}
              className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line cursor-text"
            >
              {notes}
            </p>
          ) : (
            <button
              onClick={() => { setNotesDraft(""); setEditingNotes(true); }}
              className="text-sm text-gray-400 hover:text-brand-600 transition-colors"
            >
              + Add notes
            </button>
          )}
        </div>

        {/* Activity Log — premium (ee/); hidden in the public build */}
        {hasPremium && (
        <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl p-5 mb-4 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Activity log</p>
            <button
              onClick={() => setShowLogModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750 shadow-xs transition-colors"
            >
              <RiAddLine size={14} /> Log activity
            </button>
          </div>

          {activityLogs.length === 0 ? (
            <button
              onClick={() => setShowLogModal(true)}
              className="w-full py-6 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-xs text-gray-400 hover:text-gray-600 hover:border-brand-500 transition-colors"
            >
              Log the first activity
            </button>
          ) : (
            <div className="flex flex-col gap-0 divide-y divide-gray-200 dark:divide-gray-800">
              {activityLogs.map((log) => (
                <div key={log.id} className="group flex gap-3 py-3 first:pt-0 last:pb-0">
                  <div className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-xs ${LOG_TYPE_COLORS[log.type]}`}>
                    {LOG_TYPE_ICONS[log.type]}
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedLog(log)}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize ${LOG_TYPE_COLORS[log.type]}`}>
                        {log.type}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(log.logged_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3">{log.body}</p>
                  </div>
                  <button
                    onClick={() => deleteLog(log.id)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-error transition-all mt-0.5"
                  >
                    <RiDeleteBinLine size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Career history */}
        {positions.length > 0 && (
          <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl p-5 mb-4 shadow-xs">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Career history</p>
            <div className="flex flex-col gap-3">
              {positions.map((pos, i) => (
                <div key={i} className="flex gap-3">
                  <div className="mt-1 w-6 h-6 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center shrink-0">
                    <RiBriefcaseLine size={12} className="text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">{pos.title}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{pos.companyName}</p>
                    {(pos.startDate || pos.endDate) && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {pos.startDate ?? ""}{pos.endDate ? ` — ${pos.endDate}` : pos.current ? " — Present" : ""}
                      </p>
                    )}
                    {pos.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed line-clamp-3">{pos.description}</p>
                    )}
                  </div>
                  {pos.current && (
                    <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400 border border-brand-500/20 self-start mt-0.5">Current</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Company */}
        {target.companyObj && (
          <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl p-5 mb-4 shadow-xs">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Company</p>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center shrink-0">
                <RiBuilding2Line size={16} className="text-gray-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link href={`/companies/${target.companyObj.id}`} className="text-sm font-semibold text-gray-900 dark:text-white hover:text-brand-600 transition-colors">
                    {target.companyObj.name}
                  </Link>
                  {target.companyObj.linkedin_url && (
                    <a href={target.companyObj.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-brand-500 transition-colors">
                      <RiExternalLinkLine size={13} />
                    </a>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                  {target.companyObj.industry && <span className="text-xs text-gray-500 dark:text-gray-400">{target.companyObj.industry}</span>}
                  {target.companyObj.location && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      <RiMapPinLine size={11} /> {target.companyObj.location}
                    </span>
                  )}
                  {target.company_size && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">{target.company_size} employees</span>
                  )}
                  {target.companyObj.domain && (
                    <a href={`https://${target.companyObj.domain}`} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-gray-500 dark:text-gray-400 hover:text-brand-600 flex items-center gap-1 transition-colors">
                      <RiGlobalLine size={11} /> {target.companyObj.domain}
                    </a>
                  )}
                </div>
                {target.company_description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 leading-relaxed line-clamp-4">{target.company_description}</p>
                )}
              </div>
            </div>
          </div>
        )}

          </div>{/* end left col */}

          {/* Right col — 1/3 */}
          <div className="w-72 shrink-0">

        {/* Outreach timeline */}
        <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl p-5 mb-4 shadow-xs">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Outreach timeline</p>
          <div className="flex flex-col gap-3">
            <Field label="Added" value={formatDate(target.created_at)} />
            <Field label="Connection requested" value={formatDate(target.connection_requested_at)} />
            <Field label="Connected" value={formatDate(target.connected_at)} />
            <Field label="Message sent" value={formatDate(target.message_sent_at)} />
            <Field label="Last reply" value={formatDate(target.last_replied_at)} />
            <Field label="Apollo enriched" value={formatDate(target.apollo_enriched_at)} />
          </div>
        </div>

        {/* Lists */}
        <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl p-5 mb-4 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">In lists</p>
            <button
              onClick={() => setShowAddList(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 transition-colors"
            >
              <RiAddLine size={14} /> Add
            </button>
          </div>
          {memberLists.length === 0 ? (
            <p className="text-xs text-base-content/25">Not in any list yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {memberLists.map((l) => (
                <span key={l.id} className="group inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-md text-xs bg-base-300 text-base-content/60 hover:text-base-content hover:bg-base-300/80 transition-colors">
                  <Link href={`/lists/${l.id}`}>{l.name}</Link>
                  <button
                    onClick={() => removeFromList(l.id)}
                    disabled={removingListId === l.id}
                    title="Remove from this list"
                    className="text-base-content/30 hover:text-error transition-colors disabled:opacity-40"
                  >
                    <RiCloseCircleLine size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {showAddList && (
          <div className="modal modal-open">
            <div className="modal-box bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xl max-w-sm p-6">
              <h3 className="font-bold text-base mb-4 text-gray-900 dark:text-white">Add to list</h3>
              {addableLists.length === 0 ? (
                <p className="text-sm text-gray-400">Already in every list.</p>
              ) : (
                <select
                  className="w-full px-3 py-2 rounded-xl text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 shadow-xs focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 cursor-pointer"
                  value={addListId}
                  onChange={(e) => setAddListId(e.target.value)}
                >
                  <option value="">Select a list…</option>
                  {addableLists.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              )}
              <div className="modal-action mt-4 pt-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
                <button type="button" className="btn btn-ghost btn-sm text-gray-600 dark:text-gray-400" onClick={() => { setShowAddList(false); setAddListId(""); }}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white shadow-xs transition-colors disabled:opacity-50"
                  disabled={!addListId || addListLoading}
                  onClick={addToList}
                >
                  {addListLoading ? <span className="loading loading-spinner loading-xs" /> : "Add"}
                </button>
              </div>
            </div>
            <div className="modal-backdrop" onClick={() => { setShowAddList(false); setAddListId(""); }} />
          </div>
        )}

        {/* Todos — premium (ee/); hidden in the public build */}
        {hasPremium && (
        <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl p-5 mb-4 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Todos</p>
              {todos.filter((t) => t.status === "open").length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400 border border-brand-500/20 text-[10px] font-bold">
                  {todos.filter((t) => t.status === "open").length}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowTodoModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 shadow-xs transition-colors"
            >
              <RiAddLine size={13} /> Add
            </button>
          </div>

          {todos.length === 0 ? (
            <button
              onClick={() => setShowTodoModal(true)}
              className="w-full py-6 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-xs text-gray-400 hover:text-gray-600 hover:border-brand-500 transition-colors"
            >
              Add the first todo
            </button>
          ) : (
            <div className="flex flex-col divide-y divide-gray-200 dark:divide-gray-800">
              {todos.map((todo) => {
                const overdue = todo.status !== "done" && todo.due_date && new Date(todo.due_date) < new Date(new Date().toDateString());
                return (
                  <div key={todo.id} className={`group flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0 ${todo.status === "done" ? "opacity-40" : ""}`}>
                    <button
                      onClick={() => toggleTodo(todo)}
                      className={`mt-0.5 shrink-0 transition-colors ${todo.status === "done" ? "text-emerald-500" : "text-gray-300 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-300"}`}
                    >
                      {todo.status === "done"
                        ? <RiCheckboxCircleLine size={16} />
                        : <RiCheckboxBlankCircleLine size={16} />
                      }
                    </button>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedTodo(todo)}>
                      <p className={`text-xs leading-snug ${todo.status === "done" ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200 font-medium"}`}>
                        {todo.title}
                      </p>
                      {todo.description && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{todo.description}</p>
                      )}
                      {todo.due_date && (
                        <span className={`inline-flex items-center gap-1 text-[10px] mt-1 px-1.5 py-0.5 rounded ${
                          overdue ? "bg-error/10 text-error border border-error/20" : "text-gray-400 bg-gray-100 dark:bg-gray-800"
                        }`}>
                          <RiCalendarLine size={9} />
                          {new Date(todo.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => deleteTodo(todo.id)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-error transition-all"
                    >
                      <RiDeleteBinLine size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Campaign history */}
        {campaignHistory.length > 0 && (
          <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl p-5 shadow-xs">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Campaign history</p>
            <div className="flex flex-col gap-3">
              {campaignHistory.map((run) => {
                const stateStyle: Record<string, string> = {
                  completed: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50",
                  failed: "bg-error/15 text-error border border-error/20",
                  skipped: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
                  in_progress: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400 border border-sky-200 dark:border-sky-800/50",
                  pending: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
                };
                const logLevelColor: Record<string, string> = {
                  info: "text-gray-500",
                  warn: "text-warning",
                  error: "text-error",
                };
                return (
                  <div key={run.run_id} className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-gray-50/50 dark:bg-gray-800/40">
                    <div className="flex items-center gap-2 px-3.5 py-2.5 bg-gray-100/70 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800">
                      <RiFlowChart size={14} className="text-gray-400 shrink-0" />
                      <Link
                        href={`/workflows/${run.workflow_id}`}
                        className="text-xs font-semibold text-gray-900 dark:text-white hover:text-brand-600 transition-colors flex-1 truncate"
                      >
                        {run.workflow_name}
                      </Link>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${stateStyle[run.state] ?? "bg-gray-100 text-gray-500"}`}>
                        {run.state.replace("_", " ")}
                      </span>
                    </div>
                    <div className="px-3.5 py-1.5">
                      <span className="text-[10px] text-gray-400 font-medium">
                        {new Date(run.enrolled_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    {run.error_message && (
                      <div className="px-3.5 py-2 bg-error/5 border-t border-error/10 text-[11px] text-error">
                        {run.error_message}
                      </div>
                    )}
                    {run.logs.length > 0 && (
                      <div className="divide-y divide-gray-200 dark:divide-gray-800 border-t border-gray-200 dark:border-gray-800">
                        {run.logs.map((log) => (
                          <div key={log.id} className="flex items-start gap-2 px-3.5 py-1.5">
                            <span className="text-[10px] text-gray-400 shrink-0 pt-0.5 tabular-nums font-mono">
                              {new Date(log.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <span className={`text-[10px] leading-relaxed ${logLevelColor[log.level] ?? "text-gray-600 dark:text-gray-400"}`}>
                              {log.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

          </div>{/* end right col */}

        </div>{/* end two-col */}
      </div>
    </>
  );
}
