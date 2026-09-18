import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import Head from "next/head";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";
import { previewSignalMessage } from "@/lib/signals/message-template";
import { toast } from "sonner";
import {
  COUNTRIES_LIST,
  SAMPLE_TITLES,
  SAMPLE_INDUSTRIES,
  toggleOrAppendPill,
  isPillActive,
} from "@/lib/lead-finder/constants";
import {
  RiRadarLine,
  RiSearchLine,
  RiSparklingLine,
  RiAddLine,
  RiRefreshLine,
  RiCheckLine,
  RiCloseLine,
  RiPlayLine,
  RiFileList3Line,
  RiRobotLine,
  RiExternalLinkLine,
  RiUserSearchLine,
  RiBuildingLine,
  RiMapPinLine,
  RiBriefcaseLine,
  RiChat1Line,
  RiThumbUpLine,
  RiExchangeLine,
  RiArrowRightLine,
  RiGroupLine,
  RiLineChartLine,
  RiArrowLeftLine,
  RiShieldCheckLine,
  RiDeleteBinLine,
  RiFireLine,
  RiCalendarLine,
  RiFilter3Line,
  RiShareForwardLine,
  RiTimeLine,
  RiEditLine,
  RiUserAddLine,
  RiArrowUpLine,
  RiEyeLine,
  RiMegaphoneLine,
  RiLinkedinBoxFill,
} from "react-icons/ri";

interface SignalMonitor {
  id: string;
  name: string;
  type: string;
  target_url: string | null;
  competitor_name: string | null;
  keywords_json?: string | null;
  icp_filters_json?: string | null;
  account_id?: string | null;
  target_list_id?: string | null;
  target_workflow_id?: string | null;
  mode: "review" | "autopilot";
  status: "active" | "paused";
  last_checked_at: string | null;
  created_at: string;
  message_config_json?: string | null;
  scan_interval_minutes: number;
  next_scan_at: string | null;
  scan_state: "idle" | "running" | "error";
  last_success_at: string | null;
  last_error: string | null;
  capabilities_json?: string | null;
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
  status: "pending" | "approved" | "rejected" | "imported" | "enrolled" | "failed";
  message_metadata_json?: string | null;
  promotion_state?: "pending" | "promoting" | "imported" | "enrolled" | "blocked" | "failed";
  promotion_error?: string | null;
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

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const session = await getServerSession(req, res, authOptions);
  const user = session?.user as { id?: string; email?: string; role?: string; owner_id?: string | null; assigned_account_id?: string | null } | undefined;
  if (!user?.id) return { redirect: { destination: "/login", permanent: false } };
  const db = getDb();
  const workspaceOwnerId = user.owner_id || user.id;
  const isSuperAdmin = user.email?.trim().toLowerCase() === "inhubflow@gmail.com";

  const whereClause = isSuperAdmin
    ? "WHERE COALESCE(kind, 'monitor') = 'monitor'"
    : "WHERE workspace_owner_id = ? AND COALESCE(kind, 'monitor') = 'monitor'";
  const monitorsRaw = db
    .prepare(`SELECT * FROM signal_monitors ${whereClause} ORDER BY created_at DESC`)
    .all(...(isSuperAdmin ? [] : [workspaceOwnerId])) as SignalMonitor[];

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
    .prepare(`
      SELECT id, name, is_authenticated FROM accounts
      ${isSuperAdmin ? "" : user.owner_id
        ? "WHERE assigned_user_id = ? OR id = ?"
        : "WHERE owner_id = ? OR (owner_id IS NULL AND ? = 1)"}
      ORDER BY created_at DESC
    `)
    .all(...(isSuperAdmin ? [] : user.owner_id
      ? [user.id, user.assigned_account_id || ""]
      : [workspaceOwnerId, 1])) as AccountOption[];

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
  icon: React.ElementType;
  color: string;
  badgeBg: string;
  inputKind: "post_url" | "profile_or_company_url" | "keywords" | "roles_or_industry";
}

