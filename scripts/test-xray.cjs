#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");

// Register in-memory TypeScript compiler for testing
Module._extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
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

const {
  XRaySearchError,
  resolveSubdomain,
  buildXRayQuery,
  normalizeXRayUrl,
  parseXRaySnippet,
  isLeadTitleRelevant,
  searchLinkedInWithSerper,
} = require("../lib/linkedin/xray.ts");

console.log("▶ [Test 1] Resolving national subdomains");
assert.equal(resolveSubdomain("Santiago, Chile").code, "cl");
assert.equal(resolveSubdomain("Chile").name, "Chile");
assert.equal(resolveSubdomain("São Paulo, Brasil").code, "br");
assert.equal(resolveSubdomain("Madrid, España").code, "es");
assert.equal(resolveSubdomain("Bogotá, Colombia").code, "co");
assert.equal(resolveSubdomain("Global").code, "www");
console.log("  ✔ Subdomains resolved correctly");

console.log("▶ [Test 2] Query building - national & global expansion");
const qChile = buildXRayQuery({ title: "CEO", location: "Santiago, Chile" });
assert.equal(
  qChile.query.includes("(site:cl.linkedin.com/in/ OR site:linkedin.com/in/ OR site:www.linkedin.com/in/)"),
  true,
  "Must include national subdomain AND www/global domain to capture all indexed profiles"
);
assert.equal(
  qChile.query.includes("pub/"),
  false,
  "Must NOT include /pub/ since it is deprecated and discarded by the normalizer"
);
assert.equal(qChile.query.includes('"Santiago"'), true);
assert.equal(qChile.query.includes('-intitle:"profiles"'), true);
assert.equal(qChile.query.includes('-inurl:"dir/"'), true);
assert.equal(qChile.subdomain, "cl");
assert.equal(qChile.countryName, "Chile");

const qGlobal = buildXRayQuery({ title: "Founder", location: "" });
assert.equal(
  qGlobal.query.includes("(site:linkedin.com/in/ OR site:www.linkedin.com/in/)"),
  true
);
assert.equal(qGlobal.subdomain, "www");

console.log("▶ [Test 2b] Query building with explicit country & custom city");
const qCustomCity = buildXRayQuery({ title: "Director", country: "Chile", city: "Antofagasta" });
assert.equal(qCustomCity.query.includes("site:cl.linkedin.com/in/"), true);
assert.equal(qCustomCity.query.includes('"Antofagasta"'), true);
assert.equal(qCustomCity.subdomain, "cl");
assert.equal(qCustomCity.countryName, "Chile");
console.log("  ✔ Custom city and country query building validated");
console.log("  ✔ Query structure and boolean clauses validated");

console.log("▶ [Test 3] Synonyms expansion & industry OR groups");
const qCeo = buildXRayQuery({ title: "CEO" });
assert.equal(qCeo.query.includes('"Chief Executive Officer"'), true);
assert.equal(qCeo.query.includes('"Director General"'), true);
assert.equal(qCeo.query.includes('"Gerente General"'), true);

const qMultiComp = buildXRayQuery({ title: "Director", company: "Codelco, BHP" });
assert.equal(qMultiComp.query.includes('("Codelco" OR "BHP")'), true);
console.log("  ✔ Synonyms and multi-company OR groups expanded");

console.log("▶ [Test 4] LinkedIn profile URL normalization");
assert.equal(
  normalizeXRayUrl("https://cl.linkedin.com/in/marko-didyk-123/"),
  "https://www.linkedin.com/in/marko-didyk-123/"
);
assert.equal(
  normalizeXRayUrl("https://www.google.com/url?q=https://www.linkedin.com/in/juan-perez-456/&sa=U"),
  "https://www.linkedin.com/in/juan-perez-456/"
);
assert.equal(normalizeXRayUrl("https://www.linkedin.com/dir/Juan/Perez"), null);
assert.equal(normalizeXRayUrl("https://www.linkedin.com/in"), null);
assert.equal(normalizeXRayUrl("https://google.com/search?q=test"), null);
console.log("  ✔ URL normalization correctly strips redirects and rejects non-profile paths");

