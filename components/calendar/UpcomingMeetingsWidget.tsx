import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  RiCalendarEventLine,
  RiTimeLine,
  RiVideoLine,
  RiArrowRightLine,
  RiRobotLine,
  RiUserLine,
  RiAddLine,
} from "react-icons/ri";
import type { CalendarEventWithTarget } from "@/lib/calendar/calendar-service";
import { dayKeyInZone, timeLabelInZone } from "@/lib/calendar/time";
import { useWorkspaceTimezone } from "@/lib/calendar/use-workspace-timezone";

export const UpcomingMeetingsWidget: React.FC = () => {
  const [events, setEvents] = useState<CalendarEventWithTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const timezone = useWorkspaceTimezone();

  useEffect(() => {
    async function fetchUpcoming() {
      try {
        const now = new Date().toISOString();
        const res = await fetch(`/api/calendar/events?start=${encodeURIComponent(now)}&status=confirmed`);
        if (res.ok) {
          const data = await res.json();
          setEvents((data.events || []).slice(0, 4));
        }
      } catch (err) {
        console.error("Error fetching upcoming meetings:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchUpcoming();
  }, []);

  function formatRelativeDate(iso: string) {
    // Day bucketing and the clock label both follow the workspace zone, not the
    // browser's — otherwise "Hoy/Mañana" flips for any viewer outside that zone.
    const dayKey = dayKeyInZone(iso, timezone);
    const todayKey = dayKeyInZone(new Date(), timezone);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = dayKeyInZone(tomorrow, timezone);

    const timeStr = timeLabelInZone(iso, timezone);
    const d = new Date(iso);

    if (dayKey === todayKey) return `Hoy a las ${timeStr}`;
    if (dayKey === tomorrowKey) return `Mañana a las ${timeStr}`;

    return `${d.toLocaleDateString("es-ES", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: timezone,
    })} a las ${timeStr}`;
  }

  return (
    <div className="rounded-2xl border border-gray-300 bg-white p-5 shadow-xs dark:border-gray-700 dark:bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-brand-500/10 text-brand-500 flex items-center justify-center text-sm">
            <RiCalendarEventLine size={16} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Próximas Reuniones Comerciales
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Citas agendadas por ti, tu página pública o el SDR IA
            </p>
          </div>
        </div>

        <Link
          href="/calendar"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
        >
          Ver Calendario <RiArrowRightLine size={13} />
        </Link>
      </div>

      {/* Body */}
      {loading ? (
        <div className="py-8 text-center text-xs text-gray-400">
          <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Cargando reuniones...
        </div>
      ) : events.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-center bg-gray-50/50 dark:bg-gray-850/30">
          <RiCalendarEventLine size={24} className="mx-auto text-gray-400 dark:text-gray-600 mb-2" />
          <p className="text-xs text-gray-600 dark:text-gray-400 font-medium">
            No tienes reuniones comerciales agendadas para los próximos días.
          </p>
          <Link
            href="/calendar"
            className="inline-flex items-center gap-1.5 mt-3 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs"
          >
            <RiAddLine size={14} />
            Agendar Reunión
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {events.map((evt) => {
            const isSdr = evt.channel === "sdr_ai";

            return (
              <div
                key={evt.id}
                className="p-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-850/50 hover:border-brand-500 dark:hover:border-brand-500 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {evt.target_image_url ? (
                    <img
                      src={evt.target_image_url}
                      alt={evt.target_name || "Prospecto"}
                      className="w-9 h-9 rounded-full object-cover border border-gray-200 dark:border-gray-700 shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-400 font-bold text-xs flex items-center justify-center shrink-0">
                      {evt.target_name ? evt.target_name[0].toUpperCase() : <RiUserLine size={14} />}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold text-gray-900 dark:text-white truncate">
                        {evt.title}
                      </p>
                      {isSdr && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 shrink-0">
                          <RiRobotLine size={10} /> SDR IA
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {evt.target_name ? (
                        <span>
                          {evt.target_name}
                          {evt.target_company ? ` @ ${evt.target_company}` : ""}
                        </span>
                      ) : (
                        "Reunión de demostración"
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-200 dark:border-gray-800">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 bg-brand-50/80 dark:bg-brand-950/40 px-2.5 py-1 rounded-lg border border-brand-500/20">
                    <RiTimeLine size={13} className="shrink-0" />
                    <span>{formatRelativeDate(evt.start_time)}</span>
                  </div>

                  {evt.meeting_link && (
                    <a
                      href={evt.meeting_link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-xs"
                    >
                      <RiVideoLine size={13} />
                      Unirse
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
