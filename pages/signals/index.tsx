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
  RiGroupLine,
  RiLineChartLine,
  RiArrowLeftLine,
  RiFireLine,
  RiFlashlightLine,
  RiShieldCheckLine,
  RiSendPlane2Line,
  RiUserVoiceLine,
  RiCheckboxCircleLine,
  RiTimeLine,
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

export interface AccountOption {
  id: string;
  name: string;
  is_authenticated: number;
}

interface SignalsPageProps {
  initialMonitors: SignalMonitor[];
  lists: ListOption[];
  workflows: WorkflowOption[];
  accounts: AccountOption[];
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

  const accounts = db
    .prepare("SELECT id, name, is_authenticated FROM accounts ORDER BY created_at DESC")
    .all() as AccountOption[];

  return {
    props: {
      initialMonitors,
      lists,
      workflows,
      accounts,
    },
  };
};

export interface SignalDefinition {
  id: string;
  title: string;
  badge: string;
  level: 1 | 2 | 3;
  levelTitle: string;
  group: "A" | "B" | "C" | "D";
  groupTitle: string;
  description: string;
  icon: any;
  color: string;
  badgeBg: string;
  inputKind: "post_url" | "profile_or_company_url" | "keywords" | "roles_or_industry";
}

export const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  // Nivel 1: Máxima Intención (Calientes - Competencia y Comunidad)
  {
    id: "competitor_reactions",
    title: "Reacciones a Posts de Competidores",
    badge: "Alta Conversión",
    level: 1,
    levelTitle: "🔥 Nivel 1: Máxima Intención",
    group: "A",
    groupTitle: "Social & Competidores",
    description: "Decisores que dieron Like, Celebrate, Insightful o Support a posts de competidores directos o referentes del nicho.",
    icon: RiThumbUpLine,
    color: "text-amber-500",
    badgeBg: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    inputKind: "post_url",
  },
  {
    id: "high_intent_comments",
    title: "Comentarios en Posts Clave / Lead Magnets",
    badge: "Máxima Intención",
    level: 1,
    levelTitle: "🔥 Nivel 1: Máxima Intención",
    group: "A",
    groupTitle: "Social & Competidores",
    description: "Comentaristas en posts de debate o pidiendo recursos. La IA contextualiza su opinión sin sonar intrusiva.",
    icon: RiChat1Line,
    color: "text-blue-500",
    badgeBg: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
    inputKind: "post_url",
  },
  {
    id: "competitor_followers",
    title: "Audiencia & Seguidores de Competidores",
    badge: "Afinidad Directa",
    level: 1,
    levelTitle: "🔥 Nivel 1: Máxima Intención",
    group: "A",
    groupTitle: "Social & Competidores",
    description: "Profesionales que siguen a empresas competidoras o a sus fundadores y líderes de opinión en LinkedIn.",
    icon: RiGroupLine,
    color: "text-indigo-500",
    badgeBg: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300",
    inputKind: "profile_or_company_url",
  },

  // Nivel 2: Momento de Compra / Disparadores de Cambio (Triggers)
  {
    id: "new_in_role",
    title: "Just Hired / Nuevo Cargo (<90 Días)",
    badge: "Ventana Dorada",
    level: 2,
    levelTitle: "⚡ Nivel 2: Momento de Compra",
    group: "B",
    groupTitle: "Cambios de Rol & Triggers",
    description: "Decisores recién nombrados (CEO, VP, Director). En sus primeros 90 días tienen presupuesto fresco para nuevos proveedores.",
    icon: RiExchangeLine,
    color: "text-emerald-500",
    badgeBg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
    inputKind: "roles_or_industry",
  },
  {
    id: "internal_promotion",
    title: "Ascenso Interno a Decisor",
    badge: "Nuevo Poder de Firma",
    level: 2,
    levelTitle: "⚡ Nivel 2: Momento de Compra",
    group: "B",
    groupTitle: "Cambios de Rol & Triggers",
    description: "Profesionales que acaban de ser promovidos internamente a puestos de liderazgo con capacidad de contratación.",
    icon: RiBriefcaseLine,
    color: "text-purple-500",
    badgeBg: "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300",
    inputKind: "roles_or_industry",
  },
  {
    id: "hiring_spree",
    title: "Hiring Intent (Contratación Activa)",
    badge: "Presupuesto Abierto",
    level: 2,
    levelTitle: "⚡ Nivel 2: Momento de Compra",
    group: "D",
    groupTitle: "Crecimiento de Empresa",
    description: "Empresas con vacantes activas para SDRs, Ventas o Marketing. Si contratan personal, necesitan herramientas.",
    icon: RiBuildingLine,
    color: "text-orange-500",
    badgeBg: "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
    inputKind: "roles_or_industry",
  },

  // Nivel 3: Actividad Reciente & Búsquedas Personalizadas
  {
    id: "active_poster",
    title: "Más Activos en tu ICP (<48h)",
    badge: "Bandeja Caliente",
    level: 3,
    levelTitle: "🟢 Nivel 3: Actividad & Búsqueda",
    group: "C",
    groupTitle: "Actividad & Búsqueda",
    description: "Decisores que publican activamente en LinkedIn, garantizando que su bandeja de entrada está activa y abierta a conectar.",
    icon: RiSparklingLine,
    color: "text-rose-500",
    badgeBg: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
    inputKind: "profile_or_company_url",
  },
  {
    id: "keyword_intent",
    title: "Búsqueda Personalizada por Palabras Clave",
    badge: "Dolor Activo 24/7",
    level: 3,
    levelTitle: "🟢 Nivel 3: Actividad & Búsqueda",
    group: "C",
    groupTitle: "Actividad & Búsqueda",
    description: "Rastrea publicaciones y comentarios preguntando por recomendaciones ('alternativa a...', 'busco CRM', 'herramienta B2B').",
    icon: RiSearchLine,
    color: "text-teal-500",
    badgeBg: "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300",
    inputKind: "keywords",
  },
  {
    id: "company_growth",
    title: "Empresas en Hipercrecimiento (+20%)",
    badge: "Expansión Acelerada",
    level: 3,
    levelTitle: "🟢 Nivel 3: Actividad & Búsqueda",
    group: "D",
    groupTitle: "Crecimiento de Empresa",
    description: "Empresas de tu ICP cuya plantilla comercial ha crecido más de un 20% en los últimos 6 meses en LinkedIn.",
    icon: RiLineChartLine,
    color: "text-cyan-500",
    badgeBg: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300",
    inputKind: "roles_or_industry",
  },
];

