import React, { useState, useEffect } from "react";
import {
  RiCloseLine,
  RiCalendarEventLine,
  RiTimeLine,
  RiUserLine,
  RiVideoLine,
  RiBuildingLine,
  RiSearchLine,
  RiSparklingLine,
  RiCheckLine,
} from "react-icons/ri";
import { toast } from "sonner";
import type { CalendarEventWithTarget } from "@/lib/calendar/calendar-service";
import { utcFromZoned } from "@/lib/calendar/time";

interface TargetOption {
  id: string;
  full_name: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
}

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEventCreated: (event: CalendarEventWithTarget) => void;
  initialDate?: Date;
  initialHour?: number;
  initialTarget?: TargetOption | null;
  /**
   * IANA zone of the workspace. The date/hour the user picks are wall-clock in this
   * zone; without it `new Date("YYYY-MM-DDTHH:mm")` would be parsed as browser-local
   * and the meeting could land in the wrong day for any non-UTC workspace.
   */
  timezone: string;
  /** Optional campaign (run) this meeting belongs to. */
  initialRunId?: string | null;
  /** Optional list this meeting belongs to. */
  initialListId?: string | null;
}

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  isOpen,
  onClose,
  onEventCreated,
  initialDate,
  initialHour = 10,
  initialTarget = null,
  timezone,
  initialRunId = null,
  initialListId = null,
}) => {
  const [title, setTitle] = useState("");
  const [targetId, setTargetId] = useState<string>("");
  const [selectedTarget, setSelectedTarget] = useState<TargetOption | null>(null);
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("10:00");
  const [duration, setDuration] = useState<number>(30);
  const [meetingLink, setMeetingLink] = useState("");
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState<"linkedin" | "email" | "manual">("linkedin");
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Ecosystem linkage: which campaign / list this meeting belongs to.
  const [runId, setRunId] = useState<string>("");
  const [listId, setListId] = useState<string>("");
  const [runs, setRuns] = useState<Array<{ id: string; name: string }>>([]);
  const [lists, setLists] = useState<Array<{ id: string; name: string }>>([]);

  // Live prospect search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TargetOption[]>([]);
  const [searching, setSearching] = useState(false);

  // Initialize date & time when modal opens
  useEffect(() => {
    if (isOpen) {
      const d = initialDate || new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      setDateStr(`${y}-${m}-${day}`);

      const h = String(initialHour).padStart(2, "0");
      setTimeStr(`${h}:00`);

      if (initialTarget) {
        setSelectedTarget(initialTarget);
        setTargetId(initialTarget.id);
        setTitle(`Reunión con ${initialTarget.full_name || "Contacto"}`);
      } else {
        setSelectedTarget(null);
        setTargetId("");
        setTitle("Reunión Comercial");
      }

      setRunId(initialRunId ?? "");
      setListId(initialListId ?? "");
    }
  }, [isOpen, initialDate, initialHour, initialTarget, initialRunId, initialListId]);

  // Load campaigns + lists once, so a meeting can be attached to the funnel.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    Promise.all([
      fetch("/api/runs?limit=50").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/lists").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([runsData, listsData]) => {
      if (cancelled) return;
      const runRows = (runsData?.runs ?? runsData?.items ?? []) as Array<{
        id: string;
        name?: string | null;
        workflow_name?: string | null;
      }>;
      const listRows = (listsData?.lists ?? listsData?.items ?? []) as Array<{
        id: string;
        name?: string | null;
      }>;
      setRuns(
        runRows.map((r) => ({
          id: r.id,
          name: r.name || r.workflow_name || `Campaña ${r.id.slice(0, 8)}`,
        }))
      );
      setLists(listRows.map((l) => ({ id: l.id, name: l.name || `Lista ${l.id.slice(0, 8)}` })));
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Debounced search for targets
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/targets?search=${encodeURIComponent(searchQuery)}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.contacts || []);
        }
      } catch (err) {
        console.error("Search targets error:", err);
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  function handleSelectTarget(t: TargetOption) {
    setSelectedTarget(t);
    setTargetId(t.id);
    setSearchQuery("");
    setSearchResults([]);
    if (!title || title === "Reunión Comercial") {
      setTitle(`Reunión con ${t.full_name || "Prospecto"}`);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Por favor ingresa un título para la reunión");
      return;
    }
    if (!dateStr || !timeStr) {
      toast.error("Fecha y hora son obligatorias");
      return;
    }

    // Build ISO start & end times. `dateStr`/`timeStr` are wall-clock in the workspace
    // zone, so they must be converted with the zone — not parsed as browser-local.
    const [y, mo, d] = dateStr.split("-").map(Number);
    const [hh, mm] = timeStr.split(":").map(Number);
    if (!y || !mo || !d || !Number.isFinite(hh) || !Number.isFinite(mm)) {
      toast.error("Formato de fecha u hora no válido");
      return;
    }
    const startDateTime = utcFromZoned(y, mo, d, hh, mm, timezone);
    if (isNaN(startDateTime.getTime())) {
      toast.error("Formato de fecha u hora no válido");
      return;
    }

    const endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000);

    setSubmitting(true);
    try {
      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          start_time: startDateTime.toISOString(),
          end_time: endDateTime.toISOString(),
          target_id: targetId || null,
          meeting_link: meetingLink.trim() || null,
          channel,
          auto_advance_pipeline: autoAdvance,
          run_id: runId || null,
          list_id: listId || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al agendar la reunión");
      }

      const { event } = await res.json();
      toast.success("¡Reunión agendada exitosamente!");
      if (targetId && autoAdvance) {
        toast.info("Prospecto avanzado automáticamente a 'Reunión Agendada' en el Pipeline");
      }
      onEventCreated(event);
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-500/10 text-brand-500 flex items-center justify-center">
              <RiCalendarEventLine size={18} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-base">
                Agendar Nueva Reunión
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Programa una cita con tu prospecto y sincronízala con tu CRM.
              </p>
              <p className="text-[10px] text-gray-400">Zona horaria: {timezone}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <RiCloseLine size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Prospect selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              Prospecto / Contacto (Opcional)
            </label>

            {selectedTarget ? (
              <div className="p-3 rounded-xl bg-brand-50/60 dark:bg-brand-950/30 border border-brand-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-brand-500 text-white font-bold text-xs flex items-center justify-center shrink-0">
                    {(selectedTarget.full_name || "C")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-xs text-gray-900 dark:text-white truncate">
                      {selectedTarget.full_name}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {selectedTarget.title || selectedTarget.company || selectedTarget.email || "Contacto"}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTarget(null);
                    setTargetId("");
                  }}
                  className="text-xs text-brand-600 dark:text-brand-400 hover:underline font-medium"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <RiSearchLine size={15} />
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar prospecto por nombre o empresa..."
                  className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-3 py-2 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-brand-500"
                />

                {/* Dropdown search results */}
                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg z-30 max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/60">
                    {searchResults.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => handleSelectTarget(t)}
                        className="p-2.5 hover:bg-brand-50/50 dark:hover:bg-brand-950/30 cursor-pointer transition-colors flex items-center justify-between"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                            {t.full_name}
                          </div>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                            {t.title} {t.company ? `@ ${t.company}` : ""}
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-brand-600 dark:text-brand-400">
                          Seleccionar
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              Título de la reunión <span className="text-brand-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Demo comercial InHubFlow"
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-brand-500"
            />
          </div>

          {/* Date, Time and Duration Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                Fecha <span className="text-brand-500">*</span>
              </label>
              <input
                type="date"
                required
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                Hora de Inicio <span className="text-brand-500">*</span>
              </label>
              <input
                type="time"
                required
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                Duración
              </label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-brand-500"
              >
                <option value={15}>15 minutos</option>
                <option value={30}>30 minutos</option>
                <option value={45}>45 minutos</option>
                <option value={60}>60 minutos</option>
              </select>
            </div>
          </div>

          {/* Meeting Link */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              Enlace de Videollamada (Google Meet / Zoom)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <RiVideoLine size={15} />
              </span>
              <input
                type="url"
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="https://meet.google.com/xxx-xxxx-xxx"
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-3 py-2 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          {/* Ecosystem linkage: campaign + list */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                Campaña (opcional)
              </label>
              <select
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-brand-500"
              >
                <option value="">Sin campaña</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                Lista (opcional)
              </label>
              <select
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-brand-500"
              >
                <option value="">Sin lista</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Description / Agenda */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              Notas de la reunión
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Puntos a tratar, contexto previo o requerimientos del cliente..."
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-brand-500"
            />
          </div>

          {/* Pipeline Auto-Advance Checkbox */}
          {targetId && (
            <label className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 dark:bg-gray-850/60 border border-gray-200 dark:border-gray-700/60 cursor-pointer">
              <input
                type="checkbox"
                checked={autoAdvance}
                onChange={(e) => setAutoAdvance(e.target.checked)}
                className="checkbox checkbox-xs checkbox-primary rounded"
              />
              <span className="text-xs text-gray-700 dark:text-gray-300 font-medium">
                Mover automáticamente este prospecto a la etapa <strong>"Reunión Agendada"</strong> en el Pipeline
              </span>
            </label>
          )}

          {/* Form Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs disabled:opacity-50"
            >
              {submitting ? "Guardando..." : "Confirmar y Agendar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
