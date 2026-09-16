import Head from "next/head";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiUserSearchLine,
  RiSearchLine,
  RiBuildingLine,
  RiMapPinLine,
  RiBriefcaseLine,
  RiFileList3Line,
  RiExternalLinkLine,
  RiArrowRightLine,
  RiShieldCheckLine,
  RiAlertLine,
  RiFlashlightLine,
  RiCheckboxCircleLine,
  RiSparklingLine,
  RiRadarLine,
  RiUserLine,
  RiRefreshLine,
  RiCheckLine,
  RiSettings4Line,
  RiMailLine,
  RiPhoneLine,
} from "react-icons/ri";

interface Account {
  id: string;
  name: string;
  email: string;
  is_authenticated: number;
}

interface Lead {
  linkedinUrl: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  email?: string | null;
  phone?: string | null;
  profileImageUrl: string | null;
  degree: number | null;
  summary: string | null;
}

interface LeadFinderProps {
  accounts: Account[];
}

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();
  const accounts = db
    .prepare(
      "SELECT id, name, email, is_authenticated FROM accounts ORDER BY is_authenticated DESC, name ASC"
    )
    .all() as Account[];
  return { props: { accounts } };
};

import {
  type CountryOption,
  COUNTRIES_LIST,
  SAMPLE_TITLES,
  SAMPLE_INDUSTRIES,
  toggleOrAppendPill,
  isPillActive,
} from "@/lib/lead-finder/constants";

export type { CountryOption };
export { COUNTRIES_LIST, SAMPLE_TITLES, SAMPLE_INDUSTRIES, toggleOrAppendPill, isPillActive };

