import Head from "next/head";
import { useState, useEffect, useMemo } from "react";
import type { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
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
  RiFileCopyLine,
  RiImageAddLine,
  RiUploadCloud2Line,
  RiImageLine,
  RiExternalLinkLine,
} from "react-icons/ri";
import { getNextAvailablePublishingSlot } from "@/lib/social-selling/slots";
import { EditorialMonthCalendar } from "@/components/social-selling/EditorialMonthCalendar";

interface SocialPost {
  id: string;
  account_id: string;
  topic: string | null;
  content: string;
  image_prompt?: string | null;
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

export const getServerSideProps: GetServerSideProps<SocialSellingProps> = async (ctx) => {
  const session = await getServerSession(ctx.req, ctx.res, authOptions);
  if (!session) {
    return {
      redirect: { destination: "/login", permanent: false },
    };
  }

  const currentUser = session.user as any;
  const db = getDb();

  let accounts: AccountItem[] = [];

  // 1. Si es un vendedor/miembro del equipo asignado a una cuenta específica:
  if (currentUser?.owner_id && currentUser?.assigned_account_id) {
    accounts = db
      .prepare("SELECT id, name, unipile_account_id, unipile_status FROM accounts WHERE id = ?")
      .all(currentUser.assigned_account_id) as AccountItem[];
  } else if (currentUser?.owner_id) {
    accounts = db
      .prepare("SELECT id, name, unipile_account_id, unipile_status FROM accounts WHERE assigned_user_id = ?")
      .all(currentUser.id) as AccountItem[];
  } else {
    // 2. Si es el Administrador/Owner del workspace (o SuperAdmin): ve todas las cuentas de su equipo
    const isSuperAdmin =
      currentUser?.role === "admin" ||
      currentUser?.email?.trim().toLowerCase() === "inhubflow@gmail.com";

    if (isSuperAdmin) {
      accounts = db
        .prepare("SELECT id, name, unipile_account_id, unipile_status FROM accounts ORDER BY name ASC")
        .all() as AccountItem[];
    } else {
      accounts = db
        .prepare("SELECT id, name, unipile_account_id, unipile_status FROM accounts WHERE owner_id = ? OR owner_id IS NULL ORDER BY name ASC")
        .all(currentUser.id) as AccountItem[];
    }
  }

  const accountIds = accounts.map((a) => a.id);
  const initialPosts =
    accountIds.length > 0
      ? (db
          .prepare(
            `SELECT * FROM social_selling_posts WHERE account_id IN (${accountIds.map(() => "?").join(",")}) ORDER BY scheduled_at ASC`
          )
          .all(...accountIds) as SocialPost[])
      : [];

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
    image_prompt?: string | null;
    media_url?: string | null;
    scheduled_at?: string;
  } | null>(null);

  // Subida de imagen
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Manual Post State
  const [manualContent, setManualContent] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [manualImagePrompt, setManualImagePrompt] = useState<string | null>(null);
  const [manualMediaUrl, setManualMediaUrl] = useState<string | null>(null);
  const [isGeneratingManualPrompt, setIsGeneratingManualPrompt] = useState(false);
  const [isReorganizing, setIsReorganizing] = useState(false);

  // Calendar / Scheduled Posts State
  const [posts, setPosts] = useState<SocialPost[]>(initialPosts);
  const [calendarViewMode, setCalendarViewMode] = useState<"month" | "cards">("month");
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

  // Mantener el slot predeterminado para posts manuales en el próximo Lun/Mié/Vie libre
  useEffect(() => {
    if (posts) {
      const slot = getNextAvailablePublishingSlot(posts);
      setManualDate(slot.toISOString().slice(0, 16));
    }
  }, [posts, activeTab]);

  // Reorganizar automáticamente todas las publicaciones pendientes en Lunes, Miércoles y Viernes
  const handleReorganizeCalendar = async () => {
    if (!selectedAccountId) return;
    setIsReorganizing(true);
    try {
      const res = await fetch("/api/social-selling/reorganize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: selectedAccountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al reorganizar el calendario");
      toast.success(data.message || "¡Calendario reorganizado en Lunes, Miércoles y Viernes!");
      await refreshPosts();
    } catch (err: any) {
      toast.error(err.message || "Error al reorganizar");
    } finally {
      setIsReorganizing(false);
    }
  };

