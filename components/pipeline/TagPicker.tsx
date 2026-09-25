import React from "react";
import { RiAddLine, RiCloseLine, RiRobot3Line, RiPriceTag3Line } from "react-icons/ri";
import { useTranslation } from "@/lib/i18n/LanguageContext";

export interface TagOption {
  id: string;
  slug: string;
  name: string;
  color: string;
  kind: string;
  stage_id: string | null;
}

export interface AppliedTag {
  slug: string;
  name: string;
  color: string;
  source: string;
}

interface TagPickerProps {
  available: TagOption[];
  applied: AppliedTag[];
  onAdd: (slug: string) => void | Promise<void>;
  onRemove: (slug: string) => void | Promise<void>;
  busy?: boolean;
}

export const TagPicker: React.FC<TagPickerProps> = ({
  available,
  applied,
  onAdd,
  onRemove,
  busy,
}) => {
  const { t } = useTranslation();
  const appliedSlugs = new Set(applied.map((t) => t.slug));
  const pending = available.filter((t) => !appliedSlugs.has(t.slug));

  return (
    <div className="space-y-2.5">
      {applied.length === 0 ? (
        <p className="text-xs text-base-content/50">
          {t("pipeline.tagsHint")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {applied.map((tag) => (
            <span
              key={tag.slug}
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border"
              style={{
                borderColor: `${tag.color}55`,
                backgroundColor: `${tag.color}1a`,
                color: tag.color,
              }}
            >
              {tag.source === "ai" ? (
                <RiRobot3Line size={11} title={t("pipeline.tagAiTooltip")} />
              ) : (
                <RiPriceTag3Line size={11} />
              )}
              {tag.name}
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(tag.slug)}
                className="opacity-60 hover:opacity-100 disabled:opacity-30 transition-opacity"
                title={t("pipeline.removeTag")}
              >
                <RiCloseLine size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-primary hover:underline flex items-center gap-1 list-none">
            <RiAddLine size={13} />
            {t("pipeline.addTag")}
          </summary>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {pending.map((tag) => (
              <button
                key={tag.id}
                type="button"
                disabled={busy}
                onClick={() => onAdd(tag.slug)}
                title={tag.stage_id ? "Moverá el lead a la etapa asociada" : "Etiqueta informativa"}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-base-300 hover:border-primary/60 text-base-content/70 hover:text-primary transition-colors disabled:opacity-40"
                style={{ backgroundColor: `${tag.color}12` }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};
