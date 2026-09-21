import React from "react";
import {
  RiLinkedinBoxFill,
  RiMailLine,
  RiRobotLine,
  RiAlertLine,
  RiTimeLine,
  RiExternalLinkLine,
  RiChat3Line,
  RiListCheck,
} from "react-icons/ri";
import type { PipelineCard } from "@/lib/pipeline/pipeline-service";
import ProspectAvatar from "@/components/ui/ProspectAvatar";

interface KanbanCardProps {
  card: PipelineCard;
  onSelect: (card: PipelineCard) => void;
  onDragStart: (e: React.DragEvent, cardId: string) => void;
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("es-ES", { month: "short", day: "numeric" });
}

export const KanbanCard: React.FC<KanbanCardProps> = ({ card, onSelect, onDragStart }) => {
  const needsHuman = card.sdr_thread_state === "HUMAN_REVIEW" || card.sdr_thread_state === "HUMAN_ACTIVE";

  // Intent badge display
  let intentBadge: { text: string; cls: string } | null = null;
  if (card.sdr_intent === "interested" || card.reply_kind === "call_task") {
    intentBadge = { text: "Interesado", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" };
  } else if (card.sdr_intent === "meeting_request") {
    intentBadge = { text: "Pide Reunión", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" };
  } else if (card.sdr_intent === "pricing_question" || card.reply_kind === "pricing") {
    intentBadge = { text: "Precios", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" };
  } else if (card.sdr_intent === "not_interested" || card.reply_kind === "not_interested") {
    intentBadge = { text: "No Interesado", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30" };
  } else if (card.reply_kind === "ooo_followup" || card.sdr_intent === "ooo") {
    intentBadge = { text: "Fuera de Oficina", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" };
  } else if (card.reply_kind === "human_reply") {
    intentBadge = { text: "Respondió", cls: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30" };
  }

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, card.id)}
      onClick={() => onSelect(card)}
      className="group relative bg-white dark:bg-gray-900 hover:bg-gray-50/90 dark:hover:bg-gray-850 border border-gray-300 dark:border-gray-700 hover:border-brand-500/60 rounded-xl p-3.5 shadow-xs hover:shadow-md transition-all cursor-grab active:cursor-grabbing select-none"
    >
      {/* Top Header: Channel + Tags */}
      <div className="flex items-center justify-between gap-1.5 mb-2.5">
        <div className="flex items-center gap-1.5">
          {card.channel === "linkedin" || card.channel === "both" ? (
            <span
              title="Contacto con perfil de LinkedIn"
              className="w-5 h-5 rounded flex items-center justify-center bg-[#0a66c2]/10 text-[#0a66c2]"
            >
              <RiLinkedinBoxFill size={14} />
            </span>
          ) : null}
          {card.channel === "email" || card.channel === "both" ? (
            <span
              title="Contacto con Email disponible"
              className="w-5 h-5 rounded flex items-center justify-center bg-amber-500/10 text-amber-600"
            >
              <RiMailLine size={13} />
            </span>
          ) : null}
          {card.degree === 1 && (
            <span className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded bg-success/15 text-success">
              1º
            </span>
          )}
        </div>

        {/* SDR Status Indicator */}
        {needsHuman ? (
          <span
            title="La IA pausó el bot y solicita revisión humana"
            className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-error/15 text-error border border-error/20 animate-pulse"
          >
            <RiAlertLine size={12} />
            Humano
          </span>
        ) : card.sdr_autopilot ? (
          <span
            title="SDR IA respondiendo activamente en piloto automático"
            className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
          >
            <RiRobotLine size={12} />
            SDR
          </span>
        ) : null}
      </div>

      {/* Profile: Avatar + Name + Title */}
      <div className="flex items-start gap-2.5 mb-2.5">
        <ProspectAvatar
          imageUrl={card.profile_image_url}
          name={card.full_name}
          size="md"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h4 className="font-semibold text-sm text-base-content truncate group-hover:text-primary transition-colors">
              {card.full_name}
            </h4>
            {card.linkedin_url && (
              <a
                href={card.linkedin_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-60 hover:opacity-100 text-base-content/60 hover:text-primary transition-opacity"
                title="Abrir perfil de LinkedIn"
              >
                <RiExternalLinkLine size={12} />
              </a>
            )}
          </div>
          {card.title && (
            <p className="text-xs text-base-content/70 truncate mt-0.5" title={card.title}>
              {card.title}
            </p>
          )}
          {card.company && (
            <p className="text-xs font-medium text-base-content/50 truncate mt-0.5">
              {card.company}
            </p>
          )}
        </div>
      </div>

      {/* Badges: AI tags / Intent / Campaign / Lists */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {card.tags?.map((tag) => (
          <span
            key={tag.slug}
            title={tag.source === "ai" ? `Etiqueta aplicada por la IA: ${tag.name}` : `Etiqueta: ${tag.name}`}
            className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md border"
            style={{
              borderColor: `${tag.color}55`,
              backgroundColor: `${tag.color}1a`,
              color: tag.color,
            }}
          >
            {tag.source === "ai" ? <RiRobotLine size={9} /> : null}
            {tag.name}
          </span>
        ))}
        {intentBadge && (
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${intentBadge.cls}`}>
            {intentBadge.text}
          </span>
        )}
        {(card.workflow_names ?? []).slice(0, 2).map((name) => (
          <span
            key={name}
            className="text-[10px] text-base-content/50 bg-base-200 px-1.5 py-0.5 rounded truncate max-w-[140px]"
            title={`Campaña: ${name}`}
          >
            {name}
          </span>
        ))}
        {(card.list_names ?? []).slice(0, 2).map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-0.5 text-[10px] text-base-content/50 bg-base-200 px-1.5 py-0.5 rounded truncate max-w-[140px]"
            title={`Lista: ${name}`}
          >
            <RiListCheck size={9} />
            {name}
          </span>
        ))}
      </div>

      {/* Card Footer: Last Activity + Quick Action */}
      <div className="flex items-center justify-between text-[11px] text-base-content/40 pt-2 border-t border-base-200">
        <div className="flex items-center gap-1 truncate" title={card.last_interaction_at ? `Última interacción: ${new Date(card.last_interaction_at).toLocaleString()}` : "Sin interacción reciente"}>
          <RiTimeLine size={12} className="shrink-0" />
          <span className="truncate">
            {card.last_interaction_at ? timeAgo(card.last_interaction_at) : "Sin actividad"}
          </span>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(card);
          }}
          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[11px] text-primary hover:underline transition-opacity"
        >
          <RiChat3Line size={12} />
          Ver
        </button>
      </div>
    </div>
  );
};