  // Reprogramar post al arrastrar y soltar (Drag and Drop) dentro del calendario
  const handleReschedulePost = async (postId: string, newDate: Date) => {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    // Mantener la hora original del post o las 10:00 AM si no estuviese definida
    const currentScheduled = new Date(post.scheduled_at);
    const targetDate = new Date(newDate);
    if (!isNaN(currentScheduled.getTime())) {
      targetDate.setHours(currentScheduled.getHours(), currentScheduled.getMinutes(), 0, 0);
    } else {
      targetDate.setHours(10, 0, 0, 0);
    }

    const newIso = targetDate.toISOString();

    // Actualización optimista inmediata en la interfaz
    const previousPosts = [...posts];
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, scheduled_at: newIso } : p))
    );

    try {
      const res = await fetch("/api/social-selling/posts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: postId,
          scheduled_at: newIso,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "No se pudo reprogramar la publicación");
      }

      const formattedDate = targetDate.toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      const formattedTime = targetDate.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      });

      toast.success(`Publicación reprogramada para el ${formattedDate} (${formattedTime})`);
    } catch (err: any) {
      setPosts(previousPosts);
      toast.error(err.message || "Error al mover la publicación");
    }
  };

  // Copiar Prompt de Imagen al Portapapeles (Asegurando siempre formato 4:3)
  const handleCopyPrompt = async (promptText?: string | null) => {
    if (!promptText) {
      toast.error("No hay un prompt de imagen generado para este post");
      return;
    }
    let normalized = promptText.trim();
    if (!normalized.includes("4:3")) {
      normalized = normalized.replace(/--ar\s+\d+:\d+/gi, "").replace(/aspect ratio\s+\d+:\d+/gi, "").trim();
      normalized = `${normalized.replace(/,\s*$/, "")}, aspect ratio 4:3 --ar 4:3`;
    }
    try {
      await navigator.clipboard.writeText(normalized);
      toast.success("¡Prompt copiado (Formato 4:3)! Listo para Midjourney o Flux.");
    } catch {
      toast.error("No se pudo copiar automáticamente. Por favor selecciónalo y copia manualmente.");
    }
  };

