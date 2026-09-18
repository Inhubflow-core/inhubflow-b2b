import Head from "next/head";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  RiRobotLine,
  RiSettings4Line,
  RiBookOpenLine,
  RiChatCheckLine,
  RiHistoryLine,
  RiShieldCheckLine,
  RiAlertLine,
  RiSendPlaneLine,
  RiSaveLine,
  RiAddLine,
  RiDeleteBinLine,
  RiRefreshLine,
  RiSparklingLine,
  RiCheckLine,
  RiTimeLine,
  RiUserVoiceLine,
} from "react-icons/ri";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import type { SdrSimulationResult } from "@/lib/sdr-agent/simulation";

type Tab = "overview" | "prompts" | "knowledge" | "simulator" | "history";

interface KnowledgeSource {
  id: string;
  title: string;
  source_type: string;
  status: string;
  content: string;
  created_at: string;
}

interface SdrConfigData {
  runtime?: {
    available: boolean;
    requestedMode: "off" | "shadow" | "approval" | "auto";
    effectiveMode: "off" | "shadow" | "approval" | "auto";
    providerEnabled: boolean;
    outboundEnabled: boolean;
    blockers: string[];
  };
  agent: {
    id: string;
    name: string;
    status: string;
    mode: "off" | "shadow" | "approval" | "auto";
    default_language: string;
    model: string | null;
    confidence_threshold: number;
    max_auto_turns: number;
    handoff_email: string | null;
  };
  activeVersion: {
    id: string;
    version_number: number;
    publication_state?: "draft" | "published";
    model: string | null;
    system_prompt: string;
    policy: {
      company_context?: string;
      handoff_rules?: string;
    };
    config: {
      custom_instructions?: string;
    };
  } | null;
  stats: {
    totalDecisions: number;
    totalHandoffs: number;
    totalThreads: number;
    activeThreads: number;
  };
  recentDecisions: Array<{
    id: string;
    intent: string;
    confidence: number;
    risk_level: string;
    language: string;
    recommended_action: string;
    requires_human: number;
    reason_code: string | null;
    reply_draft: string | null;
    model: string | null;
    latency_ms: number;
    created_at: string;
    target_name?: string;
    target_company?: string;
  }>;
}

interface SdrSimulationResponse extends SdrSimulationResult {
  ok: true;
}

