import Head from "next/head";
import { useState, useEffect, useMemo } from "react";
import type { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import {
  RiMegaphoneLine,
  RiRadarLine,
  RiCalendarEventLine,
  RiSearchLine,
  RiSparklingLine,
  RiThumbUpLine,
  RiChat1Line,
  RiShareForwardLine,
  RiTimeLine,
  RiCheckLine,
  RiEditLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiSendPlaneLine,
  RiLinkedinBoxFill,
  RiCloseLine,
  RiRefreshLine,
  RiArrowRightLine,
  RiAddLine,
  RiFileList3Line,
} from "react-icons/ri";

interface SocialPost {
  id: string;
  account_id: string;
  topic: string | null;
  content: string;
  media_url: string | null;
  media_type: string;
  original_post_url: string | null;
  original_author: string | null;
  original_content: string | null;
  original_metrics_json: string | null;
  scheduled_at: string;
  status: "draft" | "scheduled" | "publishing" | "published" | "failed";
  linkedin_post_urn: string | null;
  error_message: string | null;
  created_at: string;
  published_at: string | null;
}

interface ViralPost {
  id: string;
  author_name: string;
  author_headline: string;
  author_avatar: string | null;
  text: string;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  engagement_score: number;
  media_url: string | null;
  post_url: string | null;
  date: string | null;
}

interface AccountItem {
  id: string;
  name: string;
  unipile_account_id: string | null;
  unipile_status: string | null;
}

interface SocialSellingProps {
  accounts: AccountItem[];
  initialPosts: SocialPost[];
}

export const getServerSideProps: GetServerSideProps<SocialSellingProps> = async () => {
  const db = getDb();

  const accounts = db
    .prepare("SELECT id, name, unipile_account_id, unipile_status FROM accounts ORDER BY name ASC")
    .all() as AccountItem[];

  const initialPosts = db
    .prepare("SELECT * FROM social_selling_posts ORDER BY scheduled_at ASC")
    .all() as SocialPost[];

  return {
    props: {
      accounts,
      initialPosts,
    },
  };
};

export default function SocialSellingPage({ accounts, initialPosts }: SocialSellingProps) {
  const [activeTab, setActiveTab] = useState<"radar" | "calendar" | "create">("radar");
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id || "");

  // Radar State
  const [topic, setTopic] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [viralPosts, setViralPosts] = useState<ViralPost[]>([]);

  // Modeling State
  const [modelingPostId, setModelingPostId] = useState<string | null>(null);
  const [modeledDraft, setModeledDraft] = useState<{
    original: ViralPost;
    title: string;
    content: string;
  } | null>(null);

  // Calendar / Scheduled Posts State
  const [posts, setPosts] = useState<SocialPost[]>(initialPosts);
  const [isBatchScheduling, setIsBatchScheduling] = useState(false);

  // Modals
  const [previewPost, setPreviewPost] = useState<SocialPost | null>(null);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [publishLoadingId, setPublishLoadingId] = useState<string | null>(null);

  const selectedAccount = useMemo(() => {
    return accounts.find((a) => a.id === selectedAccountId) || accounts[0];
  }, [accounts, selectedAccountId]);

  // Recargar posts del calendario
  const refreshPosts = async () => {
    try {
      const res = await fetch(`/api/social-selling/posts?account_id=${selectedAccountId}`);
      const data = await res.json();
      if (data.posts) setPosts(data.posts);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshPosts();
  }, [selectedAccountId]);

  // Buscar posts virales por tema
  const handleSearchViral = async (customTopic?: string) => {
    const q = (customTopic ?? topic).trim();
    if (!q) {
      toast.error("Por favor ingresa un tema de búsqueda");
      return;
    }

    if (!selectedAccountId) {
      toast.error("Selecciona una cuenta de LinkedIn primero");
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch("/api/social-selling/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: q,
          account_id: selectedAccountId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al buscar posts");

      setViralPosts(data.posts || []);
      if ((data.posts || []).length === 0) {
        toast.info("No se encontraron publicaciones con ese tema exacto. Prueba con un término más general.");
      } else {
        toast.success(`Se encontraron ${data.posts.length} publicaciones con alto engagement`);
      }
    } catch (err: any) {
      toast.error(err.message || "Error al escanear posts virales");
    } finally {
      setIsSearching(false);
    }
  };

  // Modelar un post individual con IA
  const handleModelPost = async (vPost: ViralPost) => {
    setModelingPostId(vPost.id);
    try {
      const res = await fetch("/api/social-selling/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original_text: vPost.text,
          original_author: vPost.author_name,
          topic: topic || "Social Selling",
          account_id: selectedAccountId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error modelando el post");

      setModeledDraft({
        original: vPost,
        title: data.title,
        content: data.content,
      });
    } catch (err: any) {
      toast.error(err.message || "Error al modelar el post con IA");
    } finally {
      setModelingPostId(null);
    }
  };

  // Guardar un post modelado individual en el calendario
  const handleScheduleSingle = async (content: string, dateStr?: string) => {
    if (!selectedAccountId) {
      toast.error("Selecciona una cuenta de LinkedIn");
      return;
    }

    try {
      const scheduledAt = dateStr || new Date(Date.now() + 86400000).toISOString();
      const res = await fetch("/api/social-selling/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: selectedAccountId,
          content,
          topic: topic || "Inbound",
          scheduled_at: scheduledAt,
          original_post_url: modeledDraft?.original.post_url,
          original_author: modeledDraft?.original.author_name,
          original_content: modeledDraft?.original.text,
          original_metrics: modeledDraft ? {
            likes: modeledDraft.original.likes_count,
            comments: modeledDraft.original.comments_count,
            shares: modeledDraft.original.shares_count,
          } : null,
          status: "scheduled",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error programando el post");

      toast.success("¡Post programado con éxito!");
      setModeledDraft(null);
      await refreshPosts();
      setActiveTab("calendar");
    } catch (err: any) {
      toast.error(err.message || "Error al programar el post");
    }
  };

  // Modelar y programar en lote los 12 posts del mes (Lunes, Miércoles y Viernes)
  const handleBatchScheduleMonth = async () => {
    if (viralPosts.length === 0) {
      toast.error("Primero busca posts virales");
      return;
    }

    if (!selectedAccountId) {
      toast.error("Selecciona una cuenta de LinkedIn");
      return;
    }

    setIsBatchScheduling(true);
    toast.info("Iniciando modelado inteligente con IA para el mes completo...");

    try {
      const targetPosts = viralPosts.slice(0, 12);
      const modeledList: Array<{ content: string; original_post_url?: string; original_author?: string; original_content?: string; original_metrics?: any }> = [];

      for (let i = 0; i < targetPosts.length; i++) {
        const vp = targetPosts[i];
        try {
          const res = await fetch("/api/social-selling/model", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              original_text: vp.text,
              original_author: vp.author_name,
              topic: topic || "Social Selling",
              account_id: selectedAccountId,
            }),
          });
          const data = await res.json();
          if (res.ok && data.content) {
            modeledList.push({
              content: data.content,
              original_post_url: vp.post_url || undefined,
              original_author: vp.author_name || undefined,
              original_content: vp.text || undefined,
              original_metrics: {
                likes: vp.likes_count,
                comments: vp.comments_count,
                shares: vp.shares_count,
              },
            });
          }
        } catch {
          // continuar con los siguientes
        }
      }

      if (modeledList.length === 0) {
        throw new Error("No se pudo modelar ningún post");
      }

      // Enviar lote al endpoint de calendarización de Lunes, Miércoles y Viernes
      const batchRes = await fetch("/api/social-selling/schedule-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: selectedAccountId,
          posts: modeledList,
          topic: topic || "Social Selling Mes",
          publishing_time: "09:00",
        }),
      });

      const batchData = await batchRes.json();
      if (!batchRes.ok) throw new Error(batchData.error || "Error al calendarizar lote");

      toast.success(`¡Espectacular! Se programaron ${batchData.scheduled_count} posts para todo el mes (Lun, Mié, Vie)`);
      await refreshPosts();
      setActiveTab("calendar");
    } catch (err: any) {
      toast.error(err.message || "Error al modelar el lote mensual");
    } finally {
      setIsBatchScheduling(false);
    }
  };

  // Publicar un post inmediatamente
  const handlePublishNow = async (postId: string) => {
    setPublishLoadingId(postId);
    try {
      const res = await fetch("/api/social-selling/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: postId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error publicando");

      toast.success("¡Publicación enviada a LinkedIn con éxito!");
      await refreshPosts();
    } catch (err: any) {
      toast.error(err.message || "Error al publicar");
    } finally {
      setPublishLoadingId(null);
    }
  };

  // Eliminar un post programado
  const handleDeletePost = async (postId: string) => {
    if (!confirm("¿Seguro que deseas eliminar este post programado?")) return;
    try {
      const res = await fetch(`/api/social-selling/posts?id=${postId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      toast.success("Post eliminado");
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch {
      toast.error("No se pudo eliminar el post");
    }
  };

  // Actualizar post editado
  const handleSaveEdit = async () => {
    if (!editingPost) return;
    try {
      const res = await fetch("/api/social-selling/posts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingPost.id,
          content: editingPost.content,
          scheduled_at: editingPost.scheduled_at,
          status: editingPost.status,
        }),
      });
      if (!res.ok) throw new Error("Error actualizando");
      toast.success("Post actualizado correctamente");
      setEditingPost(null);
      await refreshPosts();
    } catch {
      toast.error("No se pudo actualizar el post");
    }
  };

  const sampleTopics = [
    "Automatización de Ventas B2B",
    "Liderazgo y Cultura Corporativa",
    "Estrategia de Prospección Outbound",
    "Inteligencia Artificial en Marketing",
    "Errores comunes en Ventas Complejas",
  ];

  return (
    <>
      <Head>
        <title>Social Selling | InHubFlow</title>
      </Head>

      <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950 p-6 md:p-8 space-y-6">
        {/* Header Superior */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                <RiMegaphoneLine className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                Social Selling
              </h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">
                Inbound IA
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Escanea publicaciones virales en LinkedIn, modélalas con la identidad de tu empresa y programa tu mes de contenido en minutos.
            </p>
          </div>

          {/* Selector de cuenta emisora */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Cuenta emisora:</label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="select select-sm select-bordered bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 font-medium rounded-lg"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Barra de Navegación de Pestañas */}
        <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800">
          <button
            onClick={() => setActiveTab("radar")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
              activeTab === "radar"
                ? "border-purple-600 text-purple-600 dark:text-purple-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <RiRadarLine className="w-4 h-4" />
            Radar Viral (Buscar y Modelar)
          </button>
          <button
            onClick={() => setActiveTab("calendar")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
              activeTab === "calendar"
                ? "border-purple-600 text-purple-600 dark:text-purple-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <RiCalendarEventLine className="w-4 h-4" />
            Calendario Editorial ({posts.length})
          </button>
          <button
            onClick={() => setActiveTab("create")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${
              activeTab === "create"
                ? "border-purple-600 text-purple-600 dark:text-purple-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <RiAddLine className="w-4 h-4" />
            Crear Publicación Manual
          </button>
        </div>

        {/* CONTENIDO: TAB 1 - RADAR VIRAL */}
        {activeTab === "radar" && (
          <div className="space-y-6">
            {/* Buscador de temas */}
            <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <RiSearchLine className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearchViral()}
                    placeholder="Escribe un tema de tu industria (ej. Automatización de ventas B2B, Retención de talento, etc.)"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:text-white"
                  />
                </div>
                <button
                  onClick={() => handleSearchViral()}
                  disabled={isSearching}
                  className="btn btn-primary bg-purple-600 hover:bg-purple-700 border-none text-white px-6 rounded-xl flex items-center gap-2"
                >
                  {isSearching ? (
                    <>
                      <span className="loading loading-spinner loading-xs" />
                      Escaneando LinkedIn...
                    </>
                  ) : (
                    <>
                      <RiSparklingLine className="w-4 h-4" />
                      Escanear Posts Virales
                    </>
                  )}
                </button>
              </div>

              {/* Temas sugeridos */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-gray-400">Sugerencias rápidas:</span>
                {sampleTopics.map((st) => (
                  <button
                    key={st}
                    onClick={() => {
                      setTopic(st);
                      handleSearchViral(st);
                    }}
                    className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-purple-50 hover:text-purple-600 dark:bg-gray-800 dark:hover:bg-purple-900/30 dark:hover:text-purple-300 text-gray-600 dark:text-gray-300 transition-colors"
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Cabecera de resultados y botón de Lote Mensual */}
            {viralPosts.length > 0 && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 p-4 rounded-xl">
                <div>
                  <h3 className="text-sm font-bold text-purple-950 dark:text-purple-200">
                    Se encontraron {viralPosts.length} publicaciones de alto impacto
                  </h3>
                  <p className="text-xs text-purple-700 dark:text-purple-300">
                    Puedes modelar posts individuales o usar el automatizador mensual para programar todo el mes.
                  </p>
                </div>
                <button
                  onClick={handleBatchScheduleMonth}
                  disabled={isBatchScheduling}
                  className="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white border-none rounded-lg px-4 flex items-center gap-2 shadow-sm"
                >
                  {isBatchScheduling ? (
                    <>
                      <span className="loading loading-spinner loading-xs" />
                      Modelando los 12 del mes...
                    </>
                  ) : (
                    <>
                      <RiSparklingLine className="w-4 h-4" />
                      ⚡ Modelar los 12 del Mes (Lun, Mié, Vie)
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Grid de 12 Posts Virales */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {viralPosts.map((vp) => (
                <div
                  key={vp.id}
                  className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Header del Autor */}
                    <div className="flex items-center gap-3">
                      {vp.author_avatar ? (
                        <img
                          src={vp.author_avatar}
                          alt={vp.author_name}
                          className="w-10 h-10 rounded-full object-cover border border-gray-200 dark:border-gray-700"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300 font-bold flex items-center justify-center text-sm">
                          {vp.author_name.charAt(0)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">
                          {vp.author_name}
                        </h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                          {vp.author_headline || "Profesional de LinkedIn"}
                        </p>
                      </div>
                      <RiLinkedinBoxFill className="w-5 h-5 text-blue-600 shrink-0" />
                    </div>

                    {/* Métricas de Engagement */}
                    <div className="flex items-center gap-3 text-xs bg-gray-50 dark:bg-gray-800/40 p-2 rounded-lg text-gray-600 dark:text-gray-300">
                      <span className="flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400">
                        <RiThumbUpLine className="w-3.5 h-3.5" />
                        {vp.likes_count.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                        <RiChat1Line className="w-3.5 h-3.5" />
                        {vp.comments_count.toLocaleString()}
                      </span>
                      {vp.shares_count > 0 && (
                        <span className="flex items-center gap-1 text-gray-500">
                          <RiShareForwardLine className="w-3.5 h-3.5" />
                          {vp.shares_count}
                        </span>
                      )}
                    </div>

                    {/* Contenido del Post */}
                    <div className="text-xs text-gray-700 dark:text-gray-300 line-clamp-6 whitespace-pre-line leading-relaxed font-normal">
                      {vp.text}
                    </div>

                    {vp.media_url && (
                      <div className="rounded-lg overflow-hidden border border-gray-100 dark:border-gray-800 h-28 bg-gray-100 dark:bg-gray-800">
                        <img src={vp.media_url} alt="Media" className="w-full h-full object-cover" />
                      </div>
                    )}
                  </div>

                  {/* Botón de Acción para Modelar */}
                  <div className="pt-4 border-t border-gray-100 dark:border-gray-800 mt-4">
                    <button
                      onClick={() => handleModelPost(vp)}
                      disabled={modelingPostId === vp.id}
                      className="w-full btn btn-sm bg-purple-50 hover:bg-purple-600 text-purple-700 hover:text-white dark:bg-purple-900/30 dark:hover:bg-purple-700 dark:text-purple-300 dark:hover:text-white border border-purple-200 dark:border-purple-800 rounded-xl flex items-center justify-center gap-2 transition-all font-semibold"
                    >
                      {modelingPostId === vp.id ? (
                        <>
                          <span className="loading loading-spinner loading-xs" />
                          Modelando con IA...
                        </>
                      ) : (
                        <>
                          <RiSparklingLine className="w-4 h-4" />
                          Modelar y Programar
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CONTENIDO: TAB 2 - CALENDARIO EDITORIAL MENSUAL */}
        {activeTab === "calendar" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  Calendario de Publicaciones (3 posts por semana)
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Publicaciones distribuidas automáticamente en Lunes, Miércoles y Viernes en horarios óptimos.
                </p>
              </div>
              <button
                onClick={refreshPosts}
                className="btn btn-sm btn-ghost gap-1.5 text-xs text-gray-600 dark:text-gray-300"
              >
                <RiRefreshLine className="w-3.5 h-3.5" />
                Actualizar
              </button>
            </div>

            {posts.length === 0 ? (
              <div className="bg-white dark:bg-gray-900 p-12 text-center rounded-2xl border border-gray-200 dark:border-gray-800 space-y-4">
                <div className="w-12 h-12 mx-auto rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 flex items-center justify-center">
                  <RiCalendarEventLine className="w-6 h-6" />
                </div>
                <h4 className="text-base font-bold text-gray-900 dark:text-white">
                  No hay publicaciones programadas aún
                </h4>
                <p className="text-sm text-gray-500 max-w-md mx-auto">
                  Ve a la pestaña <strong>Radar Viral</strong> para buscar los mejores posts de tu nicho y calendarizar tu mes en un solo clic.
                </p>
                <button
                  onClick={() => setActiveTab("radar")}
                  className="btn btn-primary bg-purple-600 text-white rounded-xl px-5"
                >
                  Ir al Radar Viral
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {posts.map((post) => {
                  const dateObj = new Date(post.scheduled_at);
                  const formattedDate = dateObj.toLocaleDateString("es-ES", {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  });
                  const formattedTime = dateObj.toLocaleTimeString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  return (
                    <div
                      key={post.id}
                      className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        {/* Fecha y Estado */}
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-xs font-bold text-purple-600 dark:text-purple-400 capitalize">
                            <RiTimeLine className="w-3.5 h-3.5" />
                            {formattedDate} • {formattedTime}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${
                              post.status === "published"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                                : post.status === "scheduled"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                                : post.status === "publishing"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                            }`}
                          >
                            {post.status === "published"
                              ? "Publicado"
                              : post.status === "scheduled"
                              ? "Programado"
                              : post.status === "publishing"
                              ? "Publicando..."
                              : "Error"}
                          </span>
                        </div>

                        {/* Preview del contenido */}
                        <div className="text-xs text-gray-700 dark:text-gray-300 line-clamp-5 whitespace-pre-line leading-relaxed font-normal bg-gray-50 dark:bg-gray-800/40 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                          {post.content}
                        </div>

                        {post.topic && (
                          <div className="text-[11px] text-gray-400">
                            Tema: <span className="text-gray-600 dark:text-gray-300 font-medium">{post.topic}</span>
                          </div>
                        )}
                      </div>

                      {/* Botones de acción */}
                      <div className="pt-4 border-t border-gray-100 dark:border-gray-800 mt-4 flex items-center justify-between">
                        <button
                          onClick={() => setPreviewPost(post)}
                          className="btn btn-xs btn-ghost gap-1 text-gray-600 hover:text-purple-600 dark:text-gray-400 text-[11px]"
                        >
                          <RiEyeLine className="w-3.5 h-3.5" />
                          Vista previa
                        </button>
                        <div className="flex items-center gap-1.5">
                          {post.status === "scheduled" && (
                            <button
                              onClick={() => handlePublishNow(post.id)}
                              disabled={publishLoadingId === post.id}
                              title="Publicar en LinkedIn de inmediato"
                              className="btn btn-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white dark:bg-emerald-950/40 dark:text-emerald-300 border-none rounded-lg"
                            >
                              {publishLoadingId === post.id ? (
                                <span className="loading loading-spinner loading-xs" />
                              ) : (
                                <RiSendPlaneLine className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => setEditingPost(post)}
                            title="Editar texto u horario"
                            className="btn btn-xs btn-ghost text-gray-500 hover:text-gray-800 dark:hover:text-white"
                          >
                            <RiEditLine className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeletePost(post.id)}
                            title="Eliminar post"
                            className="btn btn-xs btn-ghost text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            <RiDeleteBinLine className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* CONTENIDO: TAB 3 - CREAR PUBLICACIÓN MANUAL */}
        {activeTab === "create" && (
          <div className="max-w-2xl bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Crear Nueva Publicación
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Redacta directamente tu post o apóyate en tus borradores para programarlo en la cuenta de LinkedIn seleccionada.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Contenido del Post:</label>
                <textarea
                  id="manualPostContent"
                  rows={8}
                  placeholder="Escribe tu publicación para LinkedIn aquí..."
                  className="w-full mt-1 p-3.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Fecha y Hora de Publicación:</label>
                <input
                  type="datetime-local"
                  id="manualPostDate"
                  defaultValue={new Date(Date.now() + 86400000).toISOString().slice(0, 16)}
                  className="w-full mt-1 p-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-sm dark:text-white"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => {
                    const contentEl = document.getElementById("manualPostContent") as HTMLTextAreaElement;
                    const dateEl = document.getElementById("manualPostDate") as HTMLInputElement;
                    if (!contentEl?.value.trim()) {
                      toast.error("El contenido no puede estar vacío");
                      return;
                    }
                    handleScheduleSingle(contentEl.value.trim(), new Date(dateEl.value).toISOString());
                  }}
                  className="btn btn-primary bg-purple-600 text-white rounded-xl px-6"
                >
                  Programar Publicación
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: MODELADO CON IA */}
        {modeledDraft && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-3xl max-w-3xl w-full border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="p-5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-purple-50/50 dark:bg-purple-950/20">
                <div className="flex items-center gap-2 text-purple-700 dark:text-purple-300 font-bold text-sm">
                  <RiSparklingLine className="w-5 h-5" />
                  Post Modelado con la Identidad de tu Empresa (SDR)
                </div>
                <button
                  onClick={() => setModeledDraft(null)}
                  className="btn btn-sm btn-circle btn-ghost text-gray-500"
                >
                  <RiCloseLine className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Post Original de Referencia ({modeledDraft.original.author_name})
                  </label>
                  <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/30 p-3 rounded-xl border border-gray-100 dark:border-gray-800 line-clamp-3 mt-1">
                    {modeledDraft.original.text}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                    Versión Modelada (Gancho + Insight + Propuesta de Valor + CTA)
                  </label>
                  <textarea
                    value={modeledDraft.content}
                    onChange={(e) =>
                      setModeledDraft({ ...modeledDraft, content: e.target.value })
                    }
                    rows={10}
                    className="w-full mt-1 p-3.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:text-white"
                  />
                </div>
              </div>

              <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-end gap-3">
                <button
                  onClick={() => setModeledDraft(null)}
                  className="btn btn-sm btn-ghost text-gray-500 rounded-xl"
                >
                  Descartar
                </button>
                <button
                  onClick={() => handleScheduleSingle(modeledDraft.content)}
                  className="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white border-none rounded-xl px-5"
                >
                  Aprobar y Programar en Calendario
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: VISTA PREVIA ESTILO LINKEDIN */}
        {previewPost && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-xl w-full border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5">
                  <RiLinkedinBoxFill className="w-4 h-4 text-blue-600" />
                  Vista previa de publicación en LinkedIn
                </span>
                <button
                  onClick={() => setPreviewPost(null)}
                  className="btn btn-xs btn-circle btn-ghost text-gray-500"
                >
                  <RiCloseLine className="w-4 h-4" />
                </button>
              </div>

              {/* Feed Card LinkedIn */}
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-purple-600 text-white font-bold flex items-center justify-center text-base">
                    {selectedAccount?.name?.charAt(0) || "U"}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                      {selectedAccount?.name || "Tu Nombre"}
                    </h4>
                    <p className="text-xs text-gray-500 line-clamp-1">
                      Líder en Estrategia B2B • Social Selling
                    </p>
                    <span className="text-[11px] text-gray-400">Ahora • 🌐</span>
                  </div>
                </div>

                <div className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-line leading-relaxed">
                  {previewPost.content}
                </div>

                {/* Botones simulados de LinkedIn */}
                <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-around text-xs text-gray-500 font-semibold">
                  <span className="flex items-center gap-1.5 hover:text-blue-600 cursor-pointer">
                    <RiThumbUpLine className="w-4 h-4" /> Recomendar
                  </span>
                  <span className="flex items-center gap-1.5 hover:text-blue-600 cursor-pointer">
                    <RiChat1Line className="w-4 h-4" /> Comentar
                  </span>
                  <span className="flex items-center gap-1.5 hover:text-blue-600 cursor-pointer">
                    <RiShareForwardLine className="w-4 h-4" /> Compartir
                  </span>
                  <span className="flex items-center gap-1.5 hover:text-blue-600 cursor-pointer">
                    <RiSendPlaneLine className="w-4 h-4" /> Enviar
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: EDITAR POST */}
        {editingPost && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-xl w-full border border-gray-200 dark:border-gray-800 shadow-2xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  Editar Publicación Programada
                </h3>
                <button
                  onClick={() => setEditingPost(null)}
                  className="btn btn-xs btn-circle btn-ghost"
                >
                  <RiCloseLine className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Contenido:</label>
                <textarea
                  value={editingPost.content}
                  onChange={(e) => setEditingPost({ ...editingPost, content: e.target.value })}
                  rows={8}
                  className="w-full mt-1 p-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Fecha y Hora Programada:</label>
                <input
                  type="datetime-local"
                  value={new Date(editingPost.scheduled_at).toISOString().slice(0, 16)}
                  onChange={(e) =>
                    setEditingPost({
                      ...editingPost,
                      scheduled_at: new Date(e.target.value).toISOString(),
                    })
                  }
                  className="w-full mt-1 p-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm dark:text-white"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button onClick={() => setEditingPost(null)} className="btn btn-sm btn-ghost">
                  Cancelar
                </button>
                <button onClick={handleSaveEdit} className="btn btn-sm bg-purple-600 text-white rounded-xl">
                  Guardar Cambios
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