function resolveImageUrl(url?: string | null): string {
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("http")) return url;
  if (url.startsWith("/api/uploads/social-image")) return url;
  if (url.startsWith("/uploads/social-posts/")) {
    const filename = url.replace(/^\/uploads\/social-posts\//, "").split("?")[0];
    return `/api/uploads/social-image?file=${filename}`;
  }
  return url;
}

  // Subir archivo de imagen para el post
  const handleImageFileChange = async (file: File, target: "draft" | "edit" | "manual") => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Por favor selecciona un archivo de imagen (PNG, JPG o WEBP)");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error("La imagen supera el límite de 15 MB");
      return;
    }

    setIsUploadingImage(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;

        // 1. Mostrar de inmediato la imagen local en la UI (cero latencia para vista previa)
        if (target === "draft") {
          setModeledDraft((prev) => (prev ? { ...prev, media_url: base64 } : null));
        } else if (target === "edit") {
          setEditingPost((prev) => (prev ? { ...prev, media_url: base64, media_type: "image" } : null));
        } else if (target === "manual") {
          setManualMediaUrl(base64);
        }

        // 2. Subir al servidor en segundo plano
        try {
          const res = await fetch("/api/uploads/social-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type,
              base64,
            }),
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Error al subir la imagen");

          // 3. Reemplazar con la URL oficial de la API
          if (target === "draft") {
            setModeledDraft((prev) => (prev ? { ...prev, media_url: data.url } : null));
          } else if (target === "edit") {
            setEditingPost((prev) => (prev ? { ...prev, media_url: data.url, media_type: "image" } : null));
          } else if (target === "manual") {
            setManualMediaUrl(data.url);
          }
          toast.success("¡Imagen subida y adjuntada al post!");
        } catch (uploadErr: any) {
          toast.error(uploadErr.message || "Error al procesar subida");
        } finally {
          setIsUploadingImage(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setIsUploadingImage(false);
      toast.error(err.message || "Error al leer el archivo");
    }
  };

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

      const nextSlot = getNextAvailablePublishingSlot(posts);

      setModeledDraft({
        original: vPost,
        title: data.title,
        content: data.content,
        image_prompt: data.image_prompt || null,
        media_url: null,
        scheduled_at: nextSlot.toISOString(),
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
      const scheduledAt = dateStr || getNextAvailablePublishingSlot(posts).toISOString();
      const res = await fetch("/api/social-selling/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: selectedAccountId,
          content,
          topic: topic || "Inbound",
          scheduled_at: scheduledAt,
          image_prompt: modeledDraft?.image_prompt || null,
          media_url: modeledDraft?.media_url || null,
          media_type: modeledDraft?.media_url ? "image" : "none",
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

  // Generar prompt de imagen con IA a partir del texto del post manual (en formato 4:3)
  const handleGenerateManualPrompt = async () => {
    if (!manualContent || !manualContent.trim()) {
      toast.error("Escribe primero el contenido del post para que la IA diseñe el prompt visual");
      return;
    }

    setIsGeneratingManualPrompt(true);
    try {
      const res = await fetch("/api/social-selling/generate-image-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post_content: manualContent.trim(),
          topic: topic || "Social Selling",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error generando prompt de imagen");

      setManualImagePrompt(data.image_prompt);
      toast.success("¡Prompt generado con éxito en formato 4:3!");
    } catch (err: any) {
      toast.error(err.message || "Error al generar prompt de imagen");
    } finally {
      setIsGeneratingManualPrompt(false);
    }
  };

  // Programar publicación manual completa (con prompt y/o imagen)
  const handleScheduleManual = async () => {
    if (!selectedAccountId) {
      toast.error("Selecciona una cuenta de LinkedIn");
      return;
    }
    if (!manualContent || !manualContent.trim()) {
      toast.error("El contenido del post no puede estar vacío");
      return;
    }

    try {
      const scheduledAt = manualDate ? new Date(manualDate).toISOString() : getNextAvailablePublishingSlot(posts).toISOString();
      const res = await fetch("/api/social-selling/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: selectedAccountId,
          content: manualContent.trim(),
          topic: topic || "Publicación Manual",
          scheduled_at: scheduledAt,
          image_prompt: manualImagePrompt || null,
          media_url: manualMediaUrl || null,
          media_type: manualMediaUrl ? "image" : "none",
          status: "scheduled",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error programando el post");

      toast.success("¡Publicación programada con éxito!");
      setManualContent("");
      setManualImagePrompt(null);
      setManualMediaUrl(null);
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
      const modeledList: Array<{
        content: string;
        image_prompt?: string | null;
        media_url?: string | null;
        media_type?: string;
        original_post_url?: string;
        original_author?: string;
        original_content?: string;
        original_metrics?: any;
      }> = [];

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
              image_prompt: data.image_prompt || null,
              media_url: null,
              media_type: "none",
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
          image_prompt: editingPost.image_prompt || null,
          media_url: editingPost.media_url || null,
          media_type: editingPost.media_url ? "image" : "none",
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
                    type="button"
                    onClick={() => setTopic(st)}
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
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
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
                      <span className="flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400" title="Reacciones">
                        <RiThumbUpLine className="w-3.5 h-3.5" />
                        {vp.likes_count.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400" title="Comentarios">
                        <RiChat1Line className="w-3.5 h-3.5" />
                        {vp.comments_count.toLocaleString()}
                      </span>
                      {vp.shares_count > 0 && (
                        <span className="flex items-center gap-1 text-gray-500" title="Veces compartido">
                          <RiShareForwardLine className="w-3.5 h-3.5" />
                          {vp.shares_count}
                        </span>
                      )}
                      {vp.comments_count >= 2 ? (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          💬 Debate activo
                        </span>
                      ) : vp.likes_count >= 15 ? (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                          🚀 Alto alcance
                        </span>
                      ) : null}
                    </div>

                    {/* Contenido del Post */}
                    <div className="text-xs text-gray-700 dark:text-gray-300 line-clamp-6 whitespace-pre-line leading-relaxed font-normal">
                      {vp.text}
                    </div>

                    {vp.media_url && (
                      <div className="rounded-lg overflow-hidden border border-gray-100 dark:border-gray-800 h-28 bg-gray-100 dark:bg-gray-800">
                        <img
                          src={vp.media_url}
                          alt="Creativo de LinkedIn"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            // Si la URL de LinkedIn expira o no carga, ocultar el contenedor limpiamente
                            e.currentTarget.parentElement?.classList.add("hidden");
                          }}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                  </div>

                  {/* Botones de Acción */}
                  <div className="pt-4 border-t border-gray-100 dark:border-gray-800 mt-4 flex items-center gap-2">
                    {vp.post_url ? (
                      <a
                        href={vp.post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-sm btn-outline border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl flex items-center justify-center gap-1.5 transition-all text-xs font-semibold px-3 shrink-0"
                        title="Abrir publicación original en LinkedIn"
                      >
                        <RiExternalLinkLine className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                        <span>Ver Publicación</span>
                      </a>
                    ) : null}

                    <button
                      onClick={() => handleModelPost(vp)}
                      disabled={modelingPostId === vp.id}
                      className="flex-1 btn btn-sm bg-purple-50 hover:bg-purple-600 text-purple-700 hover:text-white dark:bg-purple-900/30 dark:hover:bg-purple-700 dark:text-purple-300 dark:hover:text-white border border-purple-200 dark:border-purple-800 rounded-xl flex items-center justify-center gap-1.5 transition-all font-semibold text-xs truncate"
                    >
                      {modelingPostId === vp.id ? (
                        <>
                          <span className="loading loading-spinner loading-xs" />
                          <span className="truncate">Modelando...</span>
                        </>
                      ) : (
                        <>
                          <RiSparklingLine className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">Modelar y Programar</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CONTENIDO: TAB 2 - CALENDARIO EDITORIAL MENSUAL CON DRAG & DROP */}
        {activeTab === "calendar" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-purple-500/5 dark:bg-purple-950/20 p-4 rounded-2xl border border-purple-200/60 dark:border-purple-900/40">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    Calendario Editorial
                  </h3>
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                    {posts.length} {posts.length === 1 ? "publicación" : "publicaciones"}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Arrastra y suelta (drag and drop) publicaciones entre casillas para reprogramar fechas al instante.
                </p>
              </div>

              {/* Selector de modo de vista: Mes vs Tarjetas */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="join border border-gray-300 dark:border-gray-700 rounded-xl p-0.5 bg-gray-100 dark:bg-gray-800 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setCalendarViewMode("month")}
                    className={`join-item btn btn-xs gap-1 font-semibold ${
                      calendarViewMode === "month"
                        ? "btn-primary bg-purple-600 border-purple-600 text-white"
                        : "btn-ghost text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                    }`}
                    title="Vista de calendario mensual con cuadrícula de días y drag & drop"
                  >
                    <RiCalendarEventLine size={13} /> Vista Mes
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarViewMode("cards")}
                    className={`join-item btn btn-xs gap-1 font-semibold ${
                      calendarViewMode === "cards"
                        ? "btn-primary bg-purple-600 border-purple-600 text-white"
                        : "btn-ghost text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                    }`}
                    title="Vista en lista detallada de tarjetas"
                  >
                    <RiFileList3Line size={13} /> Tarjetas
                  </button>
                </div>
              </div>
            </div>

            {posts.length === 0 ? (
              <div className="bg-white dark:bg-gray-900 p-12 text-center rounded-2xl border border-gray-200 dark:border-gray-800 space-y-4 shadow-sm">
                <div className="w-12 h-12 mx-auto rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 flex items-center justify-center">
                  <RiCalendarEventLine className="w-6 h-6" />
                </div>
                <h4 className="text-base font-bold text-gray-900 dark:text-white">
                  No hay publicaciones programadas aún
                </h4>
                <p className="text-sm text-gray-500 max-w-md mx-auto">
                  Ve a la pestaña <strong>Radar Viral</strong> para buscar los mejores posts de tu nicho y calendarizar tu mes en un solo clic, o crea una publicación manual.
                </p>
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => setActiveTab("radar")}
                    className="btn btn-primary bg-purple-600 text-white rounded-xl px-5"
                  >
                    Ir al Radar Viral
                  </button>
                  <button
                    onClick={() => setActiveTab("create")}
                    className="btn btn-outline border-purple-300 text-purple-700 dark:text-purple-300 rounded-xl px-5"
                  >
                    Crear Publicación Manual
                  </button>
                </div>
              </div>
            ) : calendarViewMode === "month" ? (
              <EditorialMonthCalendar
                posts={posts}
                onReschedulePost={handleReschedulePost}
                onPreviewPost={setPreviewPost}
                onEditPost={setEditingPost}
                onDeletePost={handleDeletePost}
                onPublishNow={handlePublishNow}
                onCopyPrompt={handleCopyPrompt}
                publishLoadingId={publishLoadingId}
                onReorganize={handleReorganizeCalendar}
                isReorganizing={isReorganizing}
                onRefresh={refreshPosts}
                resolveImageUrl={resolveImageUrl}
              />
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

                        {/* Preview de imagen si existe */}
                        {post.media_url && (
                          <div className="relative rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800 h-36 bg-gray-100 dark:bg-gray-800">
                            <img
                              src={resolveImageUrl(post.media_url)}
                              alt="Creativo del post"
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-xs text-white text-[10px] px-2 py-0.5 rounded font-medium flex items-center gap-1">
                              <RiImageLine className="w-3 h-3" /> Imagen adjunta (4:3)
                            </div>
                          </div>
                        )}

                        {/* Preview del contenido */}
                        <div className="text-xs text-gray-700 dark:text-gray-300 line-clamp-4 whitespace-pre-line leading-relaxed font-normal bg-gray-50 dark:bg-gray-800/40 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                          {post.content}
                        </div>

                        {/* Acciones de Prompt de imagen si existe */}
                        {post.image_prompt && (
                          <div className="flex items-center justify-between bg-purple-50/50 dark:bg-purple-950/20 px-2.5 py-1.5 rounded-lg border border-purple-100 dark:border-purple-900/30">
                            <span className="text-[11px] text-purple-700 dark:text-purple-300 truncate font-mono">
                              Prompt IA disponible
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyPrompt(post.image_prompt)}
                              className="btn btn-xs btn-ghost text-purple-600 hover:text-purple-800 gap-1 text-[11px] font-semibold h-6 min-h-0 px-2"
                              title="Copiar prompt de imagen"
                            >
                              <RiFileCopyLine className="w-3 h-3" />
                              Copiar prompt
                            </button>
                          </div>
                        )}

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
          <div className="max-w-3xl bg-white dark:bg-gray-900 p-6 sm:p-7 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-5">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                Crear Nueva Publicación
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Redacta directamente tu post, genera el prompt visual con IA (proporción 4:3) y adjunta una imagen para programarlo en LinkedIn.
              </p>
            </div>

            <div className="space-y-4">
              {/* Contenido del post */}
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Contenido del Post:
                </label>
                <textarea
                  value={manualContent}
                  onChange={(e) => setManualContent(e.target.value)}
                  rows={8}
                  placeholder="Escribe tu publicación para LinkedIn aquí..."
                  className="w-full mt-1.5 p-3.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:text-white leading-relaxed"
                />
              </div>

              {/* Barra de herramientas creativas: Generar Prompt IA + Subir Imagen */}
              <div className="p-4 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/30 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-bold text-purple-950 dark:text-purple-200 flex items-center gap-1.5">
                    <RiSparklingLine className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    Creativo Visual (Formato 4:3 predeterminado):
                  </span>

                  <div className="flex items-center gap-2">
                    {/* Botón Generar Prompt de la Imagen */}
                    <button
                      type="button"
                      onClick={handleGenerateManualPrompt}
                      disabled={isGeneratingManualPrompt || !manualContent.trim()}
                      className="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white border-none rounded-xl flex items-center gap-1.5 text-xs font-semibold shadow-sm disabled:opacity-50"
                      title="La IA analiza tu post y redacta el prompt óptimo en inglés con formato 4:3 para Midjourney o Flux"
                    >
                      {isGeneratingManualPrompt ? (
                        <>
                          <span className="loading loading-spinner loading-xs" />
                          <span>Diseñando prompt...</span>
                        </>
                      ) : (
                        <>
                          <RiSparklingLine className="w-4 h-4" />
                          <span>Generar Prompt de la Imagen</span>
                        </>
                      )}
                    </button>

                    {/* Botón Subir Imagen */}
                    <label className="btn btn-sm btn-outline border-purple-300 dark:border-purple-700 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-xl flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                      <RiUploadCloud2Line className="w-4 h-4" />
                      <span>{isUploadingImage ? "Subiendo..." : "Subir Imagen"}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        disabled={isUploadingImage}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleImageFileChange(f, "manual");
                        }}
                      />
                    </label>
                  </div>
                </div>

                {/* Caja de Prompt Fotográfico Generado */}
                {manualImagePrompt && (
                  <div className="bg-white dark:bg-gray-900 p-3.5 rounded-xl border border-purple-200 dark:border-purple-800 text-[11px] text-gray-700 dark:text-gray-300 font-mono leading-relaxed space-y-2 mt-2">
                    <div className="flex items-center justify-between font-sans">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-purple-700 dark:text-purple-300">
                          Prompt Fotográfico para Midjourney / Flux:
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                          Formato 4:3
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyPrompt(manualImagePrompt)}
                        className="btn btn-xs bg-purple-100 hover:bg-purple-200 text-purple-700 dark:bg-purple-900/60 dark:hover:bg-purple-800 dark:text-purple-200 border-none rounded-lg flex items-center gap-1 font-sans font-semibold"
                      >
                        <RiFileCopyLine className="w-3 h-3" />
                        <span>Copiar Prompt</span>
                      </button>
                    </div>
                    <div className="break-words select-all text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 p-2.5 rounded-lg border border-gray-100 dark:border-gray-800">
                      {manualImagePrompt}
                    </div>
                  </div>
                )}

                {/* Previsualización de la Imagen Cargada */}
                {manualMediaUrl && (
                  <div className="relative rounded-xl overflow-hidden border border-purple-200 dark:border-purple-800 h-44 bg-gray-900 group mt-2">
                    <img
                      src={resolveImageUrl(manualMediaUrl)}
                      alt="Imagen adjunta al post manual"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-2 right-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setManualMediaUrl(null)}
                        className="btn btn-xs btn-circle bg-red-600 hover:bg-red-700 text-white border-none shadow-md"
                        title="Eliminar imagen"
                      >
                        <RiCloseLine className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm text-[10px] font-semibold text-white px-2.5 py-0.5 rounded-md">
                      ✓ Imagen adjunta lista para publicar en LinkedIn
                    </div>
                  </div>
                )}
              </div>

              {/* Fecha y Hora de Publicación */}
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Fecha y Hora de Publicación:
                </label>
                <input
                  type="datetime-local"
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  className="w-full mt-1 p-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-sm dark:text-white"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleScheduleManual}
                  disabled={!manualContent.trim()}
                  className="btn btn-primary bg-purple-600 hover:bg-purple-700 text-white rounded-xl px-6 flex items-center gap-2 shadow-sm font-semibold disabled:opacity-50"
                >
                  <RiCalendarEventLine className="w-4 h-4" />
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
                    rows={8}
                    className="w-full mt-1 p-3.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:text-white"
                  />
                </div>

                {/* SECCIÓN CREATIVO VISUAL: BOTONES COPIAR PROMPT Y SUBIR IMAGEN */}
                <div className="bg-gradient-to-r from-purple-50/70 to-indigo-50/70 dark:from-purple-950/30 dark:to-indigo-950/30 p-4 rounded-2xl border border-purple-200/80 dark:border-purple-800/60 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h5 className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                        <RiSparklingLine className="w-4 h-4 text-purple-600" />
                        Creativo Visual para LinkedIn
                      </h5>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        Copia el prompt fotográfico generado por IA o sube directamente tu imagen.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Botón 1: Copiar Prompt de Imagen */}
                      <button
                        type="button"
                        onClick={() => handleCopyPrompt(modeledDraft.image_prompt)}
                        className="btn btn-xs bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700 rounded-lg gap-1.5 font-bold shadow-xs py-1 px-2.5 h-auto min-h-0"
                      >
                        <RiFileCopyLine className="w-3.5 h-3.5" />
                        Copiar prompt de imagen
                      </button>

                      {/* Botón 2: Subir Imagen */}
                      <label className="btn btn-xs bg-purple-600 hover:bg-purple-700 text-white border-none rounded-lg gap-1.5 font-bold cursor-pointer shadow-xs py-1 px-2.5 h-auto min-h-0">
                        {isUploadingImage ? (
                          <span className="loading loading-spinner loading-xs" />
                        ) : (
                          <RiUploadCloud2Line className="w-3.5 h-3.5" />
                        )}
                        Subir imagen
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          disabled={isUploadingImage}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleImageFileChange(f, "draft");
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Vista del Prompt de Imagen */}
                  {modeledDraft.image_prompt && (
                    <div className="bg-white/80 dark:bg-gray-900/80 p-3 rounded-xl border border-purple-100 dark:border-purple-900/40 text-[11px] text-gray-700 dark:text-gray-300 font-mono leading-relaxed space-y-1">
                      <div className="flex items-center justify-between font-sans">
                        <span className="font-bold text-purple-600 dark:text-purple-400 not-italic">
                          Prompt Fotográfico para Midjourney / Flux:
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                          Formato 4:3
                        </span>
                      </div>
                      <div className="break-words">{modeledDraft.image_prompt}</div>
                    </div>
                  )}

                  {/* Preview de la imagen subida */}
                  {modeledDraft.media_url && (
                    <div className="relative rounded-xl overflow-hidden border border-purple-200 dark:border-purple-800 h-44 bg-gray-900 group">
                      <img
                        src={resolveImageUrl(modeledDraft.media_url)}
                        alt="Imagen cargada"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-2 right-2 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setModeledDraft({ ...modeledDraft, media_url: null })}
                          className="btn btn-xs btn-circle bg-red-600 hover:bg-red-700 text-white border-none shadow-md"
                          title="Quitar imagen"
                        >
                          <RiCloseLine className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-xs text-white text-[11px] px-2.5 py-1 rounded-md font-medium flex items-center gap-1.5">
                        <RiImageLine className="w-3.5 h-3.5 text-purple-400" /> Imagen adjunta lista para publicar
                      </div>
                    </div>
                  )}
                </div>
                {/* Fecha y Hora de Publicación (Slot asignado Lun, Mié o Vie) */}
                <div className="bg-purple-50/70 dark:bg-purple-950/30 p-3.5 rounded-2xl border border-purple-200/80 dark:border-purple-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-purple-950 dark:text-purple-200 flex items-center gap-1.5">
                      <RiCalendarEventLine className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      Fecha de Publicación (Slot asignado: Lun, Mié, Vie):
                    </span>
                    <p className="text-[11px] text-purple-700 dark:text-purple-300">
                      Calculado automáticamente sin repetir días para garantizar máxima distribución.
                    </p>
                  </div>
                  <input
                    type="datetime-local"
                    value={modeledDraft.scheduled_at ? modeledDraft.scheduled_at.slice(0, 16) : ""}
                    onChange={(e) =>
                      setModeledDraft({
                        ...modeledDraft,
                        scheduled_at: new Date(e.target.value).toISOString(),
                      })
                    }
                    className="p-2 rounded-xl border border-purple-300 dark:border-purple-700 bg-white dark:bg-gray-800 text-xs font-semibold text-gray-800 dark:text-gray-100"
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
                  onClick={() => handleScheduleSingle(modeledDraft.content, modeledDraft.scheduled_at)}
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
            <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-xl w-full border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
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
              <div className="p-5 space-y-4 overflow-y-auto">
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

                {/* Imagen del post en el Feed de LinkedIn si existe */}
                {previewPost.media_url && (
                  <div className="rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800 max-h-80 bg-gray-100 dark:bg-gray-800">
                    <img
                      src={resolveImageUrl(previewPost.media_url)}
                      alt="Creativo de LinkedIn"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

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
            <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-xl w-full border border-gray-200 dark:border-gray-800 shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
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
                  rows={7}
                  className="w-full mt-1 p-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm dark:text-white"
                />
              </div>

              {/* Botones Creativo Visual en Edición */}
              <div className="bg-purple-50/50 dark:bg-purple-950/20 p-3.5 rounded-xl border border-purple-100 dark:border-purple-900/40 space-y-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                    <RiImageLine className="w-4 h-4 text-purple-600" />
                    Imagen del Post
                  </span>
                  <div className="flex items-center gap-2">
                    {editingPost.image_prompt && (
                      <button
                        type="button"
                        onClick={() => handleCopyPrompt(editingPost.image_prompt)}
                        className="btn btn-xs bg-white dark:bg-gray-800 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg gap-1 font-semibold"
                      >
                        <RiFileCopyLine className="w-3.5 h-3.5" />
                        Copiar prompt
                      </button>
                    )}
                    <label className="btn btn-xs bg-purple-600 hover:bg-purple-700 text-white border-none rounded-lg gap-1 font-semibold cursor-pointer">
                      {isUploadingImage ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        <RiUploadCloud2Line className="w-3.5 h-3.5" />
                      )}
                      Subir imagen
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        disabled={isUploadingImage}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleImageFileChange(f, "edit");
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>

                {editingPost.image_prompt && (
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono bg-white/70 dark:bg-gray-900/60 p-2.5 rounded-lg border border-purple-100 dark:border-purple-900/30 space-y-1">
                    <div className="flex items-center justify-between font-sans">
                      <strong className="text-purple-600 dark:text-purple-400">Prompt Fotográfico:</strong>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                        Formato 4:3
                      </span>
                    </div>
                    <div className="break-words">{editingPost.image_prompt}</div>
                  </div>
                )}

                {editingPost.media_url && (
                  <div className="relative rounded-lg overflow-hidden border border-purple-200 dark:border-purple-800 h-32 bg-gray-900">
                    <img
                      src={resolveImageUrl(editingPost.media_url)}
                      alt="Imagen adjunta"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setEditingPost({ ...editingPost, media_url: null, media_type: "none" })}
                      className="absolute top-2 right-2 btn btn-xs btn-circle bg-red-600 text-white border-none"
                      title="Eliminar imagen"
                    >
                      <RiCloseLine className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <RiTimeLine className="w-3.5 h-3.5 text-purple-600" />
                    Hora Programada:
                  </label>
                  <span className="text-[11px] text-gray-400 capitalize">
                    {new Date(editingPost.scheduled_at).toLocaleDateString("es-ES", {
                      weekday: "long",
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
                <input
                  type="time"
                  value={(() => {
                    const d = new Date(editingPost.scheduled_at);
                    if (isNaN(d.getTime())) return "10:00";
                    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
                  })()}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    const [h, m] = val.split(":").map(Number);
                    const d = new Date(editingPost.scheduled_at);
                    if (!isNaN(h) && !isNaN(m)) {
                      d.setHours(h, m, 0, 0);
                      setEditingPost({
                        ...editingPost,
                        scheduled_at: d.toISOString(),
                      });
                    }
                  }}
                  className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm font-semibold dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
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
