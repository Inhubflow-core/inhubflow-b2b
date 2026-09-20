import React from "react";
import type { CalendarEventWithTarget } from "@/lib/calendar/calendar-service";
import { dayKeyInZone, timeLabelInZone } from "@/lib/calendar/time";

interface WeekViewProps {
  currentDate: Date;
  events: CalendarEventWithTarget[];
  timezone: string;
  onSelectEvent: (event: CalendarEventWithTarget) => void;
  onSelectSlot: (date: Date, hour: number) => void;
}

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const HOUR_HEIGHT = 60; // px per hour slot
const DAY_START_HOUR = 8;

export const WeekView: React.FC<WeekViewProps> = ({
  currentDate,
  events,
  timezone,
  onSelectEvent,
  onSelectSlot,
}) => {
  const weekDays = React.useMemo(() => {
    const day = currentDate.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(currentDate);
    monday.setDate(currentDate.getDate() + diffToMonday);

    const days: Array<{
      date: Date;
      dateStr: string;
      dayName: string;
      dayNum: number;
      isToday: boolean;
      events: CalendarEventWithTarget[];
    }> = [];

    const dayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    const todayStr = dayKeyInZone(new Date(), timezone);
    const eventsByDay = new Map<string, CalendarEventWithTarget[]>();
    for (const evt of events) {
      const key = dayKeyInZone(evt.start_time, timezone);
      const list = eventsByDay.get(key);
      if (list) list.push(evt);
      else eventsByDay.set(key, [evt]);
    }

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dayNum = String(d.getDate()).padStart(2, "0");
      const dStr = `${y}-${m}-${dayNum}`;

      days.push({
        date: d,
        dateStr: dStr,
        dayName: dayNames[i],
        dayNum: d.getDate(),
        isToday: dStr === todayStr,
        events: (eventsByDay.get(dStr) ?? []).slice().sort(
          (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
        ),
      });
    }

    return days;
  }, [currentDate, events, timezone]);

  function getStatusStyle(status: string) {
    switch (status) {
      case "completed":
        return "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-emerald-500/30";
      case "cancelled":
        return "bg-gray-200 dark:bg-gray-800 text-gray-500 line-through border-gray-300 dark:border-gray-700";
      case "no_show":
        return "bg-rose-500/20 text-rose-800 dark:text-rose-200 border-rose-500/30";
      default:
        return "bg-brand-500/20 text-brand-800 dark:text-brand-200 border-brand-500/30";
    }
  }

  // Position within the day column, measured in workspace-local time.
  function calculateEventPosition(event: CalendarEventWithTarget) {
    const startLabel = timeLabelInZone(event.start_time, timezone);
    const [startHour, startMinute] = startLabel.split(":").map(Number);
    const startMinutesFrom8 = (startHour - DAY_START_HOUR) * 60 + startMinute;
    const durationMinutes = Math.max(
      25,
      (new Date(event.end_time).getTime() - new Date(event.start_time).getTime()) / (1000 * 60)
    );

    return {
      top: (startMinutesFrom8 / 60) * HOUR_HEIGHT,
      height: Math.max(30, (durationMinutes / 60) * HOUR_HEIGHT - 2),
    };
  }

  return (
    <div className="w-full rounded-2xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xs overflow-hidden flex flex-col">
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 sticky top-0 z-10">
        <div className="py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 border-r border-gray-300 dark:border-gray-700">
          Hora
        </div>
        {weekDays.map((wd) => (
          <div
            key={wd.dateStr}
            className={`py-2.5 px-2 text-center border-r last:border-r-0 border-gray-300 dark:border-gray-700 transition-colors ${
              wd.isToday ? "bg-brand-500/5 dark:bg-brand-500/10" : ""
            }`}
          >
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              {wd.dayName}
            </div>
            <div
              className={`inline-flex items-center justify-center text-sm font-bold rounded-full w-7 h-7 mt-0.5 ${
                wd.isToday ? "bg-brand-500 text-white shadow-xs" : "text-gray-900 dark:text-white"
              }`}
            >
              {wd.dayNum}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-y-auto max-h-[620px] relative">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] relative">
          <div className="border-r border-gray-300 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-850/60 select-none">
            {HOURS.map((hour) => (
              <div
                key={hour}
                style={{ height: `${HOUR_HEIGHT}px` }}
                className="text-[11px] font-medium text-gray-400 dark:text-gray-500 pr-2 pt-1 text-right border-b border-gray-200 dark:border-gray-800"
              >
                {String(hour).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {weekDays.map((wd) => (
            <div
              key={wd.dateStr}
              className={`relative border-r last:border-r-0 border-gray-300 dark:border-gray-700 transition-colors ${
                wd.isToday ? "bg-brand-500/[0.02]" : ""
              }`}
            >
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  onClick={() => onSelectSlot(wd.date, hour)}
                  style={{ height: `${HOUR_HEIGHT}px` }}
                  className="border-b border-gray-200 dark:border-gray-800 hover:bg-brand-50/40 dark:hover:bg-brand-950/20 cursor-pointer transition-colors"
                />
              ))}

              {wd.events.map((evt) => {
                const { top, height } = calculateEventPosition(evt);
                if (top < 0) return null;

                return (
                  <div
                    key={evt.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEvent(evt);
                    }}
                    style={{ top: `${top}px`, height: `${height}px`, left: "3px", right: "3px" }}
                    title={`${timeLabelInZone(evt.start_time, timezone)} - ${timeLabelInZone(evt.end_time, timezone)} | ${evt.title}`}
                    className={`absolute rounded-xl border p-2 text-xs font-medium cursor-pointer shadow-xs transition-all hover:scale-[1.02] hover:z-20 overflow-hidden flex flex-col justify-between ${getStatusStyle(evt.status)}`}
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-1 font-bold text-[11px]">
                        <span>
                          {timeLabelInZone(evt.start_time, timezone)} - {timeLabelInZone(evt.end_time, timezone)}
                        </span>
                      </div>
                      <div className="font-semibold truncate text-xs">
                        {evt.target_name || evt.title}
                      </div>
                      {evt.target_company && (
                        <div className="text-[10px] opacity-75 truncate">{evt.target_company}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
