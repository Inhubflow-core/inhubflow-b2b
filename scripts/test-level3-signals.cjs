#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) request = path.join(root, request.slice(2));
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
Module._extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

const { isAuthorEmployeeOrAffiliate, passesIcp } = require("../lib/signals/scanners/scoring.ts");
const { scanRealSignals } = require("../lib/signals/scanners/index.ts");

console.log("▶ Iniciando Suite de Pruebas y Diagnóstico Integral del NIVEL 3...");

// -------------------------------------------------------------
// PRUEBA 1: Anti-Auto-Bombo no debe descartar leads en Nivel 3
// -------------------------------------------------------------
{
  const signals = ["new_in_role", "internal_promotion", "active_poster", "hiring_spree", "company_growth", "profile_viewers"];
  for (const sig of signals) {
    const lead = {
      fullName: "Carlos Gómez",
      linkedinUrl: "https://www.linkedin.com/in/carlos-gomez-ceo",
      headline: "CEO at Fintech Labs",
      company: "Fintech Labs",
      signalType: sig,
      evidence: {
        fingerprint: `fp-${sig}`,
        sourceType: "role_announcement_post",
        snippet: "publicación de Carlos Gómez: Feliz de comenzar una nueva etapa",
        metadata: { postAuthor: "Carlos Gómez", postAuthorCompany: "Fintech Labs" },
      },
    };
    const isSelf = isAuthorEmployeeOrAffiliate(lead);
    assert.equal(isSelf, false, `El decisor en ${sig} no debe considerarse auto-bombo`);
    const passed = passesIcp(lead, { titles: ["CEO"], locations: ["Global / Todos"], exclude_author_employees: true });
    assert.equal(passed, true, `Decisor en ${sig} debe pasar passesIcp`);
  }
  console.log("  ✅ [Test 1] Todas las 6 señales de Nivel 3 pasan Anti-Auto-Bombo y passesIcp al 100%");
}

