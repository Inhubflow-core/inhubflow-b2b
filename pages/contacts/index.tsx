import Head from "next/head";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiExternalLinkLine, RiArrowLeftSLine, RiArrowRightSLine,
  RiUserFollowLine, RiUserAddLine, RiUserLine, RiUserSearchLine,
  RiMessage2Line, RiReplyLine, RiMailCheckLine, RiAtLine, RiMailLine,
  RiSearchLine, RiAddLine, RiListCheck2, RiDeleteBinLine, RiKanbanView,
} from "react-icons/ri";
import FilterBar, { ActiveFilter, filtersToParams } from "@/components/ui/FilterBar";
import ProspectAvatar from "@/components/ui/ProspectAvatar";

const PAGE_SIZE = 50;

interface Contact {
  id: string;
  linkedin_url: string | null;
  full_name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  email_status: string | null;
  phone: string | null;
  degree: number | null;
  connection_requested_at: string | null;
  connected_at: string | null;
  message_sent_at: string | null;
  last_replied_at: string | null;
  apollo_enriched_at: string | null;
  seniority: string | null;
  profile_image_url?: string | null;
  created_at: string;
}

interface ListOption {
  id: string;
  name: string;
  target_count: number;
}

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();
  const lists = db
    .prepare(
      `SELECT l.id, l.name, COUNT(lt.target_id) as target_count
       FROM lists l
       LEFT JOIN list_targets lt ON lt.list_id = l.id
       GROUP BY l.id
       ORDER BY l.name ASC`
    )
    .all() as ListOption[];
  const total = (
    db
      .prepare("SELECT COUNT(*) as c FROM targets t WHERE EXISTS (SELECT 1 FROM list_targets lt WHERE lt.target_id = t.id)")
      .get() as { c: number }
  ).c;
  return { props: { lists, total } };
};

function ConnectionIcon({ t }: { t: Contact }) {
  if (t.degree === 1) {
    return <span title="Connected" className="text-success"><RiUserFollowLine size={14} /></span>;
  }
  if (t.connection_requested_at) {
    return <span title="Request sent" className="text-warning"><RiUserAddLine size={14} /></span>;
  }
  return (
    <span title={t.degree === 2 ? "2nd degree" : t.degree === 3 ? "3rd degree" : "Not connected"} className="text-base-content/20">
      <RiUserLine size={14} />
    </span>
  );
}