export const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  // Nivel 1: Máxima Intención (Calientes - Competencia y Comunidad)
  {
    id: "post_engagement",
    title: "Buscador de Posts (Likes + Comentarios)",
    badge: "⭐ Recomendado",
    level: 1,
    levelTitle: "🔥 Nivel 1: Máxima Intención",
    group: "A",
    groupTitle: "Social & Competidores",
    description: "Encuentra posts virales o de competidores en LinkedIn. Extrae tanto a quienes comentaron como a quienes reaccionaron en un solo monitor.",
    icon: RiFireLine,
    color: "text-amber-500",
    badgeBg: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    inputKind: "post_url",
  },
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
    id: "competitor_audience",
    title: "Audiencia Activa de Competidores",
    badge: "Afinidad Directa",
    level: 1,
    levelTitle: "🔥 Nivel 1: Máxima Intención",
    group: "A",
    groupTitle: "Social & Competidores",
    description: "Profesionales que comentan o reaccionan a contenido reciente relacionado con competidores y referentes. No afirma acceso a listas privadas de seguidores.",
    icon: RiGroupLine,
    color: "text-indigo-500",
    badgeBg: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300",
    inputKind: "profile_or_company_url",
  },
  {
    id: "profile_viewers",
    title: "Visitantes Recientes del Perfil",
    badge: "Interés Directo",
    level: 1,
    levelTitle: "🔥 Nivel 1: Máxima Intención",
    group: "A",
    groupTitle: "Social & Competidores",
    description: "Personas que visitaron recientemente tu perfil. Requiere una cuenta con Sales Navigator.",
    icon: RiUserSearchLine,
    color: "text-fuchsia-500",
    badgeBg: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/60 dark:text-fuchsia-300",
    inputKind: "roles_or_industry",
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
  {
    id: "funding_round",
    title: "Rondas de Inversión Anunciadas",
    badge: "Capital Fresco",
    level: 2,
    levelTitle: "⚡ Nivel 2: Momento de Compra",
    group: "D",
    groupTitle: "Crecimiento de Empresa",
    description: "Anuncios públicos reales de funding, verificados después contra el CEO o fundador actual en LinkedIn.",
    icon: RiLineChartLine,
    color: "text-emerald-500",
    badgeBg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
    inputKind: "keywords",
  },
  {
    id: "acquisition_event",
    title: "Adquisiciones y Fusiones",
    badge: "Cambio Estratégico",
    level: 2,
    levelTitle: "⚡ Nivel 2: Momento de Compra",
    group: "D",
    groupTitle: "Crecimiento de Empresa",
    description: "Movimientos corporativos publicados en fuentes web, vinculados con decisores verificados en LinkedIn.",
    icon: RiExchangeLine,
    color: "text-violet-500",
    badgeBg: "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300",
    inputKind: "keywords",
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
    badge: "Dolor Activo",
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
    id: "company_news",
    title: "Noticias y Anuncios Empresariales",
    badge: "Contexto Público",
    level: 3,
    levelTitle: "🟢 Nivel 3: Actividad & Búsqueda",
    group: "C",
    groupTitle: "Actividad & Búsqueda",
    description: "Lanzamientos, expansión y noticias públicas; cada evidencia conserva fuente y fecha.",
    icon: RiBuildingLine,
    color: "text-blue-500",
    badgeBg: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
    inputKind: "keywords",
  },
  {
    id: "industry_event",
    title: "Eventos y Conferencias del Sector",
    badge: "Timing Público",
    level: 3,
    levelTitle: "🟢 Nivel 3: Actividad & Búsqueda",
    group: "C",
    groupTitle: "Actividad & Búsqueda",
    description: "Participación pública en conferencias, ferias y eventos, validada con el perfil profesional.",
    icon: RiRadarLine,
    color: "text-indigo-500",
    badgeBg: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300",
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

const ASK_AI_TEMPLATES = [
  {
    label: "Rondas de Inversión",
    prompt: "Encuentra 10 CEOs de empresas que recibieron inversion recientemente en Chile",
  },
  {
    label: "Nuevos en el Cargo",
    prompt: "Encuentra 10 Directores de Marketing o VP de Ventas que asumieron nuevo cargo en los últimos 90 días en México",
  },
  {
    label: "Publicaciones Activas",
    prompt: "Encuentra 10 Líderes Comerciales que publican activamente sobre prospección B2B o IA en España",
  },
  {
    label: "Crecimiento Acelerado",
    prompt: "Encuentra 10 Fundadores y CEOs de startups en hipercrecimiento en Colombia",
  },
];

export default function SignalsPage({
  initialMonitors,
  lists,
  workflows,
  accounts,
}: SignalsPageProps) {

  // Estados principales
  const [activeTab, setActiveTab] = useState<"leads" | "monitors" | "guide">("leads");
  const [monitors, setMonitors] = useState<SignalMonitor[]>(initialMonitors);
  const [leads, setLeads] = useState<SignalLead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [selectedMonitorFilter, setSelectedMonitorFilter] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");
  const [searchQuery] = useState<string>("");

  // Ask AI
  const [askPrompt, setAskPrompt] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askResults, setAskResults] = useState<SignalLead[] | null>(null);
  const [askAccountId, setAskAccountId] = useState(accounts[0]?.id || "");
  const askAbortControllerRef = useRef<AbortController | null>(null);

  // Modal Nuevo Monitor - Wizard 4 Pasos
  const [showNewModal, setShowNewModal] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);

  // Paso 1: Criterios de Prospección / Audiencia (ICP) - Formato Lead Finder
  const [icpTitle, setIcpTitle] = useState("CEO, Director de Marketing");
  const [icpCountry, setIcpCountry] = useState("Chile");
  const [icpCity, setIcpCity] = useState("");
  const [icpCompany, setIcpCompany] = useState("");
  const [icpSizes, setIcpSizes] = useState<string[]>(["11-50", "51-200"]);

  const selectedCountryOption = COUNTRIES_LIST.find((c) => c.name === icpCountry) || COUNTRIES_LIST[0];

  const icpTitles = icpTitle
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const icpLocations = (() => {
    const locs: string[] = [];
    if (icpCity.trim() && icpCountry !== "Global / Todos") {
      locs.push(`${icpCity.trim()}, ${icpCountry}`);
    } else if (icpCountry !== "Global / Todos") {
      locs.push(icpCountry);
    }
    return locs;
  })();

  // Paso 2: Señales de Intención (Pestañas de Navegación: "posts" vs "keywords" vs "icp_triggers")
  const [signalCategoryTab, setSignalCategoryTab] = useState<"posts" | "keywords" | "icp_triggers">("posts");
  const [selectedMarketEvents, setSelectedMarketEvents] = useState<string[]>([]);
  const handleToggleMarketEvent = (id: string) => {
    setSelectedMarketEvents((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };
  const [selectedIcpSignals, setSelectedIcpSignals] = useState<string[]>(["new_in_role"]);
  const handleToggleIcpSignal = (id: string) => {
    setSelectedIcpSignals((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((item) => item !== id) : prev) : [...prev, id]
    );
  };
  const [newType, setNewType] = useState<string>("post_engagement");
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
  const [sourceStrategy, setSourceStrategy] = useState<"linkedin" | "web" | "hybrid">("linkedin");

  // Buscador Inteligente de Posts en LinkedIn
  const [postSearchMode, setPostSearchMode] = useState<"search" | "manual">("search");
  const [postSearchCompetitor, setPostSearchCompetitor] = useState("");
  const [postSearchKeywords, setPostSearchKeywords] = useState("");
  const [postSearchDate, setPostSearchDate] = useState<"past_24h" | "past_week" | "past_month">("past_month");
  const [postSearchSortBy, setPostSearchSortBy] = useState<"engagement" | "date">("engagement");
  const [isSearchingPosts, setIsSearchingPosts] = useState(false);
  const [discoveredPosts, setDiscoveredPosts] = useState<Array<{
    id: string;
    shareUrl: string;
    text: string;
    date: string | null;
    reactionCount: number;
    commentCount: number;
    repostCount: number;
    author: {
      id: string | null;
      name: string;
      headline: string | null;
      profilePictureUrl: string | null;
      publicIdentifier: string | null;
      isCompany: boolean;
    };
  }>>([]);
  const [selectedPostUrls, setSelectedPostUrls] = useState<string[]>([]);
  const [extractComments, setExtractComments] = useState(true);
  const [extractReactions, setExtractReactions] = useState(true);

  // Paso 3: Mensaje IA Anti-Stalker
  const [msgObjective, setMsgObjective] = useState<"conversation" | "demo" | "resource">("conversation");
  const [msgTone, setMsgTone] = useState<"consultive" | "professional" | "direct">("consultive");
  const [msgLanguage, setMsgLanguage] = useState<"es" | "en" | "pt-BR">("es");
  const [msgMaxWords, setMsgMaxWords] = useState(90);
  const [customTemplate, setCustomTemplate] = useState("");

  // Paso 4: Lanzamiento & Configuración
  const [newName, setNewName] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id || "");
  const [newTargetList, setNewTargetList] = useState(lists[0]?.id || "");
  const [newTargetWorkflow, setNewTargetWorkflow] = useState(workflows[0]?.id || "");
  const [newMode, setNewMode] = useState<"review" | "autopilot">("review");
  const [scanIntervalMinutes, setScanIntervalMinutes] = useState(360);
  const [accountCapabilities, setAccountCapabilities] = useState<{
    accountReady: boolean;
    salesNavigator: boolean;
    webEvidence: boolean;
    supportedSignals: string[];
    error?: string;
  } | null>(null);
  const [autopilotReadiness, setAutopilotReadiness] = useState<{
    ready: boolean;
    score: number;
    checklist: Array<{ key: string; label: string; ok: boolean }>;
  } | null>(null);
  const [editingMonitorId, setEditingMonitorId] = useState<string | null>(null);

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

  // Búsqueda de posts en LinkedIn
  const handleSearchLinkedInPosts = async () => {
    if (!selectedAccountId) {
      toast.error("Selecciona una cuenta de LinkedIn conectada");
      return;
    }
    const queryComp = postSearchCompetitor.trim() || newCompetitor.trim();
    const queryKw = postSearchKeywords.trim();
    if (!queryComp && !queryKw) {
      toast.error("Ingresa el nombre del competidor o al menos una palabra clave");
      return;
    }
    setIsSearchingPosts(true);
    try {
      const res = await fetch("/api/signals/posts/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: selectedAccountId,
          competitor: queryComp,
          keywords: queryKw,
          date_posted: postSearchDate,
          sort_by: postSearchSortBy,
          limit: 25,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al buscar publicaciones");
      }
      const postsFound = data.posts || data.items || [];
      setDiscoveredPosts(postsFound);
      if (postsFound.length === 0) {
        toast.info("No se encontraron publicaciones con esos criterios. Prueba con una palabra clave individual más amplia (ej: 'Prospección', 'IA' o el nombre de un competidor).");
      } else {
        toast.success(`Se encontraron ${postsFound.length} publicaciones con alto engagement`);
      }
    } catch (err: any) {
      toast.error(err.message || "Error al buscar publicaciones");
    } finally {
      setIsSearchingPosts(false);
    }
  };

  const toggleSelectPost = (shareUrl: string) => {
    setSelectedPostUrls((prev) => {
      const exists = prev.includes(shareUrl);
      const next = exists ? prev.filter((u) => u !== shareUrl) : [...prev, shareUrl];
      setNewTargetUrl(next.join("\n"));
      return next;
    });
  };

  const handleSelectTopPosts = (count: number = 3) => {
    const top = discoveredPosts.slice(0, count).map((p) => p.shareUrl).filter(Boolean);
    setSelectedPostUrls(top);
    setNewTargetUrl(top.join("\n"));
  };

  const handleToggleExtraction = (kind: "comments" | "reactions") => {
    let nextComments = extractComments;
    let nextReactions = extractReactions;
    if (kind === "comments") {
      nextComments = !extractComments;
      if (!nextComments && !nextReactions) {
        toast.error("Debes extraer al menos comentarios o reacciones");
        return;
      }
      setExtractComments(nextComments);
    } else {
      nextReactions = !extractReactions;
      if (!nextComments && !nextReactions) {
        toast.error("Debes extraer al menos comentarios o reacciones");
        return;
      }
      setExtractReactions(nextReactions);
    }

    if (nextComments && nextReactions) {
      setNewType("post_engagement");
    } else if (nextComments) {
      setNewType("high_intent_comments");
    } else {
      setNewType("competitor_reactions");
    }
  };

  const advanceWizard = () => {
    if (wizardStep === 1 && icpTitles.length === 0) {
      toast.error("Añade al menos un cargo objetivo");
      return;
    }
    if (wizardStep === 2) {
      if (signalCategoryTab === "posts") {
        if (!newTargetUrl.trim() && selectedPostUrls.length === 0) {
          toast.error("Selecciona al menos una publicación o introduce su URL de LinkedIn");
          return;
        }
      } else if (signalCategoryTab === "keywords") {
        if (keywordsList.length === 0 && !newCompetitor.trim() && selectedMarketEvents.length === 0) {
          toast.error("Añade al menos una palabra clave, un competidor o activa al menos un evento");
          return;
        }
      } else if (signalCategoryTab === "icp_triggers") {
        if (selectedIcpSignals.length === 0) {
          toast.error("Selecciona al menos una señal disparadora de ICP");
          return;
        }
      }
    }
    if (wizardStep === 3 && customTemplate.trim() && customTemplate.trim().length < 20) {
      toast.error("La plantilla personalizada es demasiado corta");
      return;
    }
    setWizardStep((current) => Math.min(4, current + 1) as 1 | 2 | 3 | 4);
  };
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [creatingMonitor, setCreatingMonitor] = useState(false);

  // Modal Importar Leads a Lista
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [targetListId, setTargetListId] = useState(lists[0]?.id || "");
  const [importing, setImporting] = useState(false);
  const [deletingLeads, setDeletingLeads] = useState(false);
  const [deletingMonitorId, setDeletingMonitorId] = useState<string | null>(null);

  const visibleLeadIds = leads.map((lead) => lead.id);
  const allVisibleLeadsSelected = visibleLeadIds.length > 0
    && visibleLeadIds.every((id) => selectedLeadIds.includes(id));

  const handleToggleSelectAllVisible = () => {
    if (allVisibleLeadsSelected) {
      const visible = new Set(visibleLeadIds);
      setSelectedLeadIds((current) => current.filter((id) => !visible.has(id)));
      return;
    }
    setSelectedLeadIds((current) => [...new Set([...current, ...visibleLeadIds])]);
  };

  // Helpers para manipulación de chips
  const handleSelectSignalType = (type: string) => {
    setNewType(type);
    if (["funding_round", "company_news", "acquisition_event", "industry_event"].includes(type)) {
      setSourceStrategy("hybrid");
      return;
    }
    if (type !== "keyword_intent") setSourceStrategy("linkedin");
  };

  const handleToggleSize = (size: string) => {
    if (icpSizes.includes(size)) {
      setIcpSizes(icpSizes.filter((s) => s !== size));
    } else {
      setIcpSizes([...icpSizes, size]);
    }
  };

  const handleOpenNewWizard = () => {
    setEditingMonitorId(null);
    setWizardStep(1);
    setNewName("");
    setSignalCategoryTab("posts");
    setSelectedMarketEvents([]);
    setSelectedIcpSignals(["new_in_role"]);
    setNewType("post_engagement");
    setSignalLevelFilter("ALL");
    setNewCompetitor("");
    setPostSearchCompetitor("");
    setNewTargetUrl("");
    setSelectedPostUrls([]);
    setDiscoveredPosts([]);
    setPostSearchKeywords("");
    setIcpTitle("CEO, Director, Gerente General");
    setIcpCountry("Global / Todos");
    setIcpCity("");
    setIcpSizes([]);
    setIcpCompany("");
    setKeywordsList([
      "automatización de ventas",
      "crm",
      "prospección b2b",
      "cold outreach",
    ]);
    setExtractComments(true);
    setExtractReactions(true);
    setMsgObjective("conversation");
    setMsgTone("consultive");
    setMsgLanguage("es");
    setMsgMaxWords(90);
    setCustomTemplate("");
    setNewMode("review");
    setScanIntervalMinutes(60);
    setShowNewModal(true);
  };

  const handleOpenEditWizard = (monitor: SignalMonitor) => {
    setEditingMonitorId(monitor.id);
    setWizardStep(1);
    setNewName(monitor.name || "");
    const monitorType = monitor.type || "post_engagement";
    setNewType(monitorType);

    const icpSignalTypes = ["new_in_role", "internal_promotion", "hiring_spree", "company_growth", "profile_viewers", "active_poster"];
    let initialEvents: string[] = [];
    let initialIcpSignals: string[] = [];
    if (monitor.icp_filters_json) {
      try {
        const icp = JSON.parse(monitor.icp_filters_json);
        if (Array.isArray(icp.event_kinds)) {
          initialEvents = icp.event_kinds.filter((k: string) =>
            ["funding_round", "company_news", "industry_event", "acquisition_event"].includes(k)
          );
          initialIcpSignals = icp.event_kinds.filter((k: string) =>
            icpSignalTypes.includes(k)
          );
        }
      } catch {}
    }
    if (initialEvents.length === 0 && ["funding_round", "company_news", "industry_event", "acquisition_event"].includes(monitorType)) {
      initialEvents = [monitorType];
    }
    if (initialIcpSignals.length === 0 && icpSignalTypes.includes(monitorType)) {
      initialIcpSignals = [monitorType];
    }
    setSelectedMarketEvents(initialEvents);
    setSelectedIcpSignals(initialIcpSignals.length > 0 ? initialIcpSignals : ["new_in_role"]);

    if (icpSignalTypes.includes(monitorType) || initialIcpSignals.length > 0) {
      setSignalCategoryTab("icp_triggers");
    } else if (["keyword_intent", "competitor_audience", "funding_round", "company_news", "industry_event", "acquisition_event"].includes(monitorType) || initialEvents.length > 0) {
      setSignalCategoryTab("keywords");
    } else {
      setSignalCategoryTab("posts");
    }
    setSignalLevelFilter("ALL");
    if (monitor.account_id) setSelectedAccountId(monitor.account_id);
    if (monitor.target_list_id) setNewTargetList(monitor.target_list_id);
    setNewTargetWorkflow(monitor.target_workflow_id || "");
    setNewMode(monitor.mode || "review");
    setScanIntervalMinutes(monitor.scan_interval_minutes || 60);

    const compName = monitor.competitor_name || "";
    setNewCompetitor(compName);
    setPostSearchCompetitor(compName);

    // Parsear target_url si son posts seleccionados
    let urls: string[] = [];
    if (monitor.target_url) {
      const trimmed = monitor.target_url.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            urls = parsed.map(String).map((u) => u.trim()).filter(Boolean);
          }
        } catch {
          urls = [trimmed];
        }
      } else if (trimmed) {
        const splitUrls = trimmed.split(/[\n,]+/).map((u) => u.trim()).filter((u) => u.startsWith("http"));
        urls = splitUrls.length > 0 ? splitUrls : [trimmed];
      }
    }
    setSelectedPostUrls(urls);
    setNewTargetUrl(urls.join("\n"));
    setDiscoveredPosts([]);

    if (monitor.type === "post_engagement") {
      setExtractComments(true);
      setExtractReactions(true);
    } else if (monitor.type === "competitor_reactions") {
      setExtractComments(false);
      setExtractReactions(true);
    } else if (monitor.type === "high_intent_comments") {
      setExtractComments(true);
      setExtractReactions(false);
    } else {
      setExtractComments(true);
      setExtractReactions(true);
    }

    // Parsear keywords_json
    if (monitor.keywords_json) {
      try {
        const kws = JSON.parse(monitor.keywords_json);
        if (Array.isArray(kws) && kws.length > 0) {
          setKeywordsList(kws);
          setPostSearchKeywords(kws.join(", "));
        } else {
          setKeywordsList([]);
          setPostSearchKeywords("");
        }
      } catch {
        setKeywordsList([]);
        setPostSearchKeywords("");
      }
    } else {
      setKeywordsList([]);
      setPostSearchKeywords("");
    }

    // Parsear icp_filters_json
    if (monitor.icp_filters_json) {
      try {
        const icp = JSON.parse(monitor.icp_filters_json);
        setIcpTitle(Array.isArray(icp.titles) && icp.titles.length > 0 ? icp.titles.join(", ") : "");
        setIcpSizes(Array.isArray(icp.company_sizes) ? icp.company_sizes : []);
        setIcpCompany(icp.company || (Array.isArray(icp.industries) && icp.industries.length > 0 ? icp.industries.join(", ") : ""));
        setTimeWindowDays(icp.time_window_days || 90);
        setSourceStrategy(icp.source_strategy || "linkedin");

        if (Array.isArray(icp.locations) && icp.locations.length > 0) {
          const firstLoc = String(icp.locations[0]).trim();
          const match = COUNTRIES_LIST.find((c) => {
            if (c.name === "Global / Todos") return false;
            const cNameLower = c.name.toLowerCase();
            const locLower = firstLoc.toLowerCase();
            return locLower === cNameLower || locLower.endsWith(`, ${cNameLower}`) || locLower.endsWith(` ${cNameLower}`);
          });

          if (match) {
            setIcpCountry(match.name);
            const cityPart = firstLoc.replace(new RegExp(`,?\\s*${match.name}$`, "i"), "").trim();
            setIcpCity(cityPart);
          } else {
            setIcpCountry("Global / Todos");
            setIcpCity(firstLoc);
          }
        } else {
          setIcpCountry("Global / Todos");
          setIcpCity("");
        }
      } catch {
        setIcpTitle("");
        setIcpCountry("Global / Todos");
        setIcpCity("");
        setIcpSizes([]);
        setIcpCompany("");
      }
    } else {
      setIcpTitle("");
      setIcpCountry("Global / Todos");
      setIcpCity("");
      setIcpSizes([]);
      setIcpCompany("");
    }

    // Parsear message_config_json
    if (monitor.message_config_json) {
      try {
        const msg = JSON.parse(monitor.message_config_json);
        setMsgObjective(msg.objective || "conversation");
        setMsgTone(msg.tone || "consultive");
        setMsgLanguage(msg.language || "es");
        setMsgMaxWords(msg.max_words || 90);
        setCustomTemplate(msg.custom_template || "");
      } catch {
        setMsgObjective("conversation");
        setMsgTone("consultive");
        setMsgLanguage("es");
        setMsgMaxWords(90);
        setCustomTemplate("");
      }
    } else {
      setMsgObjective("conversation");
      setMsgTone("consultive");
      setMsgLanguage("es");
      setMsgMaxWords(90);
      setCustomTemplate("");
    }

    setShowNewModal(true);
  };

  // Cargar leads
  const fetchLeads = useCallback(async () => {
    setLeadsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "200");
      if (selectedMonitorFilter !== "all") params.set("monitor_id", selectedMonitorFilter);
      if (selectedStatusFilter !== "all") params.set("status", selectedStatusFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/signals/leads?${params.toString()}`);
      const data = await res.json();
      if (data.items) {
        setLeads(data.items);
      }
    } catch {
      toast.error("Error al cargar prospectos detectados");
    } finally {
      setLeadsLoading(false);
    }
  }, [selectedMonitorFilter, selectedStatusFilter, searchQuery]);

  useEffect(() => {
    setSelectedLeadIds([]);
  }, [selectedMonitorFilter, selectedStatusFilter]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    if (!selectedAccountId) {
      setAccountCapabilities(null);
      return;
    }
    fetch(`/api/signals/capabilities?account_id=${encodeURIComponent(selectedAccountId)}`)
      .then((response) => response.json())
      .then((data) => setAccountCapabilities(data))
      .catch(() => setAccountCapabilities({ accountReady: false, salesNavigator: false, webEvidence: false, supportedSignals: [] }));
  }, [selectedAccountId]);

  useEffect(() => {
    if (newMode !== "autopilot") {
      setAutopilotReadiness(null);
      return;
    }
    const params = new URLSearchParams({
      account_id: selectedAccountId,
      list_id: newTargetList,
      workflow_id: newTargetWorkflow,
    });
    fetch(`/api/signals/readiness?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => setAutopilotReadiness(data))
      .catch(() => setAutopilotReadiness({ ready: false, score: 0, checklist: [] }));
  }, [newMode, selectedAccountId, newTargetList, newTargetWorkflow]);

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
    } catch {
      toast.error("Error de conexión al escanear señal", { id: toastId });
    }
  };

  // Crear Monitor (Lanzamiento desde Wizard)
  const handleCreateMonitor = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    let effectiveType = newType;
    if (signalCategoryTab === "posts") {
      if (extractComments && extractReactions) effectiveType = "post_engagement";
      else if (extractComments && !extractReactions) effectiveType = "high_intent_comments";
      else if (!extractComments && extractReactions) effectiveType = "competitor_reactions";
    } else if (signalCategoryTab === "keywords") {
      if (selectedMarketEvents.length > 0) {
        effectiveType = selectedMarketEvents[0];
      } else if (newCompetitor.trim() && keywordsList.length === 0) {
        effectiveType = "competitor_audience";
      } else {
        effectiveType = "keyword_intent";
      }
    } else if (signalCategoryTab === "icp_triggers") {
      effectiveType = selectedIcpSignals[0] || "new_in_role";
    }

    const def = SIGNAL_DEFINITIONS.find((d) => d.id === effectiveType) || SIGNAL_DEFINITIONS.find((d) => d.id === newType);
    if (!selectedAccountId) { toast.error("Selecciona una cuenta de LinkedIn"); return; }
    if (!newTargetList) { toast.error("Selecciona una lista de destino"); return; }
    if (accountCapabilities && !accountCapabilities.supportedSignals.includes(effectiveType)) {
      toast.error("La cuenta seleccionada no es compatible con esta señal");
      return;
    }
    if (newMode === "autopilot" && !newTargetWorkflow) {
      toast.error("Piloto Automático requiere un workflow");
      return;
    }
    if (newMode === "autopilot" && autopilotReadiness && !autopilotReadiness.ready) {
      toast.error("El SDR IA aún no cumple los requisitos para Piloto Automático");
      return;
    }
    const monitorName =
      newName.trim() ||
      (signalCategoryTab === "icp_triggers"
        ? `${def?.title || "Radar ICP"} - ${icpTitles.slice(0, 2).join(", ") || icpCountry}`
        : `${def?.title || "Radar"} - ${newCompetitor.trim() || postSearchCompetitor.trim() || keywordsList[0] || "ICP"}`);

    const targetUrlToSend = selectedPostUrls.length > 1
      ? JSON.stringify(selectedPostUrls)
      : (selectedPostUrls[0] || newTargetUrl.trim() || undefined);

    setCreatingMonitor(true);
    try {
      if (editingMonitorId) {
        const res = await fetch(`/api/signals/${editingMonitorId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: monitorName,
            type: effectiveType,
            competitor_name: newCompetitor.trim() || postSearchCompetitor.trim() || undefined,
            target_url: targetUrlToSend,
            keywords: signalCategoryTab === "icp_triggers" ? [] : keywordsList,
            icp_filters: {
              titles: icpTitles,
              locations: icpLocations,
              company_sizes: icpSizes,
              company: icpCompany.trim() || undefined,
              industries: icpCompany.split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
              time_window_days: timeWindowDays,
              source_strategy: signalCategoryTab === "icp_triggers" ? "linkedin" : (selectedMarketEvents.length > 0 ? "hybrid" : sourceStrategy),
              event_kinds: signalCategoryTab === "icp_triggers"
                ? selectedIcpSignals
                : (selectedMarketEvents.length > 0 ? selectedMarketEvents : [effectiveType]),
            },
            mode: newMode,
            account_id: selectedAccountId || undefined,
            target_list_id: newTargetList || undefined,
            target_workflow_id: newTargetWorkflow || null,
            scan_interval_minutes: scanIntervalMinutes,
            message_config: {
              objective: msgObjective,
              tone: msgTone,
              language: msgLanguage,
              max_words: msgMaxWords,
              custom_template: customTemplate.trim() || undefined,
            },
          }),
        });

        if (res.ok) {
          const updated = await res.json();
          toast.success(`Monitor "${updated.name}" actualizado con éxito`);
          setShowNewModal(false);
          setEditingMonitorId(null);
          setWizardStep(1);
          setNewName("");
          // Refrescar lista de monitores
          const mRes = await fetch("/api/signals");
          const mData = await mRes.json();
          if (mData.items) setMonitors(mData.items);
        } else {
          const err = await res.json();
          toast.error(err.error || "Error al actualizar monitor");
        }
        return;
      }

      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: monitorName,
          type: effectiveType,
          competitor_name: newCompetitor.trim() || postSearchCompetitor.trim() || undefined,
          target_url: targetUrlToSend,
          keywords: signalCategoryTab === "icp_triggers" ? [] : keywordsList,
          icp_filters: {
            titles: icpTitles,
            locations: icpLocations,
            company_sizes: icpSizes,
            company: icpCompany.trim() || undefined,
            industries: icpCompany.split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
            time_window_days: timeWindowDays,
            source_strategy: signalCategoryTab === "icp_triggers" ? "linkedin" : (selectedMarketEvents.length > 0 ? "hybrid" : sourceStrategy),
            event_kinds: signalCategoryTab === "icp_triggers"
              ? selectedIcpSignals
              : (selectedMarketEvents.length > 0 ? selectedMarketEvents : [effectiveType]),
          },
          mode: newMode,
          account_id: selectedAccountId || undefined,
          target_list_id: newTargetList || undefined,
          target_workflow_id: newTargetWorkflow || undefined,
          scan_interval_minutes: scanIntervalMinutes,
          message_config: {
            objective: msgObjective,
            tone: msgTone,
            language: msgLanguage,
            max_words: msgMaxWords,
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
    } catch {
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

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo actualizar el prospecto");
      const nextStatus = status === "approved"
        ? (data.promotion?.state === "enrolled" ? "enrolled" : data.promotion?.state === "imported" ? "imported" : "approved")
        : "rejected";
      setLeads((prev) => prev.map((lead) => lead.id === leadId ? {
        ...lead,
        status: nextStatus,
        promotion_state: data.promotion?.state || lead.promotion_state,
      } : lead));
      toast.success(status === "approved"
        ? data.promotion?.state === "enrolled" ? "Prospecto aprobado y enrolado en campaña" : "Prospecto aprobado e importado"
        : "Prospecto descartado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al actualizar prospecto");
    }
  };

  const handleSaveLeadDraft = async (leadId: string) => {
    const response = await fetch("/api/signals/leads/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_message", lead_id: leadId, icebreaker_preview: editingDraft }),
    });
    const data = await response.json();
    if (!response.ok) { toast.error(data.error || "No se pudo guardar el mensaje"); return; }
    setLeads((current) => current.map((lead) => lead.id === leadId ? { ...lead, icebreaker_preview: editingDraft.trim() } : lead));
    setEditingLeadId(null);
    toast.success("Mensaje actualizado");
  };

  // Cancelar investigación en curso de Ask AI
  const handleCancelAsk = () => {
    if (askAbortControllerRef.current) {
      askAbortControllerRef.current.abort();
    }
  };

  // Ejecutar Ask AI
  const handleExecuteAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!askPrompt.trim()) return;

    const targetAccountId = askAccountId || selectedAccountId || accounts[0]?.id;
    if (!targetAccountId) {
      toast.error("Debes conectar o seleccionar una cuenta de LinkedIn para usar Ask AI");
      return;
    }

    if (askAbortControllerRef.current) {
      askAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    askAbortControllerRef.current = controller;

    setAskLoading(true);
    setAskResults(null);
    const toastId = toast.loading("Buscando y verificando prospectos con IA...");

    try {
      const res = await fetch("/api/signals/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          query: askPrompt.trim(),
          account_id: targetAccountId,
          list_id: newTargetList || undefined,
          workflow_id: newTargetWorkflow || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.leads) {
        setAskResults(data.leads);
        // Sincronizar inmediatamente la tabla Hot Leads para reflejar los nuevos prospectos
        fetchLeads();
        toast.success(`Se encontraron ${data.leads.length} prospectos de alta intención`, { id: toastId });
      } else {
        toast.error(data.error || "Error en la consulta Ask AI", { id: toastId });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        toast.info("Investigación cancelada", { id: toastId });
      } else {
        toast.error("Error al conectar con el servicio Ask AI", { id: toastId });
      }
    } finally {
      setAskLoading(false);
      askAbortControllerRef.current = null;
    }
  };

  // Importar Ask Lead a Lista
  const handleImportAskLead = async (lead: SignalLead) => {
    if (!newTargetList) {
      toast.error("Selecciona una lista de destino en el paso de lanzamiento");
      return;
    }
    const toastId = toast.loading("Guardando prospecto...");
    try {
      const response = await fetch("/api/signals/leads/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          lead_ids: [lead.id],
          target: { list_id: newTargetList, workflow_id: newTargetWorkflow || undefined },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo importar el prospecto");
      toast.success(`Prospecto “${lead.full_name}” importado correctamente`, { id: toastId });
      fetchLeads();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al importar", { id: toastId });
    }
  };

  const handleDeleteSelectedLeads = async () => {
    if (selectedLeadIds.length === 0 || deletingLeads) return;
    const selected = leads.filter((lead) => selectedLeadIds.includes(lead.id));
    const imported = selected.filter((lead) => Boolean(lead.promotion_state && ["imported", "enrolled"].includes(lead.promotion_state))).length;
    const explanation = imported > 0
      ? `\n\n${imported} ya fueron promovidos. Se eliminarán del Radar, pero sus contactos, listas y campañas se conservarán.`
      : "";
    if (!window.confirm(`¿Eliminar ${selectedLeadIds.length} lead(s) seleccionados del Signal Radar? Esta acción no se puede deshacer.${explanation}`)) return;
    setDeletingLeads(true);
    try {
      const response = await fetch("/api/signals/leads/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", lead_ids: selectedLeadIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron eliminar los leads");
      setLeads((current) => current.filter((lead) => !selectedLeadIds.includes(lead.id)));
      setSelectedLeadIds([]);
      toast.success(`${data.deleted} lead(s) eliminados del Radar`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al eliminar leads");
    } finally {
      setDeletingLeads(false);
    }
  };

  const handleDeleteMonitor = async (monitor: SignalMonitor) => {
    if (deletingMonitorId) return;
    if (!window.confirm(`¿Eliminar el monitor “${monitor.name}” y todos sus leads/evidencias del Signal Radar?\n\nLos contactos, listas y campañas ya creados se conservarán.`)) return;
    setDeletingMonitorId(monitor.id);
    try {
      const response = await fetch(`/api/signals/${monitor.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar el monitor");
      setMonitors((current) => current.filter((item) => item.id !== monitor.id));
      setLeads((current) => current.filter((lead) => lead.monitor_id !== monitor.id));
      setSelectedLeadIds((current) => current.filter((id) => !leads.some((lead) => lead.id === id && lead.monitor_id === monitor.id)));
      if (selectedMonitorFilter === monitor.id) setSelectedMonitorFilter("all");
      toast.success(`Monitor “${monitor.name}” eliminado`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al eliminar monitor");
    } finally {
      setDeletingMonitorId(null);
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
              Según la frecuencia configurada
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
              Basados en señales verificadas
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <RiSparklingLine className="text-brand-600 dark:text-brand-400" size={20} />
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                Ask AI — Investigador Autónomo de Prospectos
              </h3>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 rounded-md">
                Búsqueda en Lenguaje Natural
              </span>
            </div>

            {/* Selector de cuenta de LinkedIn */}
            <div className="flex items-center gap-2">
              {accounts.length === 0 ? (
                <span className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-lg">
                  ⚠️ Sin cuentas conectadas
                </span>
              ) : accounts.length === 1 ? (
                <span className="text-xs text-gray-600 dark:text-gray-300 bg-white/70 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 px-2.5 py-1 rounded-lg">
                  Cuenta: <strong className="text-gray-900 dark:text-white">{accounts[0].name}</strong>
                </span>
              ) : (
                <div className="flex items-center gap-1.5">
                  <label htmlFor="ask-account-select" className="text-xs text-gray-600 dark:text-gray-400 font-medium">
                    Cuenta:
                  </label>
                  <select
                    id="ask-account-select"
                    value={askAccountId}
                    onChange={(e) => setAskAccountId(e.target.value)}
                    className="text-xs rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-gray-900 shadow-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 focus:border-brand-500 focus:outline-none"
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
          {/* Guía visual con la Fórmula Recomendada */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 bg-white/70 dark:bg-gray-800/70 p-2.5 rounded-xl border border-gray-200/80 dark:border-gray-700/80">
            <span className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1">
              💡 Fórmula recomendada:
            </span>
            <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700/80 text-gray-800 dark:text-gray-200 font-semibold border border-gray-200 dark:border-gray-600">
              Encuentra
            </span>
            <span className="px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300 font-medium border border-brand-200/50 dark:border-brand-800/50">
              [Cantidad]
            </span>
            <span>+</span>
            <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 font-medium border border-indigo-200/50 dark:border-indigo-800/50">
              [Cargo / Decisor]
            </span>
            <span>+</span>
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 font-medium border border-amber-200/50 dark:border-amber-800/50">
              [Señal de Intención o Evento]
            </span>
            <span>+</span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 font-medium border border-emerald-200/50 dark:border-emerald-800/50">
              [País o Ciudad]
            </span>
          </div>

          <form onSubmit={handleExecuteAsk} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <RiSearchLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
              <input
                type="text"
                value={askPrompt}
                onChange={(e) => setAskPrompt(e.target.value)}
                placeholder="Ejemplo: Encuentra 10 CEOs de empresas que recibieron inversion recientemente en Chile..."
                className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-xs md:text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="submit"
                disabled={askLoading || !askPrompt.trim() || accounts.length === 0}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs md:text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-50 transition-all shadow-xs"
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
              {askLoading && (
                <button
                  type="button"
                  onClick={handleCancelAsk}
                  className="inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl text-xs md:text-sm font-semibold text-gray-700 hover:text-red-600 bg-gray-100 hover:bg-red-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-red-950/40 dark:hover:text-red-400 border border-gray-300 dark:border-gray-700 transition-all"
                  title="Cancelar investigación en curso"
                >
                  <RiCloseLine size={16} /> Cancelar
                </button>
              )}
            </div>
          </form>

          {/* Chips con Plantillas de Ejemplo Rápidas */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">
              Ejemplos rápidos:
            </span>
            {ASK_AI_TEMPLATES.map((tmpl, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setAskPrompt(tmpl.prompt)}
                className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-medium text-gray-700 hover:text-brand-600 bg-white hover:bg-brand-50/80 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-brand-950/40 dark:hover:text-brand-300 border border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700 transition-all whitespace-nowrap shadow-2xs cursor-pointer"
                title={`Cargar: "${tmpl.prompt}"`}
              >
                <span>{tmpl.label}</span>
              </button>
            ))}
          </div>

          {/* Resultados de Ask AI */}
          {askResults && (
            <div className="mt-4 pt-4 border-t border-purple-200 dark:border-purple-800/40 space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-gray-300">
                <span>Resultados de alta intención para: “{askPrompt}”</span>
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
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                disabled={deletingLeads}
                onClick={handleDeleteSelectedLeads}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-300 disabled:opacity-50"
              >
                {deletingLeads ? <RiRefreshLine className="animate-spin" size={14} /> : <RiDeleteBinLine size={14} />}
                Eliminar seleccionados ({selectedLeadIds.length})
              </button>
              <button
                type="button"
                onClick={() => setShowImportModal(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-brand-500 hover:bg-brand-600 shadow-xs"
              >
                <RiFileList3Line size={14} /> Importar ({selectedLeadIds.length}) a Lista
              </button>
            </div>
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

              <div className="flex items-center gap-3">
                <label className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                  leads.length > 0
                    ? "cursor-pointer border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    : "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-600"
                }`}>
                  <input
                    type="checkbox"
                    disabled={leads.length === 0 || leadsLoading}
                    checked={allVisibleLeadsSelected}
                    onChange={handleToggleSelectAllVisible}
                    className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                  />
                  {allVisibleLeadsSelected
                    ? `Deseleccionar todos (${visibleLeadIds.length})`
                    : `Seleccionar todos (${visibleLeadIds.length})`}
                </label>
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
                  Crea un monitor de señales para buscar evidencias reales o usa «Escanear ahora» en la pestaña de monitores.
                </p>
                <button
                  onClick={handleOpenNewWizard}
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
                            : lead.signal_type === "competitor_audience"
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
                        <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-brand-600 dark:text-brand-400">Mensaje personalizado sugerido</span>
                            {lead.status === "pending" && editingLeadId !== lead.id && (
                              <button
                                type="button"
                                onClick={() => { setEditingLeadId(lead.id); setEditingDraft(lead.icebreaker_preview || ""); }}
                                className="text-[11px] text-brand-600 hover:underline"
                              >
                                Editar antes de aprobar
                              </button>
                            )}
                          </div>
                          {editingLeadId === lead.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={editingDraft}
                                onChange={(event) => setEditingDraft(event.target.value)}
                                rows={4}
                                className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-900"
                              />
                              <div className="flex gap-2 justify-end">
                                <button type="button" onClick={() => setEditingLeadId(null)} className="px-2 py-1 text-gray-500">Cancelar</button>
                                <button type="button" onClick={() => handleSaveLeadDraft(lead.id)} className="px-3 py-1 rounded-lg bg-brand-500 text-white">Guardar</button>
                              </div>
                            </div>
                          ) : (
                            <p>“{lead.icebreaker_preview}”</p>
                          )}
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
                        ) : lead.status === "enrolled" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-purple-700 bg-purple-50 dark:bg-purple-950/50 dark:text-purple-300">
                            Enrolado en Campaña
                          </span>
                        ) : lead.status === "imported" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-blue-700 bg-blue-50 dark:bg-blue-950/50 dark:text-blue-300">
                            Importado a Lista
                          </span>
                        ) : lead.status === "failed" ? (
                          <span className="text-xs text-red-500" title={lead.promotion_error || undefined}>Error de promoción</span>
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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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

                      {m.target_url && (() => {
                        let displayUrl = m.target_url.trim();
                        let isMulti = false;
                        let count = 1;
                        if (displayUrl.startsWith("[") && displayUrl.endsWith("]")) {
                          try {
                            const parsed = JSON.parse(displayUrl);
                            if (Array.isArray(parsed) && parsed.length > 0) {
                              count = parsed.length;
                              displayUrl = String(parsed[0]);
                              isMulti = count > 1;
                            }
                          } catch {}
                        }
                        displayUrl = displayUrl.replace(/^["'\[\s\\]+|["'\]\s\\]+$/g, "");
                        const href = displayUrl.startsWith("http") ? displayUrl : `https://${displayUrl}`;
                        return (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1 truncate"
                          >
                            <RiExternalLinkLine size={12} className="shrink-0" />
                            {isMulti ? `${count} publicaciones monitoreadas` : displayUrl}
                          </a>
                        );
                      })()}

                      <div className="pt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800">
                        <span>Total captados: <strong className="text-gray-900 dark:text-white">{m.total_leads || 0}</strong></span>
                        <span>Pendientes: <strong className="text-brand-600">{m.pending_leads || 0}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <div className="flex items-center flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={m.scan_state === "running" || deletingMonitorId === m.id}
                          onClick={() => handleScanMonitor(m.id, m.name)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300 transition-colors disabled:opacity-50 shrink-0"
                        >
                          <RiRefreshLine className={m.scan_state === "running" ? "animate-spin" : ""} size={14} /> Escanear ahora
                        </button>
                        <button
                          type="button"
                          disabled={m.scan_state === "running" || deletingMonitorId === m.id}
                          onClick={() => handleOpenEditWizard(m)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 transition-colors disabled:opacity-50 shrink-0"
                          title="Editar configuración y criterios de este monitor"
                        >
                          <RiEditLine size={14} /> Editar
                        </button>
                        <button
                          type="button"
                          disabled={m.scan_state === "running" || deletingMonitorId === m.id}
                          onClick={() => handleDeleteMonitor(m)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-300 disabled:opacity-50 shrink-0"
                          title={m.scan_state === "running" ? "Espera a que termine el escaneo" : "Eliminar monitor"}
                        >
                          {deletingMonitorId === m.id ? <RiRefreshLine className="animate-spin" size={14} /> : <RiDeleteBinLine size={14} />}
                          Eliminar
                        </button>
                      </div>

                      <div className="flex flex-col items-end gap-0.5 text-[11px] text-gray-400">
                        <span>{m.scan_state === "running" ? "Escaneando…" : m.last_success_at ? `Último éxito ${new Date(m.last_success_at).toLocaleString()}` : "Sin escaneos exitosos"}</span>
                        {m.next_scan_at && m.status === "active" && <span>Próximo: {new Date(m.next_scan_at).toLocaleString()}</span>}
                        {m.last_error && <span className="text-red-500 max-w-52 truncate" title={m.last_error}>{m.last_error}</span>}
                      </div>
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
                  Metodología de InHubFlow
                </span>
              </div>
              <h3 className="text-lg md:text-xl font-black text-gray-900 dark:text-white">
                Matriz Completa de Señales de Intención de Compra
              </h3>
              <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-3xl">
                La prospección en frío masiva obtiene menos del 3% de respuesta porque contacta a destiempo. 
                Signal Radar detecta evidencias reales de intención para ayudarte a contactar en un momento relevante.
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

        {/* Modal: Wizard de Creación de Monitor */}
        {showNewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs">
            <div className="w-full max-w-5xl xl:max-w-6xl h-[88vh] flex flex-col bg-white dark:bg-gray-900 rounded-3xl border border-gray-300 dark:border-gray-700 shadow-2xl overflow-hidden">
              {/* 1. Cabecera Principal del Modal */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400">
                    <RiRadarLine size={22} />
                  </span>
                  <div>
                    <h3 className="font-black text-base sm:text-lg text-gray-900 dark:text-white leading-tight">
                      {editingMonitorId ? "Reconfigurar Monitor de Señales" : "Configurar Monitor de Señales de Intención"}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {editingMonitorId ? "Modifica el ICP, publicaciones monitoreadas, mensaje IA o modo operativo" : "Asistente guiado de InHubFlow para prospección basada en señales reales"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewModal(false);
                    setEditingMonitorId(null);
                  }}
                  className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <RiCloseLine size={22} />
                </button>
              </div>

              {/* 2. Barra de Progreso del Wizard (Stepper) */}
              <div className="px-6 py-3.5 border-b border-gray-300 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-850/50">
                <div className="flex items-center justify-between max-w-4xl mx-auto">
                  {[
                    { num: 1, label: "Definir ICP", icon: RiUserSearchLine },
                    { num: 2, label: "Disparador", icon: RiRadarLine },
                    { num: 3, label: "Mensaje IA", icon: RiSparklingLine },
                    { num: 4, label: "Lanzar", icon: RiPlayLine },
                  ].map((step, idx) => {
                    const isCurrent = wizardStep === step.num;
                    const isPast = wizardStep > step.num;
                    const canNavigate = Boolean(editingMonitorId) || step.num <= wizardStep;
                    const StepIcon = step.icon;
                    return (
                      <div key={step.num} className="flex items-center flex-1 last:flex-none">
                        <button
                          type="button"
                          disabled={!canNavigate}
                          onClick={() => canNavigate && setWizardStep(step.num as 1 | 2 | 3 | 4)}
                          className="flex items-center gap-2 group text-left focus:outline-none"
                        >
                          <span
                            className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold transition-all ${
                              isCurrent
                                ? "bg-brand-500 text-white shadow-md shadow-brand-500/25 ring-2 ring-brand-500/30"
                                : isPast || Boolean(editingMonitorId)
                                ? "bg-emerald-500 text-white"
                                : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 group-hover:bg-gray-300"
                            }`}
                          >
                            {isPast || Boolean(editingMonitorId) ? <RiCheckLine size={15} /> : <StepIcon size={14} />}
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
                              PASO {step.num}
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
                {/* =========================================================
                    PASO 1: DEFINIR AUDIENCIA Y CLIENTE IDEAL (ICP) - ESTILO LEAD FINDER
                   ========================================================= */}
                {wizardStep === 1 && (
                  <div className="space-y-5 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 pb-3">
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <RiSearchLine className="text-brand-500" /> Criterios de Prospección (ICP)
                      </h2>
                      <span className="text-xs text-gray-400 dark:text-gray-500">PASO 1 de 4</span>
                    </div>

                    {/* Cargo / Título Profesional */}
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                        Cargo o Título Profesional <span className="text-brand-500">*</span>
                      </label>
                      <div className="relative">
                        <RiBriefcaseLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
                        <input
                          type="text"
                          value={icpTitle}
                          onChange={(e) => setIcpTitle(e.target.value)}
                          placeholder="ej: CEO, Director de Marketing, Dentista, Abogado..."
                          className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                        />
                      </div>
                      {/* Sugerencias de cargos (Pills idénticos a Lead Finder) */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {SAMPLE_TITLES.map((st) => {
                          const active = isPillActive(icpTitle, st);
                          return (
                            <button
                              key={st}
                              type="button"
                              onClick={() => setIcpTitle(toggleOrAppendPill(icpTitle, st))}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                                active
                                  ? "bg-brand-500 border-brand-500 text-white shadow-xs"
                                  : "bg-gray-50 border-gray-300 text-gray-700 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-300 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
                              }`}
                            >
                              {active ? `✓ ${st}` : `+${st}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Ubicación: País y Ciudad */}
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Selector de País */}
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                            País
                          </label>
                          <select
                            value={icpCountry}
                            onChange={(e) => {
                              setIcpCountry(e.target.value);
                              setIcpCity("");
                            }}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-xs transition-all focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                          >
                            {COUNTRIES_LIST.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Input de Ciudad */}
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                            Ciudad <span className="text-gray-400 font-normal">(Opcional)</span>
                          </label>
                          <div className="relative">
                            <RiMapPinLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
                            <input
                              type="text"
                              value={icpCity}
                              onChange={(e) => setIcpCity(e.target.value)}
                              placeholder="Ej: Santiago, Antofagasta..."
                              className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Ciudades clave sugeridas */}
                      {selectedCountryOption && selectedCountryOption.popularCities.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <span className="text-[11px] text-gray-400 dark:text-gray-500 mr-1 font-medium">Ciudades clave:</span>
                          {selectedCountryOption.popularCities.map((cName) => {
                            const active = icpCity.toLowerCase() === cName.toLowerCase();
                            return (
                              <button
                                key={cName}
                                type="button"
                                onClick={() => setIcpCity(active ? "" : cName)}
                                className={`px-2.5 py-0.5 rounded-lg text-xs font-medium border transition-all ${
                                  active
                                    ? "bg-brand-500 border-brand-500 text-white shadow-xs"
                                    : "bg-gray-50 border-gray-300 text-gray-700 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-300 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
                                }`}
                              >
                                {active ? `✓ ${cName}` : `+${cName}`}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Empresa o Industria (Opcional) */}
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                        Empresa o Industria <span className="text-gray-400 font-normal">(Opcional)</span>
                      </label>
                      <div className="relative">
                        <RiBuildingLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
                        <input
                          type="text"
                          value={icpCompany}
                          onChange={(e) => setIcpCompany(e.target.value)}
                          placeholder="ej: Salud, SaaS, Inmobiliaria, Google..."
                          className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                        />
                      </div>
                      {/* Sugerencias de Industrias */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {SAMPLE_INDUSTRIES.map((si) => {
                          const active = isPillActive(icpCompany, si);
                          return (
                            <button
                              key={si}
                              type="button"
                              onClick={() => setIcpCompany(toggleOrAppendPill(icpCompany, si))}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                                active
                                  ? "bg-brand-500 border-brand-500 text-white shadow-xs"
                                  : "bg-gray-50 border-gray-300 text-gray-700 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-300 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
                              }`}
                            >
                              {active ? `✓ ${si}` : `+${si}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Tamaño de Empresa (Empleados) */}
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                        Tamaño de Empresa (Empleados)
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
                              className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                                isSelected
                                  ? "bg-brand-500 border-brand-500 !text-white shadow-xs"
                                  : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750"
                              }`}
                            >
                              {sz.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Resumen de configuración ICP */}
                    <div className="p-3.5 rounded-2xl bg-brand-50/50 dark:bg-brand-950/20 border border-brand-300 dark:border-brand-800 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 text-brand-900 dark:text-brand-200">
                        <RiShieldCheckLine size={18} className="text-brand-500 shrink-0" />
                        <span>
                          <strong>ICP Configurado:</strong> {icpTitles.length > 0 ? `${icpTitles.length} cargo(s) (${icpTitles.slice(0, 3).join(", ")}${icpTitles.length > 3 ? "..." : ""})` : "Sin cargos definidos"} en{" "}
                          {icpLocations.length > 0 ? icpLocations.join(" · ") : icpCountry} · {icpSizes.length} rango(s) de tamaño
                          {icpCompany.trim() ? ` · Sector: ${icpCompany.trim()}` : ""}.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* =========================================================
                    PASO 2: DISPARADOR DE SEÑALES (POSTS VS PALABRAS CLAVE)
                   ========================================================= */}
                {wizardStep === 2 && (
                  <div className="space-y-5 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 pb-3">
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <RiRadarLine className="text-brand-500" /> Disparador de Señales de Intención
                      </h2>
                      <span className="text-xs text-gray-400 dark:text-gray-500">PASO 2 de 4</span>
                    </div>

                    {/* Selector de Categoría (Pestañas de Navegación del Paso 2) */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 p-1.5 rounded-2xl bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 text-xs gap-1.5 border border-brand-500/20 dark:border-brand-500/10">
                      <button
                        type="button"
                        onClick={() => {
                          setSignalCategoryTab("posts");
                          setNewType("post_engagement");
                        }}
                        className={`group flex items-center gap-3 py-3 px-3.5 rounded-xl transition-all cursor-pointer text-left ${
                          signalCategoryTab === "posts"
                            ? "bg-white dark:bg-gray-850 text-gray-900 dark:text-white shadow-xs border border-gray-300 dark:border-gray-700"
                            : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-white/60 dark:hover:bg-gray-700/50"
                        }`}
                      >
                        <span className={`text-2xl sm:text-3xl font-black tracking-tight shrink-0 select-none transition-colors ${
                          signalCategoryTab === "posts"
                            ? "text-brand-600 dark:text-brand-400"
                            : "text-gray-300 dark:text-gray-600 group-hover:text-gray-400 dark:group-hover:text-gray-500"
                        }`}>
                          01
                        </span>
                        <div className="min-w-0">
                          <span className="block leading-tight font-bold text-xs truncate">Posts en LinkedIn</span>
                          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 block truncate">Likes y Comentarios</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSignalCategoryTab("keywords");
                          setNewType("keyword_intent");
                        }}
                        className={`group flex items-center gap-3 py-3 px-3.5 rounded-xl transition-all cursor-pointer text-left ${
                          signalCategoryTab === "keywords"
                            ? "bg-white dark:bg-gray-850 text-gray-900 dark:text-white shadow-xs border border-gray-300 dark:border-gray-700"
                            : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-white/60 dark:hover:bg-gray-700/50"
                        }`}
                      >
                        <span className={`text-2xl sm:text-3xl font-black tracking-tight shrink-0 select-none transition-colors ${
                          signalCategoryTab === "keywords"
                            ? "text-brand-600 dark:text-brand-400"
                            : "text-gray-300 dark:text-gray-600 group-hover:text-gray-400 dark:group-hover:text-gray-500"
                        }`}>
                          02
                        </span>
                        <div className="min-w-0">
                          <span className="block leading-tight font-bold text-xs truncate">Palabras Clave & Mercado</span>
                          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 block truncate">Menciones y Noticias</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSignalCategoryTab("icp_triggers");
                          if (selectedIcpSignals.length === 0) {
                            setSelectedIcpSignals(["new_in_role"]);
                          }
                          setNewType(selectedIcpSignals[0] || "new_in_role");
                        }}
                        className={`group flex items-center gap-3 py-3 px-3.5 rounded-xl transition-all cursor-pointer text-left ${
                          signalCategoryTab === "icp_triggers"
                            ? "bg-white dark:bg-gray-850 text-gray-900 dark:text-white shadow-xs border border-gray-300 dark:border-gray-700"
                            : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-white/60 dark:hover:bg-gray-700/50"
                        }`}
                      >
                        <span className={`text-2xl sm:text-3xl font-black tracking-tight shrink-0 select-none transition-colors ${
                          signalCategoryTab === "icp_triggers"
                            ? "text-brand-600 dark:text-brand-400"
                            : "text-gray-300 dark:text-gray-600 group-hover:text-gray-400 dark:group-hover:text-gray-500"
                        }`}>
                          03
                        </span>
                        <div className="min-w-0">
                          <span className="block leading-tight font-bold text-xs truncate">Disparadores de ICP</span>
                          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 block truncate">100% Automático (Cero URLs)</span>
                        </div>
                      </button>
                    </div>

                    {/* =========================================================
                        PESTAÑA 1: PUBLICACIONES EN LINKEDIN (LIKES + COMENTARIOS)
                    ========================================================= */}
                    {signalCategoryTab === "posts" && (
                      <div className="space-y-4 animate-in fade-in duration-150">
                        {/* Selector de modo: Buscador Inteligente vs Manual */}
                        <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 pb-3">
                          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-xs">
                            <button
                              type="button"
                              onClick={() => setPostSearchMode("search")}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
                                postSearchMode === "search"
                                  ? "bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-300 shadow-2xs"
                                  : "text-gray-600 hover:text-gray-900 dark:text-gray-400"
                              }`}
                            >
                              <RiSearchLine size={13} /> Buscador de Posts en LinkedIn (Recomendado)
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPostSearchMode("manual");
                                setNewTargetUrl(selectedPostUrls.join("\n"));
                              }}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
                                postSearchMode === "manual"
                                  ? "bg-white dark:bg-gray-700 text-brand-600 dark:text-brand-300 shadow-2xs"
                                  : "text-gray-600 hover:text-gray-900 dark:text-gray-400"
                              }`}
                            >
                              <RiFileList3Line size={13} /> Pegar URL(s) Manualmente
                            </button>
                          </div>
                        </div>

                        {/* Publicaciones actualmente configuradas en el monitor */}
                        {selectedPostUrls.length > 0 && (
                          <div className="p-4 rounded-2xl bg-brand-50/50 dark:bg-brand-950/20 border border-brand-300 dark:border-brand-800 space-y-2.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-white text-[11px] font-bold">
                                  {selectedPostUrls.length}
                                </span>
                                <span className="text-xs font-bold text-gray-900 dark:text-white">
                                  {selectedPostUrls.length === 1
                                    ? "1 Publicación activa configurada"
                                    : `${selectedPostUrls.length} Publicaciones activas configuradas`}
                                </span>
                                <span className="text-[10px] text-brand-700 dark:text-brand-300 font-medium hidden sm:inline">
                                  (Señales que serán escaneadas)
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPostUrls([]);
                                  setNewTargetUrl("");
                                }}
                                className="text-[11px] font-semibold text-red-600 hover:text-red-700 dark:text-red-400 hover:underline"
                              >
                                Limpiar todas
                              </button>
                            </div>

                            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                              {selectedPostUrls.map((url, idx) => (
                                <div
                                  key={url + idx}
                                  className="flex items-center justify-between gap-2.5 p-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-xs shadow-2xs"
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <RiLinkedinBoxFill className="text-brand-600 shrink-0" size={16} />
                                    <span className="truncate font-mono text-[11px] text-gray-700 dark:text-gray-300" title={url}>
                                      {url}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300 transition-colors"
                                    >
                                      Ver post <RiExternalLinkLine size={10} />
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextUrls = selectedPostUrls.filter((_, i) => i !== idx);
                                        setSelectedPostUrls(nextUrls);
                                        setNewTargetUrl(nextUrls.join("\n"));
                                      }}
                                      className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                      title="Quitar esta publicación"
                                    >
                                      <RiCloseLine size={14} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* MODO BUSCADOR INTELIGENTE */}
                        {postSearchMode === "search" && (
                          <div className="space-y-4">
                            <div className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs space-y-3.5">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {/* Campo 1: Competidor o Marca */}
                                <div>
                                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    Competidor, Marca o Creador
                                  </label>
                                  <input
                                    type="text"
                                    value={postSearchCompetitor}
                                    onChange={(e) => {
                                      setPostSearchCompetitor(e.target.value);
                                      setNewCompetitor(e.target.value);
                                    }}
                                    placeholder="Ej: HubSpot, Lemlist, Salesforce..."
                                    className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                                  />
                                </div>

                                {/* Campo 2: Fecha de Publicación */}
                                <div>
                                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    Fecha de Publicación
                                  </label>
                                  <select
                                    value={postSearchDate}
                                    onChange={(e) => setPostSearchDate(e.target.value as any)}
                                    className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                                  >
                                    <option value="past_week">Esta semana (Más recientes)</option>
                                    <option value="past_month">Último mes (Mayor volumen)</option>
                                    <option value="past_24h">Últimas 24 horas (Inmediato)</option>
                                  </select>
                                </div>

                                {/* Campo 3: Ordenar por */}
                                <div>
                                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    Priorizar Resultados Por
                                  </label>
                                  <select
                                    value={postSearchSortBy}
                                    onChange={(e) => setPostSearchSortBy(e.target.value as any)}
                                    className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                                  >
                                    <option value="engagement">Mayor Viralidad (Likes + Comentarios)</option>
                                    <option value="date">Más Recientes</option>
                                  </select>
                                </div>
                              </div>

                              {/* Palabras clave de búsqueda */}
                              <div>
                                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                  Palabras Clave en la Publicación <span className="text-brand-500">*</span>
                                </label>
                                <div className="flex gap-2">
                                  <div className="relative flex-1">
                                    <RiSearchLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
                                    <input
                                      type="text"
                                      value={postSearchKeywords}
                                      onChange={(e) => setPostSearchKeywords(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          handleSearchLinkedInPosts();
                                        }
                                      }}
                                      placeholder="Ej: Prospección, IA, Automatización, Ventas B2B, Cold Email..."
                                      className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-8 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                                    />
                                    {postSearchKeywords && (
                                      <button
                                        type="button"
                                        onClick={() => setPostSearchKeywords("")}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                                      >
                                        <RiCloseLine size={15} />
                                      </button>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={handleSearchLinkedInPosts}
                                    disabled={isSearchingPosts}
                                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-50 shadow-xs transition-all shrink-0 cursor-pointer"
                                  >
                                    {isSearchingPosts ? (
                                      <>
                                        <RiRefreshLine className="animate-spin" size={14} /> Buscando en LinkedIn...
                                      </>
                                    ) : (
                                      <>
                                        <RiSearchLine size={14} /> Buscar Posts
                                      </>
                                    )}
                                  </button>
                                </div>

                                {/* Chips sugeridos de 1 clic */}
                                <div className="space-y-1.5 mt-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium mr-1">Temas recomendados:</span>
                                    {[
                                      "Prospección B2B",
                                      "Inteligencia Artificial",
                                      "Automatización",
                                      "Cold Outreach",
                                      "Generación de Leads",
                                      "SaaS",
                                    ].map((sug) => {
                                      const isChipActive = postSearchKeywords.trim().toLowerCase() === sug.toLowerCase();
                                      return (
                                        <button
                                          key={sug}
                                          type="button"
                                          onClick={() => {
                                            if (isChipActive) {
                                              setPostSearchKeywords("");
                                            } else {
                                              setPostSearchKeywords(sug);
                                            }
                                          }}
                                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                                            isChipActive
                                              ? "bg-brand-500 border-brand-500 text-white shadow-xs"
                                              : "bg-gray-50 border-gray-300 text-gray-700 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-300 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
                                          }`}
                                        >
                                          {isChipActive ? `✓ ${sug}` : `+${sug}`}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                    💡 Elige un tema o escribe un término directo (ej: <em>HubSpot</em>, <em>Prospección</em>) para descubrir publicaciones con alto volumen de comentarios y reacciones.
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* RESULTADOS DE BÚSQUEDA */}
                            {isSearchingPosts && (
                              <div className="p-8 text-center rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-300 dark:border-gray-700 space-y-3">
                                <RiRefreshLine className="animate-spin text-brand-500 mx-auto" size={28} />
                                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                  Conectando con LinkedIn y ordenando publicaciones por viralidad...
                                </p>
                                <p className="text-[11px] text-gray-400">
                                  Esto toma unos segundos mientras calculamos reacciones y comentarios reales.
                                </p>
                              </div>
                            )}

                            {!isSearchingPosts && discoveredPosts.length > 0 && (
                              <div className="space-y-3">
                                {/* Barra de control de publicaciones */}
                                <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-brand-50/60 dark:bg-brand-950/30 border border-brand-300 dark:border-brand-800">
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-500 text-white text-[11px] font-bold">
                                      {selectedPostUrls.length}
                                    </span>
                                    <span className="text-xs font-bold text-gray-900 dark:text-white">
                                      {selectedPostUrls.length === 1
                                        ? "1 publicación seleccionada"
                                        : `${selectedPostUrls.length} publicaciones seleccionadas`}
                                    </span>
                                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                      (de {discoveredPosts.length} encontradas)
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleSelectTopPosts(3)}
                                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-brand-700 bg-white dark:bg-gray-800 border border-brand-300 dark:border-brand-800 hover:bg-brand-100/50 transition-colors"
                                    >
                                      ⭐ Seleccionar Top 3 Virales
                                    </button>
                                    {selectedPostUrls.length > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => handleSelectTopPosts(0)}
                                        className="px-2 py-1 rounded-lg text-[11px] font-semibold text-gray-600 dark:text-gray-400 hover:text-red-500 transition-colors"
                                      >
                                        Limpiar
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Grid de Tarjetas de Posts */}
                                <div className="grid grid-cols-1 gap-2.5 max-h-[380px] overflow-y-auto pr-1">
                                  {discoveredPosts.map((post) => {
                                    const isSelected = selectedPostUrls.includes(post.shareUrl);
                                    return (
                                      <div
                                        key={post.id || post.shareUrl}
                                        onClick={() => toggleSelectPost(post.shareUrl)}
                                        className={`relative p-3.5 rounded-2xl border text-left cursor-pointer transition-all ${
                                          isSelected
                                            ? "border-brand-500 bg-brand-50/40 dark:bg-brand-950/40 shadow-xs ring-1 ring-brand-500"
                                            : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800/80 hover:border-gray-400 dark:hover:border-gray-600 hover:shadow-xs"
                                        }`}
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          {/* Checkbox + Autor */}
                                          <div className="flex items-start gap-3 min-w-0">
                                            <div className="pt-0.5 shrink-0">
                                              <div
                                                className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                                                  isSelected
                                                    ? "bg-brand-500 border-brand-500 text-white"
                                                    : "border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-900"
                                                }`}
                                              >
                                                {isSelected && <RiCheckLine size={12} />}
                                              </div>
                                            </div>

                                            {/* Avatar */}
                                            {post.author.profilePictureUrl ? (
                                              <img
                                                src={post.author.profilePictureUrl}
                                                alt={post.author.name}
                                                className="w-9 h-9 rounded-full object-cover shrink-0 border border-gray-300 dark:border-gray-700"
                                              />
                                            ) : (
                                              <div className="w-9 h-9 rounded-full bg-linear-to-br from-brand-400 to-indigo-600 text-white font-bold flex items-center justify-center text-xs shrink-0">
                                                {post.author.name ? post.author.name.slice(0, 2).toUpperCase() : "IN"}
                                              </div>
                                            )}

                                            {/* Info Autor */}
                                            <div className="min-w-0">
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="text-xs font-bold text-gray-900 dark:text-white truncate">
                                                  {post.author.name}
                                                </span>
                                                {post.author.isCompany && (
                                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                                    Empresa
                                                  </span>
                                                )}
                                              </div>
                                              {post.author.headline && (
                                                <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-1">
                                                  {post.author.headline}
                                                </p>
                                              )}
                                            </div>
                                          </div>

                                          {/* Enlace para ver en LinkedIn */}
                                          {post.shareUrl && (
                                            <a
                                              href={post.shareUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300 border border-brand-300 dark:border-brand-800 transition-colors shrink-0"
                                            >
                                              Ver en LinkedIn <RiExternalLinkLine size={11} />
                                            </a>
                                          )}
                                        </div>

                                        {/* Snippet del texto */}
                                        {post.text && (
                                          <p className="mt-2.5 text-xs text-gray-700 dark:text-gray-300 line-clamp-2 leading-relaxed">
                                            {post.text}
                                          </p>
                                        )}

                                        {/* Métricas de Engagement */}
                                        <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px]">
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                                            <RiThumbUpLine size={12} /> {post.reactionCount} reacciones
                                          </span>
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                                            <RiChat1Line size={12} /> {post.commentCount} comentarios
                                          </span>
                                          {post.repostCount > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium text-gray-500 bg-gray-100 dark:bg-gray-700/60">
                                              <RiShareForwardLine size={12} /> {post.repostCount}
                                            </span>
                                          )}
                                          {post.date && (
                                            <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 ml-auto">
                                              <RiTimeLine size={11} /> {post.date}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {!isSearchingPosts && discoveredPosts.length === 0 && (
                              <div className="p-6 text-center rounded-2xl bg-white dark:bg-gray-800/40 border-2 border-dashed border-gray-300 dark:border-gray-700 space-y-2">
                                <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-600 flex items-center justify-center mx-auto">
                                  <RiFireLine size={20} />
                                </div>
                                <h5 className="text-xs font-bold text-gray-800 dark:text-gray-200">
                                  Descubre publicaciones virales de competidores en 1 clic
                                </h5>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                                  Escribe el nombre de un competidor o temas clave de tu nicho arriba y pulsa <strong>Buscar Posts</strong> para ver publicaciones reales con alto volumen de comentarios y reacciones.
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* MODO MANUAL (Pegar URLs) */}
                        {postSearchMode === "manual" && (
                          <div className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                  Competidor o Referente <span className="text-gray-400 font-normal">(Opcional)</span>
                                </label>
                                <input
                                  type="text"
                                  value={newCompetitor}
                                  onChange={(e) => {
                                    setNewCompetitor(e.target.value);
                                    setPostSearchCompetitor(e.target.value);
                                  }}
                                  placeholder="Ej: HubSpot, Lemlist, Salesforce..."
                                  className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                                />
                              </div>
                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                    URL(s) de Publicaciones <span className="text-brand-500">*</span>
                                  </label>
                                  <span className="text-xs font-semibold text-brand-600 dark:text-brand-400">
                                    {selectedPostUrls.length} {selectedPostUrls.length === 1 ? "detectada" : "detectadas"}
                                  </span>
                                </div>
                                <textarea
                                  rows={3}
                                  value={newTargetUrl}
                                  onChange={(e) => {
                                    setNewTargetUrl(e.target.value);
                                    const urls = e.target.value
                                      .split(/[\n,]+/)
                                      .map((u) => u.trim())
                                      .filter((u) => u.startsWith("http"));
                                    setSelectedPostUrls(urls);
                                  }}
                                  placeholder="Pega una o más URLs de LinkedIn (una por línea)...&#10;https://www.linkedin.com/posts/...&#10;https://www.linkedin.com/feed/update/..."
                                  className="w-full rounded-xl border border-gray-300 bg-white p-3 text-xs text-gray-900 shadow-xs transition-all focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 font-mono"
                                />
                              </div>
                            </div>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500">
                              Puedes pegar publicaciones específicas de LinkedIn (ej: https://www.linkedin.com/posts/...). Se escanearán comentarios y reacciones de cada una.
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* =========================================================
                        PESTAÑA 2: PALABRAS CLAVE, COMPETIDORES Y NOTICIAS
                       ========================================================= */}
                    {signalCategoryTab === "keywords" && (
                      <div className="space-y-5 animate-in fade-in duration-150">
                        {/* 1. Empresa o Competidor a Vigilar */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                              Empresa, Competidor o Referente <span className="text-gray-400 font-normal">(Opcional)</span>
                            </label>
                            <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">Sin URLs necesarias</span>
                          </div>
                          <div className="relative">
                            <RiBuildingLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
                            <input
                              type="text"
                              value={newCompetitor}
                              onChange={(e) => {
                                setNewCompetitor(e.target.value);
                                setPostSearchCompetitor(e.target.value);
                              }}
                              placeholder="Ej: HubSpot, Salesforce, Lemlist, Apollo, Deel..."
                              className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                            />
                          </div>
                          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                            InHubFlow rastreará automáticamente discusiones públicas, menciones y personas que interactúen alrededor de este competidor.
                          </p>
                        </div>

                        {/* 2. Palabras Clave de Intención de Compra */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                              Palabras Clave de Intención de Compra
                            </label>
                            <span className="text-xs font-semibold text-brand-600 dark:text-brand-400">
                              {keywordsList.length} término(s) activo(s)
                            </span>
                          </div>

                          {/* Chips activos */}
                          {keywordsList.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-gray-50 dark:bg-gray-850 border border-gray-300 dark:border-gray-700 items-center">
                              {keywordsList.map((kw) => (
                                <span
                                  key={kw}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-brand-50 text-brand-800 dark:bg-brand-950/60 dark:text-brand-300 border border-brand-300 dark:border-brand-800 shadow-2xs"
                                >
                                  {kw}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveKeyword(kw)}
                                    className="hover:text-red-500 transition-colors cursor-pointer"
                                    title="Quitar palabra clave"
                                  >
                                    <RiCloseLine size={13} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Input para agregar keywords */}
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <RiSearchLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
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
                                placeholder="Escribe una frase y pulsa Enter (ej: 'busco CRM', 'alternativa a Lemlist')..."
                                className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-8 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                              />
                              {customKeywordInput && (
                                <button
                                  type="button"
                                  onClick={() => setCustomKeywordInput("")}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                                >
                                  <RiCloseLine size={15} />
                                </button>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleAddKeyword(customKeywordInput)}
                              className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 shadow-xs transition-all shrink-0 cursor-pointer"
                            >
                              + Añadir
                            </button>
                          </div>

                          {/* Sugerencias de 1 clic (estilo idéntico a las pills del Paso 1) */}
                          <div className="pt-0.5 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium mr-1">Términos sugeridos:</span>
                              {[
                                "busco CRM",
                                "alternativa a HubSpot",
                                "automatización de ventas",
                                "prospección b2b",
                                "cold outreach",
                                "contratar SDRs",
                              ].map((sug) => {
                                const isAdded = keywordsList.includes(sug);
                                return (
                                  <button
                                    key={sug}
                                    type="button"
                                    onClick={() => {
                                      if (isAdded) {
                                        handleRemoveKeyword(sug);
                                      } else {
                                        handleAddKeyword(sug);
                                      }
                                    }}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                                      isAdded
                                        ? "bg-brand-500 border-brand-500 text-white shadow-xs"
                                        : "bg-gray-50 border-gray-300 text-gray-700 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-300 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-brand-950/40 dark:hover:text-brand-400"
                                    }`}
                                  >
                                    {isAdded ? `✓ ${sug}` : `+${sug}`}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500">
                              💡 El sistema rastrea publicaciones y preguntas en LinkedIn donde las personas usen estas palabras clave y las cruza con tus cargos y países del ICP.
                            </p>
                          </div>
                        </div>

                        {/* 3. Eventos Disparadores de Mercado (Trigger Events) */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                              Eventos Disparadores de Mercado (Trigger Events)
                            </label>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (selectedMarketEvents.length === 3) {
                                    setSelectedMarketEvents([]);
                                  } else {
                                    setSelectedMarketEvents(["funding_round", "company_news", "acquisition_event"]);
                                  }
                                }}
                                className="text-[11px] font-semibold text-brand-600 dark:text-brand-400 hover:underline cursor-pointer"
                              >
                                {selectedMarketEvents.length === 3 ? "Deseleccionar todos" : "Seleccionar los 3"}
                              </button>
                              <span className="text-gray-300 dark:text-gray-600">|</span>
                              <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">Web Pública + LinkedIn</span>
                            </div>
                          </div>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            Activa alertas cuando empresas de tu sector protagonicen noticias relevantes en prensa o rondas de capital (puedes marcar 1, 2 o las 3 opciones):
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            {[
                              {
                                id: "funding_round",
                                icon: RiLineChartLine,
                                iconColor: "text-emerald-500",
                                title: "Rondas de Inversión",
                                desc: "Financiamiento reciente",
                              },
                              {
                                id: "company_news",
                                icon: RiMegaphoneLine,
                                iconColor: "text-rose-500",
                                title: "Expansión / Noticias",
                                desc: "Nuevas aperturas y lanzamientos",
                              },
                              {
                                id: "acquisition_event",
                                icon: RiExchangeLine,
                                iconColor: "text-indigo-500",
                                title: "Fusiones & Compras",
                                desc: "Reestructuración y nuevo stack",
                              },
                            ].map((ev) => {
                              const isActive = selectedMarketEvents.includes(ev.id);
                              const Icon = ev.icon;
                              return (
                                <button
                                  key={ev.id}
                                  type="button"
                                  onClick={() => handleToggleMarketEvent(ev.id)}
                                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer relative ${
                                    isActive
                                      ? "border-2 border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 text-gray-900 dark:text-white shadow-xs"
                                      : "border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750"
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-1.5">
                                    <Icon size={18} className={`${ev.iconColor} shrink-0`} />
                                    <div
                                      className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold transition-all ${
                                        isActive
                                          ? "bg-brand-500 text-white shadow-xs"
                                          : "border border-gray-300 dark:border-gray-600 text-transparent"
                                      }`}
                                    >
                                      ✓
                                    </div>
                                  </div>
                                  <strong className="text-xs block font-bold text-gray-900 dark:text-white">
                                    {ev.title}
                                  </strong>
                                  <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-0.5">
                                    {ev.desc}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          {selectedMarketEvents.length > 0 && (
                            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                              ✓ Se detectarán {selectedMarketEvents.length === 3 ? "los 3 tipos de noticias públicas" : `${selectedMarketEvents.length} tipo(s) de noticias públicas`} y se cruzarán con los decisores en LinkedIn que coincidan con tu ICP.
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* =========================================================
                        PESTAÑA 3: DISPARADORES AUTOMÁTICOS DE ICP (NIVEL 3)
                       ========================================================= */}
                    {signalCategoryTab === "icp_triggers" && (
                      <div className="space-y-4 animate-in fade-in duration-150">
                        {/* Cabecera de los 6 disparadores */}
                        <div className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                Señales Automáticas de Decisores (Nivel 3)
                              </span>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                                Selecciona 1 o más eventos. El sistema rastreará periódicamente LinkedIn buscando personas que cumplan estas condiciones:
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  if (selectedIcpSignals.length === 6) {
                                    setSelectedIcpSignals(["new_in_role"]);
                                  } else {
                                    setSelectedIcpSignals([
                                      "new_in_role",
                                      "internal_promotion",
                                      "hiring_spree",
                                      "company_growth",
                                      "profile_viewers",
                                      "active_poster",
                                    ]);
                                  }
                                }}
                                className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 hover:underline cursor-pointer"
                              >
                                {selectedIcpSignals.length === 6 ? "Restablecer (1)" : "Seleccionar los 6"}
                              </button>
                            </div>
                          </div>

                          {/* Grid de las 6 Señales Automáticas de ICP */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                            {[
                              {
                                id: "new_in_role",
                                icon: RiUserAddLine,
                                iconColor: "text-emerald-500",
                                title: "Just Hired / Nuevo Cargo (<90 Días)",
                                badge: "Ventana Dorada",
                                badgeBg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
                                desc: "Decisores recién nombrados (CEO, VP, Director). En sus primeros 90 días tienen presupuesto fresco para nuevos proveedores.",
                              },
                              {
                                id: "internal_promotion",
                                icon: RiArrowUpLine,
                                iconColor: "text-purple-500",
                                title: "Ascenso Interno a Decisor",
                                badge: "Poder de Firma",
                                badgeBg: "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300",
                                desc: "Profesionales promovidos internamente a puestos de liderazgo con capacidad de contratación y cambio de stack.",
                              },
                              {
                                id: "hiring_spree",
                                icon: RiBriefcaseLine,
                                iconColor: "text-orange-500",
                                title: "Hiring Intent (Contratación Activa)",
                                badge: "Presupuesto Abierto",
                                badgeBg: "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
                                desc: "Empresas de tu sector que han publicado vacantes comerciales o de operaciones. Si contratan personal, necesitan herramientas.",
                              },
                              {
                                id: "company_growth",
                                icon: RiLineChartLine,
                                iconColor: "text-teal-500",
                                title: "Empresas en Hipercrecimiento (+20%)",
                                badge: "Expansión Rápida",
                                badgeBg: "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300",
                                desc: "Empresas cuya plantilla esté creciendo rápidamente (+20% anual) según métricas de contratación en LinkedIn.",
                              },
                              {
                                id: "profile_viewers",
                                icon: RiEyeLine,
                                iconColor: "text-fuchsia-500",
                                title: "Visitantes Recientes de tu Perfil",
                                badge: "Interés Directo",
                                badgeBg: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/60 dark:text-fuchsia-300",
                                desc: "Prospectos y decisores que han visitado tu perfil de LinkedIn recientemente. Requiere Sales Navigator.",
                              },
                              {
                                id: "active_poster",
                                icon: RiFireLine,
                                iconColor: "text-rose-500",
                                title: "Más Activos en tu ICP (<48h)",
                                badge: "Bandeja Caliente",
                                badgeBg: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
                                desc: "Decisores que publican o comentan activamente en LinkedIn, garantizando que su bandeja de mensajes está activa.",
                              },
                            ].map((sig) => {
                              const isSelected = selectedIcpSignals.includes(sig.id);
                              const Icon = sig.icon;
                              return (
                                <button
                                  key={sig.id}
                                  type="button"
                                  onClick={() => handleToggleIcpSignal(sig.id)}
                                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer relative flex flex-col justify-between ${
                                    isSelected
                                      ? "border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100 ring-2 ring-emerald-500/40 shadow-xs"
                                      : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-850 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-600 hover:shadow-xs"
                                  }`}
                                >
                                  <div>
                                    <div className="flex items-center justify-between gap-1.5 mb-1.5">
                                      <Icon className={`${sig.iconColor} shrink-0`} size={18} />
                                      <div className="flex items-center gap-1.5">
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${sig.badgeBg}`}>
                                          {sig.badge}
                                        </span>
                                        <div
                                          className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold transition-all ${
                                            isSelected
                                              ? "bg-emerald-600 text-white shadow-xs"
                                              : "border border-gray-400 dark:border-gray-500 text-transparent"
                                          }`}
                                        >
                                          ✓
                                        </div>
                                      </div>
                                    </div>
                                    <strong className="text-xs block leading-tight font-bold text-gray-900 dark:text-white">
                                      {sig.title}
                                    </strong>
                                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                                      {sig.desc}
                                    </p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          {/* Mensaje de Confirmación */}
                          {selectedIcpSignals.length > 0 && (
                            <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-[11px]">
                              <p className="text-emerald-600 dark:text-emerald-400 font-medium">
                                ✓ <strong>{selectedIcpSignals.length} señal(es) activa(s):</strong> InHubFlow buscará continuamente perfiles y los agregará con su evidencia a la lista de destino.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* =========================================================
                    PASO 3: MENSAJE IA ANTI-STALKER & LIVE PREVIEW
                   ========================================================= */}
                {wizardStep === 3 && (
                  <div className="space-y-5 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 pb-3">
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <RiSparklingLine className="text-brand-500" /> Mensaje IA Anti-Stalker
                      </h2>
                      <span className="text-xs text-gray-400 dark:text-gray-500">PASO 3 de 4</span>
                    </div>

                    {/* Selector de Objetivo del Mensaje */}
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                        1. Objetivo de Conversión del Mensaje
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {[
                          {
                            id: "conversation",
                            icon: RiChat1Line,
                            iconColor: "text-brand-500",
                            title: "Iniciar Conversación",
                            desc: "Abre diálogo estratégico sobre cuellos de botella en su proceso.",
                          },
                          {
                            id: "demo",
                            icon: RiCalendarLine,
                            iconColor: "text-blue-500",
                            title: "Agendar Demo Breve",
                            desc: "Propuesta de valor directa para directores con dolor activo.",
                          },
                          {
                            id: "resource",
                            icon: RiFileList3Line,
                            iconColor: "text-purple-500",
                            title: "Compartir Recurso / Guía",
                            desc: "Ofrece un framework o playbook sin fricción comercial inicial.",
                          },
                        ].map((obj) => {
                          const Icon = obj.icon;
                          const isSelected = msgObjective === obj.id;
                          return (
                            <button
                              key={obj.id}
                              type="button"
                              onClick={() => setMsgObjective(obj.id as "conversation" | "demo" | "resource")}
                              className={`p-3.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                                isSelected
                                  ? "border-2 border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 text-gray-900 dark:text-white shadow-xs font-bold"
                                  : "border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750"
                              }`}
                            >
                              <div className="font-bold flex items-center gap-1.5">
                                <Icon size={16} className={obj.iconColor} />
                                <span>{obj.title}</span>
                              </div>
                              <div className="text-[11px] text-gray-500 dark:text-gray-400 font-normal mt-1 leading-snug">
                                {obj.desc}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Selector de Tono */}
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                        2. Tono de la IA
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {[
                          {
                            id: "consultive",
                            icon: RiSparklingLine,
                            iconColor: "text-purple-500",
                            label: "Consultivo & Experto (Recomendado)",
                          },
                          {
                            id: "professional",
                            icon: RiBriefcaseLine,
                            iconColor: "text-amber-500",
                            label: "Profesional & Directo",
                          },
                          {
                            id: "direct",
                            icon: RiThumbUpLine,
                            iconColor: "text-emerald-500",
                            label: "Cercano & Casual",
                          },
                        ].map((tn) => {
                          const Icon = tn.icon;
                          const isSelected = msgTone === tn.id;
                          return (
                            <button
                              key={tn.id}
                              type="button"
                              onClick={() => setMsgTone(tn.id as "consultive" | "professional" | "direct")}
                              className={`p-2.5 rounded-xl border text-center text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                isSelected
                                  ? "border-2 border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 text-gray-900 dark:text-white shadow-xs font-bold"
                                  : "border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750"
                              }`}
                            >
                              <Icon size={15} className={tn.iconColor} />
                              <span>{tn.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                          Idioma del Mensaje
                        </label>
                        <select
                          value={msgLanguage}
                          onChange={(e) => setMsgLanguage(e.target.value as "es" | "en" | "pt-BR")}
                          className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                        >
                          <option value="es">Español</option>
                          <option value="en">English</option>
                          <option value="pt-BR">Português (Brasil)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                          Máximo de Palabras
                        </label>
                        <input
                          type="number"
                          min={20}
                          max={180}
                          value={msgMaxWords}
                          onChange={(e) => setMsgMaxWords(Math.max(20, Math.min(180, Number(e.target.value) || 90)))}
                          className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                        />
                      </div>
                    </div>

                    {/* Vista previa orientativa del mensaje */}
                    <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                          Simulación en Tiempo Real (LinkedIn Direct Message Preview)
                        </label>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                          <RiShieldCheckLine size={12} /> Vista previa orientativa
                        </span>
                      </div>

                      {/* Mockup de LinkedIn Card */}
                      <div className="p-4 rounded-xl bg-[#F3F6F8] dark:bg-gray-850 border border-gray-300 dark:border-gray-700 space-y-3">
                        {/* Cabecera del chat de LinkedIn */}
                        <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 pb-2.5">
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
                          <div className="max-w-xl bg-white dark:bg-gray-800 p-4 rounded-xl rounded-tl-xs border border-gray-300 dark:border-gray-700 shadow-2xs text-xs md:text-sm text-gray-800 dark:text-gray-200 leading-relaxed font-normal">
                            {previewSignalMessage({
                              signalType: newType,
                              objective: msgObjective,
                              tone: msgTone,
                              competitor: newCompetitor,
                              keywords: keywordsList,
                              customTemplate,
                              language: msgLanguage,
                              maxWords: msgMaxWords,
                            })}
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
                            className="w-full rounded-xl border border-gray-300 bg-white p-3.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
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
                  <div className="space-y-5 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 pb-3">
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <RiPlayLine className="text-brand-500" /> Lanzamiento del Monitor de Señales
                      </h2>
                      <span className="text-xs text-gray-400 dark:text-gray-500">PASO 4 de 4</span>
                    </div>

                    {/* 1. Nombre del Monitor */}
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                        Nombre del Monitor <span className="text-brand-500">*</span>
                      </label>
                      <div className="relative">
                        <RiRadarLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
                        <input
                          type="text"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder={`Radar: ${
                            SIGNAL_DEFINITIONS.find((s) => s.id === newType)?.title || "Señales"
                          } - ${newCompetitor || keywordsList[0] || "ICP"}`}
                          className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                        />
                      </div>
                    </div>

                    {/* 2. Cuenta de LinkedIn Remitente */}
                    {accounts.length > 0 && (
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                          Cuenta de LinkedIn Remitente
                        </label>
                        <div className="relative">
                          <RiLinkedinBoxFill className="absolute left-3.5 top-3 text-brand-600" size={16} />
                          <select
                            value={selectedAccountId}
                            onChange={(e) => setSelectedAccountId(e.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                          >
                            {accounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.name} {acc.is_authenticated ? "(Conectada ✓)" : "(Desconectada)"}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* 3. Modo de Operación (Review vs Autopilot) */}
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                        Modo de Operación
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setNewMode("review")}
                          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                            newMode === "review"
                              ? "border-2 border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 text-gray-900 dark:text-white shadow-xs"
                              : "border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 font-bold text-xs">
                              Modo Revisión
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-300">
                                Recomendado
                              </span>
                            </span>
                            {newMode === "review" && <RiCheckLine className="text-brand-500" size={18} />}
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 font-normal mt-1 leading-relaxed">
                            Los prospectos captados van a tu cola de «Hot Leads». Revisas y apruebas el mensaje antes de activar el contacto.
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setNewMode("autopilot")}
                          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                            newMode === "autopilot"
                              ? "border-2 border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 text-gray-900 dark:text-white shadow-xs"
                              : "border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 font-bold text-xs">
                              Piloto Automático (Autopilot)
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300">
                                Gates SDR IA
                              </span>
                            </span>
                            {newMode === "autopilot" && <RiCheckLine className="text-brand-500" size={18} />}
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 font-normal mt-1 leading-relaxed">
                            InHubFlow solo enrola automáticamente cuando la cuenta, campaña y los controles del SDR IA están listos. Si falta un gate, el lead pasa a revisión.
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* 4. Lista y campaña destino */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                          Lista de Destino <span className="text-brand-500">*</span>
                        </label>
                        <select
                          value={newTargetList}
                          onChange={(e) => setNewTargetList(e.target.value)}
                          className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                        >
                          <option value="">Selecciona una lista</option>
                          {lists.map((list) => (
                            <option key={list.id} value={list.id}>{list.name} ({list.target_count} contactos)</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                          Workflow <span className="text-gray-400 font-normal">{newMode === "autopilot" ? "*" : "(Opcional)"}</span>
                        </label>
                        <select
                          value={newTargetWorkflow}
                          onChange={(e) => setNewTargetWorkflow(e.target.value)}
                          className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                        >
                          <option value="">Solo guardar en lista</option>
                          {workflows.map((workflow) => (
                            <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                        Frecuencia de Escaneo
                      </label>
                      <select
                        value={scanIntervalMinutes}
                        onChange={(e) => setScanIntervalMinutes(Number(e.target.value))}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs transition-all focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-brand-500"
                      >
                        <option value={60}>Cada hora</option>
                        <option value={360}>Cada 6 horas (recomendado)</option>
                        <option value={720}>Cada 12 horas</option>
                        <option value={1440}>Una vez al día</option>
                      </select>
                    </div>

                    {newMode === "autopilot" && (
                      <div className={`p-3.5 rounded-xl border text-xs ${autopilotReadiness?.ready
                        ? "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-200"
                        : "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200"}`}>
                        <strong>{autopilotReadiness?.ready ? "✓ Autopilot listo" : "Autopilot permanecerá en revisión"}</strong>
                        {!autopilotReadiness?.ready && (
                          <p className="mt-1 leading-relaxed">Completa cuenta, lista, workflow y gates del SDR IA. No se contactará a nadie automáticamente mientras falte un requisito.</p>
                        )}
                      </div>
                    )}

                    {/* Ficha Resumen Completa */}
                    <div className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          Resumen de Configuración del Monitor
                        </span>
                        <span className="text-[11px] text-brand-600 dark:text-brand-400 font-medium">
                          Listo para activar
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700">
                          <span className="text-[10px] text-gray-400 block font-medium">Audiencia (ICP)</span>
                          <strong className="text-gray-800 dark:text-gray-200 truncate block">
                            {icpTitles.length} cargos · {icpLocations.length > 0 ? icpLocations[0] : icpCountry}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700">
                          <span className="text-[10px] text-gray-400 block font-medium">Señal Elegida</span>
                          <strong className="text-brand-600 truncate block">
                            {SIGNAL_DEFINITIONS.find((s) => s.id === newType)?.title}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700">
                          <span className="text-[10px] text-gray-400 block font-medium">Fórmula Mensaje</span>
                          <strong className="text-purple-600 truncate block capitalize">
                            {msgObjective} · {msgTone}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700">
                          <span className="text-[10px] text-gray-400 block font-medium">Modo</span>
                          <strong className="text-emerald-600 block">
                            {newMode === "review" ? "Revisión Manual" : "Piloto Automático"}
                          </strong>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1 border-t border-gray-200 dark:border-gray-750">
                        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700">
                          <span className="text-[10px] text-gray-400 block font-medium">Disparador / Posts</span>
                          <strong className="text-gray-800 dark:text-gray-200 truncate block" title={selectedPostUrls.join(", ")}>
                            {selectedPostUrls.length > 0
                              ? `${selectedPostUrls.length} publicación(es)`
                              : newCompetitor.trim() || keywordsList[0] || "Configurado"}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700">
                          <span className="text-[10px] text-gray-400 block font-medium">Cuenta Remitente</span>
                          <strong className="text-gray-800 dark:text-gray-200 truncate block">
                            {accounts.find((a) => a.id === selectedAccountId)?.name || "Cuenta activa"}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700">
                          <span className="text-[10px] text-gray-400 block font-medium">Lista de Destino</span>
                          <strong className="text-gray-800 dark:text-gray-200 truncate block">
                            {lists.find((l) => l.id === newTargetList)?.name || "Sin lista"}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700">
                          <span className="text-[10px] text-gray-400 block font-medium">Frecuencia</span>
                          <strong className="text-gray-800 dark:text-gray-200 block">
                            {scanIntervalMinutes === 60
                              ? "Cada 1 hora"
                              : scanIntervalMinutes === 360
                              ? "Cada 6 horas"
                              : scanIntervalMinutes === 720
                              ? "Cada 12 horas"
                              : "Cada 24 horas"}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Footer de Navegación del Wizard */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-300 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-850/80">
                <div>
                  {wizardStep === 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewModal(false);
                        setEditingMonitorId(null);
                      }}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                    >
                      Cancelar
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setWizardStep((prev) => Math.max(1, prev - 1) as 1 | 2 | 3 | 4)}
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
                      onClick={advanceWizard}
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 shadow-md hover:shadow-lg transition-all"
                    >
                      Siguiente:{" "}
                      {wizardStep === 1
                        ? "Elegir Disparador"
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
                          <RiRefreshLine className="animate-spin" size={16} />{" "}
                          {editingMonitorId ? "Guardando Cambios..." : "Lanzando Monitor..."}
                        </>
                      ) : (
                        <>
                          {editingMonitorId ? <RiCheckLine size={16} /> : <RiRadarLine size={16} />}
                          {editingMonitorId ? "Guardar Cambios del Monitor" : "Lanzar Monitor de Señales"}
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
              <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 pb-3">
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

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-300 dark:border-gray-700">
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
