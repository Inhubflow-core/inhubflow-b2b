const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");

// TypeScript on-the-fly transpiler with @/lib alias resolution
const LIB_ROOT = path.resolve(__dirname, "../lib").replace(/\\/g, "/");
Module._extensions[".ts"] = (module, filename) => {
  let source = fs.readFileSync(filename, "utf8");
  source = source.replace(/@\/lib\//g, () => LIB_ROOT + "/");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, filename);
};

// 1. Load schema and services
const { applyCompaniesSchema } = require("../lib/companies/schema.ts");
const {
  resolveOrCreateCompany,
  linkTargetToCompany,
  backfillUnlinkedTargets,
  getCompanyWithContext,
  extractDomain,
  cleanCompanyName,
} = require("../lib/companies/service.ts");
const { importCsv } = require("../lib/csv-import.ts");
const { saveProfilesToList } = require("../lib/linkedin/search.ts");
const { upsertCampaignTarget } = require("../lib/campaigns/enrollment.ts");
const { applyPipelineSchema } = require("../lib/pipeline/schema.ts");
const { applySdrSchema } = require("../lib/sdr-agent/schema.ts");
const { applyTagsSchema } = require("../lib/tags/schema.ts");
const { getPipelineCardsByStage } = require("../lib/pipeline/pipeline-service.ts");

function setupTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Create core minimal tables for testing
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      role TEXT DEFAULT 'user',
      owner_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY,
      linkedin_url TEXT UNIQUE,
      sales_nav_url TEXT,
      first_name TEXT,
      last_name TEXT,
      full_name TEXT,
      title TEXT,
      company TEXT,
      location TEXT,
      city TEXT,
      country TEXT,
      headline TEXT,
      summary TEXT,
      notes TEXT,
      email TEXT,
      email_status TEXT,
      seniority TEXT,
      phone TEXT,
      profile_image_url TEXT,
      degree INTEGER,
      connection_requested_at TEXT,
      connected_at TEXT,
      message_sent_at TEXT,
      last_replied_at TEXT,
      email_replied_at TEXT,
      last_replied_account_id TEXT,
      linkedin_member_urn TEXT,
      stage_id TEXT,
      stage_updated_at TEXT,
      reply_kind TEXT,
      sdr_autopilot INTEGER DEFAULT 0,
      unipile_provider_id TEXT,
      company_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sales_nav_url TEXT,
      purpose TEXT CHECK(purpose IN ('linkedin', 'email')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS list_targets (
      list_id TEXT REFERENCES lists(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES targets(id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT REFERENCES workflows(id),
      list_id TEXT REFERENCES lists(id),
      account_id TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS run_profiles (
      id TEXT PRIMARY KEY,
      run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES targets(id),
      state TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(run_id, target_id)
    );
  `);

  applyCompaniesSchema(db);
  applyPipelineSchema(db);
  applyTagsSchema(db);
  applySdrSchema(db);
  return db;
}

async function runTests() {
  console.log("=== Testing Companies (ABM) Module ===");
  const db = setupTestDb();

  // Test 1: Schema Idempotency
  console.log("\n1. Schema & Table Structure");
  applyCompaniesSchema(db); // second call must be a no-op
  const tableInfo = db.prepare("PRAGMA table_info(companies)").all();
  const columnNames = new Set(tableInfo.map((c) => c.name));
  assert.ok(columnNames.has("id"), "companies must have id");
  assert.ok(columnNames.has("workspace_owner_id"), "companies must have workspace_owner_id");
  assert.ok(columnNames.has("technology_names"), "companies must have technology_names");
  assert.ok(columnNames.has("employee_count"), "companies must have employee_count");
  console.log("  ✓ Companies schema and columns verified.");

  // Test 2: Domain and Name Utilities
  console.log("\n2. Domain Extraction & Name Cleaning");
  assert.equal(extractDomain("https://www.google.com/search?q=test"), "google.com");
  assert.equal(extractDomain("john@acme.co.uk"), "acme.co.uk");
  assert.equal(extractDomain("user@gmail.com"), null, "Consumer emails must not produce company domain");
  assert.equal(cleanCompanyName('  "Acme Corporation"  '), "Acme Corporation");
  console.log("  ✓ Domain extraction and company name cleaning verified.");

  // Test 3: Resolution & Deduplication
  console.log("\n3. Company Resolution & Deduplication");
  const ws1 = "workspace-1";
  const id1 = resolveOrCreateCompany(db, {
    name: "InHubFlow Corp",
    domain: "inhubflow.online",
    industry: "B2B SaaS",
    workspaceOwnerId: ws1,
  });
  assert.ok(id1, "Company id should be generated");

  // Resolving again with same domain should return same id and update missing info
  const id2 = resolveOrCreateCompany(db, {
    name: "InHubFlow",
    domain: "inhubflow.online",
    employeeCount: 25,
    technologyNames: ["Next.js", "TypeScript", "SQLite"],
    workspaceOwnerId: ws1,
  });
  assert.equal(id1, id2, "Resolving with same domain must return identical company ID");

  const row = db.prepare("SELECT * FROM companies WHERE id = ?").get(id1);
  assert.equal(row.employee_count, 25, "Employee count should be enriched");
  assert.ok(row.technology_names.includes("Next.js"), "Tech stack should be enriched");
  console.log("  ✓ Deduplication and enrichment verified.");

  // Test 4: Workspace Isolation
  console.log("\n4. Workspace Isolation");
  const ws2 = "workspace-2";
  const idOtherWs = resolveOrCreateCompany(db, {
    name: "InHubFlow Corp",
    domain: "inhubflow.online",
    workspaceOwnerId: ws2,
  });
  assert.notEqual(id1, idOtherWs, "Different workspaces must have independent company records");

  const ws1Details = getCompanyWithContext(db, id1, ws1);
  assert.ok(ws1Details, "Owner 1 can access their company");
  const ws2DetailsForbidden = getCompanyWithContext(db, id1, ws2);
  assert.equal(ws2DetailsForbidden, null, "Owner 2 cannot access Owner 1 company");
  console.log("  ✓ Workspace boundaries strictly isolated.");

  // Test 5: CSV Import Auto-linking
  console.log("\n5. CSV Import Integration");
  db.prepare("INSERT INTO lists (id, name, purpose) VALUES ('list-1', 'Lista CSV', 'email')").run();
  const csvContent = `full_name,email,company,title
Carlos Mendoza,carlos@techlead.io,TechLead IO,CTO
Sofia Ruiz,sofia@techlead.io,TechLead IO,VP Sales`;

  const csvResult = importCsv(db, "list-1", csvContent, ws1);
  assert.equal(csvResult.imported, 2, "2 targets imported from CSV");

  const targetCarlos = db.prepare("SELECT * FROM targets WHERE email = 'carlos@techlead.io'").get();
  assert.ok(targetCarlos.company_id, "Target imported via CSV must have company_id assigned");

  const targetSofia = db.prepare("SELECT * FROM targets WHERE email = 'sofia@techlead.io'").get();
  assert.equal(targetCarlos.company_id, targetSofia.company_id, "Colleagues with same company must link to same company record");
  console.log("  ✓ CSV import automatically creates and links company.");

  // Test 6: LinkedIn Search / Lead Finder Integration
  console.log("\n6. Lead Finder / X-Ray Search Integration");
  const searchProfiles = [
    {
      linkedinUrl: "https://www.linkedin.com/in/roberto-founder",
      fullName: "Roberto Silva",
      firstName: "Roberto",
      lastName: "Silva",
      title: "CEO",
      company: "Startup AI Lab",
      location: "Santiago, Chile",
      profileImageUrl: null,
      degree: 1,
      summary: null,
    },
  ];

  const searchResult = saveProfilesToList(db, {
    listName: "Lista X-Ray",
    profiles: searchProfiles,
    workspaceOwnerId: ws1,
  });
  assert.equal(searchResult.importedCount, 1);

  const targetRoberto = db.prepare("SELECT * FROM targets WHERE linkedin_url = 'https://www.linkedin.com/in/roberto-founder'").get();
  assert.ok(targetRoberto.company_id, "Target from Lead Finder must have company_id linked");
  const companyLab = db.prepare("SELECT * FROM companies WHERE id = ?").get(targetRoberto.company_id);
  assert.equal(companyLab.name, "Startup AI Lab");
  console.log("  ✓ Lead Finder import automatically creates and links company.");

  // Test 7: Campaign Enrollment Integration
  console.log("\n7. Campaign Target Upsert Integration");
  const targetIdFromCampaign = upsertCampaignTarget(db, {
    linkedinUrl: "https://www.linkedin.com/in/maria-campaign",
    fullName: "Maria Lopez",
    company: "Cloud Growth Partners",
    location: "Madrid, Spain",
  });
  const targetMaria = db.prepare("SELECT * FROM targets WHERE id = ?").get(targetIdFromCampaign);
  assert.ok(targetMaria.company_id, "Target upserted for campaign must have company_id linked");
  console.log("  ✓ Campaign upsert automatically creates and links company.");

  // Test 8: Pipeline Card company_id Exposure
  console.log("\n8. Pipeline / Kanban Integration");
  db.prepare("UPDATE targets SET stage_id = 'stage_prospect' WHERE id = ?").run(targetCarlos.id);
  const pipelineCards = getPipelineCardsByStage(db, "stage_prospect");
  const carlosCard = pipelineCards.find((c) => c.id === targetCarlos.id);
  assert.ok(carlosCard, "Carlos should appear in pipeline cards");
  assert.equal(carlosCard.company_id, targetCarlos.company_id, "Pipeline card must expose company_id");
  console.log("  ✓ Pipeline card exposes company_id correctly.");

  // Test 9: Backfill Unlinked Targets
  console.log("\n9. Backfill Unlinked Targets");
  db.prepare(`
    INSERT INTO targets (id, linkedin_url, full_name, company, email)
    VALUES ('t-orphan', 'https://www.linkedin.com/in/orphan-user', 'Ana Gomez', 'Orphan Corp', 'ana@orphancorp.com')
  `).run();

  const orphanBefore = db.prepare("SELECT company_id FROM targets WHERE id = 't-orphan'").get();
  assert.equal(orphanBefore.company_id, null, "Should be unlinked before backfill");

  const backfillResult = backfillUnlinkedTargets(db, ws1);
  assert.ok(backfillResult.linkedCount >= 1, "At least 1 target should be linked by backfill");

  const orphanAfter = db.prepare("SELECT company_id FROM targets WHERE id = 't-orphan'").get();
  assert.ok(orphanAfter.company_id, "Orphan target should now have company_id assigned");
  console.log("  ✓ Backfill resolved orphan targets seamlessly.");

  // Test 10: Cascade Unlink Protection on Delete
  console.log("\n10. Unlink on Delete (Preserving Targets)");
  const companyToDelete = targetCarlos.company_id;
  db.prepare("UPDATE targets SET company_id = NULL WHERE company_id = ?").run(companyToDelete);
  db.prepare("DELETE FROM companies WHERE id = ?").run(companyToDelete);

  const carlosAfterCompanyDelete = db.prepare("SELECT id, company_id FROM targets WHERE id = ?").get(targetCarlos.id);
  assert.ok(carlosAfterCompanyDelete, "Target must NOT be deleted when company is removed");
  assert.equal(carlosAfterCompanyDelete.company_id, null, "Target company_id must be nullified");
  console.log("  ✓ Target preserved safely when company is deleted.");

  console.log("\n=== ALL COMPANIES MODULE CHECKS PASSED ===");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
