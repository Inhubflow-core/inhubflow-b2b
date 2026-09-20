import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { requireApiActor } from "@/lib/authz";
import { getCompanyWithContext } from "@/lib/companies/service";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const actor = await requireApiActor(req, res);
  if (!actor) return;

  const db = getDb();
  const id = req.query.id as string;

  const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as
    | { id: string; workspace_owner_id: string | null }
    | undefined;

  if (!company) return res.status(404).json({ error: "Empresa no encontrada" });

  if (
    !actor.isSuperAdmin &&
    company.workspace_owner_id &&
    company.workspace_owner_id !== actor.workspaceOwnerId
  ) {
    return res.status(404).json({ error: "Empresa no encontrada" });
  }

  if (req.method === "GET") {
    const details = getCompanyWithContext(db, id, actor.isSuperAdmin ? null : actor.workspaceOwnerId);
    if (!details) return res.status(404).json({ error: "Empresa no encontrada" });
    return res.json({ ...details.company, contacts: details.contacts });
  }

  if (req.method === "PUT") {
    const {
      name, domain, industry, location, city, country,
      linkedin_url, website, notes, employee_count, founded_year,
      annual_revenue, description, technology_names, keywords
    } = req.body;

    const techNames = Array.isArray(technology_names)
      ? JSON.stringify(technology_names)
      : (typeof technology_names === "string" ? technology_names : null);
    const kw = Array.isArray(keywords)
      ? JSON.stringify(keywords)
      : (typeof keywords === "string" ? keywords : null);

    db.prepare(`
      UPDATE companies SET
        name = COALESCE(?, name),
        domain = ?,
        industry = ?,
        location = ?,
        city = ?,
        country = ?,
        linkedin_url = ?,
        website = ?,
        notes = ?,
        employee_count = ?,
        founded_year = ?,
        annual_revenue = ?,
        description = ?,
        technology_names = COALESCE(?, technology_names),
        keywords = COALESCE(?, keywords),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name ?? null,
      domain ?? null,
      industry ?? null,
      location ?? null,
      city ?? null,
      country ?? null,
      linkedin_url ?? null,
      website ?? null,
      notes ?? null,
      employee_count ?? null,
      founded_year ?? null,
      annual_revenue ?? null,
      description ?? null,
      techNames,
      kw,
      id
    );

    return res.json(db.prepare("SELECT * FROM companies WHERE id = ?").get(id));
  }

  if (req.method === "DELETE") {
    // Unlink contacts first, preserving them
    db.prepare("UPDATE targets SET company_id = NULL WHERE company_id = ?").run(id);
    db.prepare("DELETE FROM companies WHERE id = ?").run(id);
    return res.json({ ok: true });
  }

  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  res.status(405).end();
}
