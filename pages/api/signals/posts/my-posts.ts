import type { NextApiRequest, NextApiResponse } from "next";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import { unipile } from "@/lib/unipile/client";
import type { UnipilePostItem } from "@/lib/unipile/types";

export interface MyPostDiscoveredItem {
  id: string;
  shareUrl: string;
  text: string;
  date: string | null;
  reactionCount: number;
  commentCount: number;
  author: {
    name: string;
    publicIdentifier?: string;
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const actor = requireApiActor(req, res);
  if (!actor) return;

  const rawAccountId = req.method === "POST" ? req.body?.account_id : req.query?.account_id;
  const accountId = typeof rawAccountId === "string" ? rawAccountId.trim() : "";
  if (!accountId) {
    return res.status(400).json({ error: "account_id es requerido para obtener tus publicaciones" });
  }

  const db = getDb();
  if (!canAccessLinkedInAccount(db, actor, accountId)) {
    return res.status(404).json({ error: "Cuenta no encontrada o no autorizada" });
  }

  try {
    if (!unipile.isConfigured()) {
      return res.status(502).json({ error: "El motor de LinkedIn no está configurado" });
    }

    const resolved = await resolveUnipileAccount(db, accountId, unipile);
    const fullAcc = await unipile.getAccount(resolved.unipileAccountId).catch(() => null);
    const imParams = (fullAcc?.connection_params as any)?.im || (resolved.account?.connection_params as any)?.im;
    const internalId = imParams?.id;
    const publicIdentifier = imParams?.publicIdentifier || resolved.account?.name;

    const targetIdentifier = internalId || publicIdentifier || "me";

    const rawPosts = await unipile.getUserPosts({
      account_id: resolved.unipileAccountId,
      identifier: targetIdentifier,
      limit: 20,
    });

    const posts: MyPostDiscoveredItem[] = (rawPosts || []).map((p: UnipilePostItem) => {
      const urn = p.social_id || p.id || "";
      const digits = String(urn).match(/([0-9]{10,25})/)?.[1] || "";
      const shareUrl = digits
        ? `https://www.linkedin.com/feed/update/urn:li:activity:${digits}/`
        : (p.share_url || "");

      return {
        id: String(p.id || digits),
        shareUrl,
        text: p.text || p.content || "",
        date: p.date || p.created_at || null,
        reactionCount: Number(p.reaction_counter) || 0,
        commentCount: Number(p.comment_counter) || 0,
        author: {
          name: (p.author as any)?.name || resolved.account?.name || "Tú",
          publicIdentifier: (p.author as any)?.public_identifier || publicIdentifier,
        },
      };
    });

    return res.status(200).json({
      account: {
        name: resolved.account?.name || "Tu perfil",
        publicIdentifier,
      },
      posts,
    });
  } catch (error) {
    console.error("[api/signals/posts/my-posts] Error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error al obtener tus publicaciones de LinkedIn",
    });
  }
}
