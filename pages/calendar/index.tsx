import Head from "next/head";
import { useState, useEffect, useCallback, useMemo } from "react";
import type { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiCalendarEventLine,
  RiTimeLine,
  RiListCheck2,
  RiAddLine,
  RiSearchLine,
  RiRefreshLine,
  RiShareLine,
  RiSettings4Line,
  RiCheckLine,
  RiRobotLine,
  RiLoader4Line,
  RiFilter3Line,
} from "react-icons/ri";
import { toast } from "sonner";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { AgendaView } from "@/components/calendar/AgendaView";
import { ScheduleModal } from "@/components/calendar/ScheduleModal";
import { RescheduleModal } from "@/components/calendar/RescheduleModal";
import { EventDetailModal } from "@/components/calendar/EventDetailModal";
import { CalendarSettingsModal } from "@/components/calendar/CalendarSettingsModal";
import { MeetingRequestsPanel, type MeetingRequestItem } from "@/components/calendar/MeetingRequestsPanel";
import type { CalendarEventWithTarget } from "@/lib/calendar/calendar-service";
import type { CalendarSettings } from "@/lib/calendar/schema";

type CalendarViewMode = "month" | "week" | "agenda";

interface CalendarPageProps {
  initialLists: Array<{ id: string; name: string }>;
  initialWorkflows: Array<{ id: string; name: string }>;
  timezone: string;
}

export const getServerSideProps: GetServerSideProps<CalendarPageProps> = async () => {
  const db = getDb();

  const initialLists = db
    .prepare("SELECT id, name FROM lists ORDER BY name COLLATE NOCASE ASC")
    .all() as Array<{ id: string; name: string }>;

  const initialWorkflows = db
    .prepare("SELECT id, name FROM workflows ORDER BY name COLLATE NOCASE ASC")
    .all() as Array<{ id: string; name: string }>;

  const settings = db
    .prepare("SELECT timezone FROM calendar_settings ORDER BY updated_at DESC LIMIT 1")
    .get() as { timezone: string } | undefined;

  return {
    props: {
      initialLists,
      initialWorkflows,
      timezone: settings?.timezone || "America/Santiago",
    },
  };
};

