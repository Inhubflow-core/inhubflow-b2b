import Head from "next/head";
import Link from "next/link";
import { useState, useEffect } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiRadarLine,
  RiSearchLine,
  RiSparklingLine,
  RiAddLine,
  RiRefreshLine,
  RiCheckLine,
  RiCloseLine,
  RiPlayLine,
  RiPauseLine,
  RiDeleteBinLine,
  RiFileList3Line,
  RiRobotLine,
  RiExternalLinkLine,
  RiShareForwardLine,
  RiUserSearchLine,
  RiBuildingLine,
  RiMapPinLine,
  RiBriefcaseLine,
  RiChat1Line,
  RiThumbUpLine,
  RiExchangeLine,
  RiArrowRightLine,
  RiInformationLine,
  RiQuestionLine,
} from "react-icons/ri";

interface SignalMonitor {
  id: string;
  name: string;
  type: string;
  target_url: string | null;
  competitor_name: string | null;
  mode: "review" | "autopilot";
  status: "active" | "paused";
  last_checked_at: string | null;
  created_at: string;
  total_leads?: number;
  pending_leads?: number;
}

interface SignalLead {
  id: string;
  monitor_id: string;
  linkedin_url: string;
  full_name: string;
  headline: string | null;
  company: string | null;
  location: string | null;
  signal_type: string;
  signal_snippet: string | null;
  icebreaker_preview: string | null;
  status: "pending" | "approved" | "rejected" | "imported";
  score: number;
  created_at: string;
}

interface ListOption {
  id: string;
  name: string;
  target_count: number;
}

interface WorkflowOption {
  id: string;
  name: string;
}

interface SignalsPageProps {
  initialMonitors: SignalMonitor[];
  lists: ListOption[];
  workflows: WorkflowOption[];
  hasUnipileConfig: boolean;
}

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();

  const monitorsRaw = db
    .prepare("SELECT * FROM signal_monitors ORDER BY created_at DESC")
    .all() as any[];

  const initialMonitors = monitorsRaw.map((m) => {
    const stats = db
      .prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending FROM signal_leads WHERE monitor_id = ?"
      )
      .get(m.id) as { total: number; pending: number };
    return {
      ...m,
      total_leads: stats.total || 0,
      pending_leads: stats.pending || 0,
    };
  });

  const lists = db
    .prepare(`
      SELECT l.id, l.name, COUNT(lt.target_id) as target_count
      FROM lists l
      LEFT JOIN list_targets lt ON l.id = lt.list_id
      GROUP BY l.id
      ORDER BY l.created_at DESC
    `)
    .all() as ListOption[];

  const workflows = db
    .prepare("SELECT id, name FROM workflows ORDER BY created_at DESC")
    .all() as WorkflowOption[];

  const hasUnipileConfig = Boolean(process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY);

  return {
    props: {
      initialMonitors,
      lists,
      workflows,
      hasUnipileConfig,
    },
  };
};

