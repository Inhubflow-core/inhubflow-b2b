import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  RiCloseLine,
  RiExternalLinkLine,
  RiMailLine,
  RiPhoneLine,
  RiMapPinLine,
  RiLinkedinBoxFill,
  RiRobotLine,
  RiChat3Line,
  RiSaveLine,
  RiCheckLine,
  RiCalendarEventLine,
  RiVideoLine,
  RiAddLine,
  RiTimeLine,
} from "react-icons/ri";
import { toast } from "sonner";
import type { PipelineCard, PipelineStageWithCount } from "@/lib/pipeline/pipeline-service";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { ScheduleModal } from "@/components/calendar/ScheduleModal";
import { useWorkspaceTimezone } from "@/lib/calendar/use-workspace-timezone";
import type { CalendarEventWithTarget } from "@/lib/calendar/calendar-service";
import { TagPicker, type AppliedTag, type TagOption } from "@/components/pipeline/TagPicker";

interface LeadDrawerProps {
  card: PipelineCard | null;
  stages: PipelineStageWithCount[];
  isOpen: boolean;
  onClose: () => void;
  onStageChange: (cardId: string, newStageId: string) => Promise<void>;
  onCardUpdated?: (updated: Partial<PipelineCard>) => void;
}

export const LeadDrawer: React.FC<LeadDrawerProps> = ({
  card,
  stages,
  isOpen,
  onClose,
  onStageChange,
  onCardUpdated,
}) => {
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [changingStage, setChangingStage] = useState(false);
  const [autopilot, setAutopilot] = useState(false);
  const [togglingAutopilot, setTogglingAutopilot] = useState(false);

  // Calendar meetings for this prospect
  const [meetings, setMeetings] = useState<CalendarEventWithTarget[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const timezone = useWorkspaceTimezone();

  // Tag system: AI-applied and manual labels
  const { t } = useTranslation();
  const [availableTags, setAvailableTags] = useState<TagOption[]>([]);
  const [appliedTags, setAppliedTags] = useState<AppliedTag[]>([]);
  const [tagBusy, setTagBusy] = useState(false);

  useEffect(() => {
    if (card) {
      setAutopilot(Boolean(card.sdr_autopilot));
      // Fetch full target notes
      fetch(`/api/targets/${card.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && typeof data.notes === "string") {
            setNotes(data.notes);
          } else {
            setNotes("");
          }
        })
        .catch(() => setNotes(""));

      // Fetch the tag catalogue and this lead's tags
      fetch("/api/tags")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setAvailableTags(data?.tags || []))
        .catch(() => setAvailableTags([]));

      fetch(`/api/targets/${card.id}/tags`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setAppliedTags((data?.tags || []) as AppliedTag[]);
        })
        .catch(() => setAppliedTags([]));

      // Fetch calendar meetings
      setLoadingMeetings(true);
      fetch(`/api/calendar/events?target_id=${encodeURIComponent(card.id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setMeetings(data?.events || []);
        })
        .catch(() => setMeetings([]))
        .finally(() => setLoadingMeetings(false));
    } else {
      setMeetings([]);
      setAppliedTags([]);
    }
  }, [card]);

  async function handleAddTag(slug: string) {
    if (!card || tagBusy) return;
    setTagBusy(true);
    try {
      const res = await fetch(`/api/targets/${card.id}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) throw new Error(t("pipeline.tagError"));
      const tag = availableTags.find((t) => t.slug === slug);
      setAppliedTags((prev) =>
        prev.some((t) => t.slug === slug)
          ? prev
          : [...prev, { slug, name: tag?.name ?? slug, color: tag?.color ?? "#3b82f6", source: "manual" }]
      );
      onCardUpdated?.({ tags: [...appliedTags, { slug, name: tag?.name ?? slug, color: tag?.color ?? "#3b82f6", source: "manual" }] });
      toast.success(t("pipeline.tagApplied"));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("pipeline.tagError"));
    } finally {
      setTagBusy(false);
    }
  }

  async function handleRemoveTag(slug: string) {
    if (!card || tagBusy) return;
    setTagBusy(true);
    try {
      const res = await fetch(`/api/targets/${card.id}/tags`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) throw new Error(t("pipeline.tagError"));
      const next = appliedTags.filter((t) => t.slug !== slug);
      setAppliedTags(next);
      onCardUpdated?.({ tags: next });
      toast.success(t("pipeline.tagRemoved"));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("pipeline.tagError"));
    } finally {
      setTagBusy(false);
    }
  }

  if (!isOpen || !card) return null;

  async function handleSelectStage(stageId: string) {
    if (!card || changingStage || stageId === card.stage_id) return;
    setChangingStage(true);
    try {
      await onStageChange(card.id, stageId);
      toast.success(t("pipeline.stageUpdated"));
    } catch {
      toast.error("Error al mover de etapa");
    } finally {
      setChangingStage(false);
    }
  }

  async function handleSaveNotes() {
    if (!card || savingNotes) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/targets/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error("Error al guardar notas");
      toast.success("Notas guardadas");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleToggleAutopilot() {
    if (!card || togglingAutopilot) return;
    setTogglingAutopilot(true);
    try {
      const next = !autopilot;
      const res = await fetch("/api/inbox/toggle-autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_id: card.id, enabled: next }),
      });
      if (!res.ok) throw new Error("Error al cambiar modo SDR");
      setAutopilot(next);
      onCardUpdated?.({ sdr_autopilot: next ? 1 : 0 });
      toast.success(next ? "SDR en piloto automático" : "SDR en modo manual");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al actualizar");
    } finally {
      setTogglingAutopilot(false);
    }
  }

  const currentStage = stages.find((s) => s.id === card.stage_id);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="relative w-full max-w-md bg-base-100 h-full shadow-2xl border-l border-base-300 flex flex-col z-10 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-5 border-b border-base-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {card.profile_image_url ? (
              <img
                src={card.profile_image_url}
                alt={card.full_name || "Lead"}
                className="w-12 h-12 rounded-full object-cover border border-base-300 shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-primary/20 text-primary font-bold text-sm flex items-center justify-center shrink-0">
                {card.full_name?.slice(0, 2).toUpperCase() || "?"}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="font-bold text-base text-base-content truncate">
                {card.full_name}
              </h3>
              {card.title && (
                <p className="text-xs text-base-content/70 truncate mt-0.5">{card.title}</p>
              )}
              {card.company && (
                <p className="text-xs font-semibold text-primary truncate mt-0.5">{card.company}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-base-content/50 hover:text-base-content hover:bg-base-200 transition-colors"
          >
            <RiCloseLine size={20} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Stage selection */}
          <div className="bg-base-200/50 p-4 rounded-xl border border-base-300/60">
            <label className="block text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-2">
              Etapa del Pipeline
            </label>
            <select
              value={card.stage_id || ""}
              onChange={(e) => handleSelectStage(e.target.value)}
              disabled={changingStage}
              className="select select-bordered select-sm w-full font-medium"
            >
              {stages.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} {st.id === card.stage_id ? " (Actual)" : ""}
                </option>
              ))}
            </select>
            {currentStage && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-base-content/60">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: currentStage.color }}
                />
                <span>{t("pipeline.currentStage")}: <strong>{currentStage.name}</strong></span>
              </div>
            )}
          </div>

          {/* AI / manual labels — these drive the automatic funnel progression */}
          <div className="bg-base-200/50 p-4 rounded-xl border border-base-300/60">
            <label className="block text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-2.5">
              {t("pipeline.tagsTitle")}
            </label>
            <TagPicker
              available={availableTags}
              applied={appliedTags}
              onAdd={handleAddTag}
              onRemove={handleRemoveTag}
              busy={tagBusy}
            />
          </div>

          {/* SDR Autopilot control */}
          <div className="flex items-center justify-between p-4 bg-purple-500/5 border border-purple-500/20 rounded-xl">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0">
                <RiRobotLine size={18} />
              </div>
              <div>
                <p className="text-xs font-semibold text-base-content">SDR Autopilot (IA)</p>
                <p className="text-[11px] text-base-content/60">
                  {autopilot ? "La IA responde automáticamente" : "Requiere intervención manual"}
                </p>
              </div>
            </div>

            <input
              type="checkbox"
              checked={autopilot}
              onChange={handleToggleAutopilot}
              disabled={togglingAutopilot}
              className="toggle toggle-primary toggle-sm"
            />
          </div>

          {/* Contact Details */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
              Datos de Contacto
            </h4>

            <div className="space-y-2 text-xs">
              {card.email && (
                <div className="flex items-center gap-2 text-base-content/80">
                  <RiMailLine size={14} className="text-base-content/40 shrink-0" />
                  <a href={`mailto:${card.email}`} className="hover:text-primary truncate">
                    {card.email}
                  </a>
                </div>
              )}

              {card.phone && (
                <div className="flex items-center gap-2 text-base-content/80">
                  <RiPhoneLine size={14} className="text-base-content/40 shrink-0" />
                  <span>{card.phone}</span>
                </div>
              )}

              {card.location && (
                <div className="flex items-center gap-2 text-base-content/80">
                  <RiMapPinLine size={14} className="text-base-content/40 shrink-0" />
                  <span>{card.location}</span>
                </div>
              )}

              {card.linkedin_url && (
                <div className="flex items-center gap-2 text-base-content/80">
                  <RiLinkedinBoxFill size={14} className="text-[#0a66c2] shrink-0" />
                  <a
                    href={card.linkedin_url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline text-[#0a66c2] flex items-center gap-1 truncate"
                  >
                    Ver en LinkedIn <RiExternalLinkLine size={11} />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Scheduled Meetings */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-base-content/60 flex items-center gap-1.5">
                <RiCalendarEventLine size={14} className="text-primary" />
                Reuniones Comerciales {meetings.length > 0 && `(${meetings.length})`}
              </h4>
              <button
                type="button"
                onClick={() => setShowScheduleModal(true)}
                className="btn btn-xs btn-outline btn-primary gap-1"
              >
                <RiAddLine size={13} />
                Agendar Cita
              </button>
            </div>

            {loadingMeetings ? (
              <div className="py-3 text-center text-xs text-base-content/50">Cargando citas...</div>
            ) : meetings.length === 0 ? (
              <div className="p-3.5 rounded-xl border border-dashed border-base-300 text-center bg-base-200/30">
                <p className="text-xs text-base-content/60">No hay reuniones agendadas con este prospecto.</p>
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(true)}
                  className="mt-1.5 text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                >
                  <RiAddLine size={13} /> Programar cita ahora
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {meetings.map((m) => {
                  const mDate = new Date(m.start_time).toLocaleDateString("es-ES", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const statusInfo =
                    m.status === "confirmed"
                      ? { label: "Confirmada", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" }
                      : m.status === "completed"
                      ? { label: "Realizada", cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20" }
                      : m.status === "cancelled"
                      ? { label: "Cancelada", cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20" }
                      : { label: "No Asistió", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20" };

                  return (
                    <div
                      key={m.id}
                      className="p-3 rounded-xl border border-base-300 bg-base-200/40 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-base-content truncate">{m.title}</p>
                          <p className="text-[11px] text-base-content/70 flex items-center gap-1 mt-0.5">
                            <RiTimeLine size={12} className="text-primary shrink-0" />
                            {mDate}
                          </p>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${statusInfo.cls}`}>
                          {statusInfo.label}
                        </span>
                      </div>

                      {m.meeting_link && (
                        <a
                          href={m.meeting_link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-semibold"
                        >
                          <RiVideoLine size={12} />
                          Unirse a Videollamada
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                Notas y Anotaciones
              </label>
              <button
                type="button"
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="btn btn-xs btn-primary gap-1"
              >
                {savingNotes ? <RiSaveLine className="animate-spin" size={12} /> : <RiCheckLine size={12} />}
                Guardar
              </button>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Escribe notas sobre llamadas, acuerdos o requerimientos del cliente..."
              rows={4}
              className="textarea textarea-bordered w-full text-xs leading-relaxed"
            />
          </div>
        </div>

        {/* Drawer Footer Actions */}
        <div className="p-4 border-t border-base-200 bg-base-100 flex items-center gap-2">
          <Link
            href={`/inbox?search=${encodeURIComponent(card.full_name || card.email || "")}`}
            className="btn btn-sm btn-outline flex-1 gap-1.5"
          >
            <RiChat3Line size={14} />
            Abrir en Inbox
          </Link>
          <Link
            href={`/contacts/${card.id}`}
            className="btn btn-sm btn-primary flex-1 gap-1.5"
          >
            Ver Ficha Completa
          </Link>
        </div>
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && (
        <ScheduleModal
          isOpen={showScheduleModal}
          onClose={() => setShowScheduleModal(false)}
          timezone={timezone}
          initialTarget={{
            id: card.id,
            full_name: card.full_name,
            company: card.company,
            title: card.title,
            email: card.email,
            linkedin_url: card.linkedin_url,
          }}
          onEventCreated={(newEvent) => {
            setMeetings((prev) => [newEvent, ...prev]);
            // If the card moved to meeting stage, update stage in drawer
            const meetingStage = stages.find(
              (s) => s.trigger_key === "sdr_meeting" || s.id === "stage_meeting"
            );
            if (meetingStage && meetingStage.id !== card.stage_id) {
              onStageChange(card.id, meetingStage.id);
            }
          }}
        />
      )}
    </div>
  );
};
