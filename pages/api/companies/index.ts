import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import { resolveOrCreateCompany } from "@/lib/companies/service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const db = getDb();

  if (req.method === "GET") {
    const full = req.query.full === "1" || req.query.full === "true";
    const search = (req.query.search as string | undefined)?.trim();
    const explicitPaging = req.query.limit !== undefined || req.query.page !== undefined;
    const hasPaging = explicitPaging || !full;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = (Number(req.query.page) || 0) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!actor.isSuperAdmin) {
      conditions.push("(c.workspace_owner_id = ? OR c.workspace_owner_id IS NULL)");
      params.push(actor.workspaceOwnerId);
    }

    if (search) {
      conditions.push("(c.name LIKE ? OR c.domain LIKE ? OR c.industry LIKE ? OR c.technology_names LIKE ?)");
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const select = full
      ? "c.*"
      : "c.id, c.name, c.domain, c.industry, c.location, c.website, c.employee_count, c.technology_names, c.created_at";

    const total = (db.prepare(`SELECT COUNT(*) as c FROM companies c ${where}`).get(...params) as { c: number }).c;

    const pageClause = hasPaging ? " LIMIT ? OFFSET ?" : "";
    const pageArgs = hasPaging ? [limit, offset] : [];

    const companies = db.prepare(`
      SELECT ${select}, COUNT(t.id) as contact_count
      FROM companies c
      LEFT JOIN targets t ON t.company_id = c.id
      ${where}
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE${pageClause}
    `).all(...params, ...pageArgs);

    return res.json({ companies, total });
  }

  if (req.method === "POST") {
    const { name, domain, industry, location, linkedin_url, website, notes } = req.body;
    if (!name && !domain) {
      return res.status(400).json({ error: "El nombre o dominio de la empresa es obligatorio" });
    }

    const companyId = resolveOrCreateCompany(db, {
      name,
      domain,
      industry,
      location,
      linkedinUrl: linkedin_url,
      website,
      notes,
      workspaceOwnerId: actor.workspaceOwnerId,
    });

    if (!companyId) {
      return res.status(400).json({ error: "No se pudo crear o resolver la empresa" });
    }

    return res.status(201).json(db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId));
  }

  res.setHeader("Allow", ["GET", "POST"]);
  res.status(405).end();
}