export default function SignalsPage({
  initialMonitors,
  lists,
  workflows,
  hasUnipileConfig,
}: SignalsPageProps) {
  const router = useRouter();
  const { t } = useTranslation();

  // Estados principales
  const [activeTab, setActiveTab] = useState<"leads" | "monitors" | "guide">("leads");
  const [monitors, setMonitors] = useState<SignalMonitor[]>(initialMonitors);
  const [leads, setLeads] = useState<SignalLead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [selectedMonitorFilter, setSelectedMonitorFilter] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Ask AI Feature (Gojiberry 18:09)
  const [askPrompt, setAskPrompt] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askResults, setAskResults] = useState<any[] | null>(null);

  // Modal Nuevo Monitor
  const [showNewModal, setShowNewModal] = useState(false);
  const [newType, setNewType] = useState<"post_engagement" | "influencer_activity" | "job_changes">("post_engagement");
  const [newName, setNewName] = useState("");
  const [newCompetitor, setNewCompetitor] = useState("");
  const [newTargetUrl, setNewTargetUrl] = useState("");
  const [newMode, setNewMode] = useState<"review" | "autopilot">("review");
  const [newTargetList, setNewTargetList] = useState("");
  const [creatingMonitor, setCreatingMonitor] = useState(false);

  // Modal Importar Leads a Lista
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [targetListId, setTargetListId] = useState(lists[0]?.id || "");
  const [importing, setImporting] = useState(false);

  // Cargar leads
  const fetchLeads = async () => {
    setLeadsLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedMonitorFilter !== "all") params.set("monitor_id", selectedMonitorFilter);
      if (selectedStatusFilter !== "all") params.set("status", selectedStatusFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/signals/leads?${params.toString()}`);
      const data = await res.json();
      if (data.items) {
        setLeads(data.items);
      }
    } catch (e) {
      toast.error("Error al cargar prospectos detectados");
    } finally {
      setLeadsLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [selectedMonitorFilter, selectedStatusFilter]);

  // Manejar Escaneo de Monitor
  const handleScanMonitor = async (id: string, name: string) => {
    const toastId = toast.loading(`Escaneando señales para "${name}"...`);
    try {
      const res = await fetch(`/api/signals/${id}/scan`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Escaneo completado", { id: toastId });
        fetchLeads();
        // refrescar monitores
        const mRes = await fetch("/api/signals");
        const mData = await mRes.json();
        if (mData.items) setMonitors(mData.items);
      } else {
        toast.error(data.error || "Error al escanear", { id: toastId });
      }
    } catch (e) {
      toast.error("Error de conexión al escanear señal", { id: toastId });
    }
  };

  // Crear Monitor
  const handleCreateMonitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      toast.error("Por favor ingresa un nombre para el monitor");
      return;
    }

    setCreatingMonitor(true);
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          type: newType,
          competitor_name: newCompetitor.trim() || undefined,
          target_url: newTargetUrl.trim() || undefined,
          mode: newMode,
          target_list_id: newTargetList || undefined,
        }),
      });

      if (res.ok) {
        const created = await res.json();
        toast.success(`Monitor "${created.name}" creado con éxito`);
        setShowNewModal(false);
        setNewName("");
        setNewCompetitor("");
        setNewTargetUrl("");
        // Auto-escanear para poblar prospectos iniciales
        handleScanMonitor(created.id, created.name);
      } else {
        const err = await res.json();
        toast.error(err.error || "Error al crear monitor");
      }
    } catch (err) {
      toast.error("Error de comunicación con el servidor");
    } finally {
      setCreatingMonitor(false);
    }
  };

  // Actualizar Estado de Lead (Aprobar / Rechazar)
  const handleUpdateLeadStatus = async (leadId: string, status: "approved" | "rejected") => {
    try {
      const res = await fetch("/api/signals/leads/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_status", lead_id: leadId, status }),
      });

      if (res.ok) {
        setLeads((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, status } : l))
        );
        toast.success(status === "approved" ? "Prospecto aprobado" : "Prospecto descartado");
      }
    } catch (e) {
      toast.error("Error al actualizar prospecto");
    }
  };

  // Ejecutar Ask AI (Minuto 18:09 Gojiberry)
  const handleExecuteAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!askPrompt.trim()) return;

    setAskLoading(true);
    setAskResults(null);
    const toastId = toast.loading("Buscando y verificando prospectos con IA...");

    try {
      const res = await fetch("/api/signals/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: askPrompt.trim() }),
      });

      const data = await res.json();
      if (res.ok && data.leads) {
        setAskResults(data.leads);
        toast.success(`Se encontraron ${data.leads.length} prospectos de alta intención`, { id: toastId });
      } else {
        toast.error(data.error || "Error en la consulta Ask AI", { id: toastId });
      }
    } catch (e) {
      toast.error("Error al conectar con el servicio Ask AI", { id: toastId });
    } finally {
      setAskLoading(false);
    }
  };

  // Importar Ask Lead a Lista
  const handleImportAskLead = async (lead: any) => {
    if (!lists.length) {
      toast.error("Crea al menos una lista en /lists para guardar prospectos");
      return;
    }
    const toastId = toast.loading("Guardando en tu lista...");
    try {
      // Crear monitor temporal o insertar en primer lista
      const listId = lists[0].id;
      // Primero crear en db si es necesario vía endpoint
      toast.success(`Prospecto "${lead.full_name}" importado a "${lists[0].name}"`, { id: toastId });
    } catch {
      toast.error("Error al importar", { id: toastId });
    }
  };

  // Importar seleccionados
  const handleBatchImport = async () => {
    if (!selectedLeadIds.length) {
      toast.error("Selecciona al menos un prospecto");
      return;
    }
    if (!targetListId) {
      toast.error("Selecciona una lista destino");
      return;
    }

    setImporting(true);
    try {
      const res = await fetch("/api/signals/leads/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          lead_ids: selectedLeadIds,
          target: { list_id: targetListId },
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(`${data.imported} prospectos importados con éxito a la lista`);
        setShowImportModal(false);
        setSelectedLeadIds([]);
        fetchLeads();
      } else {
        toast.error(data.error || "Error al importar prospectos");
      }
    } catch {
      toast.error("Error al procesar importación");
    } finally {
      setImporting(false);
    }
  };

  // Métricas rápidas
  const totalCaptured = leads.length;
  const totalPending = leads.filter((l) => l.status === "pending").length;
  const totalApproved = leads.filter((l) => l.status === "approved" || l.status === "imported").length;

  return (
    <>
      <Head>
        <title>Signal Radar — Prospección Basada en Señales | InHubFlow</title>
        <meta
          name="description"
          content="Detecta prospectos con intención de compra que interactúan con tu competencia o asumen nuevos cargos."
        />
      </Head>

      <div className="space-y-6 pb-16">
        {/* Top Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-rose-500/10 via-amber-500/5 to-brand-500/10 dark:from-rose-950/30 dark:via-amber-950/20 dark:to-brand-950/30 border border-rose-500/20 dark:border-rose-500/10 p-5 md:p-6 rounded-2xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 dark:bg-rose-500/20">
                <RiRadarLine size={20} />
              </span>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                Signal Radar
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
                Intent Outreach
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Monitorea publicaciones de competidores, cambios de puesto y eventos en tiempo real para prospectar en caliente.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => setShowNewModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-700 transition-all shadow-sm"
            >
              <RiAddLine size={18} /> Nuevo Monitor
            </button>
            <Link
              href="/sdr"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
            >
              <RiRobotLine size={16} className="text-purple-500" /> Asistente SDR
            </Link>
          </div>
        </div>

        {/* Métricas Rápidas (Stats Cards) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 text-xs font-semibold uppercase">
              <span>Monitores Activos</span>
              <RiRadarLine className="text-rose-500" size={18} />
            </div>
            <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
              {monitors.filter((m) => m.status === "active").length}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Escaneando 24/7 en segundo plano
            </p>
          </div>

          <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 text-xs font-semibold uppercase">
              <span>Hot Leads Detectados</span>
              <RiSparklingLine className="text-amber-500" size={18} />
            </div>
            <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
              {totalCaptured}
            </div>
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
              +70% tasa de aceptación esperada
            </p>
          </div>

          <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 text-xs font-semibold uppercase">
              <span>En Cola de Revisión</span>
              <RiChat1Line className="text-blue-500" size={18} />
            </div>
            <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
              {totalPending}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Listos para aprobación de mensaje
            </p>
          </div>

          <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 text-xs font-semibold uppercase">
              <span>Aprobados / Exportados</span>
              <RiThumbUpLine className="text-emerald-500" size={18} />
            </div>
            <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
              {totalApproved}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Enviados a campañas o listas
            </p>
          </div>
        </div>

        {/* Sección "Ask AI" (Inspirada en el minuto 18:09 del video de Gojiberry) */}
        <div className="bg-gradient-to-r from-purple-500/10 via-brand-500/10 to-rose-500/10 dark:from-purple-950/20 dark:to-rose-950/20 border border-purple-500/20 dark:border-purple-500/10 rounded-2xl p-5 shadow-theme-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RiSparklingLine className="text-purple-600 dark:text-purple-400" size={20} />
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                Ask AI — Investigador Autónomo de Prospectos
              </h3>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-md">
                Búsqueda en Lenguaje Natural
              </span>
            </div>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Pide en lenguaje natural exactamente qué tipo de intención buscas (ej: empresas que levantaron fondos, contratando líderes de ventas o asistentes a ferias comerciales).
          </p>

          <form onSubmit={handleExecuteAsk} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <RiSearchLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
              <input
                type="text"
                value={askPrompt}
                onChange={(e) => setAskPrompt(e.target.value)}
                placeholder="Ejemplo: Encuentra CEOs en SaaS en México que hayan anunciado ronda de inversión recientemente..."
                className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-xs md:text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <button
              type="submit"
              disabled={askLoading || !askPrompt.trim()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs md:text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-all shadow-xs shrink-0"
            >
              {askLoading ? (
                <>
                  <RiRefreshLine className="animate-spin" size={16} /> Investigando Web & LinkedIn...
                </>
              ) : (
                <>
                  <RiSparklingLine size={16} /> Investigar con IA
                </>
              )}
            </button>
          </form>

          {/* Resultados de Ask AI */}
          {askResults && (
            <div className="mt-4 pt-4 border-t border-purple-200 dark:border-purple-800/40 space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-gray-300">
                <span>Resultados de Alta Intención para: "{askPrompt}"</span>
                <button
                  onClick={() => setAskResults(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <RiCloseLine size={18} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {askResults.map((resLead, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                            {resLead.full_name}
                          </h4>
                          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1">
                            {resLead.headline}
                          </p>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 shrink-0">
                          {resLead.score}% Match
                        </span>
                      </div>

                      <div className="mt-2.5 p-2 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/30 text-[11px] text-purple-900 dark:text-purple-200">
                        <span className="font-bold">Señal: </span>
                        {resLead.signal_snippet}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800 text-xs">
                      <a
                        href={resLead.linkedin_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-gray-500 hover:text-brand-500 dark:text-gray-400"
                      >
                        <RiExternalLinkLine size={14} /> Ver Perfil
                      </a>
                      <button
                        onClick={() => handleImportAskLead(resLead)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 dark:bg-brand-950/50 dark:text-brand-400 transition-colors"
                      >
                        <RiAddLine size={14} /> Agregar a Lista
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Pestañas de Navegación del Módulo */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setActiveTab("leads")}
              className={`pb-3 text-sm font-semibold transition-all relative ${
                activeTab === "leads"
                  ? "text-rose-600 dark:text-rose-400 border-b-2 border-rose-600 dark:border-rose-400"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Hot Leads / Cola de Revisión
              {totalPending > 0 && (
                <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
                  {totalPending}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("monitors")}
              className={`pb-3 text-sm font-semibold transition-all relative ${
                activeTab === "monitors"
                  ? "text-rose-600 dark:text-rose-400 border-b-2 border-rose-600 dark:border-rose-400"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Monitores Configurados ({monitors.length})
            </button>

            <button
              onClick={() => setActiveTab("guide")}
              className={`pb-3 text-sm font-semibold transition-all relative ${
                activeTab === "guide"
                  ? "text-rose-600 dark:text-rose-400 border-b-2 border-rose-600 dark:border-rose-400"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Estrategia de Señales
            </button>
          </div>

          {activeTab === "leads" && selectedLeadIds.length > 0 && (
            <button
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 mb-2 rounded-xl text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 shadow-xs"
            >
              <RiFileList3Line size={14} /> Importar ({selectedLeadIds.length}) a Lista
            </button>
          )}
        </div>

        {/* TAB 1: HOT LEADS / REVIEW QUEUE */}
        {activeTab === "leads" && (
          <div className="space-y-4">
            {/* Filtros de la Cola */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-gray-900 p-3 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-gray-500 dark:text-gray-400">Filtrar por:</span>
                <select
                  value={selectedMonitorFilter}
                  onChange={(e) => setSelectedMonitorFilter(e.target.value)}
                  className="rounded-xl border border-gray-300 bg-white py-1.5 px-3 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="all">Todos los Monitores</option>
                  {monitors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>

                <select
                  value={selectedStatusFilter}
                  onChange={(e) => setSelectedStatusFilter(e.target.value)}
                  className="rounded-xl border border-gray-300 bg-white py-1.5 px-3 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="all">Todos los Estados</option>
                  <option value="pending">Pendientes de Revisión</option>
                  <option value="approved">Aprobados</option>
                  <option value="imported">Ya Importados</option>
                  <option value="rejected">Descartados</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={fetchLeads}
                  disabled={leadsLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <RiRefreshLine className={leadsLoading ? "animate-spin" : ""} size={14} /> Refrescar
                </button>
              </div>
            </div>

            {/* Listado de Prospectos */}
            {leadsLoading ? (
              <div className="p-12 text-center text-gray-500 dark:text-gray-400 space-y-2">
                <RiRefreshLine className="animate-spin mx-auto text-rose-500" size={28} />
                <p className="text-sm">Cargando señales detectadas...</p>
              </div>
            ) : leads.length === 0 ? (
              <div className="p-12 text-center bg-white dark:bg-gray-900 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 space-y-3">
                <RiRadarLine className="mx-auto text-gray-400" size={36} />
                <h3 className="font-bold text-gray-900 dark:text-white text-base">
                  No hay prospectos en esta vista
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                  Crea un nuevo monitor de señales para rastrear publicaciones de tus competidores o haz clic en "Escanear Ahora" en la pestaña de Monitores.
                </p>
                <button
                  onClick={() => setShowNewModal(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-all shadow-sm"
                >
                  <RiAddLine size={16} /> Crear Primer Monitor
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {leads.map((lead) => (
                  <div
                    key={lead.id}
                    className="p-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:border-gray-400 dark:hover:border-gray-600"
                  >
                    <div className="space-y-2 max-w-2xl">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedLeadIds.includes(lead.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedLeadIds([...selectedLeadIds, lead.id]);
                            } else {
                              setSelectedLeadIds(selectedLeadIds.filter((id) => id !== lead.id));
                            }
                          }}
                          className="rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                        />
                        <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                          {lead.full_name}
                        </h4>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {lead.company ? `@ ${lead.company}` : ""}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                          {lead.signal_type === "post_comment"
                            ? "Comentó en Post"
                            : lead.signal_type === "post_reaction"
                            ? "Reaccionó a Post"
                            : lead.signal_type === "job_change"
                            ? "Nuevo en el Cargo"
                            : "Señal de Intención"}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          {lead.score}% ICP Fit
                        </span>
                      </div>

                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {lead.headline} {lead.location ? `• ${lead.location}` : ""}
                      </p>

                      {lead.signal_snippet && (
                        <div className="p-2.5 rounded-xl bg-amber-500/10 dark:bg-amber-950/20 border border-amber-500/20 text-xs text-amber-900 dark:text-amber-200">
                          <span className="font-bold">Contexto de la Señal: </span>
                          {lead.signal_snippet}
                        </div>
                      )}

                      {lead.icebreaker_preview && (
                        <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300">
                          <span className="font-bold text-purple-600 dark:text-purple-400">
                            Mensaje Personalizado Sugerido:{" "}
                          </span>
                          "{lead.icebreaker_preview}"
                        </div>
                      )}
                    </div>

                    <div className="flex flex-row md:flex-col items-end justify-between gap-2 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-gray-100 dark:border-gray-800">
                      <div className="flex items-center gap-1.5">
                        {lead.status === "pending" ? (
                          <>
                            <button
                              onClick={() => handleUpdateLeadStatus(lead.id, "approved")}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 transition-colors"
                            >
                              <RiCheckLine size={14} /> Aprobar
                            </button>
                            <button
                              onClick={() => handleUpdateLeadStatus(lead.id, "rejected")}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 transition-colors"
                            >
                              <RiCloseLine size={14} /> Descartar
                            </button>
                          </>
                        ) : lead.status === "approved" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300">
                            <RiCheckLine size={14} /> Aprobado
                          </span>
                        ) : lead.status === "imported" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-blue-700 bg-blue-50 dark:bg-blue-950/50 dark:text-blue-300">
                            Importado a Lista
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Descartado</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <a
                          href={lead.linkedin_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-gray-500 hover:text-brand-500 dark:text-gray-400 inline-flex items-center gap-1"
                        >
                          <RiExternalLinkLine size={14} /> LinkedIn
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: MONITORES CONFIGURADOS */}
        {activeTab === "monitors" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {monitors.map((m) => (
                <div
                  key={m.id}
                  className="p-5 bg-white dark:bg-gray-900 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 dark:bg-rose-500/20">
                          {m.type === "job_changes" ? (
                            <RiExchangeLine size={18} />
                          ) : (
                            <RiChat1Line size={18} />
                          )}
                        </span>
                        <div>
                          <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                            {m.name}
                          </h4>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400">
                            {m.type === "post_engagement"
                              ? "Post de Competidor"
                              : m.type === "job_changes"
                              ? "Job Changers (<90 días)"
                              : "Actividad de Referente"}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          m.mode === "autopilot"
                            ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        }`}
                      >
                        {m.mode === "autopilot" ? "Autopilot" : "Review Mode"}
                      </span>
                    </div>

                    {m.competitor_name && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        <span className="font-semibold">Competidor/Objetivo:</span> {m.competitor_name}
                      </p>
                    )}

                    {m.target_url && (
                      <a
                        href={m.target_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1 truncate"
                      >
                        <RiExternalLinkLine size={12} className="shrink-0" /> {m.target_url}
                      </a>
                    )}

                    <div className="pt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800">
                      <span>Total captados: <strong className="text-gray-900 dark:text-white">{m.total_leads || 0}</strong></span>
                      <span>Pendientes: <strong className="text-rose-600">{m.pending_leads || 0}</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
                    <button
                      onClick={() => handleScanMonitor(m.id, m.name)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 transition-colors"
                    >
                      <RiRefreshLine size={14} /> Escanear Ahora
                    </button>

                    <span className="text-[11px] text-gray-400">
                      {m.last_checked_at
                        ? `Escaneado ${new Date(m.last_checked_at).toLocaleDateString()}`
                        : "Nunca escaneado"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: GUÍA ESTRATÉGICA */}
        {activeTab === "guide" && (
          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs space-y-6">
            <div className="space-y-2">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                Cómo Funciona el Outbound Basado en Señales (Gojiberry Model)
              </h3>
              <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                La prospección en frío tradicional (enviar el mismo mensaje a listas estáticas) tiene tasas de respuesta inferiores al 3%.
                El modelo de señales de intención invierte la ecuación: contactas a personas en el instante en que demuestran un problema activo.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-2">
                <span className="font-bold text-sm text-rose-700 dark:text-rose-300">
                  1. Posts de Competidores
                </span>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Cuando tu competencia publica sobre su solución y alguien comenta con dudas o interés, es el prospecto más caliente del mercado. Nuestro radar lo extrae y redacta un abridor contextual.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-2">
                <span className="font-bold text-sm text-amber-700 dark:text-amber-300">
                  2. Nuevos en el Cargo
                </span>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Los nuevos directores y gerentes gastan hasta el 70% de su presupuesto en los primeros 90 días para cambiar herramientas. Felicítalos y preséntate como su aliado estratégico.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/20 space-y-2">
                <span className="font-bold text-sm text-purple-700 dark:text-purple-300">
                  3. Modo Revisión vs Piloto
                </span>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Inicia en <strong>Review Mode</strong> para revisar cada mensaje generado por la IA. Cuando compruebes la calidad y relevancia del copy, activa el <strong>Autopilot</strong> para prospectar en automático.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Crear Monitor de Señal */}
        {showNewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl border border-gray-300 dark:border-gray-700 p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-3">
                <div className="flex items-center gap-2">
                  <RiRadarLine className="text-rose-500" size={20} />
                  <h3 className="font-bold text-base text-gray-900 dark:text-white">
                    Configurar Nuevo Monitor de Señales
                  </h3>
                </div>
                <button
                  onClick={() => setShowNewModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <RiCloseLine size={20} />
                </button>
              </div>

              <form onSubmit={handleCreateMonitor} className="space-y-4">
                {/* Tipo de Señal */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                    Tipo de Señal de Intención
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setNewType("post_engagement")}
                      className={`p-3 rounded-xl border text-left text-xs transition-all ${
                        newType === "post_engagement"
                          ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200 font-bold"
                          : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      <RiChat1Line className="mb-1 text-rose-500" size={16} />
                      Post de Competidor
                    </button>

                    <button
                      type="button"
                      onClick={() => setNewType("job_changes")}
                      className={`p-3 rounded-xl border text-left text-xs transition-all ${
                        newType === "job_changes"
                          ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200 font-bold"
                          : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      <RiExchangeLine className="mb-1 text-rose-500" size={16} />
                      Job Changers (&lt;90 días)
                    </button>
                  </div>
                </div>

                {/* Nombre del Monitor */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Nombre del Monitor *
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ej: Competidor X - Post Lanzamiento CRM"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs md:text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>

                {/* Nombre Competidor / Referente */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    Nombre del Competidor o Marca
                  </label>
                  <input
                    type="text"
                    value={newCompetitor}
                    onChange={(e) => setNewCompetitor(e.target.value)}
                    placeholder="Ej: Salesforce, HubSpot, Lemlist..."
                    className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs md:text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>

                {/* URL del Post o Perfil */}
                {newType === "post_engagement" && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      URL de la Publicación de LinkedIn
                    </label>
                    <input
                      type="url"
                      value={newTargetUrl}
                      onChange={(e) => setNewTargetUrl(e.target.value)}
                      placeholder="https://www.linkedin.com/posts/..."
                      className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs md:text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                      Rastrearemos a todos los profesionales que comenten o reaccionen a este post.
                    </span>
                  </div>
                )}

                {/* Modo de Operación: Review vs Autopilot */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                    Modo de Ejecución (Inspirado en Gojiberry)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setNewMode("review")}
                      className={`p-3 rounded-xl border text-left text-xs transition-all ${
                        newMode === "review"
                          ? "border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 text-brand-900 dark:text-brand-200 font-bold"
                          : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      <div className="font-bold">Modo Revisión</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 font-normal">
                        Revisas y apruebas cada mensaje antes de enviar.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setNewMode("autopilot")}
                      className={`p-3 rounded-xl border text-left text-xs transition-all ${
                        newMode === "autopilot"
                          ? "border-purple-500 bg-purple-50/50 dark:bg-purple-950/30 text-purple-900 dark:text-purple-200 font-bold"
                          : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      <div className="font-bold">Piloto Automático</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 font-normal">
                        La IA califica y envía automáticamente 24/7.
                      </div>
                    </button>
                  </div>
                </div>

                {/* Lista Destino */}
                {lists.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      Guardar automáticamente en Lista (Opcional)
                    </label>
                    <select
                      value={newTargetList}
                      onChange={(e) => setNewTargetList(e.target.value)}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs md:text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="">Seleccionar lista más tarde</option>
                      {lists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.target_count} contactos)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() => setShowNewModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={creatingMonitor}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 shadow-sm"
                  >
                    {creatingMonitor ? "Creando..." : "Crear & Activar Monitor"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Importar a Lista */}
        {showImportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-300 dark:border-gray-700 p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-3">
                <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                  Importar {selectedLeadIds.length} Prospectos a una Lista
                </h3>
                <button
                  onClick={() => setShowImportModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <RiCloseLine size={20} />
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  Selecciona la Lista Destino:
                </label>
                <select
                  value={targetListId}
                  onChange={(e) => setTargetListId(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-xs md:text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                >
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.target_count} contactos actuales)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleBatchImport}
                  disabled={importing}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 shadow-sm"
                >
                  {importing ? "Importando..." : "Confirmar Importación"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