export default function LeadFinderPage({ accounts: initialAccounts }: LeadFinderProps) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const authenticatedAccounts = accounts.filter((a) => a.is_authenticated === 1);

  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    authenticatedAccounts[0]?.id || accounts[0]?.id || ""
  );

  const [title, setTitle] = useState("");
  const [country, setCountry] = useState("Chile");
  const [city, setCity] = useState("");
  const [company, setCompany] = useState("");
  const [limit, setLimit] = useState(25);
  const [listName, setListName] = useState("");
  const [customListName, setCustomListName] = useState(false);

  const [isSearching, setIsSearching] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [completedResult, setCompletedResult] = useState<{
    listId: string;
    listName: string;
    totalFound: number;
    importedCount: number;
    updatedCount: number;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const resultsEndRef = useRef<HTMLDivElement>(null);

  const selectedCountryOption = COUNTRIES_LIST.find((c) => c.name === country) || COUNTRIES_LIST[0];

  // Auto-generate a list name based on filters if user hasn't explicitly customized it
  useEffect(() => {
    if (!customListName) {
      const locDisplay = [city.trim(), country !== "Global / Todos" ? country : ""].filter(Boolean).join(", ");
      const parts = [title.trim(), locDisplay, company.trim()].filter(Boolean);
      const dateLocale = locale === "en" ? "en-US" : locale === "pt-BR" ? "pt-BR" : "es-ES";
      const dateStr = new Date().toLocaleDateString(dateLocale, { month: "short", year: "numeric" });
      if (parts.length > 0) {
        setListName(`${parts.join(" - ")} (${dateStr})`);
      } else {
        setListName(t("leadFinder.defaultListName", { date: dateStr }));
      }
    }
  }, [title, country, city, company, customListName, locale, t]);

  // Keep accounts updated if user authenticated elsewhere
  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAccounts(data);
          if (!selectedAccountId) {
            const authAcc = data.find((a) => a.is_authenticated === 1);
            if (authAcc) setSelectedAccountId(authAcc.id);
          }
        }
      })
      .catch(() => {});
  }, [selectedAccountId]);

  async function handleStartSearch(e: React.FormEvent) {
    e.preventDefault();

    const effectiveLoc = [city.trim(), country !== "Global / Todos" ? country : ""].filter(Boolean).join(", ");

    if (!title.trim() && !effectiveLoc && !company.trim()) {
      toast.error(t("leadFinder.toastFillFields"));
      return;
    }

    setIsSearching(true);
    setLeads([]);
    setCompletedResult(null);
    setProgressPercent(5);
    setProgressMessage(t("leadFinder.scanningRealtime"));
    setCurrentPage(1);
    setTotalPages(Math.ceil(limit / 10));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/linkedin/search-and-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          accountId: selectedAccountId,
          title: title.trim(),
          country: country !== "Global / Todos" ? country : "",
          city: city.trim(),
          location: effectiveLoc,
          company: company.trim(),
          limit,
          listName: listName.trim() || undefined,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Error ${response.status}: No se pudo procesar la búsqueda.`);
      }

      if (!response.body) {
        throw new Error("El servidor no devolvió un flujo de eventos.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
          const trimmed = block.trim();
          if (!trimmed) continue;

          let eventName = "message";
          let dataStr = "";

          for (const line of trimmed.split("\n")) {
            if (line.startsWith("event: ")) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataStr = line.slice(6).trim();
            }
          }

          if (!dataStr) continue;

          let parsedData: any;
          try {
            parsedData = JSON.parse(dataStr);
          } catch (parseErr) {
            console.error("Error parsing SSE block:", parseErr);
            continue;
          }

          if (eventName === "error") {
            throw new Error(parsedData?.error || "Ocurrió un error en la búsqueda con Google X-Ray.");
          }

          if (eventName === "init") {
            setProgressMessage(parsedData.message || t("leadFinder.scanningRealtime"));
          } else if (eventName === "progress") {
            if (parsedData.message) setProgressMessage(parsedData.message);
            if (parsedData.page) setCurrentPage(parsedData.page);
            if (parsedData.totalPages) setTotalPages(parsedData.totalPages);

            const estPages = parsedData.totalPages || Math.ceil(limit / 10);
            const curP = parsedData.page || 1;
            const found = parsedData.totalFound || 0;
            const calcPct = Math.min(
              Math.round((found / limit) * 85 + (curP / estPages) * 10),
              95
            );
            setProgressPercent(Math.max(calcPct, 15));
          } else if (eventName === "lead") {
            const newLead = parsedData as Lead;
            setLeads((prev) => {
              if (prev.some((l) => l.linkedinUrl === newLead.linkedinUrl)) return prev;
              return [...prev, newLead];
            });
          } else if (eventName === "saving") {
            setProgressMessage(parsedData.message || "Guardando...");
            setProgressPercent(95);
          } else if (eventName === "complete") {
            setProgressPercent(100);
            const foundCount = parsedData.totalFound || leads.length;
            setProgressMessage(
              parsedData.message ||
                (foundCount > 0 ? t("leadFinder.extractionFinished") : t("leadFinder.noResultsTitle"))
            );
            setCompletedResult({
              listId: parsedData.listId,
              listName: parsedData.listName,
              totalFound: foundCount,
              importedCount: parsedData.importedCount || 0,
              updatedCount: parsedData.updatedCount || 0,
            });
            if (foundCount > 0) {
              toast.success(
                t("leadFinder.toastSuccess", { name: parsedData.listName, count: String(foundCount) })
              );
            } else {
              toast.info(t("leadFinder.toastNoResults"));
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        toast.info(t("leadFinder.toastCancelled"));
      } else {
        const msg = err instanceof Error ? err.message : "Error inesperado al buscar en LinkedIn.";
        toast.error(msg);
        setProgressMessage(`Error: ${msg}`);
      }
    } finally {
      setIsSearching(false);
      abortControllerRef.current = null;
    }
  }

  function handleCancelSearch() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }

  const hasAuthAccount = authenticatedAccounts.length > 0;

  return (
    <>
      <Head>
        <title>Lead Finder — Dashboard B2B</title>
        <meta
          name="description"
          content={t("leadFinder.subtitle")}
        />
      </Head>

      <div className="space-y-6 pb-12">
        {/* Top Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                {t("leadFinder.title")}
              </h1>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("leadFinder.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/lists"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
            >
              <RiFileList3Line size={16} /> {t("leadFinder.viewLists")}
            </Link>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
            >
              <RiSettings4Line size={16} /> {t("leadFinder.accounts")}
            </Link>
          </div>
        </div>

        {/* 2-Column Grid: Form & Results (50% / 50%) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left Column: Search Form (50% on lg) */}
          <div className="w-full bg-white dark:bg-gray-900 rounded-2xl border border-gray-300 dark:border-gray-700 p-5 md:p-6 shadow-theme-xs space-y-5">
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-3">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <RiSearchLine className="text-brand-500" /> {t("leadFinder.searchCriteria")}
              </h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">{t("leadFinder.stepIndicator")}</span>
            </div>

            <form onSubmit={handleStartSearch} className="space-y-4">

              {/* Title / Cargo */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  {t("leadFinder.jobTitleLabel")} <span className="text-brand-500">*</span>
                </label>
                <div className="relative">
                  <RiBriefcaseLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={isSearching}
                    placeholder={t("leadFinder.jobTitlePlaceholder")}
                    className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                  />
                </div>
                {/* Suggestions (Max 4, Multi-select) */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SAMPLE_TITLES.map((st) => {
                    const active = isPillActive(title, st);
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setTitle(toggleOrAppendPill(title, st))}
                        disabled={isSearching}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                          active
                            ? "bg-brand-500 border-brand-500 text-white shadow-xs"
                            : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-200 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
                        }`}
                      >
                        {active ? `✓ ${st}` : `+${st}`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Location: Country and City Filter */}
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Country Selector */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                      País
                    </label>
                    <select
                      value={country}
                      onChange={(e) => {
                        setCountry(e.target.value);
                        setCity("");
                      }}
                      disabled={isSearching}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-xs transition-all focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                    >
                      {COUNTRIES_LIST.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* City Input */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                      Ciudad <span className="text-gray-400 font-normal">(Opcional)</span>
                    </label>
                    <div className="relative">
                      <RiMapPinLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
                      <input
                        type="text"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        disabled={isSearching}
                        placeholder="Ej: Santiago, Antofagasta..."
                        className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Popular City Suggestions */}
                {selectedCountryOption && selectedCountryOption.popularCities.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 mr-1 font-medium">Ciudades clave:</span>
                    {selectedCountryOption.popularCities.map((cName) => {
                      const active = city.toLowerCase() === cName.toLowerCase();
                      return (
                        <button
                          key={cName}
                          type="button"
                          onClick={() => setCity(active ? "" : cName)}
                          disabled={isSearching}
                          className={`px-2.5 py-0.5 rounded-lg text-xs font-medium border transition-all ${
                            active
                              ? "bg-brand-500 border-brand-500 text-white shadow-xs"
                              : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-200 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
                          }`}
                        >
                          {active ? `✓ ${cName}` : `+${cName}`}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Company / Industry (Optional) */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  {t("leadFinder.companyLabel")} <span className="text-gray-400 font-normal">{t("leadFinder.optional")}</span>
                </label>
                <div className="relative">
                  <RiBuildingLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    disabled={isSearching}
                    placeholder={t("leadFinder.companyPlaceholder")}
                    className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                  />
                </div>
                {/* Industry Suggestions (Max 4, Multi-select) */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SAMPLE_INDUSTRIES.map((si) => {
                    const active = isPillActive(company, si);
                    return (
                      <button
                        key={si}
                        type="button"
                        onClick={() => setCompany(toggleOrAppendPill(company, si))}
                        disabled={isSearching}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                          active
                            ? "bg-brand-500 border-brand-500 text-white shadow-xs"
                            : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-200 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
                        }`}
                      >
                        {active ? `✓ ${si}` : `+${si}`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quantity Limit */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  {t("leadFinder.quantityLabel")}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[10, 25, 50, 100].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setLimit(val)}
                      disabled={isSearching}
                      className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                        limit === val
                          ? "bg-brand-500 border-brand-500 !text-white shadow-xs"
                          : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750"
                      }`}
                    >
                      {t("leadFinder.leadsCount", { count: String(val) })}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target List Name */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  {t("leadFinder.listNameLabel")}
                </label>
                <div className="relative">
                  <RiFileList3Line className="absolute left-3.5 top-3 text-gray-400" size={16} />
                  <input
                    type="text"
                    value={listName}
                    onChange={(e) => {
                      setListName(e.target.value);
                      setCustomListName(true);
                    }}
                    disabled={isSearching}
                    placeholder={t("leadFinder.listNamePlaceholder")}
                    className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-2">
                {!isSearching ? (
                  <button
                    type="submit"
                    disabled={!title.trim() && !city.trim() && !company.trim() && country === "Global / Todos"}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold !text-white bg-brand-500 hover:bg-brand-600 shadow-md shadow-brand-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-[0.99]"
                  >
                    <RiFlashlightLine size={18} /> {t("leadFinder.searchButton")}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled
                      className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold !text-white bg-brand-600 opacity-90 cursor-wait shadow-sm"
                    >
                      <RiRefreshLine className="animate-spin" size={18} />{" "}
                      {t("leadFinder.capturingButton", { current: String(leads.length), total: String(limit) })}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelSearch}
                      className="py-3 px-4 rounded-xl text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-750 transition-colors"
                    >
                      {t("leadFinder.stopButton")}
                    </button>
                  </div>
                )}
              </div>
            </form>
          </div>

          {/* Right Column: Radar & Results (50% on lg) */}
          <div className="w-full space-y-6">
            {/* Live Progress Card (Visible when searching or completed) */}
            {(isSearching || completedResult) && (
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-300 dark:border-gray-700 p-5 md:p-6 shadow-theme-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500">
                      {isSearching ? (
                        <>
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-xl bg-brand-400 opacity-30"></span>
                          <RiRadarLine size={22} className="animate-pulse" />
                        </>
                      ) : (
                        <RiCheckboxCircleLine size={24} className="text-emerald-500" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                        {isSearching ? t("leadFinder.scanningRealtime") : t("leadFinder.extractionFinished")}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-sm md:max-w-md">
                        {progressMessage || t("leadFinder.scanningRealtime")}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs font-bold text-brand-600 dark:text-brand-400">
                      {leads.length} / {limit} leads
                    </span>
                    <p className="text-[11px] text-gray-400">
                      {isSearching
                        ? t("leadFinder.pageIndicator", { page: String(currentPage), total: String(totalPages) })
                        : t("leadFinder.completedPercent")}
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden border border-gray-200 dark:border-gray-700">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      completedResult ? "bg-emerald-500" : "bg-gradient-to-r from-brand-500 to-indigo-500"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* Completion Action Banner */}
                {completedResult && completedResult.totalFound > 0 && (
                  <div className="mt-3 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-full bg-emerald-500 !text-white flex items-center justify-center shrink-0">
                        <RiCheckLine size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                          {t("leadFinder.listReady", { name: completedResult.listName })}
                        </p>
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                          {t("leadFinder.savedContacts", { count: String(completedResult.totalFound) })}
                        </p>
                      </div>
                    </div>

                    <Link
                      href={`/lists/${completedResult.listId}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 !text-white transition-colors shrink-0 shadow-xs"
                    >
                      {t("leadFinder.openList")} <RiArrowRightLine size={14} />
                    </Link>
                  </div>
                )}

                {completedResult && completedResult.totalFound === 0 && (
                  <div className="mt-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/60 flex items-start gap-2.5">
                    <RiAlertLine size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs space-y-1 text-amber-800 dark:text-amber-300">
                      <p className="font-semibold">{t("leadFinder.noResultsTitle")}</p>
                      <p className="text-amber-700 dark:text-amber-400">
                        {t("leadFinder.noResultsTip")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Results Table / Cards */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <RiUserSearchLine className="text-brand-500" size={18} />
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                    {t("leadFinder.resultsCaptured", { count: String(leads.length) })}
                  </h3>
                </div>

                {leads.length > 0 && (
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {t("leadFinder.livePreview")}
                  </span>
                )}
              </div>

              {leads.length === 0 ? (
                <div className="p-12 text-center space-y-3">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-900">
                    <RiUserSearchLine size={28} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                      {t("leadFinder.readyToSearchTitle")}
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                      {t("leadFinder.readyToSearchDesc")}
                    </p>
                  </div>
                  <div className="pt-2 flex items-center justify-center gap-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <RiShieldCheckLine size={13} className="text-emerald-500" /> {t("leadFinder.noSalesNavLimits")}
                    </span>
                    <span>•</span>
                    <span>{t("leadFinder.stealthMode")}</span>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-800 max-h-[580px] overflow-y-auto">
                  {leads.map((lead, idx) => (
                    <div
                      key={lead.linkedinUrl || idx}
                      className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors flex items-start gap-3.5"
                    >
                      {/* Avatar */}
                      <div className="relative h-11 w-11 rounded-xl overflow-hidden shrink-0 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                        {lead.profileImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={lead.profileImageUrl}
                            alt={lead.fullName}
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <RiUserLine className="text-gray-400" size={20} />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                            {lead.fullName}
                          </span>
                          {lead.degree && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                              {lead.degree}º
                            </span>
                          )}
                          {lead.company && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                              <RiBuildingLine size={11} /> {lead.company}
                            </span>
                          )}
                        </div>

                        {lead.title && (
                          <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 leading-relaxed">
                            {lead.title}
                          </p>
                        )}

                        {lead.location && (
                          <p className="text-[11px] text-gray-400 flex items-center gap-1">
                            <RiMapPinLine size={12} /> {lead.location}
                          </p>
                        )}

                        {(lead.email || lead.phone) && (
                          <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                            {lead.email && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                <RiMailLine size={11} /> {lead.email}
                              </span>
                            )}
                            {lead.phone && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                                <RiPhoneLine size={11} /> {lead.phone}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* LinkedIn Link */}
                      <div className="shrink-0 pt-0.5">
                        <a
                          href={lead.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={t("leadFinder.viewProfile")}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:bg-gray-800 dark:hover:text-brand-400 transition-colors"
                        >
                          <RiExternalLinkLine size={16} />
                        </a>
                      </div>
                    </div>
                  ))}
                  <div ref={resultsEndRef} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