export default function SdrPage() {
  const { t, locale } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [data, setData] = useState<SdrConfigData | null>(null);

  // Form State
  const [agentName, setAgentName] = useState("");
  const [mode, setMode] = useState<"off" | "shadow" | "approval" | "auto">("shadow");
  const [model, setModel] = useState("gemini-3.7-flash");
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.85);
  const [maxAutoTurns, setMaxAutoTurns] = useState(3);
  const [handoffEmail, setHandoffEmail] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [handoffRules, setHandoffRules] = useState("");

  // Knowledge Sources State
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [newSourceTitle, setNewSourceTitle] = useState("");
  const [newSourceContent, setNewSourceContent] = useState("");
  const [newSourceType, setNewSourceType] = useState("catalog");
  const [addingSource, setAddingSource] = useState(false);

  // Simulator State
  const [simMessage, setSimMessage] = useState(
    "Hola Roberto, vi tu mensaje sobre la automatización de prospección B2B. ¿Cómo funciona la integración con LinkedIn y cuánto tiempo toma configurarlo?"
  );
  const [simSenderName, setSimSenderName] = useState("Carlos Mendoza");
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState<SdrSimulationResponse | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/sdr/config");
      if (!res.ok) throw new Error("Error al cargar la configuración");
      const json: SdrConfigData = await res.json();
      setData(json);

      // Populate Form State
      setAgentName(json.agent.name || "Asistente SDR InHubFlow");
      setMode(json.agent.mode || "shadow");
      setModel(json.agent.model || "gemini-3.7-flash");
      setConfidenceThreshold(json.agent.confidence_threshold || 0.85);
      setMaxAutoTurns(json.agent.max_auto_turns || 3);
      setHandoffEmail(json.agent.handoff_email || "");
      setSystemPrompt(json.activeVersion?.system_prompt || "");
      setCompanyContext(json.activeVersion?.policy?.company_context || "");
      setHandoffRules(json.activeVersion?.policy?.handoff_rules || "");
      setCustomInstructions(json.activeVersion?.config?.custom_instructions || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al conectar con el servidor SDR");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKnowledge = useCallback(async () => {
    try {
      const res = await fetch("/api/sdr/knowledge");
      if (res.ok) {
        const json = await res.json();
        setKnowledgeSources(json.sources || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadConfig();
    loadKnowledge();
  }, [loadConfig, loadKnowledge]);

  const handlePublish = async () => {
    if (!confirm("¿Publicar esta versión para el runtime SDR? Los envíos permanecen sujetos a todos los gates de seguridad.")) return;
    setPublishing(true);
    try {
      const response = await fetch("/api/sdr/publish", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo publicar");
      toast.success("Versión SDR publicada");
      loadConfig();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo publicar");
    } finally {
      setPublishing(false);
    }
  };

  const handleSaveConfig = async () => {
    try {
      setSaving(true);
      const res = await fetch("/api/sdr/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agentName,
          mode,
          model,
          confidence_threshold: confidenceThreshold,
          max_auto_turns: maxAutoTurns,
          handoff_email: handoffEmail,
          system_prompt: systemPrompt,
          company_context: companyContext,
          custom_instructions: customInstructions,
          handoff_rules: handoffRules,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error al guardar");
      }

      toast.success(t("sdr.toastConfigSaved"));
      loadConfig();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sdr.toastGenericError"));
    } finally {
      setSaving(false);
    }
  };

  const handleAddKnowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceTitle.trim() || !newSourceContent.trim()) {
      toast.error(t("sdr.toastFillRequired"));
      return;
    }

    try {
      setAddingSource(true);
      const res = await fetch("/api/sdr/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newSourceTitle,
          source_type: newSourceType,
          content: newSourceContent,
          status: "approved",
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Error al agregar fuente de conocimiento");
      }
      toast.success(t("sdr.toastDocAdded"));
      setNewSourceTitle("");
      setNewSourceContent("");
      loadKnowledge();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sdr.toastGenericError"));
    } finally {
      setAddingSource(false);
    }
  };

  const handleApproveKnowledge = async (id: string) => {
    try {
      const response = await fetch("/api/sdr/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "approve" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo aprobar la fuente");
      toast.success(t("sdr.toastDocApproved"));
      loadKnowledge();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sdr.toastGenericError"));
    }
  };

  const handleDeleteKnowledge = async (id: string) => {
    if (!confirm(t("sdr.confirmDeleteDoc"))) return;
    try {
      const res = await fetch(`/api/sdr/knowledge?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      toast.success(t("sdr.toastDocDeleted"));
      loadKnowledge();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sdr.toastGenericError"));
    }
  };

  const handleSimulate = async () => {
    if (!simMessage.trim()) {
      toast.error(t("sdr.toastEnterSimMessage"));
      return;
    }

    try {
      setSimLoading(true);
      setSimResult(null);
      const res = await fetch("/api/sdr/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          useLiveProvider: true,
          message: simMessage,
          senderName: simSenderName,
          systemPrompt,
          companyContext,
          customInstructions,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error en la simulación");

      setSimResult(json as SdrSimulationResponse);
      toast.success(t("sdr.toastSimCompleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sdr.toastGenericError"));
    } finally {
      setSimLoading(false);
    }
  };

  const getModeBadge = (m: string) => {
    switch (m) {
      case "auto":
        return { label: t("sdr.badgeAuto"), color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
      case "approval":
        return { label: t("sdr.badgeApproval"), color: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
      case "shadow":
        return { label: t("sdr.badgeShadow"), color: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
      default:
        return { label: t("sdr.badgeOff"), color: "bg-slate-500/15 text-slate-400 border-slate-500/30" };
    }
  };

  return (
    <>
      <Head>
        <title>{t("sdr.title")} — InHubFlow</title>
      </Head>

      <div className="space-y-6 pb-12">
        {/* Top Header Banner (Lead Finder Style) */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                {t("sdr.title")}
              </h1>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${getModeBadge(mode).color}`}
              >
                {getModeBadge(mode).label}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("sdr.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={loadConfig}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
            >
              <RiRefreshLine size={16} className={loading ? "animate-spin" : ""} />
              {t("common.refresh")}
            </button>
            {data?.activeVersion?.publication_state === "draft" && (
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-600 disabled:opacity-50 md:text-sm dark:text-emerald-400 cursor-pointer"
              >
                <RiCheckLine size={16} />
                {publishing ? t("sdr.publishing") : t("sdr.publishVersion")}
              </button>
            )}
            <button
              type="button"
              onClick={handleSaveConfig}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <RiSaveLine size={16} />
              {saving ? t("common.saving") : t("common.saveChanges")}
            </button>
          </div>
        </div>

        {data?.runtime && (
          <div className={`rounded-2xl border p-4 ${
            data.runtime.effectiveMode === data.runtime.requestedMode && data.runtime.available
              ? "border-emerald-500/25 bg-emerald-500/10"
              : "border-amber-500/30 bg-amber-500/10"
          }`}>
            <div className="flex items-start gap-3">
              {data.runtime.available ? <RiShieldCheckLine className="mt-0.5 text-emerald-500" size={19} /> : <RiAlertLine className="mt-0.5 text-amber-500" size={19} />}
              <div>
                <p className="text-sm font-semibold text-base-content">
                  {t("sdr.runtimeEffective", {
                    effective: data.runtime.effectiveMode.toUpperCase(),
                    requested: data.runtime.requestedMode.toUpperCase(),
                  })}
                </p>
                <p className="mt-1 text-xs text-base-content/60">
                  {t("sdr.providerStatus", {
                    status: data.runtime.providerEnabled ? t("sdr.statusEnabled") : t("sdr.statusBlocked"),
                    outbound: data.runtime.outboundEnabled ? t("sdr.statusEnabled") : t("sdr.statusBlocked"),
                  })}
                </p>
                {data.runtime.blockers.length > 0 && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    {t("sdr.runtimeBlockers", {
                      list: data.runtime.blockers
                        .map((b) => {
                          const translated = t(`sdr.blocker_${b}`);
                          return translated && translated !== `sdr.blocker_${b}` ? translated : b;
                        })
                        .join(", "),
                    })}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 pb-1 overflow-x-auto">
          <button
            onClick={() => setActiveTab("overview")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === "overview"
                ? "bg-violet-600/10 text-violet-400 border border-violet-500/20"
                : "text-base-content/60 hover:text-base-content hover:bg-base-200/50"
            }`}
          >
            <RiSettings4Line size={18} />
            {t("sdr.tabOverview")}
          </button>

          <button
            onClick={() => setActiveTab("prompts")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === "prompts"
                ? "bg-violet-600/10 text-violet-400 border border-violet-500/20"
                : "text-base-content/60 hover:text-base-content hover:bg-base-200/50"
            }`}
          >
            <RiUserVoiceLine size={18} />
            {t("sdr.tabPrompts")}
          </button>

          <button
            onClick={() => setActiveTab("knowledge")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === "knowledge"
                ? "bg-violet-600/10 text-violet-400 border border-violet-500/20"
                : "text-base-content/60 hover:text-base-content hover:bg-base-200/50"
            }`}
          >
            <RiBookOpenLine size={18} />
            {t("sdr.tabKnowledge", { count: knowledgeSources.length })}
          </button>

          <button
            onClick={() => setActiveTab("simulator")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === "simulator"
                ? "bg-violet-600/10 text-violet-400 border border-violet-500/20"
                : "text-base-content/60 hover:text-base-content hover:bg-base-200/50"
            }`}
          >
            <RiSparklingLine size={18} />
            {t("sdr.tabSimulator")}
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === "history"
                ? "bg-violet-600/10 text-violet-400 border border-violet-500/20"
                : "text-base-content/60 hover:text-base-content hover:bg-base-200/50"
            }`}
          >
            <RiHistoryLine size={18} />
            {t("sdr.tabHistory")}
          </button>
        </div>

        {/* ─── TAB 1: OVERVIEW & MODES ────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="space-y-8">
            {/* Quick Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs">
                <div className="text-xs font-medium text-base-content/50 mb-1 flex items-center gap-1.5">
                  <RiChatCheckLine className="text-violet-400" /> {t("sdr.totalDecisions")}
                </div>
                <div className="text-2xl font-bold text-base-content">{data?.stats.totalDecisions ?? 0}</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs">
                <div className="text-xs font-medium text-base-content/50 mb-1 flex items-center gap-1.5">
                  <RiAlertLine className="text-amber-400" /> {t("sdr.totalHandoffs")}
                </div>
                <div className="text-2xl font-bold text-amber-400">{data?.stats.totalHandoffs ?? 0}</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs">
                <div className="text-xs font-medium text-base-content/50 mb-1 flex items-center gap-1.5">
                  <RiRobotLine className="text-emerald-400" /> {t("sdr.activeThreads")}
                </div>
                <div className="text-2xl font-bold text-emerald-400">{data?.stats.activeThreads ?? 0}</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs">
                <div className="text-xs font-medium text-base-content/50 mb-1 flex items-center gap-1.5">
                  <RiShieldCheckLine className="text-blue-400" /> {t("sdr.confidenceLevel")}
                </div>
                <div className="text-2xl font-bold text-base-content">{(confidenceThreshold * 100).toFixed(0)}%</div>
              </div>
            </div>

            {/* Mode Selection Cards */}
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-base-content">{t("sdr.operatingModeTitle")}</h2>
                <p className="text-sm text-base-content/50">
                  {t("sdr.operatingModeSubtitle")}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* OFF */}
                <div
                  onClick={() => setMode("off")}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                    mode === "off"
                      ? "bg-base-200 border-slate-400 ring-2 ring-slate-400/20 shadow-md"
                      : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 hover:border-brand-500 shadow-xs"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400">
                      {t("sdr.badgeOffLabel")}
                    </span>
                    {mode === "off" && <RiCheckLine className="text-slate-400" size={18} />}
                  </div>
                  <h3 className="font-semibold text-base-content text-base mb-1">{t("sdr.modeOff")}</h3>
                  <p className="text-xs text-base-content/60 leading-relaxed">
                    {t("sdr.modeOffDesc")}
                  </p>
                </div>

                {/* SHADOW */}
                <div
                  onClick={() => setMode("shadow")}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                    mode === "shadow"
                      ? "bg-amber-500/10 border-amber-500/40 ring-2 ring-amber-500/20 shadow-md"
                      : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 hover:border-brand-500 shadow-xs"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                      {t("sdr.badgeRecommended")}
                    </span>
                    {mode === "shadow" && <RiCheckLine className="text-amber-400" size={18} />}
                  </div>
                  <h3 className="font-semibold text-base-content text-base mb-1">{t("sdr.modeShadow")}</h3>
                  <p className="text-xs text-base-content/60 leading-relaxed">
                    {t("sdr.modeShadowDesc")}
                  </p>
                </div>

                {/* APPROVAL */}
                <div
                  onClick={() => setMode("approval")}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                    mode === "approval"
                      ? "bg-blue-500/10 border-blue-500/40 ring-2 ring-blue-500/20 shadow-md"
                      : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 hover:border-brand-500 shadow-xs"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                      {t("sdr.badgeCopilot")}
                    </span>
                    {mode === "approval" && <RiCheckLine className="text-blue-400" size={18} />}
                  </div>
                  <h3 className="font-semibold text-base-content text-base mb-1">{t("sdr.modeApproval")}</h3>
                  <p className="text-xs text-base-content/60 leading-relaxed">
                    {t("sdr.modeApprovalDesc")}
                  </p>
                </div>

                {/* AUTO */}
                <div
                  onClick={() => setMode("auto")}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                    mode === "auto"
                      ? "bg-emerald-500/10 border-emerald-500/40 ring-2 ring-emerald-500/20 shadow-md"
                      : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 hover:border-brand-500 shadow-xs"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                      {t("sdr.badgeAutonomous")}
                    </span>
                    {mode === "auto" && <RiCheckLine className="text-emerald-400" size={18} />}
                  </div>
                  <h3 className="font-semibold text-base-content text-base mb-1">{t("sdr.modeAuto")}</h3>
                  <p className="text-xs text-base-content/60 leading-relaxed">
                    {t("sdr.modeAutoDesc")}
                  </p>
                </div>
              </div>
            </div>

            {/* Core Settings */}
            <div className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs space-y-6">
              <h3 className="font-semibold text-base-content text-base flex items-center gap-2">
                <RiSettings4Line className="text-violet-400" /> {t("sdr.engineParameters")}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-2">
                    {t("sdr.aiModel")}
                  </label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs text-sm font-medium text-base-content focus:outline-none focus:border-violet-500"
                  >
                    <option value="gemini-3.7-flash">InHubFlow Neural 3.7 ({t("sdr.aiModelRecommended") || "Recomendado"})</option>
                    <option value="gemini-3.8-flash">InHubFlow Neural 3.8 (Ultra)</option>
                    <option value="gemini-3.6-flash">InHubFlow Neural 3.6 (Fast)</option>
                  </select>
                  <p className="text-xs text-base-content/40 mt-1.5">
                    {t("sdr.aiModelDesc")}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-2">
                    {t("sdr.minConfidence", { pct: (confidenceThreshold * 100).toFixed(0) })}
                  </label>
                  <input
                    type="range"
                    min="0.70"
                    max="0.99"
                    step="0.01"
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                    className="w-full accent-violet-500 cursor-pointer mt-2"
                  />
                  <p className="text-xs text-base-content/40 mt-1.5">
                    {t("sdr.minConfidenceDesc")}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-2">
                    {t("sdr.maxAutoTurns")}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={maxAutoTurns}
                    onChange={(e) => setMaxAutoTurns(parseInt(e.target.value, 10))}
                    className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs text-sm font-medium text-base-content focus:outline-none focus:border-violet-500"
                  />
                  <p className="text-xs text-base-content/40 mt-1.5">
                    {t("sdr.maxAutoTurnsDesc")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 2: PROMPTS & PERSONALITY ──────────────────────────────────── */}
        {activeTab === "prompts" && (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs space-y-4">
              <div>
                <label className="block text-sm font-semibold text-base-content mb-1">
                  {t("sdr.systemPromptTitle")}
                </label>
                <p className="text-xs text-base-content/50 mb-3">
                  {t("sdr.systemPromptDesc")}
                </p>
                <textarea
                  rows={8}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="w-full p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs font-mono text-xs text-base-content leading-relaxed focus:outline-none focus:border-violet-500"
                  placeholder={t("sdr.systemPromptPlaceholder")}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs space-y-3">
                <label className="block text-sm font-semibold text-base-content">
                  {t("sdr.handoffRulesTitle")}
                </label>
                <p className="text-xs text-base-content/50">
                  {t("sdr.handoffRulesDesc")}
                </p>
                <textarea
                  rows={5}
                  value={handoffRules}
                  onChange={(e) => setHandoffRules(e.target.value)}
                  className="w-full p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs text-xs text-base-content focus:outline-none focus:border-violet-500"
                  placeholder={t("sdr.handoffRulesPlaceholder")}
                />
              </div>

              <div className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs space-y-3">
                <label className="block text-sm font-semibold text-base-content">
                  {t("sdr.customInstructionsTitle")}
                </label>
                <p className="text-xs text-base-content/50">
                  {t("sdr.customInstructionsDesc")}
                </p>
                <textarea
                  rows={5}
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  className="w-full p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs text-xs text-base-content focus:outline-none focus:border-violet-500"
                  placeholder={t("sdr.customInstructionsPlaceholder")}
                />
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 3: KNOWLEDGE BASE ─────────────────────────────────────────── */}
        {activeTab === "knowledge" && (
          <div className="space-y-6">
            {/* General Company Context */}
            <div className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs space-y-3">
              <label className="block text-sm font-semibold text-base-content">
                {t("sdr.companyContextTitle")}
              </label>
              <p className="text-xs text-base-content/50">
                {t("sdr.companyContextDesc")}
              </p>
              <textarea
                rows={6}
                value={companyContext}
                onChange={(e) => setCompanyContext(e.target.value)}
                className="w-full p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs text-xs text-base-content leading-relaxed focus:outline-none focus:border-violet-500"
                placeholder={t("sdr.companyContextPlaceholder")}
              />
            </div>

            {/* Add Knowledge Item Form */}
            <form onSubmit={handleAddKnowledge} className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs space-y-4">
              <h3 className="font-semibold text-base-content text-base flex items-center gap-2">
                <RiAddLine className="text-violet-400" /> {t("sdr.addKnowledgeTitle")}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <input
                    type="text"
                    value={newSourceTitle}
                    onChange={(e) => setNewSourceTitle(e.target.value)}
                    placeholder={t("sdr.sourceTitlePlaceholder")}
                    className="w-full px-4 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs text-sm text-base-content focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <select
                    value={newSourceType}
                    onChange={(e) => setNewSourceType(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs text-sm text-base-content focus:outline-none focus:border-violet-500"
                  >
                    <option value="catalog">{t("sdr.typeCatalog")}</option>
                    <option value="policy">{t("sdr.typePolicy")}</option>
                    <option value="text">{t("sdr.typeText")}</option>
                  </select>
                </div>
              </div>

              <div>
                <textarea
                  rows={4}
                  value={newSourceContent}
                  onChange={(e) => setNewSourceContent(e.target.value)}
                  placeholder={t("sdr.sourceContentPlaceholder")}
                  className="w-full p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs text-xs text-base-content focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={addingSource}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white transition-colors disabled:opacity-50"
                >
                  <RiAddLine size={16} />
                  {addingSource ? t("sdr.addingSource") : t("sdr.addSourceBtn")}
                </button>
              </div>
            </form>

            {/* List of Knowledge Sources */}
            <div className="space-y-3">
              <h3 className="font-semibold text-base-content text-sm">{t("sdr.savedDocs", { count: knowledgeSources.length })}</h3>
              {knowledgeSources.length === 0 ? (
                <div className="p-8 text-center rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs text-sm text-base-content/40">
                  {t("sdr.noSavedDocs")}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {knowledgeSources.map((s) => (
                    <div key={s.id} className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 uppercase">
                            {s.source_type}
                          </span>
                          <div className="flex items-center gap-1">
                            {s.status === "draft" && (
                              <button
                                type="button"
                                onClick={() => handleApproveKnowledge(s.id)}
                                className="rounded-lg px-2 py-1 text-[10px] font-semibold text-emerald-500 hover:bg-emerald-500/10 cursor-pointer"
                              >
                                {t("sdr.approve")}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteKnowledge(s.id)}
                              className="p-1.5 rounded-lg text-base-content/40 hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
                            >
                              <RiDeleteBinLine size={15} />
                            </button>
                          </div>
                        </div>
                        <h4 className="font-semibold text-base-content text-sm mb-1">{s.title}</h4>
                        <p className="text-xs text-base-content/60 line-clamp-3 leading-relaxed">{s.content}</p>
                      </div>
                      <div className="text-[10px] text-base-content/30 mt-3">
                        {new Date(s.created_at).toLocaleDateString(locale)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB 4: SIMULATOR / PLAYGROUND ─────────────────────────────────── */}
        {activeTab === "simulator" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Input Simulation Form */}
            <div className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs space-y-4">
              <h3 className="font-semibold text-base-content text-base flex items-center gap-2">
                <RiSparklingLine className="text-violet-400" /> {t("sdr.simTitle")}
              </h3>
              <p className="text-xs text-base-content/50">
                {t("sdr.simSubtitle")}
              </p>

              <div>
                <label className="block text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-1.5">
                  {t("sdr.simSender")}
                </label>
                <input
                  type="text"
                  value={simSenderName}
                  onChange={(e) => setSimSenderName(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs text-sm text-base-content focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-base-content/70 uppercase tracking-wider mb-1.5">
                  {t("sdr.simMessage")}
                </label>
                <textarea
                  rows={5}
                  value={simMessage}
                  onChange={(e) => setSimMessage(e.target.value)}
                  className="w-full p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs text-sm text-base-content leading-relaxed focus:outline-none focus:border-violet-500"
                  placeholder={t("sdr.simMessagePlaceholder")}
                />
              </div>

              <button
                type="button"
                onClick={handleSimulate}
                disabled={simLoading}
                className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-600/20 transition-all disabled:opacity-50"
              >
                <RiSendPlaneLine size={18} />
                {simLoading ? t("sdr.simLoading") : t("sdr.simBtn")}
              </button>
            </div>

            {/* Simulation Results Display */}
            <div className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs flex flex-col justify-between">
              {simResult ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-base-content/50">
                      {t("sdr.analysisResult")}
                    </span>
                    <span className="text-xs text-base-content/40 flex items-center gap-1">
                      <RiTimeLine size={12} /> {simResult.latencyMs} ms ({simResult.model})
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs">
                      <div className="text-[10px] uppercase font-bold text-base-content/40">{t("sdr.intent")}</div>
                      <div className="text-sm font-bold text-violet-400 uppercase mt-0.5">
                        {simResult.decision.intent}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs">
                      <div className="text-[10px] uppercase font-bold text-base-content/40">{t("sdr.confidence")}</div>
                      <div className="text-sm font-bold text-emerald-400 mt-0.5">
                        {(simResult.decision.confidence * 100).toFixed(1)}%
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs">
                      <div className="text-[10px] uppercase font-bold text-base-content/40">{t("sdr.suggestedAction")}</div>
                      <div className="text-sm font-semibold text-base-content mt-0.5">
                        {simResult.decision.recommended_action}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs">
                      <div className="text-[10px] uppercase font-bold text-base-content/40">{t("sdr.requiresHuman")}</div>
                      <div
                        className={`text-sm font-semibold mt-0.5 ${
                          simResult.decision.requires_human ? "text-amber-400" : "text-emerald-400"
                        }`}
                      >
                        {simResult.decision.requires_human ? t("sdr.yes") : t("sdr.no")}
                      </div>
                    </div>
                  </div>

                  {simResult.decision.reply_draft && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-base-content/60">{t("sdr.suggestedDraft")}</div>
                      <div className="p-4 rounded-xl bg-base-100 border border-violet-500/30 text-sm text-base-content leading-relaxed whitespace-pre-line">
                        {simResult.decision.reply_draft}
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-base-content/50 italic bg-base-100/50 p-3 rounded-xl border border-base-300/40">
                    <span className="font-semibold not-italic">{t("sdr.aiReasoning")}</span> {simResult.decision.reasoning_summary}
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-base-content/40">
                  <RiRobotLine size={48} className="mb-3 opacity-30" />
                  <p className="text-sm font-medium">{t("sdr.noRecentSims")}</p>
                  <p className="text-xs mt-1">{t("sdr.noRecentSimsHint")}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB 5: DECISION HISTORY ───────────────────────────────────────── */}
        {activeTab === "history" && (
          <div className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 shadow-xs space-y-4">
            <h3 className="font-semibold text-base-content text-base flex items-center gap-2">
              <RiHistoryLine className="text-violet-400" /> {t("sdr.historyTitle")}
            </h3>
            <p className="text-xs text-base-content/50">
              {t("sdr.historySubtitle")}
            </p>

            {data?.recentDecisions?.length === 0 ? (
              <div className="p-8 text-center text-sm text-base-content/40">
                {t("sdr.noHistory")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-xs font-semibold text-base-content/40 uppercase">
                      <th className="py-3 px-4">{t("sdr.colDate")}</th>
                      <th className="py-3 px-4">{t("sdr.colProspect")}</th>
                      <th className="py-3 px-4">{t("sdr.colIntent")}</th>
                      <th className="py-3 px-4">{t("sdr.colConfidence")}</th>
                      <th className="py-3 px-4">{t("sdr.colAction")}</th>
                      <th className="py-3 px-4">{t("sdr.colHuman")}</th>
                      <th className="py-3 px-4">{t("sdr.colDraft")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-base-300/30">
                    {data?.recentDecisions?.map((d) => (
                      <tr key={d.id} className="hover:bg-base-200/40 transition-colors">
                        <td className="py-3 px-4 text-xs text-base-content/60 whitespace-nowrap">
                          {new Date(d.created_at).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-medium text-base-content">
                          {d.target_name || t("sdr.colProspect")}
                          {d.target_company && <span className="block text-xs text-base-content/40">{d.target_company}</span>}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-500/10 text-violet-400">
                            {d.intent}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-emerald-400">
                          {(d.confidence * 100).toFixed(0)}%
                        </td>
                        <td className="py-3 px-4 text-xs text-base-content/70">{d.recommended_action}</td>
                        <td className="py-3 px-4">
                          {d.requires_human ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400">
                              {t("sdr.humanRequired")}
                            </span>
                          ) : (
                            <span className="text-xs text-base-content/40">{t("sdr.no")}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-base-content/60 max-w-xs truncate">
                          {d.reply_draft || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
