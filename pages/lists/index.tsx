import Head from "next/head";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiCloseLine,
  RiCalendarLine,
  RiUserSearchLine,
  RiLinkedinBoxFill,
  RiDownloadLine,
  RiSparklingLine,
  RiInformationLine,
} from "react-icons/ri";

interface List {
  id: string;
  name: string;
  description: string | null;
  target_count: number;
  created_at: string;
  active_run_id: string | null;
  active_run_status: string | null;
  active_workflow_name: string | null;
}

interface Account {
  id: string;
  name: string;
  is_authenticated: number;
}

interface ImportJob {
  id: string;
  list_id: string;
  list_name?: string;
  status: string;
  phase: string | null;
  page: number;
  total_pages: number;
  count: number;
  total: number;
  imported: number;
  scheduled_for: string | null;
  start_page: number;
  batch_index: number;
  started_at: string;
  finished_at: string | null;
}

interface ListsPageProps {
  initialLists: List[];
  accounts: Account[];
  apolloConfigured: boolean;
}

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();
  const lists = db
    .prepare(
      `SELECT l.*, COUNT(lt.target_id) as target_count,
              ar.id as active_run_id,
              ar.status as active_run_status,
              w.name as active_workflow_name
       FROM lists l
       LEFT JOIN list_targets lt ON lt.list_id = l.id
       LEFT JOIN runs ar ON ar.list_id = l.id AND ar.status IN ('running', 'paused')
       LEFT JOIN workflows w ON w.id = ar.workflow_id
       GROUP BY l.id
       ORDER BY l.created_at DESC`
    )
    .all() as List[];
  const accounts = db
    .prepare("SELECT id, name, is_authenticated FROM accounts ORDER BY name ASC")
    .all() as Account[];
  const apolloConfigured = Boolean(process.env.APOLLO_API_KEY?.trim());
  return { props: { initialLists: lists, accounts, apolloConfigured } };
};