// -------------------------------------------------------------
// PRUEBA 2: Escáner real de 'new_in_role' con fallback resiliente
// -------------------------------------------------------------
async function runScannerTests() {
  const mockClient = {
    async searchLinkedIn(params) {
      if (params.category === "posts") {
        return {
          object: "LinkedinSearch",
          items: [
            {
              type: "POST",
              id: "post-101",
              share_url: "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678",
              text: "Feliz de compartir que he comenzado un nuevo cargo como VP of Sales en SaaSify!",
              parsed_datetime: new Date(Date.now() - 5 * 86_400_000).toISOString(),
              author: {
                id: "auth-1",
                name: "Lucía Fernández",
                public_identifier: "lucia-fernandez-sales",
                headline: "VP of Sales @ SaaSify | B2B Growth",
              },
            },
          ],
        };
      }
      if (params.category === "companies") {
        return {
          object: "LinkedinSearch",
          items: [
            {
              type: "COMPANY",
              id: "comp-99",
              name: "TechInnovate Cloud",
              job_offers_count: 14,
              headcount: 120,
              headcount_growth: 35,
              profile_url: "https://www.linkedin.com/company/techinnovate-cloud",
            },
          ],
        };
      }
      if (params.category === "people") {
        return {
          object: "LinkedinSearch",
          items: [
            {
              type: "PEOPLE",
              id: "person-42",
              name: "Martín Rivas",
              public_identifier: "martin-rivas-ceo",
              headline: "CEO & Co-Founder en TechInnovate Cloud",
              current_positions: [{ company: "TechInnovate Cloud", role: "CEO" }],
              location: "Madrid, España",
            },
          ],
        };
      }
      return { items: [] };
    },
    async resolveProfile(identifier, accountId) {
      return {
        provider_id: "auth-1",
        public_identifier: "lucia-fernandez-sales",
        first_name: "Lucía",
        last_name: "Fernández",
        headline: "VP of Sales @ SaaSify | B2B Growth",
        location: "Santiago, Chile",
        work_experience: [
          { company: "SaaSify", position: "VP of Sales", current: true, start: new Date(Date.now() - 30 * 86_400_000).toISOString() },
          { company: "OldCompany", position: "Director", current: false },
        ],
      };
    },
    async listLinkedInSearchParameters() {
      return { items: [{ id: "loc-123", title: "España" }] };
    },
    async getPostComments() { return { items: [] }; },
    async getPostReactions() { return { items: [] }; },
  };

  // 2.1 new_in_role
  {
    const res = await scanRealSignals(mockClient, {
      monitor: { id: "mon-1", type: "new_in_role" },
      keywords: [],
      icp: { titles: ["VP of Sales"], locations: ["Global / Todos"] },
      limit: 10,
      remoteAccountId: "acc-1",
      hasSalesNavigator: false,
    });
    assert.equal(res.leads.length, 1);
    assert.equal(res.leads[0].fullName, "Lucía Fernández");
    assert.equal(res.leads[0].company, "SaaSify");
    assert.equal(res.leads[0].signalType, "new_in_role");
    console.log("  ✅ [Test 2] scanRoleChanges (new_in_role) descubrió al decisor correctamente:", res.leads[0].fullName);
  }

  // 2.2 hiring_spree (Cero keywords con fallback inteligente a cargos o sectores B2B)
  {
    const res = await scanRealSignals(mockClient, {
      monitor: { id: "mon-2", type: "hiring_spree" },
      keywords: [],
      icp: { titles: ["CEO"], locations: ["Madrid, España"], industries: [] },
      limit: 10,
      remoteAccountId: "acc-1",
      hasSalesNavigator: false,
    });
    assert.equal(res.leads.length, 1);
    assert.equal(res.leads[0].fullName, "Martín Rivas");
    assert.equal(res.leads[0].company, "TechInnovate Cloud");
    assert.equal(res.leads[0].signalType, "hiring_spree");
    assert.equal(res.leads[0].evidence.metadata.companyId, "comp-99");
    console.log("  ✅ [Test 3] scanCompanies (hiring_spree) descubrió empresa y decisor:", res.leads[0].fullName, `(${res.leads[0].company})`);
  }

  // 2.3 company_growth (Requiere Sales Nav)
  {
    const res = await scanRealSignals(mockClient, {
      monitor: { id: "mon-3", type: "company_growth" },
      keywords: [],
      icp: { titles: ["CEO"], locations: [] },
      limit: 10,
      remoteAccountId: "acc-1",
      hasSalesNavigator: true,
    });
    assert.equal(res.leads.length, 1);
    assert.equal(res.leads[0].signalType, "company_growth");
    console.log("  ✅ [Test 4] scanCompanies (company_growth con Sales Nav) descubrió decisor:", res.leads[0].fullName);
  }

  // 2.4 Multi-disparador de Nivel 3 (ej: new_in_role + hiring_spree)
  {
    const res = await scanRealSignals(mockClient, {
      monitor: { id: "mon-4", type: "new_in_role" },
      keywords: [],
      icp: {
        titles: ["CEO", "VP of Sales"],
        event_kinds: ["new_in_role", "hiring_spree"],
        active_levels: ["icp_triggers"],
      },
      limit: 10,
      remoteAccountId: "acc-1",
      hasSalesNavigator: false,
    });
    assert.equal(res.leads.length, 2, "Debe descubrir 2 leads de distintas señales de Nivel 3");
    console.log("  ✅ [Test 5] Multi-disparador Nivel 3 (new_in_role + hiring_spree) combinó exitosamente:", res.leads.map(l => `${l.fullName} [${l.signalType}]`).join(", "));
  }

  // 2.5 Resiliencia ante falla de resolveProfile
  {
    const clientWithFailingProfile = {
      ...mockClient,
      async resolveProfile() {
        throw new Error("Unipile 429 Rate Limit");
      },
    };
    const res = await scanRealSignals(clientWithFailingProfile, {
      monitor: { id: "mon-5", type: "new_in_role" },
      keywords: [],
      icp: { titles: ["VP of Sales"], locations: ["Global / Todos"] },
      limit: 10,
      remoteAccountId: "acc-1",
      hasSalesNavigator: false,
    });
    assert.equal(res.leads.length, 1, "Debe rescatar el lead usando post.author y extracción de empresa desde headline");
    assert.equal(res.leads[0].fullName, "Lucía Fernández");
    assert.equal(res.leads[0].company, "SaaSify");
    console.log("  ✅ [Test 6] Fallback de perfil ante rate limit rescató exitosamente al decisor:", res.leads[0].fullName, `(${res.leads[0].company})`);
  }

  console.log("🏁 Todas las pruebas de diagnóstico y escaneo del NIVEL 3 pasaron al 100%.");
}

runScannerTests().catch((err) => {
  console.error("❌ Error en pruebas de Nivel 3:", err);
  process.exit(1);
});
