/**
 * Script de Verificación de Integración con Unipile API
 *
 * Uso:
 *   node scripts/test-unipile.cjs
 *
 * Requiere en .env.local o variables de entorno:
 *   UNIPILE_DSN="https://apiX.unipile.com:13342"
 *   UNIPILE_API_KEY="tu_token_aqui"
 */

const fs = require("fs");
const path = require("path");

// Cargar .env.local si existe
const envLocalPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

let dsn = (process.env.UNIPILE_DSN || "").trim().replace(/\/$/, "");
if (dsn && !dsn.startsWith("http://") && !dsn.startsWith("https://")) {
  dsn = "https://" + dsn;
}
const apiKey = (process.env.UNIPILE_API_KEY || "").trim();

console.log("==========================================");
console.log("  InHubFlow - Unipile Integration Checker ");
console.log("==========================================\n");

if (!dsn || !apiKey) {
  console.log("⚠️  Faltan variables de entorno:");
  if (!dsn) console.log("   - UNIPILE_DSN (Ej: https://api1.unipile.com:13342)");
  if (!apiKey) console.log("   - UNIPILE_API_KEY");
  console.log("\nPor favor agrega estas variables a tu archivo .env.local y vuelve a ejecutar.\n");
  process.exit(0);
}

console.log(`📡 Conectando a Unipile DSN: ${dsn}`);
console.log(`🔑 API Key configurada: ${apiKey.slice(0, 6)}...${apiKey.slice(-4)}\n`);

async function testConnection() {
  try {
    const res = await fetch(`${dsn}/api/v1/accounts`, {
      method: "GET",
      headers: {
        "X-API-KEY": apiKey,
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`❌ Error al consultar cuentas [HTTP ${res.status}]:`, errText);
      process.exit(1);
    }

    const data = await res.json();
    const accounts = data.items || [];

    console.log(`✅ Conexión exitosa con Unipile API!`);
    console.log(`📋 Cuentas vinculadas encontradas: ${accounts.length}\n`);

    if (accounts.length > 0) {
      accounts.forEach((acc, i) => {
        console.log(`  [${i + 1}] ID: ${acc.id}`);
        console.log(`      Proveedor: ${acc.provider}`);
        console.log(`      Estado: ${acc.status}`);
        console.log(`      Nombre: ${acc.name || "Sin nombre"}\n`);
      });
    } else {
      console.log("ℹ️  Aún no tienes cuentas vinculadas en Unipile.");
      console.log("   Puedes generar un link de conexión con Hosted Auth desde InHubFlow Settings.\n");
    }
  } catch (err) {
    console.error("❌ Falló la conexión:", err.message);
  }
}

testConnection();
