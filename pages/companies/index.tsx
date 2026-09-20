import Head from "next/head";
import { useState, useMemo } from "react";
import { GetServerSideProps } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiBuildingLine,
  RiGlobalLine,
  RiRefreshLine,
  RiGroupLine,
  RiPriceTagLine,
  RiSearchLine,
  RiExternalLinkLine,
  RiCodeBoxLine,
} from "react-icons/ri";

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  linkedin_url: string | null;
  website: string | null;
  notes: string | null;
  employee_count: number | null;
  technology_names: string | null;
  contact_count: number;
  created_at: string;
}

interface CompanyStats {
  total: number;
  withContacts: number;
  uniqueIndustries: number;
}

const BLANK_FORM = {
  name: "",
  domain: "",
  industry: "",
  location: "",
  linkedin_url: "",
  website: "",
  employee_count: "",
  notes: "",
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session?.user) {
    return { redirect: { destination: "/login", permanent: false } };
  }

  const user = session.user as { id?: string; owner_id?: string | null; email?: string };
  const isSuperAdmin = user.email?.trim().toLowerCase() === "inhubflow@gmail.com";
  const workspaceOwnerId = user.owner_id ?? user.id ?? "";

  const db = getDb();
  const where = !isSuperAdmin ? "WHERE (c.workspace_owner_id = ? OR c.workspace_owner_id IS NULL)" : "";
  const params = !isSuperAdmin ? [workspaceOwnerId] : [];

  const companies = db.prepare(`
    SELECT c.id, c.name, c.domain, c.industry, c.location, c.linkedin_url,
           c.website, c.notes, c.employee_count, c.technology_names, c.created_at,
           COUNT(t.id) as contact_count
    FROM companies c
    LEFT JOIN targets t ON t.company_id = c.id
    ${where}
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE
  `).all(...params) as Company[];

  const total = companies.length;
  const withContacts = companies.filter((c) => c.contact_count > 0).length;
  const uniqueIndustries = new Set(companies.map((c) => c.industry).filter(Boolean)).size;

  return {
    props: {
      initialCompanies: companies,
      stats: { total, withContacts, uniqueIndustries },
    },
  };
};

