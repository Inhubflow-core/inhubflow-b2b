import { z } from "zod";

export const SdrIntentSchema = z.enum([
  "interested",
  "product_question",
  "pricing_question",
  "integration_question",
  "security_question",
  "objection",
  "proposal_request",
  "meeting_request",
  "not_interested",
  "unsubscribe",
  "human_requested",
  "referral",
  "ooo",
  "ambiguous",
  "hostile_or_legal",
]);
export type SdrIntent = z.infer<typeof SdrIntentSchema>;

export const SdrActionTypeSchema = z.enum([
  "answer",
  "ask_clarification",
  "offer_slots",
  "create_proposal",
  "stop_outreach",
  "handoff",
  "no_action",
]);
export type SdrActionType = z.infer<typeof SdrActionTypeSchema>;

export const SdrKnowledgeStatusSchema = z.enum(["grounded", "partial", "missing"]);
export type SdrKnowledgeStatus = z.infer<typeof SdrKnowledgeStatusSchema>;

export const SdrDecisionOutputSchema = z.object({
  intent: SdrIntentSchema,
  confidence: z.number().min(0).max(1),
  risk_level: z.enum(["low", "medium", "high"]),
  language: z.enum(["es", "en", "pt-BR"]),
  reasoning_summary: z.string().min(1).max(1_000),
  recommended_action: SdrActionTypeSchema,
  requires_human: z.boolean(),
  reason_code: z.string().min(1).max(120).nullable().optional(),
  reply_draft: z.string().max(5_000).nullable().optional(),
  knowledge_status: SdrKnowledgeStatusSchema,
  knowledge_citations: z.array(z.string().min(1).max(200)).max(20).default([]),
  missing_information: z.array(z.string().min(1).max(500)).max(20).default([]),
  tags: z.array(z.string().min(1).max(60)).max(10).optional(),
  tag_reasoning: z.string().max(500).nullable().optional(),
});
export type SdrDecisionOutput = z.infer<typeof SdrDecisionOutputSchema>;

export interface SdrConversationMessage {
  direction: "inbound" | "outbound" | "system";
  body: string;
  sentAt?: string;
}

export interface SdrKnowledgeChunk {
  id: string;
  sourceId: string;
  sourceTitle: string;
  revision: number;
  content: string;
}

export interface SdrClassificationInput {
  inboundMessage: string;
  senderName?: string | null;
  conversationHistory?: SdrConversationMessage[];
  systemPrompt: string;
  companyContext?: string;
  customInstructions?: string;
  handoffRules?: string;
  knowledgeChunks: SdrKnowledgeChunk[];
}

export interface SdrProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface SdrProviderResult {
  provider: string;
  model: string;
  decision: SdrDecisionOutput;
  usage: SdrProviderUsage;
  responseId?: string | null;
}

export type SdrProviderErrorCode =
  | "missing_credentials"
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "refused"
  | "invalid_response"
  | "unknown";

export class SdrProviderError extends Error {
  constructor(
    message: string,
    readonly code: SdrProviderErrorCode,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SdrProviderError";
  }
}

export interface SdrProvider {
  readonly providerName: string;
  readonly modelName: string;
  classifyAndDraft(input: SdrClassificationInput): Promise<SdrProviderResult>;
}

export function unavailableDecision(reasonCode: string): SdrDecisionOutput {
  return {
    intent: "ambiguous",
    confidence: 0,
    risk_level: "high",
    language: "es",
    reasoning_summary: "El proveedor no produjo una decisión segura.",
    recommended_action: "handoff",
    requires_human: true,
    reason_code: reasonCode,
    reply_draft: null,
    knowledge_status: "missing",
    knowledge_citations: [],
    missing_information: ["Se requiere revisión humana."],
  };
}
