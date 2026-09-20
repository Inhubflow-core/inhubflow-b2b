import React, { useState } from "react";
import Link from "next/link";
import {
  RiRobotLine,
  RiCalendarCheckLine,
  RiCloseCircleLine,
  RiUserLine,
  RiTimeLine,
  RiInboxLine,
  RiLoader4Line,
} from "react-icons/ri";
import { toast } from "sonner";

export interface MeetingRequestItem {
  id: string;
  target_id: string | null;
  thread_id: string | null;
  duration_minutes: number;
  status: string;
  created_event_id: string | null;
  notes: string | null;
  created_at: string;
  target?: { full_name: string | null; company: string | null; email: string | null } | null;
  proposed_slots: Array<{ start_time: string; end_time: string; label?: string }>;
}

interface MeetingRequestsPanelProps {
  requests: MeetingRequestItem[];
  loading?: boolean;
  busy?: boolean;
  onApprove: (requestId: string, slot: { start_time: string; end_time: string }) => Promise<void>;
  onDecline: (requestId: string) => Promise<void>;
}

function formatSlot(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-CL", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Queue of meeting proposals raised by the SDR IA. The agent never books by
 * itself: it proposes slots and a human confirms one here.
 */
export const MeetingRequestsPanel: React.FC<MeetingRequestsPanelProps> = ({
  requests,
  loading = false,
  busy = false,
  onApprove,
  onDecline,
}) => {
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleApprove(requestId: string, slot: { start_time: string; end_time: string }) {
    setPendingId(requestId);
    try {
      await onApprove(requestId, slot);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "No se pudo agendar");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDecline(requestId: string) {
    setPendingId(requestId);
    try {
      await onDecline(requestId);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "No se pudo rechazar");
    } finally {
      setPendingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 p-4">
        <RiLoader4Line size={14} className="animate-spin" /> Cargando solicitudes...
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="flex items-center gap-2.5 text-xs text-gray-500 dark:text-gray-400 p-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white/50 dark:bg-gray-900/40">
        <RiInboxLine size={16} />
        Sin solicitudes pendientes. El SDR IA aparecerá aquí cuando un prospecto pida agendar.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((req) => {
        const name = req.target?.full_name || "Prospecto";
        const isPending = req.status === "pending";
        const isBusy = busy || pendingId === req.id;

        return (
          <div
            key={req.id}
            className="p-4 rounded-2xl border border-purple-500/25 bg-purple-500/5 dark:bg-purple-950/20 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                  <RiRobotLine size={16} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-gray-900 dark:text-white truncate flex items-center gap-1.5">
                    <RiUserLine size={12} className="text-gray-400" />
                    {name}
                    {req.target?.company ? (
                      <span className="font-medium text-gray-500 dark:text-gray-400">
                        @ {req.target.company}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <RiTimeLine size={11} /> {req.duration_minutes} min · solicitud del SDR IA
                  </div>
                </div>
              </div>

              {req.status === "scheduled" ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Agendada
                </span>
              ) : req.status === "declined" ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gray-500/15 text-gray-600 dark:text-gray-300 border border-gray-500/20">
                  Rechazada
                </span>
              ) : null}
            </div>

            {req.notes && (
              <p className="text-[11px] text-gray-600 dark:text-gray-400 italic line-clamp-2">
                &ldquo;{req.notes}&rdquo;
              </p>
            )}

            {isPending && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {req.proposed_slots.map((slot) => (
                    <button
                      key={slot.start_time}
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleApprove(req.id, slot)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-brand-500/40 bg-white dark:bg-gray-800 text-brand-700 dark:text-brand-300 hover:bg-brand-500 hover:!text-white transition-colors disabled:opacity-50"
                    >
                      <RiCalendarCheckLine size={12} />
                      {formatSlot(slot.start_time)}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  {req.thread_id && (
                    <Link
                      href={`/inbox?thread=${encodeURIComponent(req.thread_id)}`}
                      className="text-[11px] font-semibold text-gray-500 hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      Ver conversación
                    </Link>
                  )}
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleDecline(req.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-50"
                  >
                    <RiCloseCircleLine size={13} /> Descartar
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
