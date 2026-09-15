#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function accountStatus(account) {
  return String(account.sources?.find((source) => source.status)?.status || account.status || "UNKNOWN").toUpperCase();
}

async function run() {
  loadEnvFile(path.join(__dirname, "..", ".env.local"));
  const dsn = String(process.env.UNIPILE_DSN || "").trim().replace(/\/$/, "");
  const apiKey = String(process.env.UNIPILE_API_KEY || "").trim();
  const webhookToken = String(process.env.UNIPILE_WEBHOOK_TOKEN || "").trim();
  const webhookSecret = [process.env.UNIPILE_WEBHOOK_SECRET, process.env.UNIPILE_WEBHOOK_SECRETS]
    .filter(Boolean).join(",").split(",").map((value) => value.trim()).filter(Boolean);
  const callbackSecret = String(process.env.UNIPILE_CALLBACK_SECRET || process.env.UNIPILE_WEBHOOK_SECRET || "").trim();
  const problems = [];
  if (!dsn) problems.push("Falta UNIPILE_DSN");
  if (!apiKey) problems.push("Falta UNIPILE_API_KEY");
  if (!webhookToken && webhookSecret.length === 0) problems.push("Falta UNIPILE_WEBHOOK_TOKEN (v1) o un secreto HMAC v2");
  if (!callbackSecret) problems.push("Falta UNIPILE_CALLBACK_SECRET");
  if (!dsn || !apiKey) {
    console.error(`❌ ${problems.join("; ")}`);
    process.exitCode = 1;
    return;
  }

  const headers = { "X-API-KEY": apiKey, Accept: "application/json" };
  const [accountsResponse, webhooksResponse] = await Promise.all([
    fetch(`${dsn}/api/v1/accounts`, { headers }),
    fetch(`${dsn}/api/v1/webhooks`, { headers }),
  ]);
  if (!accountsResponse.ok) problems.push(`No se pudieron consultar cuentas (HTTP ${accountsResponse.status})`);
  if (!webhooksResponse.ok) problems.push(`No se pudieron consultar webhooks (HTTP ${webhooksResponse.status})`);
  const accountsPayload = accountsResponse.ok ? await accountsResponse.json() : { items: [] };
  const webhooksPayload = webhooksResponse.ok ? await webhooksResponse.json() : { items: [] };
  const accounts = accountsPayload.items || [];
  const webhooks = webhooksPayload.items || webhooksPayload || [];

  console.log("\nCuentas LinkedIn de Unipile:");
  const linkedInAccounts = accounts.filter((account) => String(account.type || account.provider || "").toUpperCase() === "LINKEDIN");
  if (linkedInAccounts.length === 0) problems.push("No hay cuentas LinkedIn conectadas en Unipile");
  for (const account of linkedInAccounts) {
    const status = accountStatus(account);
    console.log(`- ${account.name || account.id}: ${status} (${account.id})`);
    if (status !== "OK") problems.push(`La cuenta ${account.name || account.id} está en estado ${status}`);
  }

  console.log("\nWebhooks requeridos:");
  const required = [
    { source: "messaging", event: "message_received" },
    { source: "users", event: "new_relation" },
    { source: "account_status", event: "ok" },
  ];
  const webhookUrls = new Set();
  for (const requirement of required) {
    const match = webhooks.find((webhook) =>
      webhook.enabled !== false
      && webhook.source === requirement.source
      && (!Array.isArray(webhook.events) || webhook.events.length === 0 || webhook.events.includes(requirement.event))
      && (webhookSecret.length > 0 || (
        webhookToken
        && Array.isArray(webhook.headers)
        && webhook.headers.some((header) =>
          String(header.key).toLowerCase() === "x-inhubflow-webhook-token"
          && header.value === webhookToken
        )
      )),
    );
    console.log(`- ${requirement.source}/${requirement.event}: ${match ? `OK → ${match.request_url}` : "FALTA"}`);
    if (!match) problems.push(`Falta webhook ${requirement.source}/${requirement.event}`);
    else webhookUrls.add(match.request_url);
  }

  if (webhookToken && webhookUrls.size > 0) {
    console.log("\nSeguridad del endpoint desplegado:");
    for (const requestUrl of webhookUrls) {
      try {
        const body = JSON.stringify({ event: "inhubflow_readiness_probe" });
        const [withoutToken, withToken] = await Promise.all([
          fetch(requestUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body }),
          fetch(requestUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-InHubFlow-Webhook-Token": webhookToken },
            body,
          }),
        ]);
        const protectedEndpoint = withoutToken.status === 401;
        const acceptsConfiguredToken = withToken.status === 200 || withToken.status === 202;
        console.log(`- ${requestUrl}: sin token ${withoutToken.status}; con token ${withToken.status}`);
        if (!protectedEndpoint) problems.push(`El endpoint desplegado ${requestUrl} no rechaza peticiones sin token`);
        if (!acceptsConfiguredToken) problems.push(`El endpoint desplegado ${requestUrl} no acepta UNIPILE_WEBHOOK_TOKEN`);
      } catch (error) {
        problems.push(`No se pudo verificar el endpoint desplegado ${requestUrl}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  if (problems.length > 0) {
    console.log("\n❌ Integración aún no lista para envíos reales:");
    for (const problem of [...new Set(problems)]) console.log(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✅ UNIPILE LISTO PARA CAMPAÑAS E INBOX REALES");
}

run().catch((error) => {
  console.error("❌ Falló la comprobación de preparación:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
