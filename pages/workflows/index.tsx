import Head from "next/head";
import { useState } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiArrowRightLine,
  RiPlayLine,
  RiPauseLine,
  RiTimeLine,
  RiEyeLine,
  RiLinkedinBoxLine,
  RiMessage2Line,
  RiRocketLine,
  RiTeamLine,
  RiUserStarLine,
  RiMailSendLine,
  RiSuitcaseLine,
  RiGlobalLine,
  RiMegaphoneLine,
  RiShakeHandsLine,
  RiLightbulbLine,
  RiCrosshairLine,
  RiFileCopyLine,
  RiArchiveLine,
  RiInboxUnarchiveLine,
  RiArrowDownSLine,
  RiUserLine,
} from "react-icons/ri";

interface WorkflowCard {
  id: string;
  name: string;
  description: string | null;
  is_archived: number;
  step_count: number;
  action_step_count: number;
  total_prospects: number;
  completed_prospects: number;
  connections_sent: number;
  connections_accepted: number;
  active_run_id: string | null;
  active_status: string | null;
  account_name: string | null;
  account_email: string | null;
  list_name: string | null;
  created_at: string;
  step_types: string;
}

const CARD_COLORS = [
  { bg: "bg-blue-500/10", border: "border-blue-500/20", icon: "text-blue-400" },
  { bg: "bg-violet-500/10", border: "border-violet-500/20", icon: "text-violet-400" },
  { bg: "bg-emerald-500/10", border: "border-emerald-500/20", icon: "text-emerald-400" },
  { bg: "bg-orange-500/10", border: "border-orange-500/20", icon: "text-orange-400" },
  { bg: "bg-pink-500/10", border: "border-pink-500/20", icon: "text-pink-400" },
  { bg: "bg-cyan-500/10", border: "border-cyan-500/20", icon: "text-cyan-400" },
  { bg: "bg-amber-500/10", border: "border-amber-500/20", icon: "text-amber-400" },
  { bg: "bg-rose-500/10", border: "border-rose-500/20", icon: "text-rose-400" },
];

const CARD_ICONS = [
  RiRocketLine, RiTeamLine, RiUserStarLine, RiMailSendLine,
  RiSuitcaseLine, RiGlobalLine, RiMegaphoneLine, RiShakeHandsLine,
  RiLightbulbLine, RiCrosshairLine,
];

const STEP_ICON: Record<string, React.ElementType> = {
  visit: RiEyeLine,
  connect: RiLinkedinBoxLine,
  message: RiMessage2Line,
  delay: RiTimeLine,
};
const STEP_LABEL_KEYS: Record<string, string> = {
  visit: "workflows.stepVisit",
  connect: "workflows.stepConnect",
  message: "workflows.stepMessage",
  sales_inmail: "workflows.stepInmail",
  salesInmail: "workflows.stepInmail",
  email: "workflows.stepEmail",
  coldEmail: "workflows.stepEmail",
};

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();

  // Steps subquery — isolated to avoid row multiplication when joined with runs
  const stepRows = db.prepare(
    `SELECT workflow_id,
       GROUP_CONCAT(step_type ORDER BY step_order) as step_types,
       COUNT(*) as step_count,
       SUM(CASE WHEN step_type != 'delay' THEN 1 ELSE 0 END) as action_step_count
     FROM workflow_steps
     GROUP BY workflow_id`
  ).all() as { workflow_id: string; step_types: string; step_count: number; action_step_count: number }[];

  const stepMap = Object.fromEntries(stepRows.map(s => [s.workflow_id, s]));

  // Prospects/runs subquery — separate from steps to avoid GROUP_CONCAT multiplication
  const prospectRows = db.prepare(
    `SELECT r.workflow_id,
       MAX(a.name) as account_name,
       MAX(a.email) as account_email,
       MAX(l.name) as list_name,
       COUNT(DISTINCT rp.id) as total_prospects,
       COUNT(DISTINCT CASE WHEN NOT EXISTS (
         SELECT 1 FROM run_profile_tracks rt
         WHERE rt.run_profile_id = rp.id AND rt.state NOT IN ('completed','failed','skipped')
       ) AND EXISTS (
         SELECT 1 FROM run_profile_tracks rt2
         WHERE rt2.run_profile_id = rp.id AND rt2.state = 'completed'
       ) THEN rp.id END) as completed_prospects,
       COUNT(DISTINCT CASE WHEN t.connection_requested_at IS NOT NULL THEN rp.target_id END) as connections_sent,
       COUNT(DISTINCT CASE WHEN t.connected_at IS NOT NULL THEN rp.target_id END) as connections_accepted,
       MAX(CASE WHEN r.status = 'running' THEN r.id ELSE NULL END) as active_run_id,
       MAX(CASE WHEN r.status IN ('running','paused') THEN r.status ELSE NULL END) as active_status
     FROM runs r
     LEFT JOIN accounts a ON a.id = r.account_id
     LEFT JOIN lists l ON l.id = r.list_id
     LEFT JOIN run_profiles rp ON rp.run_id = r.id
     LEFT JOIN targets t ON t.id = rp.target_id
     GROUP BY r.workflow_id`
  ).all() as {
    workflow_id: string;
    account_name: string | null;
    account_email: string | null;
    list_name: string | null;
    total_prospects: number;
    completed_prospects: number;
    connections_sent: number;
    connections_accepted: number;
    active_run_id: string | null;
    active_status: string | null;
  }[];

  const prospectMap = Object.fromEntries(prospectRows.map((r) => [r.workflow_id, r]));

  const workflows = db.prepare(
    "SELECT id, name, description, is_archived, created_at FROM workflows ORDER BY created_at DESC"
  ).all() as { id: string; name: string; description: string | null; is_archived: number; created_at: string }[];

  const merged: WorkflowCard[] = workflows.map((w) => ({
    ...w,
    is_archived: w.is_archived ?? 0,
    step_count: stepMap[w.id]?.step_count ?? 0,
    action_step_count: stepMap[w.id]?.action_step_count ?? 0,
    step_types: stepMap[w.id]?.step_types ?? "",
    total_prospects: prospectMap[w.id]?.total_prospects ?? 0,
    completed_prospects: prospectMap[w.id]?.completed_prospects ?? 0,
    connections_sent: prospectMap[w.id]?.connections_sent ?? 0,
    connections_accepted: prospectMap[w.id]?.connections_accepted ?? 0,
    active_run_id: prospectMap[w.id]?.active_run_id ?? null,
    active_status: prospectMap[w.id]?.active_status ?? null,
    account_name: prospectMap[w.id]?.account_name ?? null,
    account_email: prospectMap[w.id]?.account_email ?? null,
    list_name: prospectMap[w.id]?.list_name ?? null,
  }));

  return { props: { initialWorkflows: merged } };
};