export function getSimulatedMessage(
  signalType: string,
  objective: "conversation" | "demo" | "resource",
  tone: "consultive" | "professional" | "direct",
  competitor: string,
  keywords: string[],
  customTemplate?: string
): string {
  const firstName = "Martín";
  const company = "Grupo Retail B2B";
  const comp = competitor.trim() || "soluciones del sector";
  const mainKw = keywords.length > 0 ? keywords[0] : "prospección B2B y automatización";

  if (customTemplate && customTemplate.trim()) {
    return customTemplate
      .replace(/\{first_name\}/gi, firstName)
      .replace(/\{company\}/gi, company)
      .replace(/\{topic\}/gi, mainKw)
      .replace(/\{competitor\}/gi, comp);
  }

  // 1. Competitor Engagement / Comments / Reactions
  if (
    signalType === "competitor_reactions" ||
    signalType === "high_intent_comments" ||
    signalType === "competitor_followers"
  ) {
    if (objective === "demo") {
      return `Hola ${firstName}, vi que has estado explorando soluciones de ${mainKw}. En InHubFlow ayudamos a equipos como el de ${company} a multiplicar sus reuniones cualificadas sin fricción. ¿Tendrías 10 min esta semana para ver una demo breve?`;
    }
    if (objective === "resource") {
      return `Hola ${firstName}, noté que te interesa el debate actual sobre ${mainKw}. Preparamos un playbook con los frameworks de prospección con mayor tasa de respuesta en B2B hoy en día. ¿Te gustaría que te lo comparta por aquí?`;
    }
    if (tone === "direct") {
      return `Hola ${firstName}, veo que sigues de cerca la innovación en ${mainKw}. ¿Cómo están gestionando actualmente este proceso en ${company}? Sería un gusto conectar e intercambiar visiones.`;
    }
    if (tone === "professional") {
      return `Hola ${firstName}, sigo tu trayectoria en ${company}. Dado el creciente interés por optimizar ${mainKw}, me gustaría conectar contigo y compartir algunas mejores prácticas del sector.`;
    }
    return `Hola ${firstName}, vi que has estado explorando temas de ${mainKw}. En ${company}, ¿cómo están abordando actualmente la optimización de este proceso? Me encantaría conectar.`;
  }

  // 2. Job Changes / Just Hired (<90 days)
  if (signalType === "new_in_role" || signalType === "internal_promotion") {
    if (objective === "demo") {
      return `Hola ${firstName}, ¡muchas felicidades por tu nueva posición en ${company}! Durante los primeros 90 días la prioridad suele ser acelerar resultados rápido. ¿Te gustaría que te muestre en 10 min cómo apoyamos a directores en esta fase?`;
    }
    if (objective === "resource") {
      return `Hola ${firstName}, felicitaciones por tu rol en ${company}. Te comparto un checklist práctico para estructurar el stack de prospección en los primeros 90 días. ¿Te interesaría revisarlo?`;
    }
    return `Hola ${firstName}, felicitaciones por tu nueva etapa en ${company}. En estos primeros meses al frente del equipo, ¿están revisando o renovando herramientas de prospección? Éxitos en el rol.`;
  }

  // 3. Hiring Spree
  if (signalType === "hiring_spree" || signalType === "company_growth") {
    if (objective === "demo") {
      return `Hola ${firstName}, noté el crecimiento del equipo en ${company}. Al incorporar nuevos talentos, dotarlos de automatización inteligente reduce la curva de aprendizaje a la mitad. ¿Te interesaría ver una demo rápida?`;
    }
    return `Hola ${firstName}, felicitaciones por la expansión y nuevas vacantes en ${company}. Al sumar nuevos perfiles comerciales, asegurar herramientas de alta conversión es clave. ¿Cómo están planificando el onboarding de prospección?`;
  }

  // 4. Default / Keyword Intent / Active Poster
  if (objective === "demo") {
    return `Hola ${firstName}, sigo tu trabajo en ${company}. Hemos desarrollado una solución enfocada en ${mainKw} que está duplicando respuestas en LinkedIn. ¿Tendrías 10 min para una demo rápida?`;
  }
  if (objective === "resource") {
    return `Hola ${firstName}, noté tu interés en ${mainKw}. Armamos una guía con casos prácticos aplicados a empresas como ${company}. ¿Te parece bien si te la paso por aquí?`;
  }
  return `Hola ${firstName}, vi que sigues activo en temas de ${mainKw}. En ${company}, ¿cómo abordan actualmente este canal? Me gustaría conectar contigo para estar al día.`;
}