export default function CompaniesPage({
  initialCompanies,
  stats: initialStats,
}: {
  initialCompanies: Company[];
  stats: CompanyStats;
}) {
  const { t } = useTranslation();
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState<string>("all");

  async function refresh() {
    try {
      const res = await fetch("/api/companies?full=1");
      const data = await res.json();
      if (data.companies) {
        setCompanies(data.companies);
      }
    } catch {
      // Ignore background fetch error
    }
  }

  async function handleSyncContacts() {
    setSyncing(true);
    try {
      const res = await fetch("/api/companies/backfill", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al sincronizar");
      toast.success(
        t("companies.syncSuccess", {
          linked: data.linkedCount,
          created: data.createdCompanies,
        }) || `Sincronizados ${data.linkedCount} contactos (${data.createdCompanies} empresas creadas)`
      );
      await refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al sincronizar empresas");
    } finally {
      setSyncing(false);
    }
  }

  function openCreate() {
    setEditId(null);
    setForm(BLANK_FORM);
    setShowModal(true);
  }

  function openEdit(c: Company) {
    setEditId(c.id);
    setForm({
      name: c.name,
      domain: c.domain ?? "",
      industry: c.industry ?? "",
      location: c.location ?? "",
      linkedin_url: c.linkedin_url ?? "",
      website: c.website ?? "",
      employee_count: c.employee_count ? String(c.employee_count) : "",
      notes: c.notes ?? "",
    });
    setShowModal(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const body = {
      name: form.name.trim(),
      domain: form.domain.trim() || null,
      industry: form.industry.trim() || null,
      location: form.location.trim() || null,
      linkedin_url: form.linkedin_url.trim() || null,
      website: form.website.trim() || null,
      employee_count: form.employee_count ? parseInt(form.employee_count, 10) : null,
      notes: form.notes.trim() || null,
    };
    try {
      const res = editId
        ? await fetch(`/api/companies/${editId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/companies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      setLoading(false);
      if (!res.ok) {
        const errorData = await res.json();
        toast.error(errorData.error ?? "Error al guardar empresa");
        return;
      }
      toast.success(editId ? t("companies.companyUpdated") : t("companies.companyCreated"));
      setShowModal(false);
      refresh();
    } catch {
      setLoading(false);
      toast.error("Error de conexión al guardar empresa");
    }
  }

  async function deleteCompany(id: string) {
    if (!confirm(t("companies.deleteConfirm"))) return;
    try {
      await fetch(`/api/companies/${id}`, { method: "DELETE" });
      toast.success(t("companies.companyDeleted"));
      setCompanies((prev) => prev.filter((c) => c.id !== id));
    } catch {
      toast.error("Error al eliminar empresa");
    }
  }

  const industries = useMemo(() => {
    const list = Array.from(new Set(companies.map((c) => c.industry).filter(Boolean))) as string[];
    return list.sort();
  }, [companies]);

  const filtered = useMemo(() => {
    return companies.filter((c) => {
      const matchesSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.domain ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (c.industry ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (c.technology_names ?? "").toLowerCase().includes(search.toLowerCase());

      const matchesIndustry = selectedIndustry === "all" || c.industry === selectedIndustry;

      return matchesSearch && matchesIndustry;
    });
  }, [companies, search, selectedIndustry]);

  const stats = useMemo(() => {
    return {
      total: companies.length,
      withContacts: companies.filter((c) => c.contact_count > 0).length,
      uniqueIndustries: industries.length,
    };
  }, [companies, industries]);

  return (
    <>
      <Head>
        <title>{t("companies.title")} — InHubFlow</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="space-y-6">
        {/* Top Banner Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                {t("companies.title")}
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/15 text-brand-600 dark:text-brand-400">
                {companies.length}{" "}
                {companies.length === 1
                  ? t("companies.companiesCount", { count: 1 })
                  : t("companies.companiesCountPlural", { count: companies.length })}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("companies.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <button
              onClick={handleSyncContacts}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors shadow-2xs disabled:opacity-50"
              title="Vincular automáticamente contactos huérfanos con empresas"
            >
              <RiRefreshLine size={15} className={syncing ? "animate-spin text-brand-500" : ""} />
              {syncing ? t("companies.syncing") : t("companies.syncContacts")}
            </button>

            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white transition-all shadow-xs"
            >
              <RiAddLine size={16} /> {t("companies.addCompany")}
            </button>
          </div>
        </div>

        {/* Stats Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 shadow-2xs flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-950/50 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0">
              <RiBuildingLine size={20} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {t("companies.statTotal")}
              </p>
              <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{stats.total}</p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 shadow-2xs flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <RiGroupLine size={20} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {t("companies.statWithContacts")}
              </p>
              <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{stats.withContacts}</p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 shadow-2xs flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-950/50 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
              <RiPriceTagLine size={20} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {t("companies.statIndustries")}
              </p>
              <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{stats.uniqueIndustries}</p>
            </div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <RiSearchLine size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-brand-500 transition-all shadow-2xs"
              placeholder={t("companies.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {industries.length > 0 && (
            <div className="shrink-0">
              <select
                value={selectedIndustry}
                onChange={(e) => setSelectedIndustry(e.target.value)}
                className="w-full sm:w-auto px-3 py-2 rounded-xl text-xs md:text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-hidden focus:ring-2 focus:ring-brand-500 shadow-2xs"
              >
                <option value="all">{t("companies.filterIndustry")}</option>
                {industries.map((ind) => (
                  <option key={ind} value={ind}>
                    {ind}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Companies Table */}
        {filtered.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-12 text-center text-gray-400 shadow-2xs">
            <RiBuildingLine size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
              {search || selectedIndustry !== "all"
                ? t("companies.noCompaniesMatching")
                : t("companies.noCompanies")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xs">
            <table className="table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide bg-gray-50/50 dark:bg-gray-800/30">
                  <th className="py-3 px-4 text-left">{t("companies.columns.name")}</th>
                  <th className="py-3 px-4 text-left">{t("companies.columns.domain")}</th>
                  <th className="py-3 px-4 text-left">{t("companies.columns.industry")}</th>
                  <th className="py-3 px-4 text-left">{t("companies.employees")}</th>
                  <th className="py-3 px-4 text-left">{t("companies.techStack")}</th>
                  <th className="py-3 px-4 text-center">{t("companies.columns.contacts")}</th>
                  <th className="py-3 px-4 text-right">{t("companies.columns.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.map((c) => {
                  let technologies: string[] = [];
                  if (c.technology_names) {
                    try {
                      technologies = JSON.parse(c.technology_names);
                    } catch {
                      technologies = [];
                    }
                  }

                  return (
                    <tr key={c.id} className="hover:bg-gray-50/70 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <span className="w-8 h-8 rounded-lg bg-brand-50 dark:bg-brand-950/50 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0">
                            <RiBuildingLine size={16} />
                          </span>
                          <div className="min-w-0">
                            <Link
                              href={`/companies/${c.id}`}
                              className="font-semibold text-gray-900 dark:text-white hover:text-brand-600 dark:hover:text-brand-400 transition-colors cursor-pointer truncate block"
                            >
                              {c.name}
                            </Link>
                            {c.location && (
                              <p className="text-[11px] text-gray-400 truncate">{c.location}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-xs text-gray-500 dark:text-gray-400">
                        {c.domain ? (
                          <a
                            href={c.website || `https://${c.domain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-300 hover:text-brand-600 transition-colors"
                          >
                            <RiGlobalLine size={12} className="text-gray-400" />
                            <span>{c.domain}</span>
                            <RiExternalLinkLine size={10} className="opacity-50" />
                          </a>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-xs text-gray-600 dark:text-gray-300">
                        {c.industry ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                            {c.industry}
                          </span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-xs text-gray-600 dark:text-gray-300">
                        {c.employee_count ? (
                          <span className="inline-flex items-center gap-1 font-medium">
                            <RiGroupLine size={12} className="text-gray-400" />
                            {c.employee_count.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-xs">
                        {technologies.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {technologies.slice(0, 2).map((tech) => (
                              <span
                                key={tech}
                                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 truncate"
                              >
                                {tech}
                              </span>
                            ))}
                            {technologies.length > 2 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500">
                                +{technologies.length - 2}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <Link
                          href={`/companies/${c.id}`}
                          className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            c.contact_count > 0
                              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:underline"
                              : "bg-gray-100 dark:bg-gray-800 text-gray-400"
                          }`}
                        >
                          {c.contact_count}
                        </Link>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/companies/${c.id}`}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            title="Ver Ficha ABM"
                          >
                            <RiExternalLinkLine size={15} />
                          </Link>
                          <button
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-xs"
                            onClick={() => openEdit(c)}
                            title={t("common.edit")}
                          >
                            {t("common.edit")}
                          </button>
                          <button
                            className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            onClick={() => deleteCompany(c.id)}
                            title={t("common.delete")}
                          >
                            <RiDeleteBinLine size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Create / Edit Company Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-6 my-8">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-4">
                {editId ? t("common.edit") : t("companies.addCompany")}
              </h3>
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("companies.companyName")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 shadow-2xs"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej. Acme Corp"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      {t("companies.domain")}
                    </label>
                    <input
                      className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 shadow-2xs"
                      value={form.domain}
                      onChange={(e) => setForm({ ...form, domain: e.target.value })}
                      placeholder="acme.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      {t("companies.industry")}
                    </label>
                    <input
                      className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 shadow-2xs"
                      value={form.industry}
                      onChange={(e) => setForm({ ...form, industry: e.target.value })}
                      placeholder="SaaS / Software"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      {t("companies.location")}
                    </label>
                    <input
                      className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 shadow-2xs"
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
                      placeholder="Santiago, Chile"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      {t("companies.employees")}
                    </label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 shadow-2xs"
                      value={form.employee_count}
                      onChange={(e) => setForm({ ...form, employee_count: e.target.value })}
                      placeholder="50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      Website
                    </label>
                    <input
                      className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 shadow-2xs"
                      value={form.website}
                      onChange={(e) => setForm({ ...form, website: e.target.value })}
                      placeholder="https://acme.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      {t("companies.linkedinUrl")}
                    </label>
                    <input
                      className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 shadow-2xs"
                      value={form.linkedin_url}
                      onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })}
                      placeholder="https://linkedin.com/company/acme"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("companies.notes")}
                  </label>
                  <textarea
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-brand-500 shadow-2xs resize-none"
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Notas internas de la cuenta..."
                  />
                </div>

                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    onClick={() => setShowModal(false)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white transition-colors shadow-xs disabled:opacity-50"
                  >
                    {loading ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : editId ? (
                      t("common.saveChanges")
                    ) : (
                      t("companies.addCompany")
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
