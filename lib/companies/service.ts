import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { CompanyRecord } from "./schema";

export interface ResolveCompanyInput {
  name?: string | null;
  domain?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  industry?: string | null;
  location?: string | null;
  city?: string | null;
  country?: string | null;
  employeeCount?: number | null;
  foundedYear?: number | null;
  annualRevenue?: string | null;
  description?: string | null;
  technologyNames?: string[] | string | null;
  keywords?: string[] | string | null;
  notes?: string | null;
  workspaceOwnerId?: string | null;
}

const COMMON_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
  "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "zoho.com"
]);

export function extractDomain(input?: string | null): string | null {
  if (!input) return null;
  let raw = input.trim().toLowerCase();
  if (raw.includes("@")) {
    raw = raw.split("@").pop()?.trim() || "";
  }
  if (!raw) return null;
  if (COMMON_EMAIL_DOMAINS.has(raw)) return null;

  try {
    if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
      raw = `https://${raw}`;
    }
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./i, "").trim().toLowerCase();
    return host.length > 3 && host.includes(".") ? host : null;
  } catch {
    const cleaned = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].trim().toLowerCase();
    return cleaned.length > 3 && cleaned.includes(".") ? cleaned : null;
  }
}

export function cleanCompanyName(raw?: string | null): string {
  if (!raw) return "";
  let name = raw.trim();
  // Remove wrapping quotes and extra whitespace
  name = name.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim();
  return name;
}

