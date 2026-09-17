import { z } from "zod";
import { SIGNAL_TYPES } from "./schema";

const StringArray = z.array(z.string().trim().min(1).max(120)).max(50).default([]);

export const SignalMonitorCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(SIGNAL_TYPES),
  target_url: z.string().trim().max(10_000).optional().or(z.literal("")),
  competitor_name: z.string().trim().max(200).optional(),
  keywords: StringArray.optional(),
  icp_filters: z.object({
    titles: StringArray.optional(),
    locations: StringArray.optional(),
    company_sizes: StringArray.optional(),
    company: z.string().trim().max(200).optional(),
    industries: StringArray.optional(),
    exclusions: StringArray.optional(),
    time_window_days: z.number().int().min(1).max(365).optional(),
    result_limit: z.number().int().min(1).max(100).optional(),
    source_strategy: z.enum(["linkedin", "web", "hybrid"]).optional(),
    event_kinds: StringArray.optional(),
  }).optional(),
  mode: z.enum(["review", "autopilot"]).default("review"),
  account_id: z.string().uuid().or(z.string().min(1).max(200)),
  target_list_id: z.string().min(1).max(200),
  target_workflow_id: z.string().min(1).max(200).optional().nullable(),
  scan_interval_minutes: z.number().int().min(15).max(10_080).default(360),
  message_config: z.object({
    objective: z.enum(["conversation", "demo", "resource"]).default("conversation"),
    tone: z.enum(["consultive", "professional", "direct"]).default("consultive"),
    custom_template: z.string().trim().max(2_000).optional(),
    language: z.enum(["es", "en", "pt-BR"]).default("es"),
    max_words: z.number().int().min(20).max(180).default(90),
  }).optional(),
}).superRefine((value, ctx) => {
  if (["post_engagement", "competitor_reactions", "high_intent_comments"].includes(value.type) && !value.target_url) {
    ctx.addIssue({ code: "custom", path: ["target_url"], message: "Esta señal requiere al menos una publicación de LinkedIn" });
  }
  if (value.type === "competitor_audience" && !value.competitor_name) {
    ctx.addIssue({ code: "custom", path: ["competitor_name"], message: "Esta señal requiere un competidor o referente" });
  }
  if (["keyword_intent", "active_poster", "hiring_spree", "company_growth"].includes(value.type) && !(value.keywords?.length || value.icp_filters?.titles?.length)) {
    ctx.addIssue({ code: "custom", path: ["keywords"], message: "Añade palabras clave o cargos del ICP" });
  }
  if (value.mode === "autopilot" && !value.target_workflow_id) {
    ctx.addIssue({ code: "custom", path: ["target_workflow_id"], message: "Autopilot requiere un workflow" });
  }
});

export const SignalLeadStatusSchema = z.enum(["pending", "approved", "rejected", "imported", "enrolled", "failed"]);

export const SignalMonitorPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["active", "paused", "completed"]).optional(),
  mode: z.enum(["review", "autopilot"]).optional(),
  target_url: z.string().trim().max(10_000).nullable().optional(),
  competitor_name: z.string().trim().max(200).nullable().optional(),
  keywords: StringArray.optional(),
  keywords_json: z.string().optional(),
  icp_filters: z.object({
    titles: StringArray.optional(),
    locations: StringArray.optional(),
    company_sizes: StringArray.optional(),
    company: z.string().trim().max(200).optional(),
    industries: StringArray.optional(),
    exclusions: StringArray.optional(),
    time_window_days: z.number().int().min(1).max(365).optional(),
    result_limit: z.number().int().min(1).max(100).optional(),
    source_strategy: z.enum(["linkedin", "web", "hybrid"]).optional(),
    event_kinds: StringArray.optional(),
  }).optional(),
  icp_filters_json: z.string().optional(),
  message_config: z.object({
    objective: z.enum(["conversation", "demo", "resource"]).default("conversation"),
    tone: z.enum(["consultive", "professional", "direct"]).default("consultive"),
    custom_template: z.string().trim().max(2_000).optional(),
    language: z.enum(["es", "en", "pt-BR"]).default("es"),
    max_words: z.number().int().min(20).max(180).default(90),
  }).optional(),
  message_config_json: z.string().optional(),
  target_list_id: z.string().min(1).max(200).nullable().optional(),
  target_workflow_id: z.string().min(1).max(200).nullable().optional(),
  account_id: z.string().min(1).max(200).nullable().optional(),
  scan_interval_minutes: z.number().int().min(15).max(10_080).optional(),
  next_scan_at: z.string().datetime().nullable().optional(),
}).strict();

export function validationMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`).join("; ");
}
