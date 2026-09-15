const fs = require("fs");
const path = require("path");

// Cargar .env.local
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

async function runTests() {
  console.log("==================================================");
  console.log("   InHubFlow - Suite de Pruebas Unipile API Live   ");
  console.log("==================================================\n");

  const headers = {
    "X-API-KEY": apiKey,
    "Accept": "application/json",
  };

  // 1. Obtener Cuentas
  console.log("1️⃣  Verificando cuentas conectadas...");
  const accRes = await fetch(`${dsn}/api/v1/accounts`, { headers });
  const accData = await accRes.json();
  const accounts = accData.items || [];
  
  if (accounts.length === 0) {
    console.log("❌ No hay cuentas conectadas.");
    return;
  }

  const activeAccount = accounts[0];
  console.log(`✅ Cuenta activa: ${activeAccount.name} (ID: ${activeAccount.id})\n`);

  // 2. Probar resolución de perfil público (ej: Satya Nadella o Bill Gates)
  console.log("2️⃣  Probando resolución de perfil de LinkedIn...");
  try {
    const profileUrl = "https://www.linkedin.com/in/satyanadella";
    const profileRes = await fetch(
      `${dsn}/api/v1/users/${encodeURIComponent(profileUrl)}?account_id=${activeAccount.id}`,
      { headers }
    );
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      console.log(`✅ Perfil resuelto exitosamente:`);
      console.log(`   - Nombre: ${profileData.first_name || profileData.name} ${profileData.last_name || ""}`);
      console.log(`   - Headline: ${profileData.headline}`);
      console.log(`   - Provider ID: ${profileData.provider_id || profileData.id}`);
    } else {
      console.log(`⚠️  Respuesta de resolución [HTTP ${profileRes.status}]:`, await profileRes.text());
    }
  } catch (err) {
    console.log("⚠️  Error al resolver perfil:", err.message);
  }

  // 3. Probar listado de Chats / Inbox
  console.log("\n3️⃣  Probando sincronización de Chats / Inbox...");
  try {
    const chatsRes = await fetch(`${dsn}/api/v1/chats?account_id=${activeAccount.id}&limit=5`, { headers });
    if (chatsRes.ok) {
      const chatsData = await chatsRes.json();
      const chats = chatsData.items || [];
      console.log(`✅ Chats encontrados en la cuenta: ${chats.length}`);
      chats.slice(0, 3).forEach((c, idx) => {
        console.log(`   [Chat ${idx + 1}] ID: ${c.id} | Participantes: ${c.attendees_ids?.length || 0}`);
      });
    } else {
      console.log(`⚠️  Respuesta de chats [HTTP ${chatsRes.status}]:`, await chatsRes.text());
    }
  } catch (err) {
    console.log("⚠️  Error al listar chats:", err.message);
  }

  console.log("\n==================================================");
  console.log("   Pruebas finalizadas con éxito   ");
  console.log("==================================================");
}

runTests();
