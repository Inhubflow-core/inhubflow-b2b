import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import { FiUserPlus, FiMessageSquare, FiEye, FiRepeat, FiUsers } from "react-icons/fi";
import { RiMailSendLine, RiReplyLine, RiRobot2Line, RiLinkedinBoxLine, RiFilterLine } from "react-icons/ri";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { UpcomingMeetingsWidget } from "@/components/calendar/UpcomingMeetingsWidget";

interface DashboardStats {
  totals: {
    total_targets: number;
    connections_requested: number;
    connected: number;
    messages_sent: number;
    inmails_sent: number;
    replies_received: number;
    active_runs: number;
    total_lists: number;
    total_workflows: number;
    emails_sent: number;
    email_replies: number;
  };
  today: {
    visits_today: number;
    connections_today: number;
    messages_today: number;
    inmails_today: number;
  };
  activity: { day: string; visits: number; connections: number; messages: number; inmails: number; emails: number }[];
  lists: { id: string; name: string }[];
  workflows: { id: string; name: string }[];
}

interface AgentStats {
  daily: { day: string; cost_usd: number; input_tokens: number; output_tokens: number }[];
}

// ── Animated counter ──────────────────────────────────────────────────────────

function Counter({ value, duration = 800 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number>(0);
  const start = useRef<number>(0);
  const from = useRef<number>(0);

  useEffect(() => {
    from.current = display;
    start.current = 0;
    cancelAnimationFrame(raf.current);
    function step(ts: number) {
      if (!start.current) start.current = ts;
      const p = Math.min((ts - start.current) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from.current + (value - from.current) * ease));
      if (p < 1) raf.current = requestAnimationFrame(step);
    }
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value]); // eslint-disable-line

  return <>{display.toLocaleString()}</>;
}

// ── Channel section header ─────────────────────────────────────────────────────

function ChannelHeader({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color }}>
        {icon} {label}
      </span>
      <div className="flex-1 h-px bg-gray-300 dark:bg-gray-700" />
    </div>
  );
}

// ── KPI card (TailAdmin Style) ────────────────────────────────────────────────

function KpiCard({
  label, value, sub, color, icon, pulse,
}: {
  label: string;
  value: number;
  sub?: string;
  color: string;
  icon: React.ReactNode;
  pulse?: boolean;
}) {
  return (
    <div
      className="relative rounded-2xl border border-gray-300 bg-white p-4 shadow-xs dark:border-gray-700 dark:bg-gray-900 overflow-hidden group hover:border-brand-500/50 dark:hover:border-brand-500/50 transition-all"
    >
      <div
        className="absolute top-0 right-0 w-16 h-16 rounded-bl-3xl opacity-[0.06] transition-opacity group-hover:opacity-15"
        style={{ background: color }}
      />
      <div className="flex items-start justify-between mb-3">
        <span
          className="w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0"
          style={{ background: `${color}18`, color }}
        >
          {icon}
        </span>
        {pulse && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: color }} />
          </span>
        )}
      </div>
      <div className="tabular-nums font-bold text-2xl text-gray-900 dark:text-white leading-none mb-1.5">
        <Counter value={value} />
      </div>
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
      {sub && <div className="text-xs font-medium mt-1" style={{ color }}>{sub}</div>}
    </div>
  );
}

// ── Funnel bar row ─────────────────────────────────────────────────────────────

function FunnelRow({
  icon, color, label, value, max,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: number;
  max: number;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 group">
      <span
        className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-xs"
        style={{ background: `${color}15`, color }}
      >
        {icon}
      </span>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-24 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-white w-10 text-right">
        <Counter value={value} />
      </span>
    </div>
  );
}

// ── Activity chart ────────────────────────────────────────────────────────────

const DAY_OPTIONS = [7, 14, 30, 90];