export default function ContactsPage({ lists, total: initialTotal }: { lists: ListOption[]; total: number }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0);
  const [listId, setListId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showNewContact, setShowNewContact] = useState(false);
  const [newContactForm, setNewContactForm] = useState({ full_name: "", linkedin_url: "", title: "", company: "", location: "", email: "", phone: "", list_id: "" });
  const [newContactLoading, setNewContactLoading] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAddToList, setShowAddToList] = useState(false);
  const [addToListId, setAddToListId] = useState("");
  const [addToListLoading, setAddToListLoading] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const fetch_ = useCallback(async (p: number, lid: string, q: string, activeFilters: ActiveFilter[]) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
    if (lid) params.set("list_id", lid);
    if (q) params.set("search", q);
    const filterParams = filtersToParams(activeFilters);
    filterParams.forEach((v, k) => params.set(k, v));
    const res = await fetch(`/api/targets?${params}`);
    if (res.ok) {
      const data = await res.json();
      setContacts(data.contacts);
      setTotal(data.total);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch_(page, listId, debouncedSearch, filters);
    setSelected(new Set());
  }, [page, listId, debouncedSearch, filters, fetch_]);

  // Auto-sync photos for contacts that have linkedin_url but missing profile_image_url
  useEffect(() => {
    const missing = contacts
      .filter((c) => (!c.profile_image_url || c.profile_image_url.trim() === "") && Boolean(c.linkedin_url))
      .slice(0, 15);

    if (missing.length === 0) return;

    fetch("/api/targets/sync-photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ids: missing.map((c) => c.id) }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.updated && Object.keys(data.updated).length > 0) {
          setContacts((prev) =>
            prev.map((c) =>
              data.updated[c.id] ? { ...c, profile_image_url: data.updated[c.id] } : c
            )
          );
        }
      })
      .catch(() => {});
  }, [contacts]);

  function changeList(lid: string) { setListId(lid); setPage(0); }
  function changeSearch(q: string) { setSearch(q); setPage(0); }
  function changeFilters(f: ActiveFilter[]) { setFilters(f); setPage(0); }

  const allPageSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  function toggleAll() {
    if (allPageSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(contacts.map((c) => c.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function addSelectedToList() {
    if (!addToListId || selected.size === 0) return;
    setAddToListLoading(true);
    const res = await fetch(`/api/lists/${addToListId}/add-members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ids: Array.from(selected) }),
    });
    setAddToListLoading(false);
    if (res.ok) {
      toast.success("Added to list");
      setShowAddToList(false);
      setSelected(new Set());
    } else {
      toast.error("Failed to add to list");
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    setDeleteLoading(true);
    const res = await fetch("/api/targets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected), target_ids: Array.from(selected) }),
    });
    setDeleteLoading(false);
    if (res.ok) {
      const data = await res.json();
      toast.success(t("contacts.deletedCount", { count: data.deleted }));
      setShowDeleteConfirm(false);
      setSelected(new Set());
      fetch_(page, listId, debouncedSearch, filters);
    } else {
      toast.error("Failed to delete contacts");
    }
  }

  async function createContact(e: React.FormEvent) {
    e.preventDefault();
    setNewContactLoading(true);
    const res = await fetch("/api/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newContactForm),
    });
    setNewContactLoading(false);
    if (!res.ok) {
      const d = await res.json();
      toast.error(d.error || "Failed to create contact");
      return;
    }
    toast.success(t("contacts.contactCreated"));
    setShowNewContact(false);
    setNewContactForm({ full_name: "", linkedin_url: "", title: "", company: "", location: "", email: "", phone: "", list_id: "" });
    fetch_(0, listId, debouncedSearch, filters);
    setPage(0);
  }

  const hasActiveFilters = filters.length > 0 || listId || search;

  return (
    <>
      <Head>
        <title>Contacts — Dashboard B2B</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div>
        {/* ── Top Header Banner (Lead Finder Style) ── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl mb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                {t("contacts.title")}
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/15 text-brand-600 dark:text-brand-400">
                {total === 1 ? t("contacts.contactsCount", { count: 1 }) : t("contacts.contactsCountPlural", { count: total.toLocaleString() })}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("contacts.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* View Switcher: Table vs Kanban */}
            <div className="join border border-gray-300 dark:border-gray-700 rounded-xl p-0.5 bg-gray-100 dark:bg-gray-800">
              <button
                type="button"
                className="join-item btn btn-xs btn-primary gap-1 font-semibold rounded-lg"
                title="Vista actual: Tabla"
              >
                <RiListCheck2 size={13} />
                Tabla
              </button>
              <Link
                href="/pipeline"
                className="join-item btn btn-xs btn-ghost gap-1 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-lg"
                title="Ir al Tablero Kanban"
              >
                <RiKanbanView size={13} />
                Kanban
              </Link>
            </div>

            <Link
              href="/lead-finder"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
            >
              <RiUserSearchLine size={16} /> {t("nav.leadFinder")}
            </Link>
            <button
              onClick={() => setShowNewContact(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs"
            >
              <RiAddLine size={16} /> {t("contacts.newContact")}
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-3 mb-5 flex-wrap" data-tour="contacts-filters">
          {/* Search */}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
              <RiSearchLine size={14} />
            </span>
            <input
              type="text"
              className="w-56 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl pl-8 pr-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 shadow-xs"
              placeholder={t("contacts.searchPlaceholder")}
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
            />
          </div>

          {/* List selector */}
          <select
            className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-brand-500 shadow-xs h-9 cursor-pointer"
            value={listId}
            onChange={(e) => changeList(e.target.value)}
          >
            <option value="">{t("contacts.allLists")}</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.target_count})
              </option>
            ))}
          </select>

          {/* Divider */}
          <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

          {/* FilterBar */}
          <FilterBar filters={filters} onChange={changeFilters} />
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 mb-3 px-3.5 py-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex-1">{selected.size} selected</span>
            <button
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 transition-colors"
              onClick={() => setShowAddToList(true)}
            >
              <RiListCheck2 size={13} /> Add to list
            </button>
            <button
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <RiDeleteBinLine size={13} /> {t("common.delete")}
            </button>
            <button
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              onClick={() => setSelected(new Set())}
            >
              {t("common.clear")}
            </button>
          </div>
        )}

        {/* Table */}
        {loading && contacts.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-base-content/30 text-sm gap-2">
            <span className="loading loading-spinner loading-sm" /> {t("common.loading")}
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-20 text-base-content/30 text-sm">
            {hasActiveFilters ? t("contacts.noContactsMatching") : t("contacts.noContacts")}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-theme-xs">
              <table className="table w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
                    <th className="w-8" data-tour="contacts-select">
                      <input type="checkbox" className="w-3.5 h-3.5 rounded border border-gray-300 dark:border-gray-600 accent-brand-500 cursor-pointer" checked={allPageSelected} onChange={toggleAll} />
                    </th>
                    <th>{t("contacts.columns.name")}</th>
                    <th>{t("contacts.columns.title")}</th>
                    <th>{t("contacts.columns.company")}</th>
                    <th>{t("contacts.columns.location")}</th>
                    <th>{t("contacts.columns.email")}</th>
                    <th className="w-24">{t("contacts.columns.signals")}</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {contacts.map((c) => (
                    <tr
                      key={c.id}
                      className={`hover:bg-gray-50/80 dark:hover:bg-gray-800/50 cursor-pointer transition-colors ${selected.has(c.id) ? "bg-brand-50/50 dark:bg-brand-950/20" : ""}`}
                      onClick={() => router.push(`/contacts/${c.id}`)}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 rounded border border-gray-300 dark:border-gray-600 accent-brand-500 cursor-pointer"
                          checked={selected.has(c.id)}
                          onChange={() => toggleOne(c.id)}
                        />
                      </td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <ProspectAvatar
                            imageUrl={c.profile_image_url}
                            name={c.full_name}
                            size="sm"
                          />
                          <span className="font-semibold text-gray-900 dark:text-white truncate max-w-36">{c.full_name ?? "—"}</span>
                        </div>
                      </td>
                      <td className="text-gray-600 dark:text-gray-300 max-w-44 truncate">{c.title ?? "—"}</td>
                      <td className="text-gray-600 dark:text-gray-300 truncate max-w-36">{c.company ?? "—"}</td>
                      <td className="text-gray-400 text-xs truncate max-w-32">{c.location ?? "—"}</td>
                      <td className="text-gray-600 dark:text-gray-300 text-xs font-mono truncate max-w-40">{c.email ?? <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <ConnectionIcon t={c} />
                          {c.message_sent_at && (
                            <span title="LinkedIn message sent" className="text-info"><RiMessage2Line size={13} /></span>
                          )}
                          {c.last_replied_at && (
                            <span title="Replied" className="text-success"><RiReplyLine size={13} /></span>
                          )}
                          {c.email && c.email_status === "verified" && (
                            <span title="Verified email" className="text-success"><RiMailCheckLine size={13} /></span>
                          )}
                          {c.email && c.email_status !== "verified" && (
                            <span title={`Email (${c.email_status ?? "unverified"})`} className="text-warning"><RiAtLine size={13} /></span>
                          )}
                          {c.apollo_enriched_at && !c.email && (
                            <span title="Apollo enriched — no email" className="text-base-content/20"><RiMailLine size={13} /></span>
                          )}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {c.linkedin_url && (
                          <a
                            href={c.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center p-1 rounded text-gray-400 hover:text-brand-500 transition-colors"
                          >
                            <RiExternalLinkLine size={13} />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 text-sm text-base-content/50">
                <span>
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    className="inline-flex items-center justify-center w-6 h-6 rounded text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => setPage((p) => p - 1)}
                    disabled={page === 0 || loading}
                  >
                    <RiArrowLeftSLine size={15} />
                  </button>
                  <span className="px-2">{page + 1} / {totalPages}</span>
                  <button
                    className="inline-flex items-center justify-center w-6 h-6 rounded text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= totalPages - 1 || loading}
                  >
                    <RiArrowRightSLine size={15} />
                  </button>
                </div>
              </div>
            )}

            {loading && contacts.length > 0 && (
              <div className="flex items-center gap-1.5 mt-3 text-xs text-base-content/30">
                <span className="loading loading-spinner loading-xs" /> Loading...
              </div>
            )}
          </>
        )}
      </div>
      {showNewContact && (
        <div className="modal modal-open">
          <div className="modal-box bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xl max-w-md p-6">
            <h3 className="font-bold text-base mb-4 text-gray-900 dark:text-white">New Contact</h3>
            <form onSubmit={createContact} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Full name *</label>
                  <input
                    className="w-full rounded-xl border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-700 px-3.5 py-2 text-xs text-gray-900 dark:text-gray-100 shadow-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    placeholder="Jane Smith"
                    value={newContactForm.full_name}
                    onChange={(e) => setNewContactForm({ ...newContactForm, full_name: e.target.value })}
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">LinkedIn URL *</label>
                  <input
                    className="w-full rounded-xl border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-700 px-3.5 py-2 font-mono text-xs text-gray-900 dark:text-gray-100 shadow-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    placeholder="https://linkedin.com/in/..."
                    value={newContactForm.linkedin_url}
                    onChange={(e) => setNewContactForm({ ...newContactForm, linkedin_url: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Title</label>
                  <input
                    className="w-full rounded-xl border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-700 px-3.5 py-2 text-xs text-gray-900 dark:text-gray-100 shadow-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    placeholder="CEO"
                    value={newContactForm.title}
                    onChange={(e) => setNewContactForm({ ...newContactForm, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Company</label>
                  <input
                    className="w-full rounded-xl border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-700 px-3.5 py-2 text-xs text-gray-900 dark:text-gray-100 shadow-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    placeholder="Acme Inc."
                    value={newContactForm.company}
                    onChange={(e) => setNewContactForm({ ...newContactForm, company: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Location</label>
                  <input
                    className="w-full rounded-xl border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-700 px-3.5 py-2 text-xs text-gray-900 dark:text-gray-100 shadow-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    placeholder="Berlin, Germany"
                    value={newContactForm.location}
                    onChange={(e) => setNewContactForm({ ...newContactForm, location: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Email</label>
                  <input
                    type="email"
                    className="w-full rounded-xl border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-700 px-3.5 py-2 text-xs text-gray-900 dark:text-gray-100 shadow-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    placeholder="jane@acme.com"
                    value={newContactForm.email}
                    onChange={(e) => setNewContactForm({ ...newContactForm, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Phone</label>
                  <input
                    type="tel"
                    className="w-full rounded-xl border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-700 px-3.5 py-2 text-xs text-gray-900 dark:text-gray-100 shadow-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    placeholder="+49 30 1234567"
                    value={newContactForm.phone}
                    onChange={(e) => setNewContactForm({ ...newContactForm, phone: e.target.value })}
                  />
                </div>
                {lists.length > 0 && (
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Add to list (optional)</label>
                    <select
                      className="w-full px-3 py-2 rounded-xl text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 shadow-xs focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 cursor-pointer"
                      value={newContactForm.list_id}
                      onChange={(e) => setNewContactForm({ ...newContactForm, list_id: e.target.value })}
                    >
                      <option value="">No list</option>
                      {lists.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="modal-action mt-2 pt-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
                <button type="button" className="btn btn-ghost btn-sm text-gray-600 dark:text-gray-400" onClick={() => setShowNewContact(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white shadow-xs transition-colors disabled:opacity-50"
                  disabled={newContactLoading}
                >
                  {newContactLoading ? <span className="loading loading-spinner loading-xs" /> : "Create"}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={() => setShowNewContact(false)} />
        </div>
      )}
      {showAddToList && (
        <div className="modal modal-open">
          <div className="modal-box bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xl max-w-sm p-6">
            <h3 className="font-bold text-base mb-1 text-gray-900 dark:text-white">Add to list</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {selected.size} contact{selected.size !== 1 ? "s" : ""} will be added. Contacts already in the list are skipped.
            </p>
            <select
              className="w-full px-3 py-2 rounded-xl text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 shadow-xs focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 cursor-pointer"
              value={addToListId}
              onChange={(e) => setAddToListId(e.target.value)}
            >
              <option value="">Select a list…</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <div className="modal-action mt-4 pt-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm text-gray-600 dark:text-gray-400" onClick={() => { setShowAddToList(false); setAddToListId(""); }}>
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white shadow-xs transition-colors disabled:opacity-50"
                disabled={!addToListId || addToListLoading}
                onClick={addSelectedToList}
              >
                {addToListLoading ? <span className="loading loading-spinner loading-xs" /> : "Add"}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => { setShowAddToList(false); setAddToListId(""); }} />
        </div>
      )}
      {showDeleteConfirm && (
        <div className="modal modal-open">
          <div className="modal-box bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xl max-w-sm p-6">
            <h3 className="font-bold text-base mb-1 text-gray-900 dark:text-white">Delete {selected.size} contact{selected.size !== 1 ? "s" : ""}?</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
              This permanently deletes {selected.size === 1 ? "this contact" : "these contacts"} and their run history — not just from this list, but from InHubFlow entirely. This can&apos;t be undone.
            </p>
            <div className="modal-action mt-2 pt-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm text-gray-600 dark:text-gray-400" onClick={() => setShowDeleteConfirm(false)} disabled={deleteLoading}>
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-error text-white hover:bg-error/90 transition-colors shadow-xs disabled:opacity-50"
                disabled={deleteLoading}
                onClick={deleteSelected}
              >
                {deleteLoading ? <span className="loading loading-spinner loading-xs" /> : "Delete permanently"}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => !deleteLoading && setShowDeleteConfirm(false)} />
        </div>
      )}
    </>
  );
}
