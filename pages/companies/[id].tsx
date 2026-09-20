import Head from "next/head";
import Link from "next/link";
import { useState } from "react";
import { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiArrowLeftLine,
  RiExternalLinkLine,
  RiGlobalLine,
  RiMapPinLine,
  RiBuildingLine,
  RiLinkedinBoxLine,
  RiUserLine,
  RiMailLine,
  RiPhoneLine,
  RiMoneyDollarCircleLine,
  RiCalendarLine,
  RiGroupLine,
  RiCodeBoxLine,
  RiPriceTagLine,
  RiErrorWarningLine,
  RiEditLine,
} from "react-icons/ri";

interface Contact {
  id: string;
  full_name: string | null;
  title: string | null;
  email: string | null;
  email_status: string | null;
  seniority: string | null;
  linkedin_url: string | null;
  degree: number | null;
  connected_at: string | null;
  stage_id: string | null;
  stage_name: string | null;
  stage_color: string | null;
}

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  linkedin_url: string | null;
  website: string | null;
  description: string | null;
  employee_count: number | null;
  founded_year: number | null;
  annual_revenue: string | null;
  phone: string | null;
  technology_names: string | null;
  keywords: string | null;
  notes: string | null;
  email_domain_invalid: number | null;
  created_at: string;
  contacts: Contact[];
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session?.user) {
    return { redirect: { destination: "/login", permanent: false } };
  }

  const user = session.user as { id?: string; owner_id?: string | null; email?: string };
  const isSuperAdmin = user.email?.trim().toLowerCase() === "inhubflow@gmail.com";
  const workspaceOwnerId = user.owner_id ?? user.id ?? "";

  const db = getDb();
  const id = context.params?.id as string;

  const where = !isSuperAdmin
    ? "WHERE c.id = ? AND (c.workspace_owner_id = ? OR c.workspace_owner_id IS NULL)"
    : "WHERE c.id = ?";
  const params = !isSuperAdmin ? [id, workspaceOwnerId] : [id];

  const company = db.prepare(`
    SELECT c.id, c.name, c.domain, c.industry, c.location, c.city, c.country,
           c.linkedin_url, c.website, c.description, c.employee_count, c.founded_year,
           c.annual_revenue, c.phone, c.technology_names, c.keywords, c.notes,
           c.email_domain_invalid, c.created_at
    FROM companies c
    ${where}
  `).get(...params) as Company | undefined;

  if (!company) return { notFound: true };

  const contacts = db.prepare(`
    SELECT t.id, t.full_name, t.title, t.email, t.email_status, t.seniority,
           t.linkedin_url, t.degree, t.connected_at,
           ps.id as stage_id, ps.name as stage_name, ps.color as stage_color
    FROM targets t
    LEFT JOIN pipeline_stages ps ON ps.id = t.stage_id
    WHERE t.company_id = ?
    ORDER BY t.full_name COLLATE NOCASE
  `).all(id) as Contact[];

  return { props: { company: { ...company, contacts } } };
};

