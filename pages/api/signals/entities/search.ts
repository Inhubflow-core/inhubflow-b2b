import type { NextApiRequest, NextApiResponse } from "next";
import { canAccessLinkedInAccount, requireApiActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { resolveUnipileAccount } from "@/lib/unipile/account";
import { unipile } from "@/lib/unipile/client";
import type { UnipileSearchCompany, UnipileSearchPerson } from "@/lib/unipile/types";

export interface DiscoveredEntityItem {
  id: string;
  name: string;
  type: "company" | "person";
  is_company: boolean;
  headline: string;
  pictureUrl: string | null;
  publicIdentifier: string | null;
  profileUrl: string | null;
  followers?: number | null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const q = typeof req.query.q === "string" ? req.query.q.trim() : typeof req.body?.q === "string" ? req.body.q.trim() : "";
  const accountId = typeof req.query.account_id === "string" ? req.query.account_id.trim() : typeof req.body?.account_id === "string" ? req.body.account_id.trim() : "";

  if (!q) {
    return res.status(200).json({ items: [] });
  }

  if (!accountId) {
    return res.status(400).json({ error: "account_id es requerido para buscar competidores y creadores" });
  }

  const db = getDb();
  if (!canAccessLinkedInAccount(db, actor, accountId)) {
    return res.status(404).json({ error: "Cuenta de LinkedIn no encontrada o no autorizada" });
  }

  try {
    if (!unipile.isConfigured()) {
      return res.status(502).json({ error: "El motor de LinkedIn no está configurado" });
    }

    const resolved = await resolveUnipileAccount(db, accountId, unipile);

    const [companiesResult, peopleResult] = await Promise.allSettled([
      unipile.searchLinkedIn({
        account_id: resolved.unipileAccountId,
        api: "classic",
        category: "companies",
        keywords: q,
        limit: 8,
      }),
      unipile.searchLinkedIn({
        account_id: resolved.unipileAccountId,
        api: "classic",
        category: "people",
        keywords: q,
        limit: 6,
      }),
    ]);

    const items: DiscoveredEntityItem[] = [];

    // 1. Procesar empresas encontradas
    if (companiesResult.status === "fulfilled" && Array.isArray(companiesResult.value?.items)) {
      for (const raw of companiesResult.value.items) {
        if (!raw || typeof raw !== "object") continue;
        const c = raw as UnipileSearchCompany & { logo?: string; public_identifier?: string };
        if (!c.id || !c.name) continue;

        let headline = c.industry || "";
        if (c.location) {
          headline = headline ? `${headline} • ${c.location}` : c.location;
        }

        items.push({
          id: String(c.id),
          name: c.name.trim(),
          type: "company",
          is_company: true,
          headline: headline || "Página de empresa en LinkedIn",
          pictureUrl: c.logo || null,
          publicIdentifier: c.public_identifier || null,
          profileUrl: c.profile_url || `https://www.linkedin.com/company/${c.id}`,
          followers: c.followers_count ?? null,
        });
      }
    }

    // 2. Procesar personas / creadores encontrados
    if (peopleResult.status === "fulfilled" && Array.isArray(peopleResult.value?.items)) {
      for (const raw of peopleResult.value.items) {
        if (!raw || typeof raw !== "object") continue;
        const p = raw as UnipileSearchPerson & { followers_count?: number };
        if (!p.id || !p.name) continue;

        let headline = p.headline || "";
        if (p.location && !headline.includes(p.location)) {
          headline = headline ? `${headline} • ${p.location}` : p.location;
        }

        items.push({
          id: String(p.id),
          name: p.name.trim(),
          type: "person",
          is_company: false,
          headline: headline || "Perfil profesional en LinkedIn",
          pictureUrl: p.profile_picture_url || null,
          publicIdentifier: p.public_identifier || null,
          profileUrl: p.public_profile_url || p.profile_url || `https://www.linkedin.com/in/${p.public_identifier || p.id}`,
          followers: p.followers_count ?? null,
        });
      }
    }

    // Priorizar coincidencia exacta de nombre al inicio
    const qLower = q.toLowerCase();
    items.sort((a, b) => {
      const aExact = a.name.toLowerCase() === qLower ? 1 : 0;
      const bExact = b.name.toLowerCase() === qLower ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;

      const aStarts = a.name.toLowerCase().startsWith(qLower) ? 1 : 0;
      const bStarts = b.name.toLowerCase().startsWith(qLower) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;

      // Empresas primero para competidores corporativos
      if (a.is_company !== b.is_company) return a.is_company ? -1 : 1;
      return (b.followers || 0) - (a.followers || 0);
    });

    return res.status(200).json({
      success: true,
      items,
      count: items.length,
    });
  } catch (error) {
    console.error("[api/signals/entities/search] Error buscando entidades:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error al buscar entidades en LinkedIn",
    });
  }
}
