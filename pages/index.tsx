import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import { FiUserPlus, FiMessageSquare, FiEye, FiRepeat, FiUsers, FiUserCheck } from "react-icons/fi";
import {
  RiMailSendLine,
  RiReplyLine,
  RiRobot2Line,
  RiLinkedinBoxLine,
  RiFilterLine,
  RiUserFollowLine,
  RiUserSearchLine,
  RiRadarLine,
  RiKanbanView,
  RiFlowChart,
  RiMailCheckLine,
  RiArrowRightLine,
  RiSparklingLine,
  RiShieldCheckLine,
  RiPulseLine,
} from "react-icons/ri";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { UpcomingMeetingsWidget } from "@/components/calendar/UpcomingMeetingsWidget";

interface DashboardStats {
  totals: {
    total_targets: number;
    connections_requested: number;
    connected: number;
    follows?: number;
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
    follows_today?: number;
    connections_today: number;
    messages_today: number;
    inmails_today: number;
    emails_today?: number;
  };
  activity: {
    day: string;
    visits: number;
    follows: number;
    connections: number;
    messages: number;
    inmails: number;
    emails: number;
  }[];
  lists: { id: string; name: string }[];
  workflows: { id: string; name: string }[];
  pipeline?: { id: string; name: string; color: string; order_index: number; count: number }[];
  sdr?: {
    mode: string;
    enabled: boolean;
    threads_count: number;
    decisions_count: number;
    actions_count: number;
    bookings_count: number;
    pending_actions: number;
  };
  emailHealth?: {
    connected_accounts: number;
    sent_today: number;
    total_daily_limit: number;
  };
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

// ── Executive Metric Tile (Modern InHubFlow Style) ─────────────────────────────

function MetricTile({
  icon,
  label,
  value,
  sub,
  color,
  pulse,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  color: string;
  pulse?: boolean;
}) {
  return (
    <div className="p-4 rounded-xl bg-gray-50/70 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 hover:border-brand-500 dark:hover:border-brand-500 hover:bg-white dark:hover:bg-gray-850 hover:shadow-xs transition-all group flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2.5">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 transition-transform group-hover:scale-105"
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
      <div>
        <div className="tabular-nums font-extrabold text-2xl sm:text-3xl text-gray-900 dark:text-white leading-tight tracking-tight">
          <Counter value={value} />
        </div>
        <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mt-1 truncate">
          {label}
        </div>
        {sub && (
          <div
            className="text-[10px] font-bold mt-1.5 inline-block px-2 py-0.5 rounded-md"
            style={{ background: `${color}15`, color }}
          >
            {sub}
          </div>
        )}
      </div>
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
    <div className="flex items-center gap-3 px-4 py-2.5 group hover:bg-gray-50/50 dark:hover:bg-gray-800/40 transition-colors">
      <span
        className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-xs"
        style={{ background: `${color}15`, color }}
      >
        {icon}
      </span>
      <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-32 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-xs font-bold tabular-nums text-gray-800 dark:text-gray-200 w-10 text-right shrink-0">
        <Counter value={value} />
      </span>
    </div>
  );
}

// ── Activity chart ────────────────────────────────────────────────────────────

const DAY_OPTIONS = [7, 14, 30, 90] as const;

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
    { key: "follows" as const,     color: "#a855f7", label: t("dashboard.follows") },
    { key: "connections" as const, color: "#32d583", label: t("dashboard.connections") },
    { key: "messages" as const,    color: "#f4b740", label: t("dashboard.messages") },
    { key: "inmails" as const,     color: "#e879f9", label: t("dashboard.inmails") },
    { key: "emails" as const,      color: "#fb923c", label: t("dashboard.emails") },
  ];
  const [activeSeries, setActiveSeries] = useState<Set<string>>(new Set(seriesConfig.map(s => s.key)));
  const maxVal = Math.max(
    ...data.flatMap(d => seriesConfig.filter(s => activeSeries.has(s.key)).map(s => d[s.key] || 0)),
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{t("dashboard.activity")}</span>
          <div className="flex flex-wrap items-center gap-2">
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
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 shrink-0 self-start sm:self-auto">
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
                      <span style={{ color: s.color }}>{d[s.key] || 0} {s.label.toLowerCase()}</span>
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
                        height: `${Math.max(2, ((d[s.key] || 0) / maxVal) * 130)}px`,
                        background: s.color,
                        opacity: (d[s.key] || 0) === 0 ? 0.08 : 0.8,
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

// ── AI usage & SDR Center panel ────────────────────────────────────────────────

function AiUsagePanel({
  data,
  days,
  sdr,
}: {
  data: AgentStats["daily"];
  days: number;
  sdr?: DashboardStats["sdr"];
}) {
  const { t } = useTranslation();
  const totalCost = data.reduce((s, d) => s + (d.cost_usd ?? 0), 0);
  const totalTokens = data.reduce((s, d) => s + (d.input_tokens ?? 0) + (d.output_tokens ?? 0), 0);
  const hasData = totalCost > 0 || totalTokens > 0;
  const maxCost = Math.max(...data.map(d => d.cost_usd ?? 0), 0.000001);
  const labelEvery = days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 5 : 15;

  return (
    <div className="rounded-2xl border border-gray-300 bg-white p-5 shadow-xs dark:border-gray-700 dark:bg-gray-900 flex flex-col justify-between h-full">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-gray-700 mb-3.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center">
              <RiRobot2Line size={16} />
            </div>
            <div>
              <span className="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wider block">
                {t("dashboard.sdrAgent")}
              </span>
              <span className="text-[10px] text-gray-400">Gemini 3.6 Flash & Automation</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{sdr?.mode === "autopilot" ? t("dashboard.sdrAutoMode") : t("dashboard.sdrApprovalMode")}</span>
          </div>
        </div>

        {/* SDR Micro Metrics Grid */}
        <div className="grid grid-cols-3 gap-2 mb-3.5">
          <div className="p-2.5 rounded-xl bg-purple-500/5 dark:bg-purple-950/20 border border-purple-500/20 dark:border-purple-500/30">
            <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 block uppercase tracking-wide">
              {t("dashboard.sdrDecisions")}
            </span>
            <span className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
              <Counter value={sdr?.decisions_count || 0} />
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-blue-500/5 dark:bg-blue-950/20 border border-blue-500/20 dark:border-blue-500/30">
            <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 block uppercase tracking-wide">
              Acciones IA
            </span>
            <span className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
              <Counter value={sdr?.actions_count || 0} />
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-emerald-500/5 dark:bg-emerald-950/20 border border-emerald-500/20 dark:border-emerald-500/30">
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 block uppercase tracking-wide">
              {t("dashboard.sdrMeetings")}
            </span>
            <span className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
              <Counter value={sdr?.bookings_count || 0} />
            </span>
          </div>
        </div>
      </div>

      {/* AI Token & Cost Usage Section */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <RiSparklingLine size={13} className="text-purple-400" />
            <span className="text-xs font-semibold">{t("dashboard.aiUsage")}</span>
          </div>
          <div className="flex items-center gap-3 text-xs font-medium">
            <span className="text-gray-500 dark:text-gray-400 tabular-nums">
              {totalTokens.toLocaleString()} {t("dashboard.tokens")}
            </span>
            <span className="font-bold tabular-nums text-purple-600 dark:text-purple-400">
              ${totalCost.toFixed(4)}
            </span>
          </div>
        </div>

        {!hasData ? (
          <div className="py-3 text-center">
            <p className="text-xs text-gray-400 font-medium">
              {t("dashboard.noAiUsage")}
            </p>
          </div>
        ) : (
          <div className="flex items-end gap-1" style={{ height: 60 }}>
            {data.map((d, i) => {
              const showLabel = i % labelEvery === 0;
              const height = Math.max(3, ((d.cost_usd ?? 0) / maxCost) * 45);
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
                    <span className="text-[9px] text-gray-400 mt-1 leading-none shrink-0">{d.day.slice(5)}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Link */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-2 flex items-center justify-between">
        <span className="text-[11px] text-gray-400">
          {sdr?.pending_actions ? `${sdr.pending_actions} acciones pendientes` : "Autonomía comercial activa"}
        </span>
        <Link
          href="/sdr"
          className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
        >
          Supervisar SDR IA <RiArrowRightLine size={13} />
        </Link>
      </div>
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

  // Pipeline stages values
  const interestedCount = stats.pipeline?.find(s => s.id === 'stage_interested')?.count || 0;
  const meetingCount = stats.pipeline?.find(s => s.id === 'stage_meeting')?.count || 0;
  const wonCount = stats.pipeline?.find(s => s.id === 'stage_won')?.count || 0;

  const maxFunnelValue = Math.max(
    totals.total_targets,
    totals.connected,
    totals.replies_received,
    totals.emails_sent,
    totals.email_replies,
    interestedCount,
    meetingCount,
    1
  );

  return (
    <>
    <Head>
      <title>InHubFlow — Plataforma de Prospección B2B & SDR con IA</title>
      <meta
        name="description"
        content="Automatiza tu prospección en LinkedIn y Cold Email con agentes de inteligencia artificial, pipelines comerciales y CRM integrado."
      />
      <meta property="og:site_name" content="InHubFlow" />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="https://inhubflow.online/" />
      <meta property="og:title" content="InHubFlow — Plataforma de Prospección B2B & SDR con IA" />
      <meta
        property="og:description"
        content="Automatiza tu prospección en LinkedIn y Cold Email con agentes de inteligencia artificial, pipelines comerciales y CRM integrado."
      />
      <meta property="og:image" content="https://inhubflow.online/og-image.png" />
      <meta property="og:image:secure_url" content="https://inhubflow.online/og-image.png" />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:image" content="https://inhubflow.online/og-image.png" />
      <link rel="image_src" href="https://inhubflow.online/og-image.png" />
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
              { label: t("dashboard.todayFollows", { count: today.follows_today || 0 }), color: "#a855f7" },
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

      {/* ── Quick Action Command Bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Link
          href="/lead-finder"
          className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-brand-500 dark:hover:border-brand-500 hover:shadow-xs transition-all group"
        >
          <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-brand-500/10 text-brand-500 group-hover:scale-105 transition-transform">
            <RiUserSearchLine size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{t("dashboard.actionFindLeads")}</p>
            <p className="text-[10px] text-gray-400 truncate">Lead Finder</p>
          </div>
        </Link>

        <Link
          href="/workflows"
          className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-amber-500 dark:hover:border-amber-500 hover:shadow-xs transition-all group"
        >
          <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-amber-500/10 text-amber-500 group-hover:scale-105 transition-transform">
            <RiFlowChart size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{t("dashboard.actionNewCampaign")}</p>
            <p className="text-[10px] text-gray-400 truncate">Secuencias</p>
          </div>
        </Link>

        <Link
          href="/sdr"
          className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-purple-500 dark:hover:border-purple-500 hover:shadow-xs transition-all group"
        >
          <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-purple-500/10 text-purple-500 group-hover:scale-105 transition-transform">
            <RiRobot2Line size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{t("dashboard.actionSdr")}</p>
            <p className="text-[10px] text-purple-500 font-medium truncate">{stats.sdr?.decisions_count ? `${stats.sdr.decisions_count} calificados` : "En vivo"}</p>
          </div>
        </Link>

        <Link
          href="/pipeline"
          className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-pink-500 dark:hover:border-pink-500 hover:shadow-xs transition-all group"
        >
          <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-pink-500/10 text-pink-500 group-hover:scale-105 transition-transform">
            <RiKanbanView size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{t("dashboard.actionPipeline")}</p>
            <p className="text-[10px] text-gray-400 truncate">Oportunidades</p>
          </div>
        </Link>

        <Link
          href="/signals"
          className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-blue-500 dark:hover:border-blue-500 hover:shadow-xs transition-all group"
        >
          <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-500 group-hover:scale-105 transition-transform">
            <RiRadarLine size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{t("dashboard.actionSignals")}</p>
            <p className="text-[10px] text-gray-400 truncate">Radar de Intención</p>
          </div>
        </Link>

        <Link
          href="/email-health"
          className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-emerald-500 dark:hover:border-emerald-500 hover:shadow-xs transition-all group"
        >
          <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-emerald-500/10 text-emerald-500 group-hover:scale-105 transition-transform">
            <RiMailCheckLine size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{t("dashboard.actionEmailHealth")}</p>
            <p className="text-[10px] text-gray-400 truncate">Entregabilidad</p>
          </div>
        </Link>
      </div>

      {/* ── Executive Multichannel Performance Deck ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* LinkedIn Outreach Engine Panel */}
        <div className="lg:col-span-7 rounded-2xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xs p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-[#0077b5]/10 text-[#0077b5] dark:bg-[#0077b5]/20 dark:text-[#38bdf8] flex items-center justify-center text-base shrink-0">
                  <RiLinkedinBoxLine size={18} />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white tracking-tight">
                      {t("dashboard.channelLinkedin")} &mdash; Outreach Engine
                    </h3>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      Multicanal
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">
                    Automatización de visitas, seguimientos, conexiones e InMails
                  </p>
                </div>
              </div>
              <Link
                href="/workflows"
                className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
              >
                <span>Ver Campañas</span>
                <RiArrowRightLine size={12} />
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <MetricTile
                label={t("dashboard.profilesVisited")}
                value={totals.connections_requested}
                color="#0284c7"
                icon={<FiEye size={15} />}
              />
              <MetricTile
                label={t("dashboard.profilesFollowed")}
                value={totals.follows || 0}
                color="#8b5cf6"
                icon={<RiUserFollowLine size={15} />}
              />
              <MetricTile
                label={t("dashboard.connectionRequests")}
                value={totals.connections_requested}
                sub={acceptanceRate > 0 ? `${acceptanceRate}% ${t("dashboard.accepted")}` : undefined}
                color="#10b981"
                icon={<FiUserPlus size={15} />}
                pulse={totals.active_runs > 0}
              />
              <MetricTile
                label={t("dashboard.messagesSent")}
                value={totals.messages_sent}
                sub={replyRate > 0 ? `${replyRate}% ${t("dashboard.replied")}` : undefined}
                color="#f59e0b"
                icon={<FiMessageSquare size={15} />}
              />
              <MetricTile
                label={t("dashboard.inmailsSent")}
                value={totals.inmails_sent}
                color="#ec4899"
                icon={<RiLinkedinBoxLine size={15} />}
              />
              <MetricTile
                label={t("inbox.title")}
                value={totals.replies_received}
                color="#06b6d4"
                icon={<FiRepeat size={15} />}
              />
            </div>
          </div>
        </div>

        {/* Cold Email & Deliverability Panel */}
        <div className="lg:col-span-5 rounded-2xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xs p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-orange-500/10 text-orange-500 dark:bg-orange-500/20 dark:text-orange-400 flex items-center justify-center text-base shrink-0">
                  <RiMailSendLine size={18} />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white tracking-tight">
                      {t("dashboard.channelEmail")} &mdash; Secuencias
                    </h3>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <RiShieldCheckLine size={11} />
                      Warmup OK
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">
                    Cadencias de correo frío y control de reputación SPF/DKIM
                  </p>
                </div>
              </div>
              <Link
                href="/email-health"
                className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
              >
                <span>Salud</span>
                <RiArrowRightLine size={12} />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <MetricTile
                label={t("dashboard.emailsSent")}
                value={totals.emails_sent}
                sub={emailReplyRate > 0 ? `${emailReplyRate}% ${t("dashboard.replied")}` : undefined}
                color="#f97316"
                icon={<RiMailSendLine size={15} />}
              />
              <MetricTile
                label={t("dashboard.emailsReplied")}
                value={totals.email_replies}
                color="#10b981"
                icon={<RiReplyLine size={15} />}
              />
              <MetricTile
                label={t("contacts.title")}
                value={totals.total_targets}
                color="#64748b"
                icon={<FiUsers size={15} />}
              />
              <MetricTile
                label={t("dashboard.connected")}
                value={totals.connected}
                color="#3b82f6"
                icon={<FiUserPlus size={15} />}
              />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
              <RiPulseLine size={14} className="text-emerald-500" />
              <span className="text-[11px]">Entregabilidad estimada: <strong className="text-emerald-600 dark:text-emerald-400 font-semibold">98.6%</strong></span>
            </div>
            <Link
              href="/email-accounts"
              className="text-[11px] font-medium text-brand-600 dark:text-brand-400 hover:underline"
            >
              Configurar buzones &rarr;
            </Link>
          </div>
        </div>
      </div>

      {/* ── Fila 1: Embudo de Prospección & CRM + Centro SDR IA (Dos columnas en una misma línea) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        {/* Embudo de Prospección & Pipeline */}
        <div className="rounded-2xl border border-gray-300 bg-white shadow-xs dark:border-gray-700 dark:bg-gray-900 overflow-hidden flex flex-col justify-between h-full" data-tour="dashboard-funnel">
          <div className="px-5 py-3.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RiFilterLine size={16} className="text-brand-500" />
              <span className="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
                {t("dashboard.crmFunnel")}
              </span>
            </div>
            <Link
              href="/pipeline"
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
            >
              {t("dashboard.actionPipeline")} <RiArrowRightLine size={12} />
            </Link>
          </div>

          <div className="divide-y divide-gray-200 dark:divide-gray-700/80 py-1 flex-1 flex flex-col justify-around">
            <FunnelRow icon={<FiUsers size={13} />}        color="#808080" label={t("contacts.title")}        value={totals.total_targets}       max={maxFunnelValue} />
            <FunnelRow icon={<RiUserFollowLine size={13} />} color="#a855f7" label={t("dashboard.profilesFollowed")} value={totals.follows || 0}   max={maxFunnelValue} />
            <FunnelRow icon={<FiUserPlus size={13} />}     color="#32d583" label={t("dashboard.connected")}      value={totals.connected}           max={maxFunnelValue} />
            <FunnelRow icon={<FiRepeat size={13} />}       color="#06b6d4" label={t("inbox.title")}     value={totals.replies_received}    max={maxFunnelValue} />
            <FunnelRow icon={<RiSparklingLine size={13} />} color="#f59e0b" label="Interesados Calificados"  value={interestedCount}            max={maxFunnelValue} />
            <FunnelRow icon={<FiUserCheck size={13} />}     color="#10b981" label="Reuniones & Ganados"       value={meetingCount + wonCount}     max={maxFunnelValue} />
          </div>

          <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-850/30 flex items-center justify-between text-xs">
            <span className="text-gray-500 dark:text-gray-400">Conversión a oportunidad:</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {totals.total_targets > 0 ? (( (interestedCount + meetingCount + wonCount) / totals.total_targets) * 100).toFixed(1) : 0}%
            </span>
          </div>
        </div>

        {/* Centro de IA & Agente SDR */}
        {hasPremium && agentStats ? (
          <AiUsagePanel data={agentStats.daily} days={days} sdr={stats.sdr} />
        ) : (
          <div className="rounded-2xl border border-gray-300 bg-white p-5 shadow-xs dark:border-gray-700 dark:bg-gray-900 flex items-center justify-center h-full">
            <p className="text-xs text-gray-400">{t("dashboard.noAiUsage")}</p>
          </div>
        )}
      </div>

      {/* ── Fila 2: Actividad Multicanal (Tamaño completo) ── */}
      <div className="w-full">
        <ActivityChart data={stats.activity} days={days} onDaysChange={setDays} />
      </div>

      {/* ── Fila 3: Próximas Reuniones Comerciales (Tamaño completo) ── */}
      <div className="w-full">
        <UpcomingMeetingsWidget />
      </div>

      {/* ── Fila 4: Infraestructura & Salud Operativa ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Email Health Box */}
        <div className="rounded-2xl border border-gray-300 bg-white p-4 shadow-xs dark:border-gray-700 dark:bg-gray-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <RiMailCheckLine size={18} />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-900 dark:text-white">Salud de Envío de Email</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {stats.emailHealth?.connected_accounts
                  ? `${stats.emailHealth.connected_accounts} cuenta(s) activa(s) • ${stats.emailHealth.sent_today}/${stats.emailHealth.total_daily_limit} enviados hoy`
                  : "Conecta tus cuentas SMTP/IMAP para prospección multicanal"}
              </p>
            </div>
          </div>
          <Link
            href="/email-health"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 transition-colors shrink-0"
          >
            Ver Salud &rarr;
          </Link>
        </div>

        {/* Signal Radar Box */}
        <div className="rounded-2xl border border-gray-300 bg-white p-4 shadow-xs dark:border-gray-700 dark:bg-gray-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <RiRadarLine size={18} />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-900 dark:text-white">Radar de Señales de Intención</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Monitorea contrataciones, cambios de puesto y financiamiento con IA
              </p>
            </div>
          </div>
          <Link
            href="/signals"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 transition-colors shrink-0"
          >
            Ver Radar &rarr;
          </Link>
        </div>
      </div>

    </div>
    </>
  );
}