export default function WorkflowsPage({ initialWorkflows }: { initialWorkflows: WorkflowCard[] }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [workflows, setWorkflows] = useState<WorkflowCard[]>(initialWorkflows);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const activeWorkflows = workflows.filter((w) => !w.is_archived);
  const archivedWorkflows = workflows.filter((w) => w.is_archived);

  async function createWorkflow(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) { toast.error(t("workflows.createError")); return; }
    const { id } = await res.json();
    router.push(`/workflows/${id}?setup=1`);
  }

  async function deleteWorkflow(id: string) {
    await fetch(`/api/workflows/${id}`, { method: "DELETE" });
    toast.success(t("workflows.campaignDeleted"));
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
    setDeleteId(null);
  }

  async function duplicateWorkflow(id: string, name: string) {
    const res = await fetch(`/api/workflows/${id}/duplicate`, { method: "POST" });
    if (!res.ok) { toast.error(t("workflows.duplicateError")); return; }
    const { id: newId } = await res.json();
    toast.success(t("workflows.duplicateSuccess", { name }));
    router.push(`/workflows/${newId}`);
  }

  async function toggleArchive(id: string, archive: boolean) {
    await fetch(`/api/workflows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_archived: archive }),
    });
    setWorkflows((prev) => prev.map((w) => w.id === id ? { ...w, is_archived: archive ? 1 : 0 } : w));
    toast.success(archive ? t("workflows.campaignArchived") : t("workflows.campaignRestored"));
  }

  async function pauseRun(workflowId: string, runId: string) {
    await fetch(`/api/runs/${runId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paused" }) });
    toast.success(t("workflows.pausedToast"));
    setWorkflows((prev) => prev.map((w) => w.id === workflowId ? { ...w, active_status: "paused" } : w));
  }

  async function resumeRun(workflowId: string, runId: string) {
    await fetch(`/api/runs/${runId}/start`, { method: "POST" });
    toast.success(t("workflows.resumedToast"));
    setWorkflows((prev) => prev.map((w) => w.id === workflowId ? { ...w, active_status: "running" } : w));
  }

  return (
    <>
      <Head>
        <title>Secuencias — InHubFlow B2B</title>
        <meta name="description" content="Automatización y secuencias omnicanal de prospección en LinkedIn y Cold Email." />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div>
        {/* ── Top Header Banner (Lead Finder Style) ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl mb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              {t("workflows.title")}
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/15 text-brand-600 dark:text-brand-400">
              {activeWorkflows.length} {activeWorkflows.length === 1 ? t("workflows.activeCount") : t("workflows.activeCountPlural")}
            </span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("workflows.subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            data-tour="workflows-new"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs"
          >
            <RiAddLine size={16} /> {t("workflows.newCampaign")}
          </button>
        </div>
      </div>

      {workflows.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500 text-sm shadow-xs">
          {t("workflows.noCampaigns")}
        </div>
      ) : (
        <>
        {/* Active campaigns */}
        {activeWorkflows.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500 text-sm mb-4 shadow-xs">
            {t("workflows.noActiveCampaigns")}
          </div>
        ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 mb-6">
          {activeWorkflows.map((w) => {
            const colorIdx = w.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
            const style = CARD_COLORS[colorIdx % CARD_COLORS.length];
            const Icon = CARD_ICONS[colorIdx % CARD_ICONS.length];
            const stepTypes = w.step_types ? w.step_types.split(",") : [];
            // Collapse duplicate adjacent step types, skip delays (shown implicitly via arrows)
            const actionSteps: string[] = [];
            for (const t of stepTypes) {
              if (t === "delay") continue;
              if (actionSteps[actionSteps.length - 1] !== t) actionSteps.push(t);
            }
            const acceptanceRate = w.connections_sent > 0
              ? Math.round((w.connections_accepted / w.connections_sent) * 100)
              : null;
            const progress = w.total_prospects > 0
              ? Math.round((w.completed_prospects / w.total_prospects) * 100)
              : 0;
            const isRunning = w.active_status === "running";
            const isPaused = w.active_status === "paused";

            return (
              <div
                key={w.id}
                className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl p-5 cursor-pointer hover:border-brand-500/50 transition-all hover:shadow-md flex flex-col gap-4 shadow-xs"
                onClick={() => router.push(`/workflows/${w.id}`)}
              >
                {/* Header: icon + name + status */}
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${style.bg} ${style.border}`}>
                    <Icon size={18} className={style.icon} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-sm truncate text-gray-900 dark:text-white">{w.name}</span>
                      {isRunning && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                          {t("workflows.active")}
                        </span>
                      )}
                      {isPaused && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                          {t("workflows.paused")}
                        </span>
                      )}
                    </div>
                    {/* Step sequence */}
                    {actionSteps.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mb-1.5">
                        {actionSteps.map((type, i) => {
                          const StepIcon = STEP_ICON[type] ?? RiEyeLine;
                          const stepLabel = STEP_LABEL_KEYS[type] ? t(STEP_LABEL_KEYS[type]) : type;
                          return (
                            <span key={i} className="flex items-center gap-1">
                              {i > 0 && <RiArrowRightLine size={9} className="text-gray-400 dark:text-gray-600" />}
                              <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                <StepIcon size={11} />
                                {stepLabel}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {actionSteps.length === 0 && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">{t("workflows.noStepsConfigured")}</p>
                    )}

                    {/* Assigned Account & Target List */}
                    {w.account_name && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 border border-brand-200 dark:border-brand-800"
                          title={w.account_email || undefined}
                        >
                          <RiUserLine size={12} className="shrink-0 text-brand-500" />
                          {w.account_name}
                        </span>
                        {w.list_name && (
                          <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[180px]" title={w.list_name}>
                            • {w.list_name}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress */}
                {w.total_prospects > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                      <span>{t("workflows.prospectsDone", { completed: w.completed_prospects, total: w.total_prospects })}</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    {(w.connections_sent > 0 || acceptanceRate !== null) && (
                      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {w.connections_sent > 0 && <span>{t("workflows.connectedCount", { count: w.connections_sent })}</span>}
                        {acceptanceRate !== null && <span className="text-emerald-600 dark:text-emerald-400 font-medium">{t("workflows.acceptedRate", { rate: acceptanceRate })}</span>}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 dark:text-gray-500">{t("workflows.noProspectsEnrolled")}</p>
                )}

                {/* Footer */}
                <div
                  className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {w.action_step_count === 1
                      ? t("workflows.stepCount", { count: 1 })
                      : t("workflows.stepCountPlural", { count: w.action_step_count })}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {isRunning && w.active_run_id && (
                      <button
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                        onClick={() => pauseRun(w.id, w.active_run_id!)}
                      >
                        <RiPauseLine size={11} /> {t("workflows.pause")}
                      </button>
                    )}
                    {isPaused && w.active_run_id && (
                      <button
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20 hover:bg-brand-500/20 transition-colors"
                        onClick={() => resumeRun(w.id, w.active_run_id!)}
                      >
                        <RiPlayLine size={11} /> {t("workflows.resume")}
                      </button>
                    )}
                    <button
                      title={t("workflows.duplicate")}
                      className="inline-flex items-center p-1.5 rounded-lg text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      onClick={() => duplicateWorkflow(w.id, w.name)}
                    >
                      <RiFileCopyLine size={12} />
                    </button>
                    <button
                      title={t("workflows.archive")}
                      className="inline-flex items-center p-1.5 rounded-lg text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      onClick={() => toggleArchive(w.id, true)}
                    >
                      <RiArchiveLine size={12} />
                    </button>
                    <button
                      title={t("workflows.delete")}
                      className="inline-flex items-center p-1.5 rounded-lg text-xs bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors"
                      onClick={() => setDeleteId(w.id)}
                    >
                      <RiDeleteBinLine size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}

        {/* Archived section */}
        {archivedWorkflows.length > 0 && (
          <div className="mt-2">
            <button
              className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors mb-3 group"
              onClick={() => setArchivedOpen((v) => !v)}
            >
              <RiArrowDownSLine
                size={14}
                className={`transition-transform ${archivedOpen ? "" : "-rotate-90"}`}
              />
              <RiArchiveLine size={12} />
              {t("workflows.archivedSection", { count: archivedWorkflows.length })}
            </button>
            {archivedOpen && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {archivedWorkflows.map((w) => {
                  const colorIdx = w.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
                  const style = CARD_COLORS[colorIdx % CARD_COLORS.length];
                  const Icon = CARD_ICONS[colorIdx % CARD_ICONS.length];
                  return (
                    <div
                      key={w.id}
                      className="bg-white/60 dark:bg-gray-900/60 border border-gray-300 dark:border-gray-700 rounded-2xl p-4 opacity-75 hover:opacity-100 transition-opacity flex items-center gap-3 shadow-xs"
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${style.bg} ${style.border}`}>
                        <Icon size={15} className={style.icon} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate text-gray-900 dark:text-white">{w.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {w.action_step_count === 1
                            ? t("workflows.stepCount", { count: 1 })
                            : t("workflows.stepCountPlural", { count: w.action_step_count })}
                          {" · "}
                          {w.total_prospects} {t("workflows.prospects")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          title={t("workflows.restore")}
                          className="inline-flex items-center p-1.5 rounded-lg text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                          onClick={() => toggleArchive(w.id, false)}
                        >
                          <RiInboxUnarchiveLine size={12} />
                        </button>
                        <button
                          title={t("workflows.delete")}
                          className="inline-flex items-center p-1.5 rounded-lg text-xs bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors"
                          onClick={() => setDeleteId(w.id)}
                        >
                          <RiDeleteBinLine size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        </>
      )}

      {/* New campaign modal */}
      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xl max-w-md">
            <h3 className="font-semibold text-base mb-4 text-gray-900 dark:text-white">{t("workflows.newCampaign")}</h3>
            <form onSubmit={createWorkflow} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-gray-600 dark:text-gray-400 pb-1">{t("common.name")}</label>
                <input
                  className="input input-bordered input-sm w-full bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 rounded-xl focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-gray-900 dark:text-white"
                  placeholder={t("workflows.namePlaceholder")}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="label text-xs text-gray-600 dark:text-gray-400 pb-1">{t("common.description")} {t("common.optional")}</label>
                <input
                  className="input input-bordered input-sm w-full bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 rounded-xl focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-gray-900 dark:text-white"
                  placeholder={t("workflows.descPlaceholder")}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="modal-action mt-2">
                <button type="button" className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" onClick={() => setShowModal(false)}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-colors disabled:opacity-50 shadow-xs" disabled={loading}>
                  {loading ? <span className="loading loading-spinner loading-xs" /> : t("workflows.createCampaign")}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop bg-black/40 backdrop-blur-xs" onClick={() => setShowModal(false)} />
        </div>
      )}

      {/* Delete confirm */}
      {deleteId !== null && (
        <div className="modal modal-open">
          <div className="modal-box bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xl max-w-sm">
            <h3 className="font-semibold text-base mb-2 text-gray-900 dark:text-white">{t("workflows.deleteConfirm")}</h3>
            <div className="modal-action">
              <button className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" onClick={() => setDeleteId(null)}>{t("common.cancel")}</button>
              <button className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-500 hover:bg-rose-600 !text-white transition-colors shadow-xs" onClick={() => deleteWorkflow(deleteId)}>{t("common.delete")}</button>
            </div>
          </div>
          <div className="modal-backdrop bg-black/40 backdrop-blur-xs" onClick={() => setDeleteId(null)} />
        </div>
      )}
    </div>
    </>
  );
}