export default function CalendarPage({
  initialLists,
  initialWorkflows,
  timezone,
}: CalendarPageProps) {
  const { t } = useTranslation();

  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [events, setEvents] = useState<CalendarEventWithTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);

  // Ecosystem filters — same vocabulary as the pipeline board.
  const [selectedList, setSelectedList] = useState<string>("");
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>("");

  // Modals
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleInitialDate, setScheduleInitialDate] = useState<Date | undefined>(undefined);
  const [scheduleInitialHour, setScheduleInitialHour] = useState<number>(10);

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventWithTarget | null>(null);
  const [rescheduleEvent, setRescheduleEvent] = useState<CalendarEventWithTarget | null>(null);

  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settings, setSettings] = useState<CalendarSettings | null>(null);

  // SDR IA meeting proposals awaiting human approval
  const [requests, setRequests] = useState<MeetingRequestItem[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const res = await fetch("/api/calendar/requests?status=pending");
      if (res.ok) {
        const data = await res.json();
        setRequests((data.requests || []) as MeetingRequestItem[]);
      }
    } catch (err) {
      console.error("Error loading meeting requests:", err);
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (selectedList) params.set("list_id", selectedList);
      if (selectedWorkflow) params.set("workflow_id", selectedWorkflow);

      const res = await fetch(`/api/calendar/events?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch (err) {
      console.error("Error loading events:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, selectedList, selectedWorkflow]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const haystack = [
          evt.title,
          evt.target_name || "",
          evt.target_company || "",
          evt.run_name || "",
          evt.list_name || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (selectedWorkflow && !(evt.workflow_names ?? []).length && !evt.run_name) return false;
      if (selectedList && !(evt.list_names ?? []).length && !evt.list_name) return false;
      return true;
    });
  }, [events, searchQuery, selectedWorkflow, selectedList]);

  const handleCopyBookingLink = () => {
    const url = `${window.location.origin}/book`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    toast.success(t("calendar.bookingLinkCopied"));
    setTimeout(() => setCopiedLink(false), 2000);
  };

  function handlePrev() {
    const newDate = new Date(currentDate);
    if (viewMode === "month") newDate.setMonth(newDate.getMonth() - 1);
    else if (viewMode === "week") newDate.setDate(newDate.getDate() - 7);
    else newDate.setMonth(newDate.getMonth() - 1);
    setCurrentDate(newDate);
  }

  function handleNext() {
    const newDate = new Date(currentDate);
    if (viewMode === "month") newDate.setMonth(newDate.getMonth() + 1);
    else if (viewMode === "week") newDate.setDate(newDate.getDate() + 7);
    else newDate.setMonth(newDate.getMonth() + 1);
    setCurrentDate(newDate);
  }

  async function handleApproveRequest(
    requestId: string,
    slot: { start_time: string; end_time: string }
  ) {
    const res = await fetch(`/api/calendar/requests/${requestId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slot),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "No se pudo agendar la reunión");
    toast.success(t("calendar.meetingScheduled"));
    if (data.event) {
      setEvents((prev) => [...prev, data.event as CalendarEventWithTarget]);
    }
    await Promise.all([fetchRequests(), fetchEvents()]);
  }

  async function handleDeclineRequest(requestId: string) {
    const res = await fetch(`/api/calendar/requests/${requestId}/decline`, { method: "POST" });
    if (!res.ok) throw new Error("No se pudo descartar la solicitud");
    toast.success(t("calendar.requestDeclined"));
    await fetchRequests();
  }

  async function handleStatusChange(
    eventId: string,
    status: "confirmed" | "completed" | "cancelled" | "no_show"
  ) {
    const res = await fetch(`/api/calendar/events/${eventId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al actualizar el estado");
    toast.success(t("calendar.statusUpdated"));
    if (data.event) setEvents((prev) => prev.map((e) => (e.id === eventId ? data.event : e)));
    if (selectedEvent?.id === eventId) setSelectedEvent(data.event);
    await fetchEvents();
  }

  async function handleRescheduleSubmit(
    eventId: string,
    payload: { start_time: string; end_time: string }
  ) {
    const res = await fetch(`/api/calendar/events/${eventId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al reprogramar");
    toast.success(t("calendar.rescheduled"));
    setRescheduleEvent(null);
    await fetchEvents();
  }

  return (
    <>
      <Head>
        <title>{t("nav.calendar")} — InHubFlow</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl mb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                {t("calendar.title")}
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/15 text-brand-600 dark:text-brand-400">
                {events.length} {events.length === 1 ? t("calendar.meetingOne") : t("calendar.meetingMany")}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t("calendar.subtitle")}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="join border border-gray-300 dark:border-gray-700 rounded-xl p-0.5 bg-gray-100 dark:bg-gray-800 shadow-xs">
              <button
                type="button"
                onClick={() => setViewMode("month")}
                className={`join-item btn btn-xs gap-1 font-semibold ${
                  viewMode === "month"
                    ? "btn-primary"
                    : "btn-ghost text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                }`}
                title={t("calendar.monthView")}
              >
                <RiCalendarEventLine size={13} /> {t("calendar.month")}
              </button>
              <button
                type="button"
                onClick={() => setViewMode("week")}
                className={`join-item btn btn-xs gap-1 font-semibold ${
                  viewMode === "week"
                    ? "btn-primary"
                    : "btn-ghost text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                }`}
                title={t("calendar.weekView")}
              >
                <RiTimeLine size={13} /> {t("calendar.week")}
              </button>
              <button
                type="button"
                onClick={() => setViewMode("agenda")}
                className={`join-item btn btn-xs gap-1 font-semibold ${
                  viewMode === "agenda"
                    ? "btn-primary"
                    : "btn-ghost text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                }`}
                title={t("calendar.agendaView")}
              >
                <RiListCheck2 size={13} /> {t("calendar.agenda")}
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopyBookingLink}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
              title={t("calendar.copyBookingLinkHint")}
            >
              {copiedLink ? <RiCheckLine size={16} className="text-emerald-500" /> : <RiShareLine size={16} />}
              {copiedLink ? t("calendar.copied") : t("calendar.copyLink")}
            </button>

            <button
              type="button"
              onClick={() => setSettingsModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all shadow-xs"
              title={t("calendar.settingsHint")}
            >
              <RiSettings4Line size={16} /> {t("calendar.schedules")}
            </button>

            <button
              type="button"
              onClick={() => {
                setScheduleInitialDate(new Date());
                setScheduleInitialHour(10);
                setScheduleModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs md:text-sm font-semibold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs"
            >
              <RiAddLine size={16} /> {t("calendar.scheduleMeeting")}
            </button>
          </div>
        </div>

        {/* SDR IA proposals awaiting approval */}
        {requests.length > 0 && (
          <div className="mb-5 p-4 rounded-2xl border border-purple-500/25 bg-white dark:bg-gray-900 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <RiRobotLine size={16} className="text-purple-500" />
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">
                  {t("calendar.aiRequests")}
                </h2>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400">
                  {requests.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void fetchRequests()}
                className="text-[11px] font-semibold text-gray-500 hover:text-brand-600 dark:hover:text-brand-400"
              >
                {t("calendar.refresh")}
              </button>
            </div>
            <MeetingRequestsPanel
              requests={requests}
              loading={loadingRequests}
              onApprove={handleApproveRequest}
              onDecline={handleDeclineRequest}
            />
          </div>
        )}

        {/* Filter & Navigation Row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xs p-1">
              <button
                type="button"
                onClick={handlePrev}
                className="px-2 py-1 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-xs font-bold"
                title={t("calendar.previous")}
              >
                ◀
              </button>
              <button
                type="button"
                onClick={() => setCurrentDate(new Date())}
                className="px-3 py-1 rounded-lg text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                {t("calendar.today")}
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="px-2 py-1 rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-xs font-bold"
                title={t("calendar.next")}
              >
                ▶
              </button>
            </div>

            <h2 className="text-base md:text-lg font-bold text-gray-900 dark:text-white capitalize">
              {currentDate.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
            </h2>

            <button
              type="button"
              onClick={() => void fetchEvents()}
              disabled={loading}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={t("calendar.refreshCalendar")}
            >
              <RiRefreshLine size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                <RiSearchLine size={13} />
              </span>
              <input
                type="text"
                className="w-56 bg-white dark:bg-gray-850 border border-gray-300 dark:border-gray-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-brand-500 shadow-xs"
                placeholder={t("calendar.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Campaign / list filters: the calendar is part of the same funnel */}
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
              <RiFilter3Line size={12} />
            </span>
            <select
              className="bg-white dark:bg-gray-850 border border-gray-300 dark:border-gray-700 rounded-xl px-2.5 py-1.5 text-xs text-gray-800 dark:text-gray-200 focus:outline-none focus:border-brand-500 h-8 shadow-xs cursor-pointer"
              value={selectedList}
              onChange={(e) => setSelectedList(e.target.value)}
            >
              <option value="">{t("calendar.allLists")}</option>
              {initialLists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>

            <select
              className="bg-white dark:bg-gray-850 border border-gray-300 dark:border-gray-700 rounded-xl px-2.5 py-1.5 text-xs text-gray-800 dark:text-gray-200 focus:outline-none focus:border-brand-500 h-8 shadow-xs cursor-pointer"
              value={selectedWorkflow}
              onChange={(e) => setSelectedWorkflow(e.target.value)}
            >
              <option value="">{t("calendar.allCampaigns")}</option>
              {initialWorkflows.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>

            <div className="join border border-gray-300 dark:border-gray-700 rounded-xl p-0.5 bg-gray-100 dark:bg-gray-800 h-8 flex items-center shadow-xs">
              {[
                { key: "all", label: t("calendar.all") },
                { key: "confirmed", label: t("calendar.confirmedShort") },
                { key: "completed", label: t("calendar.completedShort") },
                { key: "cancelled", label: t("calendar.cancelledShort") },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setStatusFilter(opt.key)}
                  className={`join-item px-2.5 py-1 rounded-lg text-xs transition-colors ${
                    statusFilter === opt.key
                      ? "bg-brand-500 text-white font-medium shadow-xs"
                      : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Calendar View Area */}
        {loading && events.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-gray-400">
            <RiLoader4Line size={28} className="animate-spin" />
          </div>
        ) : viewMode === "month" ? (
          <MonthView
            currentDate={currentDate}
            events={filteredEvents}
            timezone={timezone}
            onSelectEvent={(evt) => {
              setSelectedEvent(evt);
              setDetailModalOpen(true);
            }}
            onSelectDate={(date) => {
              setScheduleInitialDate(date);
              setScheduleInitialHour(10);
              setScheduleModalOpen(true);
            }}
          />
        ) : viewMode === "week" ? (
          <WeekView
            currentDate={currentDate}
            events={filteredEvents}
            timezone={timezone}
            onSelectEvent={(evt) => {
              setSelectedEvent(evt);
              setDetailModalOpen(true);
            }}
            onSelectSlot={(date, hour) => {
              setScheduleInitialDate(date);
              setScheduleInitialHour(hour);
              setScheduleModalOpen(true);
            }}
          />
        ) : (
          <AgendaView
            events={filteredEvents}
            timezone={timezone}
            onSelectEvent={(evt) => {
              setSelectedEvent(evt);
              setDetailModalOpen(true);
            }}
            onReschedule={(evt) => setRescheduleEvent(evt)}
            onOpenScheduleModal={() => {
              setScheduleInitialDate(new Date());
              setScheduleInitialHour(10);
              setScheduleModalOpen(true);
            }}
          />
        )}

        <ScheduleModal
          isOpen={scheduleModalOpen}
          onClose={() => setScheduleModalOpen(false)}
          onEventCreated={(evt) => setEvents((prev) => [evt, ...prev])}
          initialDate={scheduleInitialDate}
          initialHour={scheduleInitialHour}
          timezone={timezone}
        />

        <RescheduleModal
          event={rescheduleEvent}
          isOpen={Boolean(rescheduleEvent)}
          timezone={timezone}
          onClose={() => setRescheduleEvent(null)}
          onSubmit={handleRescheduleSubmit}
        />

        <EventDetailModal
          event={selectedEvent}
          isOpen={detailModalOpen}
          timezone={settings?.timezone || timezone}
          onClose={() => setDetailModalOpen(false)}
          onEventUpdated={(updated) => {
            setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
            setSelectedEvent(updated);
          }}
          onEventDeleted={(id) => {
            setEvents((prev) => prev.filter((e) => e.id !== id));
            setSelectedEvent(null);
            setDetailModalOpen(false);
          }}
          onStatusChange={handleStatusChange}
          onReschedule={(evt) => {
            setDetailModalOpen(false);
            setRescheduleEvent(evt);
          }}
        />

        <CalendarSettingsModal
          isOpen={settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
          onSaved={(next) => {
            setSettings(next);
            void fetchEvents();
          }}
        />
      </div>
    </>
  );
}
