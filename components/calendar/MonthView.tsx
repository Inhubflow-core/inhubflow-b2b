import React from "react";
import type { CalendarEventWithTarget } from "@/lib/calendar/calendar-service";
import { dayKeyInZone, timeLabelInZone } from "@/lib/calendar/time";

interface MonthViewProps {
  currentDate: Date;
  events: CalendarEventWithTarget[];
  /** IANA zone of the workspace; all day bucketing follows it, not the browser's. */
  timezone: string;
  onSelectEvent: (event: CalendarEventWithTarget) => void;
  onSelectDate: (date: Date) => void;
}

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export const MonthView: React.FC<MonthViewProps> = ({
  currentDate,
  events,
  timezone,
  onSelectEvent,
  onSelectDate,
}) => {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Compute days for calendar grid
  const calendarDays = React.useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Days in week: Sunday=0 … Saturday=6 → Monday as index 0.
    let startDayOfWeek = firstDayOfMonth.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const days: Array<{
      date: Date;
      isCurrentMonth: boolean;
      isToday: boolean;
      events: CalendarEventWithTarget[];
    }> = [];

    const todayStr = dayKeyInZone(new Date(), timezone);
    const eventsByDay = groupByDay(events, timezone);

    const push = (date: Date, isCurrentMonth: boolean) => {
      const key = dateKeyOf(date);
      days.push({
        date,
        isCurrentMonth,
        isToday: key === todayStr,
        events: eventsByDay.get(key) ?? [],
      });
    };

    // Padding days from previous month
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      push(new Date(year, month - 1, prevMonthLastDay - i), false);
    }

    for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
      push(new Date(year, month, i), true);
    }

    // Padding days for next month to complete rows of 7
    const remainingDays = 42 - days.length; // 6 weeks standard grid
    if (remainingDays > 0 && remainingDays < 7) {
      for (let i = 1; i <= remainingDays; i++) {
        push(new Date(year, month + 1, i), false);
      }
    }

    return days;
  }, [year, month, events, timezone]);

  function getStatusStyle(status: string) {
    switch (status) {
      case "completed":
        return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20";
      case "cancelled":
        return "bg-gray-200 dark:bg-gray-800 text-gray-500 line-through border-gray-300 dark:border-gray-700";
      case "no_show":
        return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/20";
      default:
        return "bg-brand-500/15 text-brand-700 dark:text-brand-300 border-brand-500/20";
    }
  }

  return (
    <div className="w-full rounded-2xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xs overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 divide-x divide-gray-300 dark:divide-gray-700">
        {WEEKDAYS.map((wd, idx) => (
          <div
            key={wd}
            className={`py-3 text-center text-xs font-bold uppercase tracking-wider ${
              idx >= 5 ? "text-gray-400 dark:text-gray-500" : "text-gray-700 dark:text-gray-300"
            }`}
          >
            {wd}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-gray-300 dark:bg-gray-700">
        {calendarDays.map((cell, idx) => {
          const maxVisible = 3;
          const visibleEvents = cell.events.slice(0, maxVisible);
          const overflowCount = cell.events.length - maxVisible;

          return (
            <div
              key={idx}
              onClick={() => onSelectDate(cell.date)}
              className={`min-h-[110px] md:min-h-[125px] p-2.5 flex flex-col transition-colors cursor-pointer group ${
                cell.isCurrentMonth
                  ? "bg-white dark:bg-gray-900 hover:bg-brand-50/20 dark:hover:bg-brand-950/25"
                  : "bg-gray-50/70 dark:bg-gray-950/60 text-gray-400 dark:text-gray-600"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`inline-flex items-center justify-center text-xs font-semibold rounded-full w-6 h-6 transition-colors ${
                    cell.isToday
                      ? "bg-brand-500 text-white shadow-2xs font-bold"
                      : cell.isCurrentMonth
                      ? "text-gray-700 dark:text-gray-300 group-hover:text-brand-600"
                      : "text-gray-400 dark:text-gray-600"
                  }`}
                >
                  {cell.date.getDate()}
                </span>

                {cell.events.length > 0 && (
                  <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">
                    {cell.events.length} {cell.events.length === 1 ? "cita" : "citas"}
                  </span>
                )}
              </div>

              <div className="flex-1 space-y-1 overflow-hidden">
                {visibleEvents.map((evt) => (
                  <div
                    key={evt.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEvent(evt);
                    }}
                    title={`${timeLabelInZone(evt.start_time, timezone)} - ${evt.title} (${evt.target_name || "Sin prospecto"})`}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium border truncate transition-transform hover:scale-[1.02] shadow-2xs flex items-center gap-1.5 ${getStatusStyle(evt.status)}`}
                  >
                    <span className="shrink-0 font-bold opacity-80">
                      {timeLabelInZone(evt.start_time, timezone)}
                    </span>
                    <span className="truncate">{evt.target_name || evt.title}</span>
                  </div>
                ))}

                {overflowCount > 0 && (
                  <div className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 pl-1 pt-0.5">
                    +{overflowCount} más...
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function dateKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function groupByDay(
  events: CalendarEventWithTarget[],
  timezone: string
): Map<string, CalendarEventWithTarget[]> {
  const map = new Map<string, CalendarEventWithTarget[]>();
  for (const evt of events) {
    // Previously `start_time.split("T")[0]` — a UTC prefix against a local grid,
    // so late-evening meetings showed up under the wrong day.
    const key = dayKeyInZone(evt.start_time, timezone);
    const list = map.get(key);
    if (list) list.push(evt);
    else map.set(key, [evt]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }
  return map;
}
