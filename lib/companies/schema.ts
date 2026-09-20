import type Database from "better-sqlite3";

export interface CompanyRecord {
  id: string;
  workspace_owner_id: string | null;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  linkedin_url: string | null;
  website: string | null;
  description: string | null;
  employee_count: number | null;
  founded_year: number | null;
  annual_revenue: string | null;
  phone: string | null;
  technology_names: string | null;
  keywords: string | null;
  notes: string | null;
  email_domain_invalid: number;
  created_at: string;
  updated_at: string;
}

function tableColumns(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((col) => col.name)
  );
}

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  );
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  if (!hasTable(db, table) || tableColumns(db, table).has(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function applyCompaniesSchema(db: Database.Database): void {
  db.transaction(() => {
    // 1. Create companies table if it doesn't exist yet
    db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        workspace_owner_id TEXT,
        name TEXT NOT NULL,
        domain TEXT,
        industry TEXT,
        location TEXT,
        city TEXT,
        country TEXT,
        linkedin_url TEXT,
        website TEXT,
        description TEXT,
        employee_count INTEGER,
        founded_year INTEGER,
        annual_revenue TEXT,
        phone TEXT,
        technology_names TEXT,
        keywords TEXT,
        notes TEXT,
        email_domain_invalid INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // 2. Ensure additive columns exist on older tables
    ensureColumn(db, "companies", "workspace_owner_id", "TEXT");
    ensureColumn(db, "companies", "city", "TEXT");
    ensureColumn(db, "companies", "country", "TEXT");
    ensureColumn(db, "companies", "description", "TEXT");
    ensureColumn(db, "companies", "employee_count", "INTEGER");
    ensureColumn(db, "companies", "founded_year", "INTEGER");
    ensureColumn(db, "companies", "annual_revenue", "TEXT");
    ensureColumn(db, "companies", "phone", "TEXT");
    ensureColumn(db, "companies", "technology_names", "TEXT");
    ensureColumn(db, "companies", "keywords", "TEXT");
    ensureColumn(db, "companies", "email_domain_invalid", "INTEGER DEFAULT 0");
    ensureColumn(db, "companies", "updated_at", "TEXT DEFAULT (datetime('now'))");

    // Ensure company_id exists on targets
    ensureColumn(db, "targets", "company_id", "TEXT REFERENCES companies(id) ON DELETE SET NULL");

    // 3. Indexes for high performance and isolation
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_companies_workspace ON companies(workspace_owner_id, name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(workspace_owner_id, domain);
      CREATE INDEX IF NOT EXISTS idx_targets_company_id ON targets(company_id);
    `);

    // 4. Backfill workspace_owner_id for any orphan companies
    try {
      const defaultOwner = (db.prepare(`
        SELECT id FROM users WHERE role = 'admin' OR owner_id IS NULL ORDER BY created_at ASC LIMIT 1
      `).get() as { id: string } | undefined)?.id;

      if (defaultOwner) {
        db.prepare(`
          UPDATE companies
          SET workspace_owner_id = COALESCE(
            workspace_owner_id,
            (
              SELECT a.owner_id
              FROM targets t
              JOIN run_profiles rp ON rp.target_id = t.id
              JOIN runs r ON r.id = rp.run_id
              JOIN accounts a ON a.id = r.account_id
              WHERE t.company_id = companies.id AND a.owner_id IS NOT NULL
              LIMIT 1
            ),
            ?
          )
          WHERE workspace_owner_id IS NULL
        `).run(defaultOwner);
      }
    } catch {
      // Ignore if users table or accounts relations not yet initialized
    }
  })();
}
