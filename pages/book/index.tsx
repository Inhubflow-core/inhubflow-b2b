import Head from "next/head";
import type { GetServerSideProps } from "next";
import { useState, useEffect, useMemo } from "react";
import {
  RiCalendarEventLine,
  RiTimeLine,
  RiVideoLine,
  RiGlobalLine,
  RiCheckDoubleLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiBuildingLine,
  RiMailLine,
  RiUserLine,
  RiPhoneLine,
  RiCalendarCheckLine,
  RiExternalLinkLine,
  RiSparklingLine,
} from "react-icons/ri";
import { toast } from "sonner";
import { dayKeyInZone, normalizeTimeZone, DEFAULT_TIMEZONE } from "@/lib/calendar/time";

interface SlotItem {
  time: string;
  start_time: string;
  end_time: string;
  available: boolean;
}

/**
 * Public booking page. Slots come from /api/calendar/availability, which resolves
 * the requested YYYY-MM-DD in the *workspace* timezone — so the date picker here
 * must bucket days in that same zone, not in the visitor's browser zone, or a
 * visitor abroad would request the wrong calendar day and see empty slots.
 */
export default function PublicBookingPage({ initialTimezone }: { initialTimezone: string }) {
  const [timezone, setTimezone] = useState<string>(normalizeTimeZone(initialTimezone));

  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    // Default to tomorrow or next business day
    const d = new Date();
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 6) d.setDate(d.getDate() + 2); // if sat -> mon
    if (d.getDay() === 0) d.setDate(d.getDate() + 1); // if sun -> mon
    return d;
  });

  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null);

  // Step 1: Pick slot, Step 2: Form, Step 3: Success
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Success result
  const [bookingResult, setBookingResult] = useState<{
    event: any;
    meeting_link: string;
  } | null>(null);

  const selectedDateStr = useMemo(() => {
    // Bucketed in the workspace zone, matching how the API resolves the day.
    return dayKeyInZone(selectedDate, timezone);
  }, [selectedDate, timezone]);

  // The availability endpoint reports the zone it used; adopt it so the day grid,
  // the slot labels and the confirmation all speak the same clock.
  useEffect(() => {
    async function loadSlots() {
      setLoadingSlots(true);
      try {
        const res = await fetch(`/api/calendar/availability?date=${selectedDateStr}`);
        if (res.ok) {
          const data = await res.json();
          if (typeof data?.timezone === "string") {
            setTimezone(normalizeTimeZone(data.timezone));
          }
          setSlots(data.slots || []);
        } else {
          setSlots([]);
        }
      } catch (err) {
        console.error("Failed to load slots:", err);
        setSlots([]);
      } finally {
        setLoadingSlots(false);
      }
    }

    loadSlots();
    setSelectedSlot(null);
  }, [selectedDateStr]);

  // Calendar month grid calculation
  const monthDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const days: Array<{ date: Date; isCurrentMonth: boolean; isPast: boolean; isSelected: boolean }> = [];
    // "Past" and "weekend" are decided in the workspace zone, since that is the
    // calendar the visitor is actually booking against.
    const todayKey = dayKeyInZone(new Date(), timezone);

    // Padding previous month
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthLastDay - i);
      days.push({
        date: d,
        isCurrentMonth: false,
        isPast: dayKeyInZone(d, timezone) < todayKey,
        isSelected: false,
      });
    }

    // Days in month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(year, month, i);
      const key = dayKeyInZone(d, timezone);
      const isPast = key < todayKey || d.getDay() === 0 || d.getDay() === 6; // disabled past and weekends
      const isSelected = key === dayKeyInZone(selectedDate, timezone);

      days.push({
        date: d,
        isCurrentMonth: true,
        isPast,
        isSelected,
      });
    }

    return days;
  }, [currentMonth, selectedDate, timezone]);

  async function handleBookSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;
    if (!name.trim() || !email.trim()) {
      toast.error("Por favor completa los campos obligatorios");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/calendar/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          company: company.trim() || null,
          notes: notes.trim() || null,
          start_time: selectedSlot.start_time,
          end_time: selectedSlot.end_time,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "No se pudo agendar la reunión");
      }

      const data = await res.json();
      setBookingResult(data);
      setStep(3);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  // Google Calendar link builder
  const googleCalendarUrl = useMemo(() => {
    if (!bookingResult?.event) return "#";
    const evt = bookingResult.event;
    const startIso = new Date(evt.start_time).toISOString().replace(/-|:|\.\d\d\d/g, "");
    const endIso = new Date(evt.end_time).toISOString().replace(/-|:|\.\d\d\d/g, "");
    const title = encodeURIComponent(evt.title || "Reunión InHubFlow");
    const details = encodeURIComponent(
      `Reunión Comercial y Demo de InHubFlow\nEnlace de videollamada: ${bookingResult.meeting_link}`
    );
    const location = encodeURIComponent(bookingResult.meeting_link);
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startIso}/${endIso}&details=${details}&location=${location}`;
  }, [bookingResult]);

  function downloadIcs() {
    if (!bookingResult?.event) return;
    const evt = bookingResult.event;
    const startIso = new Date(evt.start_time).toISOString().replace(/-|:|\.\d\d\d/g, "");
    const endIso = new Date(evt.end_time).toISOString().replace(/-|:|\.\d\d\d/g, "");

    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//InHubFlow//Calendar//ES",
      "BEGIN:VEVENT",
      `SUMMARY:${evt.title}`,
      `DESCRIPTION:Reunión Comercial InHubFlow\\nEnlace: ${bookingResult.meeting_link}`,
      `LOCATION:${bookingResult.meeting_link}`,
      `DTSTART:${startIso}`,
      `DTEND:${endIso}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "reunion-inhubflow.ics");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <>
      <Head>
        <title>Reservar Reunión — InHubFlow</title>
        <meta
          name="description"
          content="Agenda una demostración en vivo o reunión comercial con el equipo de InHubFlow."
        />
      </Head>

      <div className="min-h-screen bg-slate-50 dark:bg-[#0c111d] text-gray-900 dark:text-gray-100 flex items-center justify-center p-4 md:p-8 font-sans">
        <div className="w-full max-w-4xl bg-white dark:bg-gray-900 rounded-3xl border border-gray-300 dark:border-gray-700 shadow-2xl overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[580px]">
          {/* Left Column: Meeting & Host Details */}
          <div className="md:col-span-5 p-6 md:p-8 bg-gray-50/70 dark:bg-gray-850/50 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              {/* Brand Logo & Host */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-brand-500 text-white font-black text-sm flex items-center justify-center shadow-xs">
                  IF
                </div>
                <div>
                  <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                    InHubFlow Outreach
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    B2B Growth & SDR IA Engine
                  </p>
                </div>
              </div>

              {/* Title & Description */}
              <div className="space-y-1.5 pt-2">
                <h1 className="text-xl md:text-2xl font-black tracking-tight text-gray-900 dark:text-white">
                  Reunión Comercial & Demo
                </h1>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  Conoce cómo automatizar tu prospección en LinkedIn y Email B2B con agentes inteligentes que cualifican y agendan en piloto automático.
                </p>
              </div>

              {/* Badges Info */}
              <div className="space-y-2 pt-2 text-xs text-gray-600 dark:text-gray-300">
                <div className="flex items-center gap-2.5">
                  <RiTimeLine size={16} className="text-brand-500 shrink-0" />
                  <span>30 minutos de sesión personalizada</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <RiVideoLine size={16} className="text-brand-500 shrink-0" />
                  <span>Google Meet (videollamada en vivo)</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <RiGlobalLine size={16} className="text-brand-500 shrink-0" />
                  <span>Zona horaria: Santiago, Chile (GMT-3)</span>
                </div>
              </div>
            </div>

            {/* Bottom Guarantee */}
            <div className="pt-6 border-t border-gray-200/80 dark:border-gray-800 text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
              <RiSparklingLine className="text-brand-500" />
              <span>Confirmación instantánea y enlace en tu email.</span>
            </div>
          </div>

          {/* Right Column: Interactive Scheduling */}
          <div className="md:col-span-7 p-6 md:p-8 flex flex-col justify-center">
            {/* STEP 1: Date & Time Slot Selector */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">
                    Selecciona una fecha y hora
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Horarios mostrados en {timezone}.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-6">
                  {/* Calendar Widget */}
                  <div className="sm:col-span-7 space-y-3">
                    {/* Month Navigator */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-800 dark:text-gray-200 capitalize">
                        {currentMonth.toLocaleDateString("es-ES", {
                          month: "long",
                          year: "numeric",
                        })}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setCurrentMonth(
                              new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
                            )
                          }
                          className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                          <RiArrowLeftLine size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setCurrentMonth(
                              new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
                            )
                          }
                          className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                          <RiArrowRightLine size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Days Grid */}
                    <div className="grid grid-cols-7 gap-1 text-center text-xs">
                      {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
                        <div key={i} className="py-1 text-[10px] font-bold text-gray-400 uppercase">
                          {d}
                        </div>
                      ))}
                      {monthDays.map((item, i) => (
                        <button
                          key={i}
                          type="button"
                          disabled={item.isPast}
                          onClick={() => setSelectedDate(item.date)}
                          className={`h-8 rounded-xl text-xs font-semibold transition-all flex items-center justify-center ${
                            item.isSelected
                              ? "bg-brand-500 text-white font-bold shadow-xs"
                              : item.isPast
                              ? "text-gray-300 dark:text-gray-700 cursor-not-allowed opacity-40"
                              : "text-gray-700 dark:text-gray-300 hover:bg-brand-50 dark:hover:bg-brand-950/40"
                          }`}
                        >
                          {item.date.getDate()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Time Slots Column */}
                  <div className="sm:col-span-5 space-y-2">
                    <div className="text-xs font-bold text-gray-700 dark:text-gray-300 capitalize pb-1 border-b border-gray-100 dark:border-gray-800">
                      {selectedDate.toLocaleDateString("es-ES", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </div>

                    <div className="max-h-[250px] overflow-y-auto space-y-1.5 pr-1">
                      {loadingSlots ? (
                        <div className="py-8 text-center text-xs text-gray-400">
                          Buscando horarios disponibles...
                        </div>
                      ) : slots.length === 0 ? (
                        <div className="py-8 text-center text-xs text-gray-400">
                          Sin horarios para este día. Elige otra fecha.
                        </div>
                      ) : (
                        slots.map((s) => (
                          <button
                            key={s.time}
                            type="button"
                            disabled={!s.available}
                            onClick={() => {
                              setSelectedSlot(s);
                              setStep(2);
                            }}
                            className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all border text-center ${
                              s.available
                                ? "bg-white dark:bg-gray-800 border-brand-500/30 text-brand-600 dark:text-brand-400 hover:bg-brand-500 hover:!text-white hover:border-brand-500 shadow-2xs"
                                : "bg-gray-100 dark:bg-gray-800/40 text-gray-400 border-transparent cursor-not-allowed line-through"
                            }`}
                          >
                            {s.time}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: Qualification Form */}
            {step === 2 && selectedSlot && (
              <form onSubmit={handleBookSubmit} className="space-y-4">
                {/* Back button and Selected Slot Badge */}
                <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    <RiArrowLeftLine size={14} /> Volver a horarios
                  </button>

                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-brand-500/10 text-brand-600 dark:text-brand-400">
                    <RiCalendarCheckLine size={13} />
                    {selectedDate.toLocaleDateString("es-ES", {
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    a las {selectedSlot.time}
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      Nombre completo <span className="text-brand-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Tu nombre y apellido"
                      className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl shadow-xs px-3 py-2 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-brand-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      Email corporativo <span className="text-brand-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nombre@tuempresa.com"
                      className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl shadow-xs px-3 py-2 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-brand-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                        Empresa (Opcional)
                      </label>
                      <input
                        type="text"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        placeholder="Nombre de tu empresa"
                        className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl shadow-xs px-3 py-2 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-brand-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                        WhatsApp / Teléfono (Opcional)
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+56 9 1234 5678"
                        className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl shadow-xs px-3 py-2 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-brand-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      ¿De qué te gustaría hablar o qué desafíos buscas resolver?
                    </label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Ej: Buscamos automatizar la prospección en LinkedIn para captar clientes en México..."
                      className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl shadow-xs p-3 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-brand-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 rounded-xl font-bold text-xs bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs disabled:opacity-50"
                >
                  {submitting ? "Confirmando reunión..." : "Confirmar Reserva"}
                </button>
              </form>
            )}

            {/* STEP 3: Success Confirmation */}
            {step === 3 && bookingResult && (
              <div className="space-y-6 text-center py-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="w-16 h-16 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-xs">
                  <RiCheckDoubleLine size={32} />
                </div>

                <div className="space-y-1.5">
                  <h2 className="text-xl font-black text-gray-900 dark:text-white">
                    ¡Tu reunión está confirmada!
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Hemos enviado los detalles y el enlace de Google Meet a <strong>{email}</strong>.
                  </p>
                </div>

                {/* Meeting card */}
                <div className="p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs text-left space-y-2 text-xs">
                  <div className="font-bold text-gray-900 dark:text-white">
                    {bookingResult.event.title}
                  </div>
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                    <RiTimeLine className="text-brand-500 shrink-0" />
                    <span>
                      {new Date(bookingResult.event.start_time).toLocaleDateString("es-ES", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: timezone,
                      })}{" "}
                      ({timezone})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                    <RiVideoLine className="text-brand-500 shrink-0" />
                    <a
                      href={bookingResult.meeting_link}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-600 dark:text-brand-400 hover:underline font-semibold"
                    >
                      {bookingResult.meeting_link}
                    </a>
                  </div>
                </div>

                {/* Calendar Add Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <a
                    href={googleCalendarUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold bg-brand-500 hover:bg-brand-600 !text-white transition-all shadow-xs"
                  >
                    <RiCalendarEventLine size={15} /> Añadir a Google Calendar
                  </a>
                  <button
                    type="button"
                    onClick={downloadIcs}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-750 text-gray-800 dark:text-gray-200 transition-all border border-gray-200 dark:border-gray-700 shadow-xs"
                  >
                    <RiCalendarCheckLine size={15} /> Descargar .ics (Outlook/Apple)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  // Seed the workspace zone so the first paint already buckets days correctly;
  // the client still adopts whatever the availability endpoint reports.
  let timezone = DEFAULT_TIMEZONE;
  try {
    const { getDb } = await import("@/lib/db");
    const { getCalendarSettings } = await import("@/lib/calendar/settings");
    const db = getDb();
    timezone = getCalendarSettings(db).timezone || DEFAULT_TIMEZONE;
  } catch (err) {
    console.error("[book] could not resolve workspace timezone:", err);
  }
  return { props: { initialTimezone: timezone } };
};