export function resolveOrCreateCompany(
  db: Database.Database,
  input: ResolveCompanyInput
): string | null {
  const cleanName = cleanCompanyName(input.name);
  const domain = extractDomain(input.domain || input.website);

  // If no name and no domain, cannot create or resolve a company
  if (!cleanName && !domain) return null;

  const finalName = cleanName || (domain ? domain.split(".")[0].toUpperCase() : "Empresa");
  const workspaceOwnerId = input.workspaceOwnerId || null;

  // 1. Try matching by domain first (most reliable identifier)
  let existing: { id: string; name: string } | undefined;
  if (domain) {
    if (workspaceOwnerId) {
      existing = db.prepare(`
        SELECT id, name FROM companies
        WHERE (workspace_owner_id = ? OR workspace_owner_id IS NULL)
          AND lower(domain) = lower(?)
        ORDER BY (workspace_owner_id = ?) DESC
        LIMIT 1
      `).get(workspaceOwnerId, domain, workspaceOwnerId) as { id: string; name: string } | undefined;
    } else {
      existing = db.prepare(`
        SELECT id, name FROM companies
        WHERE lower(domain) = lower(?)
        LIMIT 1
      `).get(domain) as { id: string; name: string } | undefined;
    }
  }

  // 2. If not matched by domain, match by normalized company name
  if (!existing && cleanName) {
    if (workspaceOwnerId) {
      existing = db.prepare(`
        SELECT id, name FROM companies
        WHERE (workspace_owner_id = ? OR workspace_owner_id IS NULL)
          AND lower(name) = lower(?)
        ORDER BY (workspace_owner_id = ?) DESC
        LIMIT 1
      `).get(workspaceOwnerId, cleanName, workspaceOwnerId) as { id: string; name: string } | undefined;
    } else {
      existing = db.prepare(`
        SELECT id, name FROM companies
        WHERE lower(name) = lower(?)
        LIMIT 1
      `).get(cleanName) as { id: string; name: string } | undefined;
    }
  }

  // 3. If found, enrich empty fields
  if (existing) {
    const techNames = Array.isArray(input.technologyNames)
      ? JSON.stringify(input.technologyNames)
      : input.technologyNames || null;
    const kw = Array.isArray(input.keywords)
      ? JSON.stringify(input.keywords)
      : input.keywords || null;

    db.prepare(`
      UPDATE companies SET
        workspace_owner_id = COALESCE(workspace_owner_id, ?),
        domain = COALESCE(domain, ?),
        website = COALESCE(website, ?),
        linkedin_url = COALESCE(linkedin_url, ?),
        industry = COALESCE(industry, ?),
        location = COALESCE(location, ?),
        city = COALESCE(city, ?),
        country = COALESCE(country, ?),
        employee_count = COALESCE(employee_count, ?),
        founded_year = COALESCE(founded_year, ?),
        annual_revenue = COALESCE(annual_revenue, ?),
        description = COALESCE(description, ?),
        technology_names = COALESCE(technology_names, ?),
        keywords = COALESCE(keywords, ?),
        notes = COALESCE(notes, ?),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      workspaceOwnerId,
      domain || null,
      input.website || null,
      input.linkedinUrl || null,
      input.industry || null,
      input.location || null,
      input.city || null,
      input.country || null,
      input.employeeCount ?? null,
      input.foundedYear ?? null,
      input.annualRevenue || null,
      input.description || null,
      techNames,
      kw,
      input.notes || null,
      existing.id
    );
    return existing.id;
  }

  // 4. Create brand new company
  const companyId = randomUUID();
  const techNames = Array.isArray(input.technologyNames)
    ? JSON.stringify(input.technologyNames)
    : input.technologyNames || null;
  const kw = Array.isArray(input.keywords)
    ? JSON.stringify(input.keywords)
    : input.keywords || null;

  db.prepare(`
    INSERT INTO companies (
      id, workspace_owner_id, name, domain, industry, location, city, country,
      linkedin_url, website, description, employee_count, founded_year,
      annual_revenue, phone, technology_names, keywords, notes, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, datetime('now'), datetime('now')
    )
  `).run(
    companyId,
    workspaceOwnerId,
    finalName,
    domain || null,
    input.industry || null,
    input.location || null,
    input.city || null,
    input.country || null,
    input.linkedinUrl || null,
    input.website || (domain ? `https://${domain}` : null),
    input.description || null,
    input.employeeCount ?? null,
    input.foundedYear ?? null,
    input.annualRevenue || null,
    null,
    techNames,
    kw,
    input.notes || null
  );

  return companyId;
}

export function linkTargetToCompany(
  db: Database.Database,
  targetId: string,
  companyId: string,
  companyName?: string | null
): void {
  if (companyName) {
    db.prepare(`
      UPDATE targets
      SET company_id = ?, company = COALESCE(NULLIF(company, ''), ?)
      WHERE id = ?
    `).run(companyId, companyName, targetId);
  } else {
    db.prepare(`
      UPDATE targets
      SET company_id = ?
      WHERE id = ?
    `).run(companyId, targetId);
  }
}

export function backfillUnlinkedTargets(
  db: Database.Database,
  workspaceOwnerId?: string | null
): { totalFound: number; linkedCount: number; createdCompanies: number } {
  // Find all targets with company text or corporate email but no company_id
  const rows = db.prepare(`
    SELECT id, company, email, location
    FROM targets
    WHERE (
      (company IS NOT NULL AND trim(company) != '')
      OR (email IS NOT NULL AND email LIKE '%@%' AND email NOT LIKE '%@gmail.com' AND email NOT LIKE '%@hotmail.com' AND email NOT LIKE '%@yahoo.com' AND email NOT LIKE '%@outlook.com')
    )
    AND (
      company_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM companies WHERE id = targets.company_id)
    )
  `).all() as Array<{ id: string; company: string | null; email: string | null; location: string | null }>;

  let linkedCount = 0;
  const initialCompanyCount = (db.prepare("SELECT COUNT(*) as c FROM companies").get() as { c: number }).c;

  db.transaction(() => {
    for (const target of rows) {
      const emailDomain = extractDomain(target.email);
      const companyId = resolveOrCreateCompany(db, {
        name: target.company,
        domain: emailDomain,
        location: target.location,
        workspaceOwnerId,
      });

      if (companyId) {
        linkTargetToCompany(db, target.id, companyId, target.company);
        linkedCount++;
      }
    }
  })();

  const finalCompanyCount = (db.prepare("SELECT COUNT(*) as c FROM companies").get() as { c: number }).c;
  return {
    totalFound: rows.length,
    linkedCount,
    createdCompanies: Math.max(0, finalCompanyCount - initialCompanyCount),
  };
}

export function getCompanyWithContext(
  db: Database.Database,
  companyId: string,
  workspaceOwnerId?: string | null
): {
  company: CompanyRecord;
  contacts: Array<{
    id: string;
    full_name: string | null;
    title: string | null;
    email: string | null;
    email_status: string | null;
    seniority: string | null;
    linkedin_url: string | null;
    degree: number | null;
    connected_at: string | null;
    stage_id: string | null;
    stage_name: string | null;
  }>;
} | null {
  let companyQuery = "SELECT * FROM companies WHERE id = ?";
  const params: unknown[] = [companyId];

  if (workspaceOwnerId) {
    companyQuery += " AND (workspace_owner_id = ? OR workspace_owner_id IS NULL)";
    params.push(workspaceOwnerId);
  }

  const company = db.prepare(companyQuery).get(...params) as CompanyRecord | undefined;
  if (!company) return null;

  const contacts = db.prepare(`
    SELECT t.id, t.full_name, t.title, t.email, t.email_status, t.seniority,
           t.linkedin_url, t.degree, t.connected_at,
           ps.id as stage_id, ps.name as stage_name
    FROM targets t
    LEFT JOIN pipeline_stages ps ON ps.id = t.stage_id
    WHERE t.company_id = ?
    ORDER BY t.full_name COLLATE NOCASE
  `).all(companyId) as Array<{
    id: string;
    full_name: string | null;
    title: string | null;
    email: string | null;
    email_status: string | null;
    seniority: string | null;
    linkedin_url: string | null;
    degree: number | null;
    connected_at: string | null;
    stage_id: string | null;
    stage_name: string | null;
  }>;

  return { company, contacts };
}
