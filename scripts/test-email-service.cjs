const assert = require("assert");
const path = require("path");
const fs = require("fs");

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret-key-at-least-32-chars-long-123456";

// TypeScript resolver hook for CJS
const Module = require("module");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const rel = request.slice(2);
    const abs = path.join(__dirname, "..", rel);
    for (const ext of [".ts", ".tsx", ".js", ".json"]) {
      if (fs.existsSync(abs + ext)) {
        return abs + ext;
      }
    }
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      for (const ext of [".ts", ".tsx", ".js", ".json"]) {
        if (fs.existsSync(path.join(abs, "index" + ext))) {
          return path.join(abs, "index" + ext);
        }
      }
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Simple TS transpilation
const ts = require("typescript");
require.extensions[".ts"] = function (module, filename) {
  let content = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  module._compile(result.outputText, filename);
};

async function runTests() {
  console.log("=== INHUBFLOW EMAIL SUITE TESTS ===");

  const { encryptSecret, decryptSecret } = require("../lib/crypto.ts");
  const { canAccessEmailAccount } = require("../lib/authz.ts");
  const { getDb } = require("../lib/db.ts");
  const db = getDb();

  // Test 1: Crypto roundtrip
  console.log("\n[Test 1] Verificando cifrado y descifrado de credenciales de email...");
  const secretPass = "SuperSecretP@ssw0rd!123";
  const encrypted = encryptSecret(secretPass);
  assert.notStrictEqual(encrypted, secretPass, "La contraseña debe estar cifrada");
  assert.ok(encrypted.startsWith("v1:"), "El formato debe ser v1:iv:tag:data");
  const decrypted = decryptSecret(encrypted);
  assert.strictEqual(decrypted, secretPass, "La contraseña descifrada debe coincidir exactamente");
  console.log("  ✅ Cifrado/Descifrado AES-256 verificado con éxito");

  // Test 2: Multi-tenant access control for Email Accounts
  console.log("\n[Test 2] Verificando aislamiento multi-tenant (canAccessEmailAccount)...");
  
  // Obtener o crear usuarios válidos para satisfacer Foreign Key
  let user1 = db.prepare("SELECT id, email FROM users LIMIT 1").get();
  if (!user1) {
    const uid = "test-owner-" + Date.now();
    db.prepare("INSERT INTO users (id, email, role) VALUES (?, ?, ?)").run(uid, "test@owner.com", "user");
    user1 = { id: uid, email: "test@owner.com" };
  }

  const testId = "test-email-acc-" + Date.now();
  db.prepare(`
    INSERT INTO email_accounts (id, name, from_email, smtp_host, smtp_port, smtp_secure, username, password, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(testId, "Test Account", "sales@client-a.com", "smtp.test.com", 587, 0, "sales@client-a.com", encrypted, user1.id);

  const actorOwner = {
    id: user1.id,
    email: user1.email,
    role: "user",
    ownerId: null,
    workspaceOwnerId: user1.id,
    isWorkspaceOwner: true,
    isWorkspaceAdmin: true,
    isSuperAdmin: false,
  };

  const actorStranger = {
    id: "user-stranger-999",
    email: "stranger@other.com",
    role: "user",
    ownerId: null,
    workspaceOwnerId: "workspace-stranger-999",
    isWorkspaceOwner: true,
    isWorkspaceAdmin: true,
    isSuperAdmin: false,
  };

  const actorSuperAdmin = {
    id: "super-1",
    email: "inhubflow@gmail.com",
    role: "admin",
    ownerId: null,
    workspaceOwnerId: "super-1",
    isWorkspaceOwner: true,
    isWorkspaceAdmin: true,
    isSuperAdmin: true,
  };

  assert.strictEqual(canAccessEmailAccount(db, actorOwner, testId), true, "El dueño del workspace debe tener acceso");
  assert.strictEqual(canAccessEmailAccount(db, actorStranger, testId), false, "Un usuario de otro workspace NO debe tener acceso");
  assert.strictEqual(canAccessEmailAccount(db, actorSuperAdmin, testId), true, "SuperAdmin debe tener acceso global");
  console.log("  ✅ Aislamiento multi-tenant en cuentas de email verificado");

  // Test 3: Transparent password resolution in sender.ts
  console.log("\n[Test 3] Verificando resolución transparente de credenciales en sender.ts...");
  const nodemailer = require("nodemailer");
  let capturedAuthPass = null;
  const originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = function (opts) {
    capturedAuthPass = opts?.auth?.pass;
    return {
      sendMail: async () => ({ messageId: "<test-msg-1@inhubflow.local>", accepted: ["prospect@b2b.com"], rejected: [] }),
      verify: async () => true,
    };
  };

  try {
    const { sendEmail } = require("../lib/email/sender.ts");
    
    // Test with encrypted password in account
    await sendEmail(
      {
        id: testId,
        from_email: "sales@client-a.com",
        from_name: "Sales",
        smtp_host: "smtp.test.com",
        smtp_port: 587,
        smtp_secure: 0,
        username: "sales@client-a.com",
        password: encrypted, // Encrypted!
      },
      "prospect@b2b.com",
      "Hola",
      "Prueba de envío"
    );

    assert.strictEqual(capturedAuthPass, secretPass, "Nodemailer debió recibir la contraseña en texto plano descifrada");
    console.log("  ✅ sendEmail descifró transparentemente la contraseña cifrada para Nodemailer");

    // Test with already plaintext password (legacy compatibility)
    await sendEmail(
      {
        id: testId,
        from_email: "sales@client-a.com",
        from_name: "Sales",
        smtp_host: "smtp.test.com",
        smtp_port: 587,
        smtp_secure: 0,
        username: "sales@client-a.com",
        password: "plain-text-pass-123",
      },
      "prospect@b2b.com",
      "Hola 2",
      "Prueba 2"
    );

    assert.strictEqual(capturedAuthPass, "plain-text-pass-123", "Nodemailer debió aceptar la contraseña en texto plano sin alterarla");
    console.log("  ✅ sendEmail soportó credenciales en texto plano sin alteración");

  } finally {
    nodemailer.createTransport = originalCreateTransport;
    // Cleanup test record
    db.prepare("DELETE FROM email_accounts WHERE id = ?").run(testId);
  }

  // Test 4: Verify Unipile isolation
  console.log("\n[Test 4] Verificando que Unipile NO se utiliza para el módulo de Email...");
  const senderTsContent = fs.readFileSync(path.join(__dirname, "../lib/email/sender.ts"), "utf8");
  const inboxTsContent = fs.readFileSync(path.join(__dirname, "../lib/email/inbox.ts"), "utf8");
  assert.ok(!senderTsContent.includes("unipile"), "lib/email/sender.ts NO debe importar ni llamar a unipile");
  assert.ok(!inboxTsContent.includes("unipile"), "lib/email/inbox.ts NO debe importar ni llamar a unipile");
  console.log("  ✅ El motor de correo es 100% nativo (Nodemailer / node-imap), sin Unipile");

  console.log("\n=======================================================");
  console.log("🎉 TODAS LAS PRUEBAS DEL MÓDULO EMAIL PASARON CON ÉXITO");
  console.log("=======================================================\n");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