export default function CompanyDetailPage({ company: initialCompany }: { company: Company }) {
  const { t } = useTranslation();
  const [company, setCompany] = useState<Company>(initialCompany);
  const [showEdit, setShowEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: initialCompany.name,
    domain: initialCompany.domain ?? "",
    industry: initialCompany.industry ?? "",
    location: initialCompany.location ?? "",
    website: initialCompany.website ?? "",
    linkedin_url: initialCompany.linkedin_url ?? "",
    employee_count: initialCompany.employee_count ? String(initialCompany.employee_count) : "",
    annual_revenue: initialCompany.annual_revenue ?? "",
    notes: initialCompany.notes ?? "",
    description: initialCompany.description ?? "",
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/companies/${company.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          employee_count: editForm.employee_count ? parseInt(editForm.employee_count, 10) : null,
        }),
      });
      if (!res.ok) throw new Error("Error al actualizar empresa");
      const updated = await res.json();
      setCompany((prev) => ({ ...prev, ...updated }));
      toast.success(t("companies.companyUpdated"));
      setShowEdit(false);
    } catch {
      toast.error("Error al actualizar empresa");
    } finally {
      setSaving(false);
    }
  }

  let technologies: string[] = [];
  if (company.technology_names) {
    try {
      technologies = JSON.parse(company.technology_names);
    } catch {
      technologies = [];
    }
  }

  let keywords: string[] = [];
  if (company.keywords) {
    try {
      keywords = JSON.parse(company.keywords);
    } catch {
      keywords = [];
    }
  }

  return (
    <>
      <Head>
        <title>{company.name} — InHubFlow</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="max-w-4xl space-y-6">
        {/* Back Link */}
        <div className="flex items-center justify-between">
          <Link
            href="/companies"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
          >
            <RiArrowLeftLine size={16} />
            <span>{t("companies.backToList")}</span>
          </Link>

          <button
            onClick={() => setShowEdit(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors shadow-2xs"
          >
            <RiEditLine size={14} /> {t("common.edit")}
          </button>
        </div>

        {/* Company Header Card */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-start gap-4 flex-1">
              <div className="w-12 h-12 rounded-xl bg-brand-50 dark:bg-brand-950/50 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                <RiBuildingLine size={24} />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
                  {company.name}
                </h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {company.industry && (
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {company.industry}
                    </span>
                  )}
                  {company.location && (
                    <span className="flex items-center gap-1">
                      <RiMapPinLine size={13} className="text-gray-400" />
                      {company.location}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  {company.domain && (
                    <a
                      href={company.website || `https://${company.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:text-brand-600 transition-colors"
                    >
                      <RiGlobalLine size={12} className="text-gray-400" />
                      {company.domain}
                      <RiExternalLinkLine size={10} className="opacity-50" />
                    </a>
                  )}
                  {company.linkedin_url && (
                    <a
                      href={company.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400 hover:underline transition-colors"
                    >
                      <RiLinkedinBoxLine size={13} />
                      LinkedIn
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start shrink-0">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40">
                <RiUserLine size={12} />
                {company.contacts.length} {t("companies.columns.contacts")}
              </span>
            </div>
          </div>
        </div>

        {/* Email Domain Invalid Alert */}
        {Boolean(company.email_domain_invalid) && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-sm text-amber-800 dark:text-amber-200">
            <RiErrorWarningLine size={18} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold">Dominio marcado por rebotes de correo</p>
              <p className="text-xs mt-0.5 text-amber-700 dark:text-amber-300">
                Se detectó un rebote en este dominio. Para proteger tu entregabilidad, los envíos fríos por email a esta cuenta han sido deshabilitados.
              </p>
            </div>
          </div>
        )}

        {/* About / Description */}
        {company.description && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-2xs">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Acerca de la empresa
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
              {company.description}
            </p>
          </div>
        )}

        {/* Firmographics & Technographics */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-2xs space-y-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Datos Firmográficos & Tecnológicos
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {company.employee_count && (
              <div>
                <p className="text-[11px] text-gray-400 uppercase tracking-wide">Tamaño</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5 mt-0.5">
                  <RiGroupLine size={14} className="text-brand-500" />
                  {company.employee_count.toLocaleString()} empleados
                </p>
              </div>
            )}
            {company.founded_year && (
              <div>
                <p className="text-[11px] text-gray-400 uppercase tracking-wide">Fundación</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5 mt-0.5">
                  <RiCalendarLine size={14} className="text-brand-500" />
                  Año {company.founded_year}
                </p>
              </div>
            )}
            {company.annual_revenue && (
              <div>
                <p className="text-[11px] text-gray-400 uppercase tracking-wide">Facturación</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5 mt-0.5">
                  <RiMoneyDollarCircleLine size={14} className="text-brand-500" />
                  {company.annual_revenue}
                </p>
              </div>
            )}
            {company.phone && (
              <div>
                <p className="text-[11px] text-gray-400 uppercase tracking-wide">Teléfono</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5 mt-0.5">
                  <RiPhoneLine size={14} className="text-brand-500" />
                  {company.phone}
                </p>
              </div>
            )}
          </div>

          {technologies.length > 0 && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-1.5 mb-2">
                <RiCodeBoxLine size={14} className="text-purple-500" />
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                  {t("companies.techStack")} ({technologies.length})
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {technologies.map((tech) => (
                  <span
                    key={tech}
                    className="px-2 py-0.5 rounded-md text-xs font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          )}

          {keywords.length > 0 && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-1.5 mb-2">
                <RiPriceTagLine size={14} className="text-brand-500" />
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                  Palabras Clave / Enfoque
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {keywords.map((kw) => (
                  <span
                    key={kw}
                    className="px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        {company.notes && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-2xs">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              {t("companies.notes")}
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
              {company.notes}
            </p>
          </div>
        )}

        {/* Contacts Linked to Company */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Contactos Vinculados ({company.contacts.length})
            </p>
            <Link
              href="/pipeline"
              className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
            >
              {t("companies.viewPipeline")}
            </Link>
          </div>

          {company.contacts.length === 0 ? (
            <div className="p-8 text-center text-gray-400 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
              <RiUserLine size={32} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
              <p className="text-sm">No hay contactos vinculados a esta empresa aún.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {company.contacts.map((c) => (
                <div key={c.id} className="py-3 flex items-center justify-between gap-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 flex items-center justify-center font-bold text-xs shrink-0">
                      {c.full_name ? c.full_name.charAt(0).toUpperCase() : "U"}
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/contacts/${c.id}`}
                        className="text-sm font-semibold text-gray-900 dark:text-white hover:text-brand-600 transition-colors truncate block"
                      >
                        {c.full_name ?? "Sin nombre"}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {c.title && <span className="truncate">{c.title}</span>}
                        {c.seniority && (
                          <span className="px-1.5 py-0.2 rounded bg-gray-100 dark:bg-gray-800 text-[10px] uppercase font-medium">
                            {c.seniority}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {c.stage_name && (
                      <span
                        className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                        style={{
                          backgroundColor: `${c.stage_color || "#465fff"}15`,
                          color: c.stage_color || "#465fff",
                        }}
                      >
                        {c.stage_name}
                      </span>
                    )}

                    {c.degree === 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold">
                        1º
                      </span>
                    )}

                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        title={c.email}
                        className={
                          c.email_status === "invalid"
                            ? "text-red-400 hover:text-red-600"
                            : "text-emerald-500 hover:text-emerald-700"
                        }
                      >
                        <RiMailLine size={15} />
                      </a>
                    )}

                    {c.linkedin_url && (
                      <a
                        href={c.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-brand-600 transition-colors"
                        title="Ver perfil de LinkedIn"
                      >
                        <RiExternalLinkLine size={14} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Edit Modal */}
        {showEdit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-6 my-8">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-4">
                {t("common.edit")}: {company.name}
              </h3>
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("companies.companyName")}
                  </label>
                  <input
                    required
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      {t("companies.domain")}
                    </label>
                    <input
                      className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      value={editForm.domain}
                      onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      {t("companies.industry")}
                    </label>
                    <input
                      className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      value={editForm.industry}
                      onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      {t("companies.location")}
                    </label>
                    <input
                      className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      value={editForm.location}
                      onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      {t("companies.employees")}
                    </label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      value={editForm.employee_count}
                      onChange={(e) => setEditForm({ ...editForm, employee_count: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("companies.notes")}
                  </label>
                  <textarea
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none"
                    rows={3}
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  />
                </div>

                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    onClick={() => setShowEdit(false)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
                  >
                    {saving ? "Guardando..." : t("common.saveChanges")}
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
