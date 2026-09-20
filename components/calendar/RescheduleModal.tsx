import React, { useState, useEffect } from "react";
import { RiCloseLine, RiCalendarEventLine, RiTimeLine, RiAlertLine } from "react-icons/ri";
import { toast } from "sonner";
import type { CalendarEventWithTarget } from "@/lib/calendar/calendar-service";
import { dayKeyInZone, timeLabelInZone, utcFromZoned } from "@/lib/calendar/time";

interface RescheduleModalProps {
  event: CalendarEventWithTarget | null;
  isOpen: boolean;
  timezone: string;
  onClose: () => void;
  onSubmit: (eventId: string, payload: { start_time: string; end_time: string }) => Promise<void>;
}

/**
 * Reschedule flow: instead of hand-editing two UTC strings, the user picks a date
 * and a time in the workspace timezone and the modal converts them back to UTC.
 * Free slots come from /api/calendar/availability, so a busy slot can't be chosen.
 */
export const RescheduleModal: React.FC<RescheduleModalProps> = ({
  event,
  isOpen,
  timezone,
  onClose,
  onSubmit,
}) => {
  const [dateStr, setDateStr] = useState("");
  const [slots, setSlots] = useState<Array<{ time: string; start_time: string; end_time: string; available: boolean }>>([]);
  const [selected, setSelected] = useState<{ start_time: string; end_time: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !event) return;
    const initial = dayKeyInZone(event.start_time, timezone);
    setDateStr(initial);
    setSelected(null);
  }, [isOpen, event, timezone]);

  useEffect(() => {
    if (!isOpen || !dateStr) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/calendar/availability?date=${dateStr}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const list = (data?.slots ?? []) as Array<{ time: string; start_time: string; end_time: string; available: boolean }>;
        // The event's own slot is free by definition: exclude it from conflicts.
        setSlots(list);
      })
      .catch(() => !cancelled && setSlots([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isOpen, dateStr]);

  if (!isOpen || !event) return null;

  const durationMs = new Date(event.end_time).getTime() - new Date(event.start_time).getTime();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      toast.error("Selecciona un horario disponible");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(event!.id, selected);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "No se pudo reprogramar");
    } finally {
      setSubmitting(false);
    }
  }

  // Keep the original duration when the user picks a time by hand.
  function handleManualTime(value: string) {
    const [h, m] = value.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m) || !dateStr) return;
    const [y, mo, d] = dateStr.split("-").map(Number);
    const start = utcFromZoned(y, mo, d, h, m, timezone);
    const end = new Date(start.getTime() + (durationMs || 30 * 60_000));
    setSelected({ start_time: start.toISOString(), end_time: end.toISOString() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-500/10 text-brand-500 flex items-center justify-center">
              <RiCalendarEventLine size={18} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-base">Reprogramar reunión</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[240px]">
                {event.title}
              </p>
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2">
            <RiTimeLine size={14} className="text-brand-500 shrink-0" />
            <span>
              Actual: {dayKeyInZone(event.start_time, timezone)} {timeLabelInZone(event.start_time, timezone)} ({timezone})
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                Nueva fecha
              </label>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                Hora exacta
              </label>
              <input
                type="time"
                onChange={(e) => handleManualTime(e.target.value)}
                className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              Horarios disponibles
            </label>
            {loading ? (
              <div className="text-xs text-gray-400 py-3">Buscando horarios...</div>
            ) : slots.length === 0 ? (
              <div className="p-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <RiAlertLine size={14} /> Sin horarios para este día.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1">
                {slots.map((slot) => {
                  const isSelected = selected?.start_time === slot.start_time;
                  return (
                    <button
                      key={slot.start_time}
                      type="button"
                      disabled={!slot.available}
                      onClick={() => setSelected({ start_time: slot.start_time, end_time: slot.end_time })}
                      className={`py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        isSelected
                          ? "bg-brand-500 !text-white border-brand-500"
                          : slot.available
                          ? "bg-white dark:bg-gray-800 border-brand-500/30 text-brand-700 dark:text-brand-300 hover:border-brand-500"
                          : "bg-gray-100 dark:bg-gray-800/40 text-gray-400 border-transparent line-through cursor-not-allowed"
                      }`}
                    >
                      {slot.time}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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
              disabled={submitting || !selected}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs disabled:opacity-50"
            >
              {submitting ? "Guardando..." : "Confirmar cambio"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
