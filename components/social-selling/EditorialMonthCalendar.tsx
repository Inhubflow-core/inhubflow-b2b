import React, { useState, useMemo } from "react";
import {
  RiTimeLine,
  RiEyeLine,
  RiEditLine,
  RiDeleteBinLine,
  RiSendPlaneLine,
  RiFileCopyLine,
  RiSparklingLine,
  RiRefreshLine,
  RiSearchLine,
  RiImageLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiDragMove2Line,
  RiCheckLine,
} from "react-icons/ri";

export interface SocialPost {
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

interface EditorialMonthCalendarProps {
  posts: SocialPost[];
  onReschedulePost: (postId: string, newDate: Date) => Promise<void>;
  onPreviewPost: (post: SocialPost) => void;
  onEditPost: (post: SocialPost) => void;
  onDeletePost: (postId: string) => void;
  onPublishNow: (postId: string) => void;
  onCopyPrompt: (promptText?: string | null) => void;
  publishLoadingId: string | null;
  onReorganize: () => void;
  isReorganizing: boolean;
  onRefresh: () => void;
  resolveImageUrl: (url?: string | null) => string;
}

const WEEKDAYS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const EditorialMonthCalendar: React.FC<EditorialMonthCalendarProps> = ({
  posts,
  onReschedulePost,
  onPreviewPost,
  onEditPost,
  onDeletePost,
  onPublishNow,
  onCopyPrompt,
  publishLoadingId,
  onReorganize,
  isReorganizing,
  onRefresh,
  resolveImageUrl,
}) => {
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dragOverDayKey, setDragOverDayKey] = useState<string | null>(null);
  const [draggedPostId, setDraggedPostId] = useState<string | null>(null);
  const [confirmPublishPost, setConfirmPublishPost] = useState<SocialPost | null>(null);
  const [confirmDeletePost, setConfirmDeletePost] = useState<SocialPost | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Filtrado de publicaciones
  const filteredPosts = useMemo(() => {
    return posts.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const haystack = `${p.content} ${p.topic || ""} ${p.original_author || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [posts, statusFilter, searchQuery]);

  // Agrupar publicaciones por fecha local (YYYY-MM-DD)
  const postsByDay = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    for (const post of filteredPosts) {
      if (!post.scheduled_at) continue;
      const d = new Date(post.scheduled_at);
      if (isNaN(d.getTime())) continue;
      const key = toLocalDateKey(d);
      const existing = map.get(key) || [];
      existing.push(post);
      map.set(key, existing);
    }
    // Ordenar posts de cada día cronológicamente
    map.forEach((dayPosts) => {
      dayPosts.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    });
    return map;
  }, [filteredPosts]);

  // Días de la cuadrícula de 7 columnas
  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Domingo = 0 ... Sábado = 6 -> Lunes como índice 0
    let startDayOfWeek = firstDayOfMonth.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const days: Array<{
      date: Date;
      key: string;
      isCurrentMonth: boolean;
      isToday: boolean;
      posts: SocialPost[];
    }> = [];

    const todayKey = toLocalDateKey(new Date());

    const pushDay = (date: Date, isCurrentMonth: boolean) => {
      const key = toLocalDateKey(date);
      days.push({
        date,
        key,
        isCurrentMonth,
        isToday: key === todayKey,
        posts: postsByDay.get(key) || [],
      });
    };

    // Días de relleno del mes anterior
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      pushDay(new Date(year, month - 1, prevMonthLastDay - i), false);
    }

    // Días del mes actual
    for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
      pushDay(new Date(year, month, i), true);
    }

    // Días de relleno del mes siguiente (múltiplo de 7, máx 42 días)
    const totalCurrent = days.length;
    const targetLength = totalCurrent > 35 ? 42 : 35;
    const remaining = targetLength - totalCurrent;
    for (let i = 1; i <= remaining; i++) {
      pushDay(new Date(year, month + 1, i), false);
    }

    return days;
  }, [year, month, postsByDay]);

  // Navegación
  const handlePrevMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Drag and Drop
  const handleDragStart = (e: React.DragEvent, postId: string) => {
    e.dataTransfer.setData("text/plain", postId);
    e.dataTransfer.effectAllowed = "move";
    setDraggedPostId(postId);
  };

  const handleDragEnd = () => {
    setDraggedPostId(null);
    setDragOverDayKey(null);
  };

  const handleDragOver = (e: React.DragEvent, dayKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverDayKey !== dayKey) {
      setDragOverDayKey(dayKey);
    }
  };

  const handleDragLeave = (e: React.DragEvent, dayKey: string) => {
    // Solo si realmente sale del contenedor de la celda
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dragOverDayKey === dayKey) {
      setDragOverDayKey(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetDate: Date) => {
    e.preventDefault();
    setDragOverDayKey(null);
    const postId = e.dataTransfer.getData("text/plain") || draggedPostId;
    if (!postId) return;

    await onReschedulePost(postId, targetDate);
    setDraggedPostId(null);
  };

  // Nombre del mes en formato capitalizado en español
  const monthName = currentDate.toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
  const formattedMonthTitle = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  // Estadísticas rápidas para los filtros
  const counts = useMemo(() => {
    return {
      all: posts.length,
      scheduled: posts.filter((p) => p.status === "scheduled").length,
      published: posts.filter((p) => p.status === "published").length,
      failed: posts.filter((p) => p.status === "failed").length,
    };
  }, [posts]);

  return (
    <div className="space-y-4">
      {/* Barra Superior de Controles y Filtros (idéntica a la del calendario de reuniones) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs">
        {/* Controles de Navegación de Mes */}
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-lg text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700 transition-colors"
              title="Mes anterior"
            >
              <RiArrowLeftSLine size={18} />
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="px-3 py-1 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-lg text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700 transition-colors"
              title="Mes siguiente"
            >
              <RiArrowRightSLine size={18} />
            </button>
          </div>

          <h2 className="text-base md:text-lg font-bold text-gray-900 dark:text-white">
            {formattedMonthTitle}
          </h2>

          <button
            type="button"
            onClick={onRefresh}
            className="p-1.5 rounded-lg text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Actualizar publicaciones"
          >
            <RiRefreshLine size={17} />
          </button>
        </div>

        {/* Buscador, Filtros de Estado y Reorganizar */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Buscador */}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
              <RiSearchLine size={14} />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por texto o tema..."
              className="w-48 sm:w-56 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-500 shadow-2xs"
            />
          </div>

          {/* Filtros de estado (Pills) */}
          <div className="flex items-center rounded-xl border border-gray-300 dark:border-gray-700 p-0.5 bg-gray-100 dark:bg-gray-800 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                statusFilter === "all"
                  ? "bg-purple-600 text-white shadow-2xs"
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Todas ({counts.all})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("scheduled")}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                statusFilter === "scheduled"
                  ? "bg-blue-600 text-white shadow-2xs"
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Programadas ({counts.scheduled})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("published")}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                statusFilter === "published"
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Publicadas ({counts.published})
            </button>
            {counts.failed > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter("failed")}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                  statusFilter === "failed"
                    ? "bg-red-600 text-white shadow-2xs"
                    : "text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                }`}
              >
                Fallidas ({counts.failed})
              </button>
            )}
          </div>

          {/* Reorganizar automáticamente */}
          <button
            type="button"
            onClick={onReorganize}
            disabled={isReorganizing || counts.scheduled === 0}
            className="btn btn-sm bg-purple-50 hover:bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:hover:bg-purple-900/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800 gap-1.5 text-xs font-semibold rounded-xl shadow-2xs"
            title="Distribuir automáticamente las publicaciones pendientes en Lunes, Miércoles y Viernes"
          >
            {isReorganizing ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <RiSparklingLine className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            )}
            <span className="hidden sm:inline">Reorganizar (Lun, Mié, Vie)</span>
          </button>
        </div>
      </div>

      {/* Grid Calendario de Mes */}
      <div className="w-full rounded-2xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
        {/* Cabecera de los 7 días de la semana */}
        <div className="grid grid-cols-7 border-b border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 divide-x divide-gray-300 dark:divide-gray-700">
          {WEEKDAYS.map((day, idx) => (
            <div
              key={day}
              className={`py-3 text-center text-xs font-bold uppercase tracking-wider ${
                idx >= 5
                  ? "text-gray-400 dark:text-gray-500 bg-gray-100/50 dark:bg-gray-900/40"
                  : "text-gray-700 dark:text-gray-200"
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Celdas de días */}
        <div className="grid grid-cols-7 gap-px bg-gray-300 dark:bg-gray-700">
          {calendarDays.map((cell) => {
            const isDragTarget = dragOverDayKey === cell.key;

            return (
              <div
                key={cell.key}
                onDragOver={(e) => handleDragOver(e, cell.key)}
                onDragLeave={(e) => handleDragLeave(e, cell.key)}
                onDrop={(e) => handleDrop(e, cell.date)}
                className={`min-h-[170px] md:min-h-[195px] p-2 flex flex-col justify-between transition-all ${
                  isDragTarget
                    ? "bg-purple-100/80 dark:bg-purple-950/70 ring-2 ring-purple-500 ring-inset shadow-inner"
                    : cell.isCurrentMonth
                    ? "bg-white dark:bg-gray-900 hover:bg-gray-50/70 dark:hover:bg-gray-850/50"
                    : "bg-gray-50/70 dark:bg-gray-950/60 text-gray-400 dark:text-gray-600"
                }`}
              >
                {/* Cabecera del día */}
                <div className="flex items-center justify-between mb-1.5 select-none">
                  <span
                    className={`inline-flex items-center justify-center text-xs font-semibold rounded-full w-6 h-6 transition-colors ${
                      cell.isToday
                        ? "bg-purple-600 text-white font-bold shadow-xs"
                        : cell.isCurrentMonth
                        ? "text-gray-700 dark:text-gray-300 font-bold"
                        : "text-gray-400 dark:text-gray-600"
                    }`}
                  >
                    {cell.date.getDate()}
                  </span>

                  {cell.posts.length > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                      {cell.posts.length} {cell.posts.length === 1 ? "post" : "posts"}
                    </span>
                  )}
                </div>

                {/* Lista de cards dentro de la casilla */}
                <div className="flex-1 space-y-2 overflow-y-auto max-h-[220px] pr-0.5 scrollbar-thin">
                  {cell.posts.map((post) => {
                    const postDate = new Date(post.scheduled_at);
                    const formattedTime = !isNaN(postDate.getTime())
                      ? postDate.toLocaleTimeString("es-ES", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "10:00";

                    const isBeingDragged = draggedPostId === post.id;
                    const isDraggable = post.status === "scheduled" || post.status === "draft";

                    return (
                      <div
                        key={post.id}
                        draggable={isDraggable}
                        onDragStart={(e) => isDraggable && handleDragStart(e, post.id)}
                        onDragEnd={handleDragEnd}
                        className={`group relative rounded-xl border p-2 text-left bg-white dark:bg-gray-850 shadow-2xs hover:shadow-md transition-all border-gray-200 dark:border-gray-700 ${
                          isDraggable
                            ? "cursor-grab active:cursor-grabbing hover:border-purple-400 dark:hover:border-purple-500"
                            : "cursor-default"
                        } ${
                          isBeingDragged ? "opacity-40 scale-95 border-dashed border-purple-500" : ""
                        }`}
                      >
                        {/* Cabecera de la tarjeta: Hora + Badge de Estado + Indicador Drag */}
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <span className="flex items-center gap-1 text-[11px] font-bold text-purple-600 dark:text-purple-400">
                            <RiTimeLine className="w-3 h-3 shrink-0" />
                            {formattedTime}
                          </span>

                          <div className="flex items-center gap-1">
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded-md font-semibold tracking-wide uppercase ${
                                post.status === "published"
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300"
                                  : post.status === "scheduled"
                                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300"
                                  : post.status === "publishing"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
                                  : "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300"
                              }`}
                            >
                              {post.status === "published"
                                ? "Publicado"
                                : post.status === "scheduled"
                                ? "Programado"
                                : post.status === "publishing"
                                ? "Enviando..."
                                : "Error"}
                            </span>

                            {isDraggable && (
                              <RiDragMove2Line
                                className="w-3 h-3 text-gray-400 opacity-40 group-hover:opacity-100 transition-opacity"
                                title="Arrastrar para mover de día"
                              />
                            )}
                          </div>
                        </div>

                        {/* Miniatura de imagen si existe */}
                        {post.media_url && (
                          <div className="relative rounded-lg overflow-hidden border border-gray-100 dark:border-gray-700 h-16 w-full mb-1.5 bg-gray-100 dark:bg-gray-800">
                            <img
                              src={resolveImageUrl(post.media_url)}
                              alt="Creativo"
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                            <div className="absolute bottom-1 right-1 bg-black/60 backdrop-blur-2xs text-white text-[9px] px-1.5 py-0.2 rounded flex items-center gap-0.5">
                              <RiImageLine className="w-2.5 h-2.5" />
                              4:3
                            </div>
                          </div>
                        )}

                        {/* Texto del post recortado */}
                        <p className="text-[11px] text-gray-700 dark:text-gray-300 line-clamp-2 leading-relaxed whitespace-pre-line mb-1.5">
                          {post.content}
                        </p>

                        {/* Mensaje de error si la publicación falló */}
                        {post.status === "failed" && post.error_message && (
                          <div
                            className="text-[10px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-1.5 py-0.5 rounded border border-red-200 dark:border-red-900/40 truncate mb-1"
                            title={post.error_message}
                          >
                            ⚠️ {post.error_message}
                          </div>
                        )}

                        {/* 4 Botones de Acción Distribuidos (Ver, Publicar, Editar, Eliminar) */}
                        <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-gray-100 dark:border-gray-800 mt-2">
                          {/* 1. Ver (Vista previa) */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPreviewPost(post);
                            }}
                            className="h-7 w-full flex items-center justify-center rounded-lg bg-gray-100 hover:bg-purple-100 text-gray-700 hover:text-purple-700 dark:bg-gray-800 dark:hover:bg-purple-950/60 dark:text-gray-300 dark:hover:text-purple-300 border border-gray-200 dark:border-gray-700 shadow-2xs transition-all cursor-pointer"
                            title="Ver vista previa"
                          >
                            <RiEyeLine className="w-4 h-4" />
                          </button>

                          {/* 2. Editar */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditPost(post);
                            }}
                            title="Editar publicación"
                            className="h-7 w-full flex items-center justify-center rounded-lg bg-gray-100 hover:bg-blue-100 text-gray-700 hover:text-blue-700 dark:bg-gray-800 dark:hover:bg-blue-950/60 dark:text-gray-300 dark:hover:text-blue-300 border border-gray-200 dark:border-gray-700 shadow-2xs transition-all cursor-pointer"
                          >
                            <RiEditLine className="w-4 h-4" />
                          </button>

                          {/* 3. Publicar ahora / Reintentar (Verde) */}
                          {post.status === "scheduled" || post.status === "failed" ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmPublishPost(post);
                              }}
                              disabled={publishLoadingId === post.id}
                              title={post.status === "failed" ? "Reintentar publicación en LinkedIn" : "Publicar en LinkedIn ahora mismo"}
                              className="h-7 w-full flex items-center justify-center rounded-lg text-white shadow-xs transition-all cursor-pointer hover:opacity-90 active:scale-95 disabled:opacity-50"
                              style={{ backgroundColor: "#059669", color: "#ffffff", border: "1px solid #059669" }}
                            >
                              {publishLoadingId === post.id ? (
                                <span className="loading loading-spinner loading-xs text-white" />
                              ) : (
                                <RiSendPlaneLine className="w-4 h-4 text-white" />
                              )}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled
                              title={post.status === "published" ? "Publicación ya enviada" : "Estado: " + post.status}
                              className="h-7 w-full flex items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 cursor-not-allowed opacity-80"
                            >
                              <RiCheckLine className="w-4 h-4" />
                            </button>
                          )}

                          {/* 4. Eliminar (Rojo) */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeletePost(post);
                            }}
                            title="Eliminar publicación"
                            className="h-7 w-full flex items-center justify-center rounded-lg text-white shadow-xs transition-all cursor-pointer hover:opacity-90 active:scale-95"
                            style={{ backgroundColor: "#dc2626", color: "#ffffff", border: "1px solid #dc2626" }}
                          >
                            <RiDeleteBinLine className="w-4 h-4 text-white" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Estado vacío sutil para el día si no tiene posts */}
                  {cell.posts.length === 0 && (
                    <div
                      className={`h-full min-h-[60px] flex items-center justify-center border-2 border-dashed rounded-xl transition-all ${
                        isDragTarget
                          ? "border-purple-400 bg-purple-50/50 dark:bg-purple-950/40"
                          : "border-transparent text-gray-300 dark:text-gray-700 text-[10px]"
                      }`}
                    >
                      {isDragTarget ? (
                        <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 animate-pulse">
                          Soltar para reprogramar aquí
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MODAL DE CONFIRMACIÓN: ¿QUIERES PUBLICAR AHORA MISMO? */}
      {confirmPublishPost && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-sm w-full border border-gray-200 dark:border-gray-800 shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <RiSendPlaneLine className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  ¿Quieres publicar ahora mismo?
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Esta publicación se enviará de inmediato a tu cuenta de LinkedIn conectada.
                </p>
              </div>
            </div>

            {/* Extracto del post */}
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-300 line-clamp-3 leading-relaxed">
              {confirmPublishPost.content}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setConfirmPublishPost(null)}
                className="btn btn-sm btn-ghost text-xs text-gray-600 dark:text-gray-300 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = confirmPublishPost.id;
                  setConfirmPublishPost(null);
                  onPublishNow(id);
                }}
                disabled={publishLoadingId === confirmPublishPost.id}
                className="btn btn-sm btn-success text-white rounded-xl text-xs font-semibold px-4 flex items-center gap-1.5 shadow-xs border-none hover:opacity-90 active:scale-95"
                style={{ backgroundColor: "#059669", color: "#ffffff", borderColor: "#059669" }}
              >
                <RiSendPlaneLine className="w-3.5 h-3.5 text-white" />
                Sí, publicar ahora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN: ¿QUIERES ELIMINAR ESTA PUBLICACIÓN? */}
      {confirmDeletePost && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-sm w-full border border-gray-200 dark:border-gray-800 shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400 flex items-center justify-center shrink-0">
                <RiDeleteBinLine className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  ¿Quieres eliminar esta publicación?
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Esta acción no se puede deshacer y se removerá de tu calendario.
                </p>
              </div>
            </div>

            {/* Extracto del post */}
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-300 line-clamp-3 leading-relaxed">
              {confirmDeletePost.content}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setConfirmDeletePost(null)}
                className="btn btn-sm btn-ghost text-xs text-gray-600 dark:text-gray-300 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = confirmDeletePost.id;
                  setConfirmDeletePost(null);
                  onDeletePost(id);
                }}
                className="btn btn-sm btn-error text-white rounded-xl text-xs font-semibold px-4 flex items-center gap-1.5 shadow-xs border-none hover:opacity-90 active:scale-95"
                style={{ backgroundColor: "#dc2626", color: "#ffffff", borderColor: "#dc2626" }}
              >
                <RiDeleteBinLine className="w-3.5 h-3.5 text-white" />
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