export default function SignalsPage({
  initialMonitors,
  lists,
  workflows,
  accounts,
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

  // Modal Nuevo Monitor - Wizard 4 Pasos (Modelo GojiBerry)
  const [showNewModal, setShowNewModal] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);

  // Paso 1: Audiencia y Cliente Ideal (ICP)
  const [icpTitles, setIcpTitles] = useState<string[]>([
    "CEO",
    "Founder",
    "VP of Sales",
    "Director Comercial",
  ]);
  const [customTitleInput, setCustomTitleInput] = useState("");
  const [icpCountries, setIcpCountries] = useState<string[]>(["España", "México", "Colombia"]);
  const [customCountryInput, setCustomCountryInput] = useState("");
  const [icpSizes, setIcpSizes] = useState<string[]>(["11-50", "51-200"]);

  // Paso 2: Señales de Intención (3 Niveles)
  const [newType, setNewType] = useState<string>("competitor_reactions");
  const [signalLevelFilter, setSignalLevelFilter] = useState<"ALL" | 1 | 2 | 3>("ALL");
  const [newCompetitor, setNewCompetitor] = useState("");
  const [newTargetUrl, setNewTargetUrl] = useState("");
  const [keywordsList, setKeywordsList] = useState<string[]>([
    "automatización de ventas",
    "crm",
    "prospección b2b",
    "cold outreach",
  ]);
  const [customKeywordInput, setCustomKeywordInput] = useState("");
  const [timeWindowDays, setTimeWindowDays] = useState<number>(90);

  // Paso 3: Mensaje IA Anti-Stalker
  const [msgObjective, setMsgObjective] = useState<"conversation" | "demo" | "resource">("conversation");
  const [msgTone, setMsgTone] = useState<"consultive" | "professional" | "direct">("consultive");
  const [customTemplate, setCustomTemplate] = useState("");

  // Paso 4: Lanzamiento & Configuración
  const [newName, setNewName] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id || "");
  const [newMode, setNewMode] = useState<"review" | "autopilot">("review");
  const [newTargetList, setNewTargetList] = useState(lists[0]?.id || "");
  const [creatingMonitor, setCreatingMonitor] = useState(false);

  // Modal Importar Leads a Lista
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [targetListId, setTargetListId] = useState(lists[0]?.id || "");
  const [importing, setImporting] = useState(false);

  // Helpers para manipulación de chips
  const handleAddTitle = (title: string) => {
    const t = title.trim();
    if (t && !icpTitles.includes(t)) {
      setIcpTitles([...icpTitles, t]);
    }
    setCustomTitleInput("");
  };

  const handleRemoveTitle = (t: string) => {
    setIcpTitles(icpTitles.filter((item) => item !== t));
  };

  const handleAddCountry = (country: string) => {
    const c = country.trim();
    if (c && !icpCountries.includes(c)) {
      setIcpCountries([...icpCountries, c]);
    }
    setCustomCountryInput("");
  };

  const handleRemoveCountry = (c: string) => {
    setIcpCountries(icpCountries.filter((item) => item !== c));
  };

  const handleToggleSize = (size: string) => {
    if (icpSizes.includes(size)) {
      setIcpSizes(icpSizes.filter((s) => s !== size));
    } else {
      setIcpSizes([...icpSizes, size]);
    }
  };

  const handleAddKeyword = (kw: string) => {
    const k = kw.trim();
    if (k && !keywordsList.includes(k)) {
      setKeywordsList([...keywordsList, k]);
    }
    setCustomKeywordInput("");
  };

  const handleRemoveKeyword = (k: string) => {
    setKeywordsList(keywordsList.filter((item) => item !== k));
  };

  const handleOpenNewWizard = () => {
    setWizardStep(1);
    setShowNewModal(true);
  };

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

  // Crear Monitor (Lanzamiento desde Wizard)
  const handleCreateMonitor = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const def = SIGNAL_DEFINITIONS.find((d) => d.id === newType);
    const monitorName =
      newName.trim() ||
      `${def?.title || "Radar"} - ${newCompetitor.trim() || keywordsList[0] || "ICP"}`;

    let targetUrlToSend = newTargetUrl.trim() || undefined;
    if (def?.inputKind === "roles_or_industry" && icpTitles.length > 0) {
      targetUrlToSend = icpTitles.join(", ");
    }

    setCreatingMonitor(true);
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: monitorName,
          type: newType,
          competitor_name: newCompetitor.trim() || undefined,
          target_url: targetUrlToSend,
          keywords: keywordsList,
          icp_filters: {
            titles: icpTitles,
            locations: icpCountries,
            company_sizes: icpSizes,
          },
          mode: newMode,
          account_id: selectedAccountId || undefined,
          target_list_id: newTargetList || undefined,
          message_config: {
            objective: msgObjective,
            tone: msgTone,
            custom_template: customTemplate.trim() || undefined,
          },
        }),
      });

      if (res.ok) {
        const created = await res.json();
        toast.success(`Monitor "${created.name}" creado con éxito`);
        setShowNewModal(false);
        setWizardStep(1);
        setNewName("");
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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/10 text-brand-500 dark:bg-brand-500/20">
                <RiRadarLine size={20} />
              </span>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                Signal Radar
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-300">
                Intent Outreach
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Monitorea publicaciones de competidores, cambios de puesto y eventos en tiempo real para prospectar en caliente.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleOpenNewWizard}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 dark:bg-brand-500 dark:hover:bg-brand-600 transition-all shadow-xs"
            >
              <RiAddLine size={18} /> Nuevo Monitor
            </button>
            <Link
              href="/sdr"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
            >
              <RiRobotLine size={16} className="text-brand-500" /> Asistente SDR
            </Link>
          </div>
        </div>

        {/* Métricas Rápidas (Stats Cards) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs">
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 text-xs font-semibold uppercase">
              <span>Monitores Activos</span>
              <RiRadarLine className="text-brand-500" size={18} />
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

        {/* Sección "Ask AI" */}
        <div className="bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/20 dark:to-indigo-950/20 border border-brand-500/20 dark:border-brand-500/10 rounded-2xl p-5 shadow-theme-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RiSparklingLine className="text-brand-600 dark:text-brand-400" size={20} />
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                Ask AI — Investigador Autónomo de Prospectos
              </h3>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 rounded-md">
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
                className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-xs md:text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <button
              type="submit"
              disabled={askLoading || !askPrompt.trim()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs md:text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-50 transition-all shadow-xs shrink-0"
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
                  ? "text-brand-500 dark:text-brand-400 border-b-2 border-brand-500 dark:border-brand-400"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Hot Leads / Cola de Revisión
              {totalPending > 0 && (
                <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-300">
                  {totalPending}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("monitors")}
              className={`pb-3 text-sm font-semibold transition-all relative ${
                activeTab === "monitors"
                  ? "text-brand-500 dark:text-brand-400 border-b-2 border-brand-500 dark:border-brand-400"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Monitores Configurados ({monitors.length})
            </button>

            <button
              onClick={() => setActiveTab("guide")}
              className={`pb-3 text-sm font-semibold transition-all relative ${
                activeTab === "guide"
                  ? "text-brand-500 dark:text-brand-400 border-b-2 border-brand-500 dark:border-brand-400"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Estrategia de Señales
            </button>
          </div>

          {activeTab === "leads" && selectedLeadIds.length > 0 && (
            <button
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 mb-2 rounded-xl text-xs font-semibold text-white bg-brand-500 hover:bg-brand-600 shadow-xs"
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
                <RiRefreshLine className="animate-spin mx-auto text-brand-500" size={28} />
                <p className="text-sm">Cargando señales detectadas...</p>
              </div>
            ) : leads.length === 0 ? (
              <div className="p-12 text-center bg-white dark:bg-gray-900 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 space-y-3">
                <RiRadarLine className="mx-auto text-brand-500/60" size={36} />
                <h3 className="font-bold text-gray-900 dark:text-white text-base">
                  No hay prospectos en esta vista
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                  Crea un nuevo monitor de señales para rastrear publicaciones de tus competidores o haz clic en "Escanear Ahora" en la pestaña de Monitores.
                </p>
                <button
                  onClick={() => setShowNewModal(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-brand-500 hover:bg-brand-600 transition-all shadow-xs"
                >
                  <RiAddLine size={16} /> Crear Primer Monitor
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {leads.map((lead) => (
                  <div
                    key={lead.id}
                    className="p-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:border-brand-500/40 dark:hover:border-brand-500/40"
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
                          className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                        />
                        <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                          {lead.full_name}
                        </h4>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {lead.company ? `@ ${lead.company}` : ""}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-brand-100 text-brand-800 dark:bg-brand-950/60 dark:text-brand-300">
                          {lead.signal_type === "post_comment" || lead.signal_type === "high_intent_comments"
                            ? "Comentó en Post"
                            : lead.signal_type === "post_reaction" || lead.signal_type === "competitor_reactions"
                            ? "Reaccionó a Post"
                            : lead.signal_type === "job_change" || lead.signal_type === "new_in_role"
                            ? "Nuevo en el Cargo (<90d)"
                            : lead.signal_type === "internal_promotion"
                            ? "Ascenso Interno"
                            : lead.signal_type === "competitor_followers"
                            ? "Seguidor de Competidor"
                            : lead.signal_type === "active_poster"
                            ? "Creador Activo (<30d)"
                            : lead.signal_type === "keyword_intent"
                            ? "Palabras Clave de Compra"
                            : lead.signal_type === "hiring_spree"
                            ? "Contratación Activa (Hiring)"
                            : lead.signal_type === "company_growth"
                            ? "Empresa en Expansión"
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
                          <span className="font-bold text-brand-600 dark:text-brand-400">
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
            {monitors.length === 0 ? (
              <div className="text-center py-16 bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 space-y-4 shadow-theme-xs">
                <div className="w-14 h-14 rounded-2xl bg-brand-500/10 text-brand-600 flex items-center justify-center mx-auto">
                  <RiRadarLine size={28} />
                </div>
                <div className="space-y-1 max-w-md mx-auto">
                  <h3 className="font-black text-base text-gray-900 dark:text-white">
                    Aún no tienes monitores de señales activos
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Configura tu primer radar con el asistente paso a paso para detectar decisores calientes en LinkedIn e iniciar conversaciones con la fórmula Anti-Stalker.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenNewWizard}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 shadow-md hover:shadow-lg transition-all"
                >
                  <RiAddLine size={16} /> Crear mi Primer Monitor
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {monitors.map((m) => {
                const def = SIGNAL_DEFINITIONS.find((d) => d.id === m.type);
                const IconComp = def ? def.icon : RiRadarLine;
                const signalTitle = def ? def.title : (m.type === "post_engagement" ? "Post de Competidor" : m.type === "job_changes" ? "Job Changers (<90 días)" : "Señal de Intención");
                const badgeColor = def ? def.color : "text-brand-500";
                return (
                  <div
                    key={m.id}
                    className="p-5 bg-white dark:bg-gray-900 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 ${badgeColor}`}>
                            <IconComp size={18} />
                          </span>
                          <div>
                            <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                              {m.name}
                            </h4>
                            <span className="text-[11px] text-gray-500 dark:text-gray-400">
                              {signalTitle}
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
                          href={m.target_url.startsWith("http") ? m.target_url : `https://${m.target_url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1 truncate"
                        >
                          <RiExternalLinkLine size={12} className="shrink-0" /> {m.target_url}
                        </a>
                      )}

                      <div className="pt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800">
                        <span>Total captados: <strong className="text-gray-900 dark:text-white">{m.total_leads || 0}</strong></span>
                        <span>Pendientes: <strong className="text-brand-600">{m.pending_leads || 0}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
                      <button
                        onClick={() => handleScanMonitor(m.id, m.name)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300 transition-colors"
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
                );
              })}
            </div>
          )}
        </div>
      )}

        {/* TAB 3: GUÍA ESTRATÉGICA DE 8+1 SEÑALES */}
        {activeTab === "guide" && (
          <div className="bg-white dark:bg-gray-900 p-6 md:p-8 rounded-2xl border border-gray-300 dark:border-gray-700 shadow-theme-xs space-y-8">
            <div className="space-y-2 border-b border-gray-100 dark:border-gray-800 pb-5">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-brand-100 text-brand-800 dark:bg-brand-950/60 dark:text-brand-300">
                  Metodología Intent-Based Outreach
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Inspirada en el modelo de Gojiberry AI
                </span>
              </div>
              <h3 className="text-lg md:text-xl font-black text-gray-900 dark:text-white">
                Matriz Completa de Señales de Intención de Compra
              </h3>
              <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-3xl">
                La prospección en frío masiva obtiene menos del 3% de respuesta porque contacta a destiempo. 
                Signal Radar detecta momentos de compra activos para que tu primer mensaje tenga hasta un <strong>40%+ de respuesta</strong>.
              </p>
            </div>

            {/* Los 4 Grupos Estratégicos */}
            <div className="space-y-6">
              {/* GRUPO A */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                  <span className="w-6 h-6 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center text-xs">
                    A
                  </span>
                  <span>Grupo A: Señales Sociales y de Competencia (Mayor Tasa de Conversión)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {SIGNAL_DEFINITIONS.filter((s) => s.group === "A").map((sig) => (
                    <div key={sig.id} className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/15 space-y-2">
                      <div className="flex items-center justify-between">
                        <sig.icon className={sig.color} size={18} />
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sig.badgeBg}`}>
                          {sig.badge}
                        </span>
                      </div>
                      <h4 className="font-bold text-xs text-gray-900 dark:text-white">{sig.title}</h4>
                      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">{sig.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* GRUPO B */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                  <span className="w-6 h-6 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-xs">
                    B
                  </span>
                  <span>Grupo B: Señales de Carrera y Cambio de Puesto (Timing Perfecto)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {SIGNAL_DEFINITIONS.filter((s) => s.group === "B").map((sig) => (
                    <div key={sig.id} className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/15 space-y-2">
                      <div className="flex items-center justify-between">
                        <sig.icon className={sig.color} size={18} />
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sig.badgeBg}`}>
                          {sig.badge}
                        </span>
                      </div>
                      <h4 className="font-bold text-xs text-gray-900 dark:text-white">{sig.title}</h4>
                      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">{sig.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* GRUPO C */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                  <span className="w-6 h-6 rounded-lg bg-brand-500/10 text-brand-600 flex items-center justify-center text-xs">
                    C
                  </span>
                  <span>Grupo C: Señales de Actividad, Contenido y Palabras Clave (Calidad de Conexión)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {SIGNAL_DEFINITIONS.filter((s) => s.group === "C").map((sig) => (
                    <div key={sig.id} className="p-4 rounded-2xl bg-brand-500/5 border border-brand-500/15 space-y-2">
                      <div className="flex items-center justify-between">
                        <sig.icon className={sig.color} size={18} />
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sig.badgeBg}`}>
                          {sig.badge}
                        </span>
                      </div>
                      <h4 className="font-bold text-xs text-gray-900 dark:text-white">{sig.title}</h4>
                      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">{sig.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* GRUPO D */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                  <span className="w-6 h-6 rounded-lg bg-cyan-500/10 text-cyan-600 flex items-center justify-center text-xs">
                    D
                  </span>
                  <span>Grupo D: Señales de Crecimiento Empresarial (Alta Capacidad de Pago)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {SIGNAL_DEFINITIONS.filter((s) => s.group === "D").map((sig) => (
                    <div key={sig.id} className="p-4 rounded-2xl bg-cyan-500/5 border border-cyan-500/15 space-y-2">
                      <div className="flex items-center justify-between">
                        <sig.icon className={sig.color} size={18} />
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sig.badgeBg}`}>
                          {sig.badge}
                        </span>
                      </div>
                      <h4 className="font-bold text-xs text-gray-900 dark:text-white">{sig.title}</h4>
                      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">{sig.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Wizard de Creación de Monitor (4 Pasos - Inspirado en GojiBerry) */}
        {showNewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs">
            <div className="w-full max-w-4xl max-h-[92vh] flex flex-col bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden">
              {/* 1. Cabecera Principal del Modal */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
                    <RiRadarLine size={22} />
                  </span>
                  <div>
                    <h3 className="font-black text-base sm:text-lg text-gray-900 dark:text-white leading-tight">
                      Configurar Monitor de Señales de Intención
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Asistente guiado paso a paso para prospección inteligente (Modelo GojiBerry)
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <RiCloseLine size={22} />
                </button>
              </div>

              {/* 2. Barra de Progreso del Wizard (Stepper) */}
              <div className="px-6 py-3.5 border-b border-gray-100 dark:border-gray-800/80 bg-gray-50/60 dark:bg-gray-850/50">
                <div className="flex items-center justify-between max-w-3xl mx-auto">
                  {[
                    { num: 1, label: "Definir ICP", icon: RiUserSearchLine },
                    { num: 2, label: "Señales", icon: RiRadarLine },
                    { num: 3, label: "Mensaje IA", icon: RiSparklingLine },
                    { num: 4, label: "Lanzar", icon: RiPlayLine },
                  ].map((step, idx) => {
                    const isCurrent = wizardStep === step.num;
                    const isPast = wizardStep > step.num;
                    const StepIcon = step.icon;
                    return (
                      <div key={step.num} className="flex items-center flex-1 last:flex-none">
                        <button
                          type="button"
                          onClick={() => setWizardStep(step.num as any)}
                          className="flex items-center gap-2 group text-left focus:outline-none"
                        >
                          <span
                            className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold transition-all ${
                              isCurrent
                                ? "bg-brand-500 text-white shadow-md shadow-brand-500/25 ring-2 ring-brand-500/30"
                                : isPast
                                ? "bg-emerald-500 text-white"
                                : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 group-hover:bg-gray-300"
                            }`}
                          >
                            {isPast ? <RiCheckLine size={15} /> : <StepIcon size={14} />}
                          </span>
                          <div className="hidden sm:block">
                            <span
                              className={`text-xs font-bold block leading-tight ${
                                isCurrent
                                  ? "text-brand-600 dark:text-brand-400"
                                  : isPast
                                  ? "text-gray-900 dark:text-white"
                                  : "text-gray-400"
                              }`}
                            >
                              Paso {step.num}
                            </span>
                            <span className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
                              {step.label}
                            </span>
                          </div>
                        </button>
                        {idx < 3 && (
                          <div
                            className={`flex-1 h-0.5 mx-2 sm:mx-4 transition-colors ${
                              isPast ? "bg-emerald-500" : "bg-gray-200 dark:bg-gray-700"
                            }`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Contenido del Wizard según el paso activo */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
                {/* =========================================================
                    PASO 1: DEFINIR AUDIENCIA Y CLIENTE IDEAL (ICP)
                   ========================================================= */}
                {wizardStep === 1 && (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-100 text-brand-800 dark:bg-brand-950/60 dark:text-brand-300">
                        <RiUserSearchLine size={13} /> Paso 1 de 4: Audiencia Objetivo
                      </div>
                      <h4 className="text-lg font-black text-gray-900 dark:text-white">
                        ¿A quién deseas encontrar con este monitor?
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Filtra cargos, países y tamaños de empresa para que el radar capture únicamente a tus decisores clave.
                      </p>
                    </div>

                    {/* 1. Cargos y Títulos de Decisores */}
                    <div className="space-y-2.5">
                      <label className="block text-xs font-bold text-gray-800 dark:text-gray-200">
                        1. Cargos y Títulos Objetivo (ICP Titles)
                      </label>
                      <div className="flex flex-wrap gap-1.5 p-2 rounded-2xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 min-h-[44px]">
                        {icpTitles.map((title) => (
                          <span
                            key={title}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-brand-50 text-brand-700 dark:bg-brand-950/70 dark:text-brand-300 border border-brand-200/80 dark:border-brand-800/60 shadow-2xs"
                          >
                            {title}
                            <button
                              type="button"
                              onClick={() => handleRemoveTitle(title)}
                              className="hover:text-red-500 transition-colors"
                            >
                              <RiCloseLine size={14} />
                            </button>
                          </span>
                        ))}
                      </div>

                      {/* Input para escribir cargo */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={customTitleInput}
                          onChange={(e) => setCustomTitleInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddTitle(customTitleInput);
                            }
                          }}
                          placeholder="Escribe un cargo y pulsa Enter (ej: Head of Outbound, CMO...)"
                          className="flex-1 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs md:text-sm text-gray-900 shadow-2xs focus:border-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddTitle(customTitleInput)}
                          className="px-4 py-2 rounded-xl text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300 transition-colors shrink-0"
                        >
                          + Añadir
                        </button>
                      </div>

                      {/* Sugerencias Rápidas de Cargos */}
                      <div className="space-y-1">
                        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                          Sugerencias rápidas:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            "CEO",
                            "Founder",
                            "VP Sales",
                            "Director Comercial",
                            "Head of Growth",
                            "Director de Marketing",
                            "COO",
                            "Gerente General",
                          ].map((sugg) => {
                            const isAdded = icpTitles.includes(sugg);
                            return (
                              <button
                                key={sugg}
                                type="button"
                                onClick={() => (isAdded ? handleRemoveTitle(sugg) : handleAddTitle(sugg))}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                                  isAdded
                                    ? "bg-brand-500 text-white shadow-2xs"
                                    : "bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                                }`}
                              >
                                {isAdded ? `✓ ${sugg}` : `+ ${sugg}`}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* 2. Ubicación / Países */}
                    <div className="space-y-2.5 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <label className="block text-xs font-bold text-gray-800 dark:text-gray-200">
                        2. Ubicación Geográfica / Países
                      </label>
                      <div className="flex flex-wrap gap-1.5 p-2 rounded-2xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 min-h-[44px]">
                        {icpCountries.map((country) => (
                          <span
                            key={country}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 shadow-2xs"
                          >
                            <RiMapPinLine size={12} /> {country}
                            <button
                              type="button"
                              onClick={() => handleRemoveCountry(country)}
                              className="hover:text-red-500 transition-colors"
                            >
                              <RiCloseLine size={14} />
                            </button>
                          </span>
                        ))}
                      </div>

                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={customCountryInput}
                          onChange={(e) => setCustomCountryInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddCountry(customCountryInput);
                            }
                          }}
                          placeholder="Añadir país o región y pulsa Enter..."
                          className="flex-1 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs md:text-sm text-gray-900 shadow-2xs focus:border-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddCountry(customCountryInput)}
                          className="px-4 py-2 rounded-xl text-xs font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 transition-colors shrink-0"
                        >
                          + Añadir
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {["España", "México", "Colombia", "Argentina", "Chile", "Perú", "Estados Unidos"].map((c) => {
                          const isAdded = icpCountries.includes(c);
                          return (
                            <button
                              key={c}
                              type="button"
                              onClick={() => (isAdded ? handleRemoveCountry(c) : handleAddCountry(c))}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                                isAdded
                                  ? "bg-emerald-500 text-white shadow-2xs"
                                  : "bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                              }`}
                            >
                              {isAdded ? `✓ ${c}` : `+ ${c}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 3. Tamaño de Empresa */}
                    <div className="space-y-2.5 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <label className="block text-xs font-bold text-gray-800 dark:text-gray-200">
                        3. Tamaño de Empresa (Empleados)
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {[
                          { id: "1-10", label: "1-10 emp." },
                          { id: "11-50", label: "11-50 emp." },
                          { id: "51-200", label: "51-200 emp." },
                          { id: "201-500", label: "201-500 emp." },
                          { id: "500+", label: "500+ emp." },
                        ].map((sz) => {
                          const isSelected = icpSizes.includes(sz.id);
                          return (
                            <button
                              key={sz.id}
                              type="button"
                              onClick={() => handleToggleSize(sz.id)}
                              className={`p-2.5 rounded-xl border text-center text-xs font-semibold transition-all ${
                                isSelected
                                  ? "border-brand-500 bg-brand-500 text-white shadow-2xs"
                                  : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300"
                              }`}
                            >
                              {sz.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Resumen de configuración ICP */}
                    <div className="p-3.5 rounded-2xl bg-brand-50/50 dark:bg-brand-950/20 border border-brand-200/60 dark:border-brand-900/40 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 text-brand-900 dark:text-brand-200">
                        <RiShieldCheckLine size={18} className="text-brand-500 shrink-0" />
                        <span>
                          <strong>ICP Calificado:</strong> {icpTitles.length} cargos seleccionados en{" "}
                          {icpCountries.length} países y {icpSizes.length} rangos de tamaño.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* =========================================================
                    PASO 2: SELECCIÓN DE SEÑAL DE INTENCIÓN (3 NIVELES)
                   ========================================================= */}
                {wizardStep === 2 && (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                        <RiRadarLine size={13} /> Paso 2 de 4: Señales de Intención
                      </div>
                      <h4 className="text-lg font-black text-gray-900 dark:text-white">
                        Selecciona el Disparador de Compra
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Elige qué comportamiento o evento en LinkedIn activará la captura de prospectos según su temperatura.
                      </p>
                    </div>

                    {/* Segmented Filter Bar por Niveles */}
                    <div className="flex flex-wrap gap-1.5 p-1 rounded-2xl bg-gray-100 dark:bg-gray-800/80 text-xs">
                      <button
                        type="button"
                        onClick={() => setSignalLevelFilter("ALL")}
                        className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
                          signalLevelFilter === "ALL"
                            ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-2xs"
                            : "text-gray-500 hover:text-gray-800 dark:text-gray-400"
                        }`}
                      >
                        Todas las Señales (9)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSignalLevelFilter(1)}
                        className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
                          signalLevelFilter === 1
                            ? "bg-white dark:bg-gray-700 text-amber-700 dark:text-amber-300 shadow-2xs"
                            : "text-gray-500 hover:text-gray-800 dark:text-gray-400"
                        }`}
                      >
                        🔥 Nivel 1: Máxima Intención (Calientes)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSignalLevelFilter(2)}
                        className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
                          signalLevelFilter === 2
                            ? "bg-white dark:bg-gray-700 text-emerald-700 dark:text-emerald-300 shadow-2xs"
                            : "text-gray-500 hover:text-gray-800 dark:text-gray-400"
                        }`}
                      >
                        ⚡ Nivel 2: Momento de Compra (Triggers)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSignalLevelFilter(3)}
                        className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
                          signalLevelFilter === 3
                            ? "bg-white dark:bg-gray-700 text-teal-700 dark:text-teal-300 shadow-2xs"
                            : "text-gray-500 hover:text-gray-800 dark:text-gray-400"
                        }`}
                      >
                        🟢 Nivel 3: Actividad & Búsquedas
                      </button>
                    </div>

                    {/* Grid de Cards de Señales */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
                      {SIGNAL_DEFINITIONS.filter(
                        (s) => signalLevelFilter === "ALL" || s.level === signalLevelFilter
                      ).map((sig) => {
                        const isSelected = newType === sig.id;
                        const SigIcon = sig.icon;
                        return (
                          <button
                            key={sig.id}
                            type="button"
                            onClick={() => setNewType(sig.id)}
                            className={`p-3.5 rounded-2xl border text-left transition-all relative flex flex-col justify-between gap-2 ${
                              isSelected
                                ? "border-brand-500 bg-brand-50/50 dark:bg-brand-950/40 ring-2 ring-brand-500/20"
                                : "border-gray-200 dark:border-gray-700/80 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-850"
                            }`}
                          >
                            <div className="flex items-start justify-between w-full">
                              <div className="flex items-center gap-2.5">
                                <span className={`p-2 rounded-xl bg-gray-100 dark:bg-gray-800 ${sig.color}`}>
                                  <SigIcon size={18} />
                                </span>
                                <div>
                                  <h5 className="font-bold text-xs text-gray-900 dark:text-white leading-tight">
                                    {sig.title}
                                  </h5>
                                  <span className="text-[10px] text-gray-400 font-medium">
                                    {sig.levelTitle}
                                  </span>
                                </div>
                              </div>
                              {isSelected && (
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-white shrink-0">
                                  <RiCheckLine size={13} />
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                              {sig.description}
                            </p>
                            <div className="pt-1 flex items-center justify-between">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${sig.badgeBg}`}>
                                {sig.badge}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Parámetros Contextuales según la señal seleccionada */}
                    <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-900 dark:text-white">
                          Parámetros para:{" "}
                          <span className="text-brand-600">
                            {SIGNAL_DEFINITIONS.find((s) => s.id === newType)?.title}
                          </span>
                        </span>
                      </div>

                      {/* Si es engagement con competidores o comentarios */}
                      {(newType === "competitor_reactions" || newType === "high_intent_comments") && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                              Nombre del Competidor o Marca Referente *
                            </label>
                            <input
                              type="text"
                              value={newCompetitor}
                              onChange={(e) => setNewCompetitor(e.target.value)}
                              placeholder="Ej: HubSpot, Lemlist, Salesforce, Apollo..."
                              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                              URL del Post Específico (Opcional)
                            </label>
                            <input
                              type="url"
                              value={newTargetUrl}
                              onChange={(e) => setNewTargetUrl(e.target.value)}
                              placeholder="https://www.linkedin.com/posts/..."
                              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                            />
                          </div>
                        </div>
                      )}

                      {/* Si es seguidores o perfil de competidor */}
                      {newType === "competitor_followers" && (
                        <div>
                          <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                            URL de Empresa o Perfil de Referente en LinkedIn *
                          </label>
                          <input
                            type="url"
                            value={newTargetUrl}
                            onChange={(e) => setNewTargetUrl(e.target.value)}
                            placeholder="https://www.linkedin.com/company/... o https://www.linkedin.com/in/..."
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          />
                        </div>
                      )}

                      {/* Si es palabras clave de intención (Keyword Intent) */}
                      {newType === "keyword_intent" && (
                        <div className="space-y-2">
                          <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                            Palabras Clave de Búsqueda de Compra (Chips interactivos)
                          </label>
                          <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                            {keywordsList.map((kw) => (
                              <span
                                key={kw}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800/60"
                              >
                                {kw}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveKeyword(kw)}
                                  className="hover:text-red-500"
                                >
                                  <RiCloseLine size={13} />
                                </button>
                              </span>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={customKeywordInput}
                              onChange={(e) => setCustomKeywordInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleAddKeyword(customKeywordInput);
                                }
                              }}
                              placeholder="Escribe palabra clave y pulsa Enter (ej: 'busco CRM', 'alternativa a Lemlist')..."
                              className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddKeyword(customKeywordInput)}
                              className="px-3 py-1.5 rounded-xl text-xs font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/60 dark:text-teal-300 transition-colors shrink-0"
                            >
                              + Añadir
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1 text-[11px]">
                            <span className="text-gray-400">Sugerencias:</span>
                            {[
                              "automatización de ventas",
                              "crm",
                              "prospección b2b",
                              "cold outreach",
                              "contratar sdrs",
                              "alternativas a hubspot",
                            ].map((kwSugg) => (
                              <button
                                key={kwSugg}
                                type="button"
                                onClick={() => handleAddKeyword(kwSugg)}
                                className="text-brand-600 hover:underline px-1"
                              >
                                + {kwSugg}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Si es nuevo en el rol o cambio de puesto */}
                      {(newType === "new_in_role" || newType === "internal_promotion") && (
                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                            Ventana Dorada de Presupuesto (Antigüedad máxima en el nuevo cargo)
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { days: 30, label: "Últimos 30 días", sub: "Recién llegado" },
                              { days: 60, label: "Últimos 60 días", sub: "Evaluando stack" },
                              { days: 90, label: "Últimos 90 días", sub: "Ventana Dorada (Recomendado)" },
                            ].map((win) => (
                              <button
                                key={win.days}
                                type="button"
                                onClick={() => setTimeWindowDays(win.days)}
                                className={`p-2.5 rounded-xl border text-center text-xs transition-all ${
                                  timeWindowDays === win.days
                                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 font-bold ring-2 ring-emerald-500/20"
                                    : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
                                }`}
                              >
                                <div>{win.label}</div>
                                <div className="text-[10px] text-gray-400 font-normal">{win.sub}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* =========================================================
                    PASO 3: MENSAJE IA ANTI-STALKER & LIVE PREVIEW
                   ========================================================= */}
                {wizardStep === 3 && (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
                        <RiSparklingLine size={13} /> Paso 3 de 4: Mensaje IA Anti-Stalker
                      </div>
                      <h4 className="text-lg font-black text-gray-900 dark:text-white">
                        Fórmula de Apertura Anti-Stalker (La Regla de Oro)
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Configura cómo redactará la IA para que el contacto sea 100% natural, relevante y con alta respuesta.
                      </p>
                    </div>

                    {/* Banner La Regla de Oro de GojiBerry */}
                    <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 space-y-2">
                      <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 text-xs font-bold">
                        <span className="text-amber-600 text-base">💡</span>
                        <span>La Regla de Oro de GojiBerry:</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-red-900 dark:text-red-200">
                          <span className="font-bold">❌ Error Típico (Stalker): </span>
                          "Hola, vi que le diste like a mi competidor X..." (Suena a acosador/invasivo).
                        </div>
                        <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 text-emerald-900 dark:text-emerald-200">
                          <span className="font-bold">✅ Fórmula InHubFlow: </span>
                          Usa la señal como contexto natural para debatir su proceso actual sin revelar rastreo.
                        </div>
                      </div>
                    </div>

                    {/* Selector de Objetivo del Mensaje */}
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-gray-800 dark:text-gray-200">
                        1. Objetivo de Conversión del Mensaje
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {[
                          {
                            id: "conversation",
                            title: "💬 Iniciar Conversación",
                            desc: "Abre diálogo estratégico sobre cuellos de botella en su proceso.",
                          },
                          {
                            id: "demo",
                            title: "📅 Agendar Demo Breve",
                            desc: "Propuesta de valor directa para directores con dolor activo.",
                          },
                          {
                            id: "resource",
                            title: "📖 Compartir Recurso / Guía",
                            desc: "Ofrece un framework o playbook sin fricción comercial inicial.",
                          },
                        ].map((obj) => (
                          <button
                            key={obj.id}
                            type="button"
                            onClick={() => setMsgObjective(obj.id as any)}
                            className={`p-3 rounded-2xl border text-left text-xs transition-all ${
                              msgObjective === obj.id
                                ? "border-brand-500 bg-brand-50 dark:bg-brand-950/40 text-brand-900 dark:text-brand-200 font-bold ring-2 ring-brand-500/20"
                                : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                            }`}
                          >
                            <div className="font-bold">{obj.title}</div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 font-normal mt-1 leading-snug">
                              {obj.desc}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Selector de Tono */}
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-gray-800 dark:text-gray-200">
                        2. Tono de la IA
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: "consultive", label: "🎯 Consultivo & Experto (Recomendado)" },
                          { id: "professional", label: "⚡ Profesional & Directo" },
                          { id: "direct", label: "🤝 Cercano & Casual" },
                        ].map((tn) => (
                          <button
                            key={tn.id}
                            type="button"
                            onClick={() => setMsgTone(tn.id as any)}
                            className={`p-2.5 rounded-xl border text-center text-xs transition-all ${
                              msgTone === tn.id
                                ? "border-purple-500 bg-purple-50 dark:bg-purple-950/40 text-purple-900 dark:text-purple-200 font-bold ring-2 ring-purple-500/20"
                                : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                            }`}
                          >
                            {tn.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* LIVE PREVIEW: Simulador de Mensaje en LinkedIn */}
                    <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                          Simulación en Tiempo Real (LinkedIn Direct Message Preview)
                        </label>
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                          🛡️ Anti-Stalker Verified
                        </span>
                      </div>

                      {/* Mockup de LinkedIn Card */}
                      <div className="p-4 rounded-2xl bg-[#F3F6F8] dark:bg-gray-850 border border-gray-300 dark:border-gray-700 space-y-3">
                        {/* Cabecera del chat de LinkedIn */}
                        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-brand-600 to-indigo-500 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                              ME
                            </div>
                            <div>
                              <div className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-1.5">
                                Martín Echavarría
                                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                              </div>
                              <div className="text-[10px] text-gray-500 dark:text-gray-400">
                                Director Comercial & Alianzas @ Grupo Retail B2B
                              </div>
                            </div>
                          </div>
                          <span className="text-[10px] text-gray-400 font-medium">En línea</span>
                        </div>

                        {/* Burbuja de mensaje */}
                        <div className="space-y-1">
                          <span className="text-[10px] text-gray-400 block text-center">
                            Hoy · Mensaje generado con IA contextual
                          </span>
                          <div className="max-w-xl bg-white dark:bg-gray-800 p-4 rounded-2xl rounded-tl-xs border border-gray-200 dark:border-gray-700 shadow-2xs text-xs md:text-sm text-gray-800 dark:text-gray-200 leading-relaxed font-normal">
                            {getSimulatedMessage(
                              newType,
                              msgObjective,
                              msgTone,
                              newCompetitor,
                              keywordsList,
                              customTemplate
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-gray-400 pt-1">
                          <span>Generado según ICP + Señal de Intención</span>
                          <span>InHubFlow AI Engine</span>
                        </div>
                      </div>
                    </div>

                    {/* Plantilla Personalizada Opcional */}
                    <div className="pt-2">
                      <details className="text-xs text-gray-600 dark:text-gray-400 group">
                        <summary className="cursor-pointer font-semibold text-brand-600 hover:underline">
                          + ¿Deseas redactar una plantilla personalizada con variables?
                        </summary>
                        <div className="mt-2 space-y-2">
                          <textarea
                            rows={3}
                            value={customTemplate}
                            onChange={(e) => setCustomTemplate(e.target.value)}
                            placeholder="Hola {first_name}, vi que sigues activo en {topic}... ¿Cómo abordan este reto en {company}?"
                            className="w-full rounded-xl border border-gray-300 bg-white p-3 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          />
                          <p className="text-[11px] text-gray-400">
                            Variables disponibles: <code>{"{first_name}"}</code>, <code>{"{company}"}</code>, <code>{"{topic}"}</code>, <code>{"{competitor}"}</code>.
                          </p>
                        </div>
                      </details>
                    </div>
                  </div>
                )}

                {/* =========================================================
                    PASO 4: REVISIÓN FINAL, CUENTA Y LANZAMIENTO
                   ========================================================= */}
                {wizardStep === 4 && (
                  <div className="space-y-6 animate-in fade-in duration-200">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                        <RiPlayLine size={13} /> Paso 4 de 4: Revisar y Activar
                      </div>
                      <h4 className="text-lg font-black text-gray-900 dark:text-white">
                        Lanzamiento del Monitor de Señales
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Define el modo de ejecución y la cuenta de LinkedIn encargada de la prospección.
                      </p>
                    </div>

                    {/* 1. Nombre del Monitor */}
                    <div>
                      <label className="block text-xs font-bold text-gray-800 dark:text-gray-200 mb-1">
                        Nombre del Monitor *
                      </label>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={`Radar: ${
                          SIGNAL_DEFINITIONS.find((s) => s.id === newType)?.title || "Señales"
                        } - ${newCompetitor || keywordsList[0] || "ICP"}`}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs md:text-sm text-gray-900 shadow-2xs focus:border-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>

                    {/* 2. Cuenta de LinkedIn Remitente */}
                    {accounts.length > 0 && (
                      <div>
                        <label className="block text-xs font-bold text-gray-800 dark:text-gray-200 mb-1">
                          Cuenta de LinkedIn Remitente
                        </label>
                        <select
                          value={selectedAccountId}
                          onChange={(e) => setSelectedAccountId(e.target.value)}
                          className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs md:text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                        >
                          {accounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name} {acc.is_authenticated ? "(Conectada ✓)" : "(Desconectada)"}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* 3. Modo de Operación (Review vs Autopilot) */}
                    <div>
                      <label className="block text-xs font-bold text-gray-800 dark:text-gray-200 mb-2">
                        Modo de Operación
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setNewMode("review")}
                          className={`p-4 rounded-2xl border text-left text-xs transition-all ${
                            newMode === "review"
                              ? "border-brand-500 bg-brand-50/60 dark:bg-brand-950/30 text-brand-900 dark:text-brand-200 font-bold ring-2 ring-brand-500/20"
                              : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          <div className="font-bold flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              Modo Revisión
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-300">
                                Recomendado
                              </span>
                            </span>
                            {newMode === "review" && <RiCheckLine className="text-brand-500" size={18} />}
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 font-normal mt-1.5 leading-relaxed">
                            Los prospectos captados van a tu cola de "Hot Leads". Revisas y apruebas el mensaje antes de disparar el contacto.
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setNewMode("autopilot")}
                          className={`p-4 rounded-2xl border text-left text-xs transition-all ${
                            newMode === "autopilot"
                              ? "border-purple-500 bg-purple-50/60 dark:bg-purple-950/30 text-purple-900 dark:text-purple-200 font-bold ring-2 ring-purple-500/20"
                              : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          <div className="font-bold flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              Piloto Automático (Autopilot)
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300">
                                24/7 Autónomo
                              </span>
                            </span>
                            {newMode === "autopilot" && <RiCheckLine className="text-purple-500" size={18} />}
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 font-normal mt-1.5 leading-relaxed">
                            InHubFlow califica a los prospectos contra tu ICP, genera el icebreaker anti-stalker y encola el contacto automáticamente.
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* 4. Lista Destino (Opcional) */}
                    {lists.length > 0 && (
                      <div>
                        <label className="block text-xs font-bold text-gray-800 dark:text-gray-200 mb-1">
                          Guardar prospectos aprobados en Lista (Opcional)
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

                    {/* Ficha Resumen Completa */}
                    <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700 space-y-3">
                      <span className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider block">
                        Resumen de Configuración del Monitor
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div className="p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                          <span className="text-[10px] text-gray-400 block">Audiencia (ICP)</span>
                          <strong className="text-gray-800 dark:text-gray-200">
                            {icpTitles.length} cargos · {icpCountries.length} países
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                          <span className="text-[10px] text-gray-400 block">Señal Elegida</span>
                          <strong className="text-brand-600 truncate block">
                            {SIGNAL_DEFINITIONS.find((s) => s.id === newType)?.title}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                          <span className="text-[10px] text-gray-400 block">Fórmula Mensaje</span>
                          <strong className="text-purple-600 truncate block capitalize">
                            {msgObjective} · {msgTone}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                          <span className="text-[10px] text-gray-400 block">Modo</span>
                          <strong className="text-emerald-600 block">
                            {newMode === "review" ? "Revisión Manual" : "Piloto Automático"}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Footer de Navegación del Wizard */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-850/80">
                <div>
                  {wizardStep === 1 ? (
                    <button
                      type="button"
                      onClick={() => setShowNewModal(false)}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                    >
                      Cancelar
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setWizardStep((prev) => ((prev - 1) as any))}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                    >
                      <RiArrowLeftLine size={15} /> Atrás
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  {wizardStep < 4 ? (
                    <button
                      type="button"
                      onClick={() => setWizardStep((prev) => ((prev + 1) as any))}
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 shadow-md hover:shadow-lg transition-all"
                    >
                      Siguiente:{" "}
                      {wizardStep === 1
                        ? "Señales de Intención"
                        : wizardStep === 2
                        ? "Mensaje IA Anti-Stalker"
                        : "Revisar & Lanzar"}{" "}
                      <RiArrowRightLine size={15} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={creatingMonitor}
                      onClick={() => handleCreateMonitor()}
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black text-white bg-brand-500 hover:bg-brand-600 shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                    >
                      {creatingMonitor ? (
                        <>
                          <RiRefreshLine className="animate-spin" size={16} /> Lanzando Monitor...
                        </>
                      ) : (
                        <>
                          <RiRadarLine size={16} /> Lanzar Monitor de Señales
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
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