console.log("▶ [Test 5] Google Snippet parsing & contact extraction");
const parsed = parseXRaySnippet(
  "Marko Didyk - Director de Minería en Codelco | LinkedIn",
  "Santiago, Chile. Especialista en procesos mineros. Contacto: marko@example.com +56912345678"
);
assert.equal(parsed.fullName, "Marko Didyk");
assert.equal(parsed.firstName, "Marko");
assert.equal(parsed.lastName, "Didyk");
assert.equal(parsed.title, "Director de Minería en Codelco");
assert.equal(parsed.company, "Codelco");
assert.equal(parsed.email, "marko@example.com");
assert.equal(parsed.phone, "+56912345678");
console.log("  ✔ Snippet parsed into clean lead structure with contact details");

console.log("▶ [Test 6] XRaySearchError classification");
const errBlocked = new XRaySearchError("Desafío de verificación detectado", "google_blocked");
assert.equal(errBlocked.name, "XRaySearchError");
assert.equal(errBlocked.code, "google_blocked");
assert.equal(errBlocked instanceof Error, true);

const errBrowser = new XRaySearchError("Chromium no disponible", "browser_unavailable");
assert.equal(errBrowser.code, "browser_unavailable");

const errTimeout = new XRaySearchError("Timeout", "timeout");
assert.equal(errTimeout.code, "timeout");
console.log("  ✔ XRaySearchError correctly instantiated and classified");

console.log("▶ [Test 7] Serper.dev integration validation");
assert.equal(typeof searchLinkedInWithSerper, "function");

// Test that missing key throws expected error
(async () => {
  try {
    await searchLinkedInWithSerper({ title: "CEO" }, undefined, "");
    assert.fail("Should have thrown without key");
  } catch (err) {
    assert.equal(err.name, "XRaySearchError");
    assert.equal(err.code, "provider_error");
    console.log("  ✔ searchLinkedInWithSerper correctly handles missing/invalid API key");
  }

  console.log("▶ [Test 8] Strict Title and Discipline Relevance Filter");
  // Exact discipline match
  assert.equal(
    isLeadTitleRelevant("Director de Marketing en ABC", "Director de Marketing", null, true),
    true,
    "Should accept Director de Marketing"
  );
  assert.equal(
    isLeadTitleRelevant("Directora de Marketing y Growth", "Director de Marketing", null, true),
    true,
    "Should accept Directora de Marketing"
  );
  assert.equal(
    isLeadTitleRelevant("CMO & VP Growth en Startup", "Director de Marketing", null, true),
    true,
    "Should accept CMO & VP Growth for Marketing Director query"
  );
  assert.equal(
    isLeadTitleRelevant("Gerente de Mercadotecnia", "Director de Marketing", null, true),
    true,
    "Should accept Gerente de Mercadotecnia"
  );

  // Exact discipline rejection (the bug user reported!)
  assert.equal(
    isLeadTitleRelevant("Director de Operaciones en Falabella", "Director de Marketing", null, true),
    false,
    "Must REJECT Director de Operaciones when searching for Director de Marketing"
  );
  assert.equal(
    isLeadTitleRelevant("Director de Finanzas en Codelco", "Director de Marketing", null, true),
    false,
    "Must REJECT Director de Finanzas when searching for Director de Marketing"
  );
  assert.equal(
    isLeadTitleRelevant("Director Legal en Corporación", "Director de Marketing", null, true),
    false,
    "Must REJECT Director Legal when searching for Director de Marketing"
  );
  assert.equal(
    isLeadTitleRelevant("Practicante de Marketing", "Director de Marketing", null, true),
    false,
    "Must REJECT Practicante/Intern when searching for Director"
  );

  // Compound X-Ray Query building check
  const qMkt = buildXRayQuery({ title: "Director de Marketing", location: "Chile" });
  assert.equal(qMkt.query.includes('"Director de Marketing"'), true);
  assert.equal(qMkt.query.includes('"Head of Marketing"'), true);
  assert.equal(qMkt.query.includes('"CMO"'), true);
  assert.equal(qMkt.query.includes('"Director" OR "Directora" OR "Director General"'), false);
  console.log("  ✔ Strict title and discipline filtering verified with 100% precision");

  console.log("\n✅ ALL GOOGLE X-RAY & SERPER TESTS PASSED CLEANLY!");
})();
