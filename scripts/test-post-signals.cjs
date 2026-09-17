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

const { passesIcp, scoreSignalLead, expandTitleCriteria } = require("../lib/signals/scanners/scoring.ts");

console.log("▶ Verificando expansión semántica de cargos");
{
  const expanded = expandTitleCriteria(["Marketing", "Ventas"]);
  assert.ok(expanded.includes("sales"));
  assert.ok(expanded.includes("business development"));
  assert.ok(expanded.includes("comercial"));
  assert.ok(expanded.includes("sdr"));
  assert.ok(expanded.includes("growth"));
  console.log("  OK: Cargos expandidos correctamente");
}

console.log("▶ Verificando que passesIcp acepte cargos afines en señales de posts");
{
  const icp = {
    titles: ["Marketing", "Ventas"],
    locations: ["Global / Todos"],
  };

  const testProfiles = [
    {
      fullName: "Nicolás Molina Padilla",
      headline: "Business Development Manager | Growth & Partnerships | Ingeniero Comercial",
      signalType: "post_engagement",
      linkedinUrl: "https://www.linkedin.com/in/nicolas-molina/",
      evidence: { fingerprint: "fp1", sourceType: "post_comment", occurredAt: new Date().toISOString() }
    },
    {
      fullName: "Paulo Luelson",
      headline: "Product Owner | Senior Business Analyst",
      signalType: "post_engagement",
      linkedinUrl: "https://www.linkedin.com/in/paulo/",
      evidence: { fingerprint: "fp2", sourceType: "post_reaction", occurredAt: new Date().toISOString() }
    },
    {
      fullName: "Matt Rogers",
      headline: "Regional Commercial Director at LabVantage Solutions, APAC",
      signalType: "competitor_reactions",
      linkedinUrl: "https://www.linkedin.com/in/matt-rogers/",
      evidence: { fingerprint: "fp3", sourceType: "post_reaction", occurredAt: new Date().toISOString() }
    },
    {
      fullName: "Manuel Menendez",
      headline: "Desarrollo de negocios B2B end to end / Nutrimos tu fuerza de ventas",
      signalType: "high_intent_comments",
      linkedinUrl: "https://www.linkedin.com/in/manuel-menendez/",
      evidence: { fingerprint: "fp4", sourceType: "post_comment", occurredAt: new Date().toISOString() }
    }
  ];

  for (const profile of testProfiles) {
    const passed = passesIcp(profile, icp);
    assert.equal(passed, true, `Debería pasar ICP: ${profile.fullName} (${profile.headline})`);
    const score = scoreSignalLead(profile, icp);
    assert.ok(score.total >= 40, `El score debería ser significativo para ${profile.fullName}, got ${score.total}`);
    console.log(`  OK: ${profile.fullName} paso ICP con score ${score.total}`);
  }
}

console.log("✅ TESTS DE SEÑALES DE POSTS Y EXPANSIÓN SEMÁNTICA COMPLETADOS CON ÉXITO");