function ActivityChart({
  data, days, onDaysChange,
}: {
  data: DashboardStats["activity"];
  days: number;
  onDaysChange: (d: number) => void;
}) {
  const { t } = useTranslation();
  const seriesConfig = [
    { key: "visits" as const,      color: "#5aa2ff", label: t("dashboard.visits") },
    { key: "connections" as const, color: "#32d583", label: t("dashboard.connections") },
    { key: "messages" as const,    color: "#f4b740", label: t("dashboard.messages") },
    { key: "inmails" as const,     color: "#e879f9", label: t("dashboard.inmails") },
    { key: "emails" as const,      color: "#fb923c", label: t("dashboard.emails") },
  ];
  const [activeSeries, setActiveSeries] = useState<Set<string>>(new Set(seriesConfig.map(s => s.key)));
  const maxVal = Math.max(
    ...data.flatMap(d => seriesConfig.filter(s => activeSeries.has(s.key)).map(s => d[s.key])),
    1
  );
  const labelEvery = days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 5 : 15;
  const gridLines = [0.25, 0.5, 0.75, 1];

  function toggleSeries(key: string) {
    setActiveSeries(prev => {
      const next = new Set(prev);
      if (next.has(key) && next.size > 1) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="rounded-2xl border border-gray-300 bg-white p-5 shadow-xs dark:border-gray-700 dark:bg-gray-900 flex flex-col" style={{ minHeight: 280 }} data-tour="dashboard-chart">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{t("dashboard.activity")}</span>
          <div className="flex items-center gap-2">
            {seriesConfig.map(s => (
              <button
                key={s.key}
                onClick={() => toggleSeries(s.key)}
                className="flex items-center gap-1.5 text-xs transition-opacity"
                style={{ opacity: activeSeries.has(s.key) ? 1 : 0.35 }}
              >
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: s.color }} />
                <span style={{ color: activeSeries.has(s.key) ? s.color : undefined }} className="text-gray-500 dark:text-gray-400 font-medium">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          {DAY_OPTIONS.map(d => (
            <button
              key={d}
              onClick={() => onDaysChange(d)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                days === d
                  ? "bg-white dark:bg-gray-700 text-brand-500 dark:text-brand-400 shadow-xs"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="relative flex-1" style={{ minHeight: 150 }}>
        {gridLines.map(g => (
          <div
            key={g}
            className="absolute left-0 right-0 border-t border-gray-200 dark:border-gray-800"
            style={{ bottom: `${g * 100}%` }}
          />
        ))}

        <div className="absolute inset-0 flex items-end gap-0.5">
          {data.map((d, i) => {
            const showLabel = i % labelEvery === 0;
            return (
              <div key={d.day} className="flex flex-col items-center flex-1 group relative h-full justify-end">
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-gray-800 text-white rounded-xl px-3 py-2 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 shadow-xl transition-opacity">
                  <div className="text-gray-400 mb-1.5 font-medium">{d.day}</div>
                  {seriesConfig.filter(s => activeSeries.has(s.key)).map(s => (
                    <div key={s.key} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                      <span style={{ color: s.color }}>{d[s.key]} {s.label.toLowerCase()}</span>
                    </div>
                  ))}
                </div>
                {/* Bars */}
                <div className="flex items-end gap-px w-full">
                  {seriesConfig.filter(s => activeSeries.has(s.key)).map(s => (
                    <div
                      key={s.key}
                      className="flex-1 rounded-t-sm transition-all duration-300"
                      style={{
                        height: `${Math.max(2, (d[s.key] / maxVal) * 130)}px`,
                        background: s.color,
                        opacity: d[s.key] === 0 ? 0.08 : 0.8,
                      }}
                    />
                  ))}
                </div>
                {showLabel && (
                  <span className="text-[10px] font-medium text-gray-400 mt-1.5 leading-none shrink-0">
                    {d.day.slice(5)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── AI usage panel ────────────────────────────────────────────────────────────

function AiUsagePanel({ data, days }: { data: AgentStats["daily"]; days: number }) {
  const { t } = useTranslation();
  const totalCost = data.reduce((s, d) => s + (d.cost_usd ?? 0), 0);
  const totalTokens = data.reduce((s, d) => s + (d.input_tokens ?? 0) + (d.output_tokens ?? 0), 0);
  const hasData = totalCost > 0 || totalTokens > 0;
  const maxCost = Math.max(...data.map(d => d.cost_usd ?? 0), 0.000001);
  const labelEvery = days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 5 : 15;

  return (
    <div className="rounded-2xl border border-gray-300 bg-white p-5 shadow-xs dark:border-gray-700 dark:bg-gray-900 flex flex-col justify-between h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-gray-800 mb-4">
        <div className="flex items-center gap-2">
          <RiRobot2Line size={16} className="text-purple-500" />
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
            {t("dashboard.aiUsage")}
          </span>
        </div>
        {hasData ? (
          <div className="flex items-center gap-3 text-xs font-medium">
            <span className="text-gray-500 dark:text-gray-400 tabular-nums">
              {totalTokens.toLocaleString()} {t("dashboard.tokens")}
            </span>
            <span className="font-bold tabular-nums text-purple-600 dark:text-purple-400">
              ${totalCost.toFixed(4)}
            </span>
          </div>
        ) : (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            SDR & Asistente IA
          </span>
        )}
      </div>

      {/* Content */}
      {!hasData ? (
        <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
          <div className="w-10 h-10 rounded-2xl bg-purple-500/10 text-purple-500 flex items-center justify-center mb-2.5">
            <RiRobot2Line size={20} />
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300 font-medium">
            {t("dashboard.noAiUsage")}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 max-w-xs">
            El consumo de tokens y costos se registrará automáticamente cuando el agente SDR califique leads o redacte respuestas.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-end pt-2">
          <div className="flex items-end gap-1" style={{ height: 120 }}>
            {data.map((d, i) => {
              const showLabel = i % labelEvery === 0;
              const height = Math.max(3, ((d.cost_usd ?? 0) / maxCost) * 100);
              return (
                <div key={d.day} className="flex flex-col items-center flex-1 group relative justify-end" style={{ height: "100%" }}>
                  <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded-xl px-2.5 py-1.5 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 shadow-xl">
                    <div className="text-gray-400 mb-1">{d.day}</div>
                    <div className="text-purple-400 font-bold">${(d.cost_usd ?? 0).toFixed(5)}</div>
                    <div className="text-gray-300">{((d.input_tokens ?? 0) + (d.output_tokens ?? 0)).toLocaleString()} {t("dashboard.tokens")}</div>
                  </div>
                  <div
                    className="w-full rounded-t-sm"
                    style={{ height, background: "#a78bfa", opacity: (d.cost_usd ?? 0) === 0 ? 0.12 : 0.85 }}
                  />
                  {showLabel && (
                    <span className="text-[10px] text-gray-400 mt-1.5 leading-none shrink-0">{d.day.slice(5)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  lists, workflows, listId, workflowId, onListChange, onWorkflowChange,
}: {
  lists: { id: string; name: string }[];
  workflows: { id: string; name: string }[];
  listId: string;
  workflowId: string;
  onListChange: (id: string) => void;
  onWorkflowChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const hasFilter = listId || workflowId;
  return (
    <div className="flex items-center gap-2">
      <RiFilterLine size={14} className="text-gray-400 shrink-0" />
      <select
        value={listId}
        onChange={(e) => { onListChange(e.target.value); if (e.target.value) onWorkflowChange(""); }}
        className={`h-8 max-w-[150px] sm:max-w-[200px] truncate px-3 rounded-xl text-xs font-medium border transition-all focus:outline-none cursor-pointer ${
          listId
            ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400"
            : "border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-400"
        }`}
      >
        <option value="">{t("dashboard.allLists")}</option>
        {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <select
        value={workflowId}
        onChange={(e) => { onWorkflowChange(e.target.value); if (e.target.value) onListChange(""); }}
        className={`h-8 max-w-[150px] sm:max-w-[200px] truncate px-3 rounded-xl text-xs font-medium border transition-all focus:outline-none cursor-pointer ${
          workflowId
            ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400"
            : "border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-400"
        }`}
      >
        <option value="">{t("dashboard.allCampaigns")}</option>
        {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      {hasFilter && (
        <button
          onClick={() => { onListChange(""); onWorkflowChange(""); }}
          className="h-8 px-2.5 rounded-xl text-xs font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {t("common.clear")}
        </button>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter();
  const { t } = useTranslation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  // Open-core: the AI usage panel reflects the premium AI writer — hidden in the public build.
  const [hasPremium, setHasPremium] = useState(true);
  const [error, setError] = useState(false);
  const [days, setDays] = useState(7);
  const [listId, setListId] = useState("");
  const [workflowId, setWorkflowId] = useState("");

  useEffect(() => {
    fetch("/api/premium-status").then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setHasPremium(!!d.hasPremium); }).catch(() => {});
  }, []);

  const loadStats = () => {
    const params = new URLSearchParams({ days: String(days) });
    if (listId) params.set("list_id", listId);
    if (workflowId) params.set("workflow_id", workflowId);

    Promise.all([
      fetch(`/api/dashboard/stats?${params}`).then(async (r) => {
        if (r.status === 401) {
          router.replace("/login");
          return null;
        }
        if (!r.ok) throw new Error("Failed to load stats");
        return r.json();
      }),
      fetch(`/api/dashboard/agent-stats?days=${days}`).then(async (r) => {
        if (!r.ok) return { daily: [] };
        return r.json();
      }),
    ])
      .then(([s, a]) => {
        if (s && s.totals) {
          setStats(s);
          setAgentStats(a || { daily: [] });
          setError(false);
        }
      })
      .catch(() => setError(true));
  };

  useEffect(() => {
    loadStats();
  }, [days, listId, workflowId]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-red-500 mb-2">{t("dashboard.loadError")}</p>
        <button
          onClick={() => { setError(false); loadStats(); }}
          className="text-xs text-brand-500 hover:underline"
        >
          {t("dashboard.retry")}
        </button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("common.loading")}</p>
      </div>
    );
  }

  const { totals, today } = stats;

  const acceptanceRate = totals.connections_requested > 0
    ? Math.round((totals.connected / totals.connections_requested) * 100)
    : 0;

  const replyRate = totals.messages_sent > 0
    ? Math.round((totals.replies_received / totals.messages_sent) * 100)
    : 0;

  const emailReplyRate = totals.emails_sent > 0
    ? Math.round((totals.email_replies / totals.emails_sent) * 100)
    : 0;

  const maxFunnelValue = Math.max(
    totals.total_targets,
    totals.connected,
    totals.replies_received,
    totals.emails_sent,
    totals.email_replies,
    1
  );

  return (
    <>
    <Head>
      <title>Dashboard B2B</title>
      <meta name="robots" content="noindex, nofollow" />
    </Head>

    <div className="space-y-6">

      {/* ── Top Header Banner (Lead Finder Style) ── */}
      <div className="flex flex-col gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl">
        {/* Title & Subtitle */}
        <div className="space-y-1">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t("dashboard.title")}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("dashboard.subtitle")}
          </p>
        </div>

        {/* Filters and Today Metrics row (below text) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-brand-500/15 dark:border-brand-500/10" data-tour="dashboard-filters">
          {/* Filters */}
          <FilterBar
            lists={stats.lists}
            workflows={stats.workflows}
            listId={listId}
            workflowId={workflowId}
            onListChange={setListId}
            onWorkflowChange={setWorkflowId}
          />

          {/* Today pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 mr-0.5">{t("common.today")}</span>
            {[
              { label: t("dashboard.todayVisits", { count: today.visits_today }),       color: "#5aa2ff" },
              { label: t("dashboard.todayConnects", { count: today.connections_today }), color: "#32d583" },
              { label: t("dashboard.todayMessages", { count: today.messages_today }),   color: "#f4b740" },
              { label: t("dashboard.todayInmails", { count: today.inmails_today }),     color: "#c084fc" },
            ].map(p => (
              <span
                key={p.label}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
                style={{ background: `${p.color}18`, color: p.color }}
              >
                {p.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPI rows — LinkedIn then Email ── */}
      <div className="space-y-4">
        {/* LinkedIn */}
        <div>
          <ChannelHeader
            icon={<RiLinkedinBoxLine size={13} />}
            label={t("dashboard.channelLinkedin")}
            color="#5aa2ff"
          />
          <div className="grid grid-cols-5 gap-3.5">
            <KpiCard
              label={t("dashboard.profilesVisited")}
              value={totals.connections_requested}
              color="#5aa2ff"
              icon={<FiEye size={14} />}
            />
            <KpiCard
              label={t("dashboard.connectionRequests")}
              value={totals.connections_requested}
              sub={acceptanceRate > 0 ? `${acceptanceRate}% ${t("dashboard.accepted")}` : undefined}
              color="#32d583"
              icon={<FiUserPlus size={14} />}
              pulse={totals.active_runs > 0}
            />
            <KpiCard
              label={t("dashboard.messagesSent")}
              value={totals.messages_sent}
              sub={replyRate > 0 ? `${replyRate}% ${t("dashboard.replied")}` : undefined}
              color="#f4b740"
              icon={<FiMessageSquare size={14} />}
            />
            <KpiCard
              label={t("dashboard.inmailsSent")}
              value={totals.inmails_sent}
              color="#e879f9"
              icon={<RiLinkedinBoxLine size={14} />}
            />
            <KpiCard
              label={t("inbox.title")}
              value={totals.replies_received}
              color="#c084fc"
              icon={<FiRepeat size={14} />}
            />
          </div>
        </div>

        {/* Email */}
        <div>
          <ChannelHeader
            icon={<RiMailSendLine size={13} />}
            label={t("dashboard.channelEmail")}
            color="#fb923c"
          />
          <div className="grid grid-cols-4 gap-3.5">
            <KpiCard
              label={t("dashboard.emailsSent")}
              value={totals.emails_sent}
              sub={emailReplyRate > 0 ? `${emailReplyRate}% ${t("dashboard.replied")}` : undefined}
              color="#fb923c"
              icon={<RiMailSendLine size={14} />}
            />
            <KpiCard
              label={t("dashboard.emailsReplied")}
              value={totals.email_replies}
              color="#32d583"
              icon={<RiReplyLine size={14} />}
            />
            <KpiCard
              label={t("contacts.title")}
              value={totals.total_targets}
              color="#808080"
              icon={<FiUsers size={14} />}
            />
            <KpiCard
              label={t("dashboard.connected")}
              value={totals.connected}
              color="#32d583"
              icon={<FiUserPlus size={14} />}
            />
          </div>
        </div>
      </div>

      {/* ── Fila 1: Embudo de Conversión & Uso de la IA (Dos columnas en una misma línea) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        {/* Embudo de Conversión */}
        <div className="rounded-2xl border border-gray-300 bg-white shadow-xs dark:border-gray-700 dark:bg-gray-900 overflow-hidden flex flex-col justify-between h-full" data-tour="dashboard-funnel">
          <div className="px-5 py-3.5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RiFilterLine size={16} className="text-brand-500" />
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">{t("dashboard.funnel")}</span>
            </div>
            <span className="text-[11px] font-medium text-gray-400">
              {totals.total_targets} {t("contacts.title").toLowerCase()}
            </span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800/80 py-1 flex-1 flex flex-col justify-around">
            <FunnelRow icon={<FiUsers size={13} />}        color="#808080" label={t("contacts.title")}        value={totals.total_targets}       max={maxFunnelValue} />
            <FunnelRow icon={<FiUserPlus size={13} />}     color="#32d583" label={t("dashboard.connected")}      value={totals.connected}           max={maxFunnelValue} />
            <FunnelRow icon={<FiRepeat size={13} />}       color="#c084fc" label={t("inbox.title")}     value={totals.replies_received}    max={maxFunnelValue} />
            <FunnelRow icon={<RiMailSendLine size={13} />} color="#fb923c" label={t("dashboard.emailsSent")}    value={totals.emails_sent}         max={maxFunnelValue} />
            <FunnelRow icon={<RiReplyLine size={13} />}    color="#32d583" label={t("dashboard.emailsReplied")}  value={totals.email_replies}       max={maxFunnelValue} />
          </div>
        </div>

        {/* Uso de la IA */}
        {hasPremium && agentStats ? (
          <AiUsagePanel data={agentStats.daily} days={days} />
        ) : (
          <div className="rounded-2xl border border-gray-300 bg-white p-5 shadow-xs dark:border-gray-700 dark:bg-gray-900 flex items-center justify-center h-full">
            <p className="text-xs text-gray-400">{t("dashboard.noAiUsage")}</p>
          </div>
        )}
      </div>

      {/* ── Fila 2: Actividad (Tamaño completo) ── */}
      <div className="w-full">
        <ActivityChart data={stats.activity} days={days} onDaysChange={setDays} />
      </div>

      {/* ── Fila 3: Próximas Reuniones Comerciales (Tamaño completo) ── */}
      <div className="w-full">
        <UpcomingMeetingsWidget />
      </div>
    </div>
    </>
  );
}