export default function ListsPage({ initialLists, accounts = [], apolloConfigured = false }: ListsPageProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [lists, setLists] = useState<List[]>(initialLists);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"sales_nav" | "empty">("sales_nav");
  const [form, setForm] = useState({ name: "", description: "" });
  const [salesNavForm, setSalesNavForm] = useState({
    name: "",
    sales_nav_url: "",
    account_id: accounts.find((a) => a.is_authenticated)?.id || accounts[0]?.id || "",
    enrich: true,
  });
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [dailyCap, setDailyCap] = useState(1500);
  const [importedToday, setImportedToday] = useState(0);
  const prevRunningRef = useRef(0);

  function openCreateModal(mode: "sales_nav" | "empty") {
    setModalMode(mode);
    setShowModal(true);
  }

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch("/api/imports");
        const data = await r.json();
        if (!alive) return;
        setJobs(data.jobs ?? []);
        setDailyCap(data.dailyCap ?? 1500);
        setImportedToday(data.importedToday ?? 0);
        // A batch just finished → refresh list counts
        const running = (data.jobs ?? []).filter((j: ImportJob) => j.status === "running").length;
        if (running < prevRunningRef.current) {
          fetch("/api/lists").then((lr) => lr.json()).then((d) => { if (alive) setLists(d); }).catch(() => {});
        }
        prevRunningRef.current = running;
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  async function cancelImport(id: string) {
    if (!confirm("Cancel this import? A running batch stops at its next page.")) return;
    await fetch(`/api/imports/${id}/cancel`, { method: "POST" });
    toast.success("Import canceled");
  }

  const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "scheduled");
  const runningByList: Record<string, ImportJob> = {};
  for (const j of jobs) if (j.status === "running") runningByList[j.list_id] = j;

  async function refresh() {
    const res = await fetch("/api/lists");
    setLists(await res.json());
  }

  async function createEmptyList(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) { toast.error("Failed to create list"); return; }
    toast.success(t("lists.listCreated"));
    setShowModal(false);
    setForm({ name: "", description: "" });
    refresh();
  }

  async function createSalesNavList(e: React.FormEvent) {
    e.preventDefault();
    if (!salesNavForm.sales_nav_url.trim()) {
      toast.error(t("lists.salesNavUrl") + " requerida");
      return;
    }
    if (!salesNavForm.account_id) {
      toast.error("Selecciona una cuenta de LinkedIn conectada");
      return;
    }

    setLoading(true);
    const listRes = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: salesNavForm.name.trim() || "Lista Sales Navigator",
        description: `Importación Sales Navigator: ${salesNavForm.sales_nav_url.slice(0, 100)}`,
      }),
    });

    if (!listRes.ok) {
      setLoading(false);
      toast.error("Error al crear la lista");
      return;
    }

    const newList = await listRes.json();

    const importRes = await fetch(`/api/lists/${newList.id}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sales_nav_url: salesNavForm.sales_nav_url.trim(),
        account_id: salesNavForm.account_id,
        enrich: apolloConfigured ? salesNavForm.enrich : false,
      }),
    });

    setLoading(false);
    if (!importRes.ok) {
      const err = await importRes.json();
      toast.error(err.error || "Error al iniciar importación de Sales Navigator");
      router.push(`/lists/${newList.id}`);
      return;
    }

    toast.success("¡Lista creada e importación de Sales Navigator iniciada!");
    setShowModal(false);
    setSalesNavForm({
      name: "",
      sales_nav_url: "",
      account_id: accounts.find((a) => a.is_authenticated)?.id || accounts[0]?.id || "",
      enrich: true,
    });
    router.push(`/lists/${newList.id}`);
  }

  async function deleteList(id: string) {
    if (!confirm(t("lists.deleteConfirm"))) return;
    await fetch(`/api/lists/${id}`, { method: "DELETE" });
    toast.success(t("lists.listDeleted"));
    setLists((prev) => prev.filter((l) => l.id !== id));
  }

  return (
    <>
      <Head>
        <title>Lists — Dashboard B2B</title>
        <meta name="description" content="Lead lists imported from LinkedIn Sales Navigator." />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div>
        {/* ── Top Header Banner (Lead Finder Style) ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl mb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              {t("lists.title")}
            </h1>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("lists.subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Link
            href="/lead-finder"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
          >
            <RiUserSearchLine size={16} /> {t("nav.leadFinder")}
          </Link>
          <button
            onClick={() => openCreateModal("sales_nav")}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border border-blue-300 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all shadow-xs"
            title={t("lists.importSalesNavDesc")}
          >
            <RiLinkedinBoxFill size={17} className="text-[#0A66C2]" />
            <span>{t("lists.importSalesNavShort") || "Sales Navigator"}</span>
          </button>
          <button
            data-tour="lists-new"
            onClick={() => openCreateModal("empty")}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs"
          >
            <RiAddLine size={16} /> {t("lists.newList")}
          </button>
        </div>
      </div>

      {/* Import jobs panel */}
      {activeJobs.length > 0 && (
        <div className="mb-6 rounded-2xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-xs" data-tour="lists-jobs">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t("lists.importJobs")}</h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t("lists.contactsImportedToday", { current: importedToday, max: dailyCap })}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {activeJobs.map((j) => {
              const pct = j.total > 0 ? Math.round((j.count / j.total) * 100) : 0;
              const scheduled = j.status === "scheduled";
              return (
                <div key={j.id} className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/50 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate text-gray-900 dark:text-white">{j.list_name ?? "—"}</span>
                      {j.batch_index > 1 && (
                        <span className="text-xs text-gray-400">{t("lists.batch", { index: j.batch_index })}</span>
                      )}
                      {scheduled ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-warning/15 text-warning border border-warning/20">
                          <RiCalendarLine size={11} /> {t("lists.scheduled", { date: j.scheduled_for ?? "" })}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-info/15 text-info border border-info/20">
                          <span className="loading loading-spinner" style={{ width: 9, height: 9 }} /> {t("lists.scraping", { pct })}
                        </span>
                      )}
                    </div>
                    {!scheduled && (
                      <div className="mt-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-brand-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {scheduled
                        ? `Resumes at page ${j.start_page} — capped at ${dailyCap}/day`
                        : `${j.count} / ${j.total}`}
                    </span>
                  </div>
                  <button
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors shrink-0"
                    onClick={() => cancelImport(j.id)}
                  >
                    <RiCloseLine size={12} /> {t("common.cancel")}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lists.length === 0 ? (
        <div className="text-center py-14 px-4 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30">
          <div className="inline-flex p-3 rounded-2xl bg-brand-500/10 text-brand-500 dark:bg-brand-500/20 mb-3 border border-brand-500/20">
            <RiUserSearchLine size={28} />
          </div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
            {t("lists.noLists")}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
            Crea listas importando desde LinkedIn Sales Navigator, usando el buscador de Lead Finder o subiendo un archivo CSV.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => openCreateModal("sales_nav")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-[#0A66C2] hover:bg-[#004182] !text-white shadow-xs transition-all"
            >
              <RiLinkedinBoxFill size={18} />
              {t("lists.importSalesNav")}
            </button>
            <Link
              href="/lead-finder"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-medium bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 shadow-xs transition-all"
            >
              <RiUserSearchLine size={16} />
              {t("nav.leadFinder")}
            </Link>
            <button
              onClick={() => openCreateModal("empty")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200/50 dark:hover:bg-gray-800 transition-all border border-transparent hover:border-gray-300 dark:hover:border-gray-700"
            >
              <RiAddLine size={16} />
              {t("lists.newList")}
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-theme-xs">
          <table className="table w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
                <th>{t("common.name")}</th>
                <th>{t("nav.contacts")}</th>
                <th>{t("nav.campaigns")}</th>
                <th>{t("common.import")}</th>
                <th>{t("common.status")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {lists.map((l) => (
                <tr
                  key={l.id}
                  className="hover:bg-gray-50/80 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/lists/${l.id}`)}
                >
                  <td>
                    <span className="font-semibold text-gray-900 dark:text-white">{l.name}</span>
                    {l.description && (
                      <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{l.description}</p>
                    )}
                  </td>
                  <td>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                      {l.target_count === 1 ? t("lists.leadsCount", { count: 1 }) : t("lists.leadsCountPlural", { count: l.target_count })}
                    </span>
                  </td>
                  <td>
                    {l.active_run_id ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${l.active_run_status === 'running' ? 'bg-success animate-pulse' : 'bg-warning'}`} />
                        {l.active_workflow_name ?? t("common.active")}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="min-w-35">
                    {runningByList[l.id] ? (() => {
                      const job = runningByList[l.id];
                      const pct = job.total > 0 ? Math.round((job.count / job.total) * 100) : 0;
                      const label = job.phase === 'visiting' ? 'Visiting' : job.phase === 'enriching' ? 'Resolving' : 'Scraping';
                      return (
                        <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <span className="loading loading-spinner loading-xs text-primary" style={{ width: 10, height: 10 }} />
                            <span className="text-xs text-primary font-medium">{label} {pct}%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-brand-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-400">{job.count} / {job.total}</span>
                        </div>
                      );
                    })() : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="text-gray-500 dark:text-gray-400 text-xs">
                    {new Date(l.created_at).toLocaleDateString()}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                        onClick={() => deleteList(l.id)}
                      >
                        <RiDeleteBinLine size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xl max-w-lg p-6">
            {/* Modal Header with Tabs */}
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setModalMode("sales_nav")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    modalMode === "sales_nav"
                      ? "bg-[#0A66C2] text-white shadow-xs"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  <RiLinkedinBoxFill size={16} />
                  <span>{t("lists.tabSalesNav")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalMode("empty")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    modalMode === "empty"
                      ? "bg-brand-500 text-white shadow-xs"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  <RiAddLine size={15} />
                  <span>{t("lists.tabEmptyList")}</span>
                </button>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-circle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                onClick={() => setShowModal(false)}
              >
                <RiCloseLine size={16} />
              </button>
            </div>

            {/* Mode 1: Sales Navigator Import Form */}
            {modalMode === "sales_nav" && (
              <form onSubmit={createSalesNavList} className="flex flex-col gap-3.5">
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/80 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2.5">
                  <RiInformationLine size={18} className="text-[#0A66C2] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block mb-0.5">Integración Directa con LinkedIn Sales Navigator</span>
                    {t("lists.importSalesNavDesc")} La extracción se realiza en segundo plano con intervalos humanos para proteger tu cuenta de LinkedIn.
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                    {t("common.name")} de la Lista <span className="text-brand-500">*</span>
                  </label>
                  <input
                    className="w-full rounded-xl border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-700 px-3.5 py-2 text-xs text-gray-900 dark:text-gray-100 shadow-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    placeholder="ej: Directores de Operaciones LatAm - Sales Nav"
                    value={salesNavForm.name}
                    onChange={(e) => setSalesNavForm({ ...salesNavForm, name: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                    {t("lists.salesNavUrl")} <span className="text-brand-500">*</span>
                  </label>
                  <input
                    className="w-full rounded-xl border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-700 px-3.5 py-2 font-mono text-xs text-gray-900 dark:text-gray-100 shadow-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    placeholder="https://www.linkedin.com/sales/lists/people/... o /sales/search/people?..."
                    value={salesNavForm.sales_nav_url}
                    onChange={(e) => setSalesNavForm({ ...salesNavForm, sales_nav_url: e.target.value })}
                    required
                  />
                  <span className="text-[11px] text-gray-400 mt-1 block">
                    Pega la URL de una lista de personas guardada o una búsqueda de Sales Navigator.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                    {t("lists.accountToUse")} <span className="text-brand-500">*</span>
                  </label>
                  {accounts.length === 0 || !accounts.some((a) => a.is_authenticated) ? (
                    <div className="p-2.5 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning">
                      ⚠️ {t("lists.noAuthAccountsAlert")}{" "}
                      <Link href="/settings" className="underline font-semibold ml-1">
                        Ir a Cuentas →
                      </Link>
                    </div>
                  ) : (
                    <select
                      className="w-full rounded-xl border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-700 px-3 py-2 text-xs text-gray-900 dark:text-gray-100 shadow-xs cursor-pointer focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                      value={salesNavForm.account_id}
                      onChange={(e) => setSalesNavForm({ ...salesNavForm, account_id: e.target.value })}
                      required
                    >
                      <option value="">{t("lists.selectAccount")}</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id} disabled={!a.is_authenticated}>
                          {a.name} {!a.is_authenticated ? `(${t("lists.notAuthenticated")})` : "✓ Autenticada"}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {apolloConfigured && (
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300 pt-1">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs checkbox-primary"
                      checked={salesNavForm.enrich}
                      onChange={(e) => setSalesNavForm({ ...salesNavForm, enrich: e.target.checked })}
                    />
                    <RiSparklingLine size={14} className="text-brand-500" />
                    <span>{t("lists.enrichWithApollo")}</span>
                  </label>
                )}

                <div className="modal-action mt-2 pt-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-gray-600 dark:text-gray-400"
                    onClick={() => setShowModal(false)}
                    disabled={loading}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-[#0A66C2] hover:bg-[#004182] !text-white shadow-xs transition-colors disabled:opacity-50"
                    disabled={loading || !accounts.some((a) => a.is_authenticated)}
                  >
                    {loading ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <>
                        <RiDownloadLine size={15} />
                        {t("lists.createAndImport")}
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* Mode 2: Empty / Manual List Form */}
            {modalMode === "empty" && (
              <form onSubmit={createEmptyList} className="flex flex-col gap-3.5">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                    {t("common.name")} de la Lista <span className="text-brand-500">*</span>
                  </label>
                  <input
                    className="w-full rounded-xl border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-700 px-3.5 py-2 text-xs text-gray-900 dark:text-gray-100 shadow-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    placeholder={t("lists.namePlaceholder")}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                    {t("common.description")} ({t("common.optional")})
                  </label>
                  <input
                    className="w-full rounded-xl border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-700 px-3.5 py-2 text-xs text-gray-900 dark:text-gray-100 shadow-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    placeholder={t("lists.descPlaceholder")}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
                <div className="modal-action mt-2 pt-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-gray-600 dark:text-gray-400"
                    onClick={() => setShowModal(false)}
                    disabled={loading}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white shadow-xs transition-colors disabled:opacity-50"
                    disabled={loading}
                  >
                    {loading ? <span className="loading loading-spinner loading-xs" /> : t("lists.createList")}
                  </button>
                </div>
              </form>
            )}
          </div>
          <div className="modal-backdrop" onClick={() => !loading && setShowModal(false)} />
        </div>
      )}
    </div>
    </>
  );
}
