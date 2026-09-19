import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import {
  canAccessEmailAccount,
  canAccessLinkedInAccount,
  canAccessSdrThread,
  requireApiActor,
  sdrThreadMatchesTarget,
  targetBelongsToEmailAccount,
  targetBelongsToLinkedInAccount,
} from "@/lib/authz";
import { simulateSdrDecision } from "@/lib/sdr-agent/simulation";
import type { SdrConversationMessage } from "@/lib/sdr-agent/providers/provider";

function parseHistory(value: unknown): SdrConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-20).flatMap((item): SdrConversationMessage[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (!["inbound", "outbound", "system"].includes(String(row.direction)) || typeof row.body !== "string") return [];
    return [{
      direction: row.direction as SdrConversationMessage["direction"],
      body: row.body.slice(0, 5_000),
      sentAt: typeof row.sentAt === "string" ? row.sentAt : undefined,
    }];
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const targetId = typeof req.body?.targetId === "string" ? req.body.targetId : "";
  const threadId = typeof req.body?.threadId === "string" ? req.body.threadId : null;
  const accountId = typeof req.body?.accountId === "string" ? req.body.accountId : null;
  const emailAccountId = typeof req.body?.emailAccountId === "string" ? req.body.emailAccountId : null;
  const message = typeof req.body?.lastMessage === "string" ? req.body.lastMessage : "";
  if (!targetId || !message.trim() || message.length > 20_000) {
    return res.status(400).json({ error: "targetId and a message of 1-20000 characters are required" });
  }
  if (!threadId && !accountId && !emailAccountId) {
    return res.status(400).json({ error: "Conversation or account context is required" });
  }

  const db = getDb();
  const contextAuthorized = Boolean(
    (threadId && canAccessSdrThread(db, actor, threadId) && sdrThreadMatchesTarget(db, threadId, targetId))
    || (accountId && canAccessLinkedInAccount(db, actor, accountId)
      && targetBelongsToLinkedInAccount(db, targetId, accountId))
    || (emailAccountId && canAccessEmailAccount(db, actor, emailAccountId)
      && targetBelongsToEmailAccount(db, targetId, emailAccountId)),
  );
  if (!contextAuthorized) return res.status(404).json({ error: "Conversation not found" });
  const target = db.prepare(
    "SELECT id, full_name FROM targets WHERE id = ?",
  ).get(targetId) as { id: string; full_name: string | null } | undefined;
  if (!target) return res.status(404).json({ error: "Target not found" });

  try {
    const result = await simulateSdrDecision(db, {
      workspaceOwnerId: actor.workspaceOwnerId,
      message: message.trim(),
      senderName: target.full_name,
      history: parseHistory(req.body?.history),
      useLiveProvider: true,
    });

    let finalReply = result.decision.reply_draft;
    if (!finalReply) {
      const firstName = target.full_name?.split(" ")[0]?.trim() || "";
      const greeting = firstName ? `Hola ${firstName}, ` : "Hola, ";
      switch (result.decision.intent) {
        case "pricing_question":
          finalReply = `${greeting}con gusto te comparto información sobre nuestros planes y precios. Se adaptan según el volumen y necesidades del equipo. ¿Te gustaría coordinar una breve llamada de 10 minutos para revisar opciones?`;
          break;
        case "meeting_request":
          finalReply = `${greeting}¡por supuesto! Me encantaría conversar. ¿Qué día y horario te quedaría más cómodo esta semana para una llamada rápida?`;
          break;
        case "product_question":
        case "interested":
          finalReply = `${greeting}gracias por tu interés. ¿Hay alguna funcionalidad o duda puntual sobre la plataforma que te gustaría profundizar?`;
          break;
        default:
          if (result.decision.requires_human) {
            finalReply = `${greeting}gracias por tu mensaje. Con gusto reviso los detalles con el equipo para darte la mejor respuesta. ¿En qué horario te viene bien conversar brevemente?`;
          }
          break;
      }
    }

    return res.status(200).json({
      ok: true,
      suggestedReply: finalReply,
      intent: result.decision.intent,
      reasoning: result.decision.reasoning_summary,
      requiresHuman: result.decision.requires_human,
      reasonCode: result.decision.reason_code,
      policy: result.policy,
    });
  } catch (error) {
    return res.status(409).json({
      error: error instanceof Error ? error.message : "Unable to generate a grounded suggestion",
    });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "100kb" } } };
