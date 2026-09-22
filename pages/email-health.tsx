import Head from "next/head";
import { useEffect, useState, useCallback } from "react";
import { RiMailLine, RiRefreshLine, RiShieldCheckLine, RiAlertLine } from "react-icons/ri";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface DayData { day: string; sent: number; limit: number; }
interface AccountRow {
  id: string; name: string; from_email: string;
  daily_email_limit: number; ramp_up_enabled: number; ramp_start_date: string | null;
  effective_limit_today: number; sent_today: number;
  days: DayData[];
}
interface LogEntry { created_at: string; message: string; email_account_id: string; }
interface GuardEntry { created_at: string; message: string; email_account_id: string | null; }

interface Data {
  accounts: AccountRow[];
  days: string[];
  recentLogs: LogEntry[];
  guardTrips: GuardEntry[];
}

const TZ = "Europe/Berlin";

function formatDay(d: string, loc = "es-ES") {
  return new Date(d + "T12:00:00Z").toLocaleDateString(loc, { month: "short", day: "numeric", timeZone: TZ });
}

function formatTime(ts: string, loc = "es-ES") {
  return new Date(ts).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ });
}

function formatDateTime(ts: string, loc = "es-ES") {
  const d = new Date(ts);
  return d.toLocaleDateString(loc, { month: "short", day: "numeric", timeZone: TZ }) + " " +
    d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export default function EmailHealth() {
  const { t, locale } = useTranslation();
  const dateLocale = locale === "pt-BR" ? "pt-BR" : locale === "es" ? "es-ES" : "en-GB";
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/email-health")
      .then(r => r.json())
      .then(d => { setData(d); setLastRefresh(new Date()); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  const totalToday = data?.accounts.reduce((s, a) => s + a.sent_today, 0) ?? 0;
  const totalLimit = data?.accounts.reduce((s, a) => s + a.effective_limit_today, 0) ?? 0;
  const overLimit = data?.accounts.filter(a => a.sent_today > a.effective_limit_today) ?? [];

  return (
    <>
      <Head>
        <title>{t("emailHealth.title")} — Dashboard B2B</title>
        <meta name="description" content={t("emailHealth.subtitle")} />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="space-y-6 pb-12">
        {/* ── Top Header Banner (Lead Finder Style) ── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl mb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                {t("emailHealth.title")}
              </h1>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("emailHealth.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {lastRefresh && (
              <span className="text-xs text-gray-400">
                {t("emailHealth.updatedAt", { time: formatTime(lastRefresh.toISOString(), dateLocale) })}
              </span>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
            >
              <RiRefreshLine size={16} className={loading ? "animate-spin" : ""} />
              {t("common.refresh")}
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs flex flex-col justify-between">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("emailHealth.sentToday")}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{totalToday}</div>
          </div>
          <div className="p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs flex flex-col justify-between">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("emailHealth.totalLimitToday")}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{totalLimit}</div>
          </div>
          <div className="p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs flex flex-col justify-between">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("emailHealth.accountsActive")}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {data?.accounts.filter(a => a.sent_today > 0).length ?? 0}
            </div>
          </div>
          {overLimit.length > 0 ? (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 shadow-xs flex flex-col justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 mb-1">
                <RiAlertLine size={13} /> {t("emailHealth.overLimitToday")}
              </div>
              <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">{overLimit.length}</div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-xs flex flex-col justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1">
                <RiShieldCheckLine size={13} /> {t("emailHealth.allWithinLimits")}
              </div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">✓</div>
            </div>
          )}
        </div>

        {/* Per-account table */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-xs mb-8 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
            <RiMailLine size={14} className="text-base-content/40" />
            <span className="text-sm font-medium text-base-content">{t("emailHealth.accountsLast7Days")}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-base-content/40 whitespace-nowrap">{t("emailHealth.colAccount")}</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-base-content/40 whitespace-nowrap">
                    {t("emailHealth.colToday")}<br/>
                    <span className="text-base-content/25 font-normal">{formatDay(today, dateLocale)}</span>
                  </th>
                  {data?.days.slice(0, -1).reverse().map(d => (
                    <th key={d} className="text-right px-4 py-2.5 text-xs font-medium text-base-content/25 whitespace-nowrap">
                      {formatDay(d, dateLocale)}
                    </th>
                  ))}
                  <th className="text-right px-5 py-2.5 text-xs font-medium text-base-content/40 whitespace-nowrap">{t("emailHealth.colLimitToday")}</th>
                </tr>
              </thead>
              <tbody>
                {data?.accounts.map(a => {
                  const over = a.sent_today > a.effective_limit_today;
                  return (
                    <tr key={a.id} className="border-b border-base-300/20 hover:bg-base-300/20 transition-colors">
                      <td className="px-5 py-3">
                        <div className="font-medium text-base-content/90 text-xs">{a.name}</div>
                        <div className="text-base-content/40 text-xs mt-0.5">{a.from_email}</div>
                        {a.ramp_start_date && (
                          <div className="text-base-content/30 text-[10px] mt-0.5">
                            {t("emailHealth.rampFrom", { date: a.ramp_start_date })}
                          </div>
                        )}
                      </td>
                      {/* Today */}
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-semibold ${over ? "text-error" : a.sent_today > 0 ? "text-base-content" : "text-base-content/30"}`}>
                          {a.sent_today}
                        </span>
                        {over && <span className="ml-1 text-error/60 text-xs">↑</span>}
                        {/* Mini bar */}
                        <div className="mt-1 h-1 w-16 rounded-full bg-base-300 ml-auto">
                          <div
                            className={`h-1 rounded-full ${over ? "bg-error" : "bg-info"}`}
                            style={{ width: `${Math.min(100, (a.sent_today / Math.max(a.effective_limit_today, 1)) * 100)}%` }}
                          />
                        </div>
                      </td>
                      {/* Past 6 days — newest first */}
                      {a.days.slice(0, -1).reverse().map(d => (
                        <td key={d.day} className="px-4 py-3 text-right">
                          <span className={`text-xs ${d.sent > d.limit ? "text-error" : d.sent > 0 ? "text-base-content/60" : "text-base-content/20"}`}>
                            {d.sent > 0 ? d.sent : "—"}
                          </span>
                        </td>
                      ))}
                      <td className="px-5 py-3 text-right text-xs text-base-content/50">
                        {a.effective_limit_today}
                        {a.ramp_up_enabled && a.ramp_start_date && a.effective_limit_today < a.daily_email_limit && (
                          <span className="ml-1 text-base-content/25">{t("emailHealth.rampBadge")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-base-300/40 bg-base-300/20">
                  <td className="px-5 py-2.5 text-xs font-medium text-base-content/50">{t("emailHealth.colTotal")}</td>
                  <td className="px-4 py-2.5 text-right text-sm font-semibold text-base-content">{totalToday}</td>
                  {data?.days.slice(0, -1).reverse().map(d => {
                    const sum = data.accounts.reduce((s, a) => s + (a.days.find(x => x.day === d)?.sent ?? 0), 0);
                    return (
                      <td key={d} className="px-4 py-2.5 text-right text-xs text-base-content/50">
                        {sum > 0 ? sum : "—"}
                      </td>
                    );
                  })}
                  <td className="px-5 py-2.5 text-right text-xs font-medium text-base-content/50">{totalLimit}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Recent send log */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-xs overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
              <span className="text-sm font-medium text-base-content">{t("emailHealth.recentSends")}</span>
              <span className="ml-2 text-xs text-base-content/30">{t("emailHealth.last50")}</span>
            </div>
            <div className="divide-y divide-base-300/20 max-h-96 overflow-y-auto">
              {data?.recentLogs.map((l, i) => {
                const acc = data.accounts.find(a => a.id === l.email_account_id);
                return (
                  <div key={i} className="px-5 py-2.5 flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs text-base-content/80">{l.message.replace("Email sent to ", "")}</div>
                      <div className="text-[10px] text-base-content/30 mt-0.5">{acc?.name ?? l.email_account_id.slice(0, 8)}</div>
                    </div>
                    <div className="text-[10px] text-base-content/30 whitespace-nowrap shrink-0">{formatDateTime(l.created_at, dateLocale)}</div>
                  </div>
                );
              })}
              {data?.recentLogs.length === 0 && (
                <div className="px-5 py-6 text-xs text-base-content/30 text-center">{t("emailHealth.noSendsRecorded")}</div>
              )}
            </div>
          </div>

          {/* Guard trips */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-xs overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
              <span className="text-sm font-medium text-base-content">{t("emailHealth.limitGuardTrips")}</span>
              <span className="ml-2 text-xs text-base-content/30">{t("emailHealth.badgeToday")}</span>
            </div>
            <div className="divide-y divide-base-300/20 max-h-96 overflow-y-auto">
              {data?.guardTrips.map((g, i) => {
                const acc = g.email_account_id ? data.accounts.find(a => a.id === g.email_account_id) : null;
                return (
                  <div key={i} className="px-5 py-2.5 flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs text-warning/80">{g.message.replace("Daily limit reached — ", "→ ")}</div>
                      {acc && <div className="text-[10px] text-base-content/30 mt-0.5">{acc.name}</div>}
                    </div>
                    <div className="text-[10px] text-base-content/30 whitespace-nowrap shrink-0">{formatDateTime(g.created_at, dateLocale)}</div>
                  </div>
                );
              })}
              {data?.guardTrips.length === 0 && (
                <div className="px-5 py-6 text-xs text-success/50 text-center">{t("emailHealth.noGuardTripsToday")}</div>
              )}
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
