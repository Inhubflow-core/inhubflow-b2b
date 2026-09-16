#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const envPath = path.resolve(__dirname, "..", ".env.local");
let envText = fs.readFileSync(envPath, "utf8");

function readValue(key) {
  const match = envText.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
}

function upsert(key, value) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  envText = pattern.test(envText)
    ? envText.replace(pattern, `${key}=${value}`)
    : envText.replace(/\s*$/, `\n${key}=${value}\n`);
}

async function run() {
  const token = readValue("UNIPILE_WEBHOOK_TOKEN") || crypto.randomBytes(32).toString("hex");
  const callbackSecret = readValue("UNIPILE_CALLBACK_SECRET") || crypto.randomBytes(32).toString("hex");
  const dsn = readValue("UNIPILE_DSN").replace(/\/$/, "");
  const apiKey = readValue("UNIPILE_API_KEY");
  if (!dsn || !apiKey) throw new Error("Faltan credenciales Unipile");

  const headers = { "X-API-KEY": apiKey, Accept: "application/json", "Content-Type": "application/json" };
  const listResponse = await fetch(`${dsn}/api/v1/webhooks`, { headers });
  if (!listResponse.ok) throw new Error(`No se pudieron listar webhooks: HTTP ${listResponse.status}`);
  const payload = await listResponse.json();
  const existing = payload.items || payload || [];
  const requestUrl = "https://b2b.inhubflow.online/api/webhooks/linkedin-events";
  const desired = [
    { source: "messaging", events: ["message_received"], name: "InHubFlow Seguro - Mensajes LinkedIn" },
    { source: "users", events: ["new_relation"], name: "InHubFlow Seguro - Nuevas relaciones" },
    {
      source: "account_status",
      events: ["creation_success", "creation_fail", "deleted", "reconnected", "sync_success", "stopped", "ok", "connecting", "error", "credentials", "permissions"],
      name: "InHubFlow Seguro - Estado de cuenta",
    },
  ];
  const keep = new Set();

  for (const item of desired) {
    const secure = existing.find((webhook) =>
      webhook.enabled !== false
      && webhook.source === item.source
      && webhook.request_url === requestUrl
      && Array.isArray(webhook.headers)
      && webhook.headers.some((header) => String(header.key).toLowerCase() === "x-inhubflow-webhook-token" && header.value === token),
    );
    if (secure) {
      keep.add(secure.id);
      console.log(`SEGURO EXISTE ${item.source} ${secure.id}`);
      continue;
    }
    const response = await fetch(`${dsn}/api/v1/webhooks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        request_url: requestUrl,
        name: item.name,
        format: "json",
        enabled: true,
        source: item.source,
        events: item.events,
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "X-InHubFlow-Webhook-Token", value: token },
        ],
      }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`No se pudo crear ${item.source}: HTTP ${response.status} ${body}`);
    const created = JSON.parse(body);
    const id = created.webhook_id || created.id;
    keep.add(id);
    console.log(`SEGURO CREADO ${item.source} ${id}`);
  }

  upsert("UNIPILE_WEBHOOK_TOKEN", token);
  upsert("UNIPILE_CALLBACK_SECRET", callbackSecret);
  const temporaryPath = `${envPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, envText, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, envPath);

  for (const webhook of existing) {
    if (!desired.some((item) => item.source === webhook.source)) continue;
    if (webhook.request_url !== requestUrl || keep.has(webhook.id)) continue;
    const response = await fetch(`${dsn}/api/v1/webhooks/${encodeURIComponent(webhook.id)}`, { method: "DELETE", headers });
    if (!response.ok) throw new Error(`No se pudo retirar webhook inseguro ${webhook.id}: HTTP ${response.status}`);
    console.log(`INSEGURO RETIRADO ${webhook.source} ${webhook.id}`);
  }
  console.log("CONFIGURACIÓN SEGURA COMPLETADA");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
