import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor, canManageSdrAgent } from "@/lib/authz";
import { ensureSdrAgent } from "@/lib/sdr-agent/seed";
import {
  approveKnowledgeSource,
  createKnowledgeDraft,
  listKnowledgeSources,
  retireKnowledgeSource,
} from "@/lib/sdr-agent/knowledge/repository";

interface KnowledgeBody {
  id?: unknown;
  title?: unknown;
  source_type?: unknown;
  content?: unknown;
  action?: unknown;
}

const SOURCE_TYPES = new Set(["text", "file", "url", "catalog", "policy"]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;
  const db = getDb();
  const { agent } = ensureSdrAgent(db, actor.workspaceOwnerId);
  if (!canManageSdrAgent(db, actor, agent.id)) {
    return res.status(403).json({ error: "No autorizado para gestionar la base de conocimiento" });
  }

  if (req.method === "GET") {
    const sources = listKnowledgeSources(db, agent.id, actor.workspaceOwnerId).map((source) => ({
      ...source,
      content: source.content ?? "",
    }));
    return res.status(200).json({ sources });
  }

  const body = (req.body ?? {}) as KnowledgeBody;
  try {
    if (req.method === "POST") {
      if (body.action === "approve") {
        if (typeof body.id !== "string") return res.status(400).json({ error: "id is required" });
        const source = approveKnowledgeSource(db, body.id, actor.workspaceOwnerId, actor.id);
        return res.status(200).json({ ok: true, source: { ...source, content: source.content ?? "" } });
      }
      if (typeof body.title !== "string" || typeof body.content !== "string") {
        return res.status(400).json({ error: "Título y contenido son obligatorios" });
      }
      const sourceType = typeof body.source_type === "string" && SOURCE_TYPES.has(body.source_type)
        ? body.source_type as "text" | "file" | "url" | "catalog" | "policy"
        : "text";
      const source = createKnowledgeDraft(db, {
        agentId: agent.id,
        workspaceOwnerId: actor.workspaceOwnerId,
        title: body.title,
        sourceType,
        content: body.content,
      });

      // Si el frontend solicita 'approved' o se crea directamente por el usuario autorizado, aprobar e indexar de inmediato
      const shouldApprove = (body as { status?: unknown }).status === "approved" || !(body as { status?: unknown }).status;
      const finalSource = shouldApprove
        ? approveKnowledgeSource(db, source.id, actor.workspaceOwnerId, actor.id)
        : source;

      return res.status(201).json({ ok: true, id: finalSource.id, status: finalSource.status });
    }

    if (req.method === "DELETE") {
      const id = typeof req.query.id === "string" ? req.query.id : "";
      if (!id) return res.status(400).json({ error: "ID inválido" });
      const retired = retireKnowledgeSource(db, id, actor.workspaceOwnerId);
      if (!retired) return res.status(404).json({ error: "Knowledge source not found" });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Knowledge operation failed" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "300kb" } } };
