import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { ensureSdrAgent } from "@/lib/sdr-agent/seed";
import { seedDemoWorkspace } from "@/lib/demo/seed-demo";

export interface AutoSeedResult {
  adminSeeded: boolean;
  adminEmail?: string;
  slotsLimit: number;
  companyName: string;
}

/**
 * Automatically seeds the instance upon first boot or environment configuration.
 * Idempotent, safe, and fast.
 */
export function autoSeedInstance(db: Database.Database): AutoSeedResult {
  const adminEmail = (process.env.INITIAL_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "inhubflow@gmail.com").trim().toLowerCase();
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "";
  const adminPasswordHash = process.env.INITIAL_ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD_HASH || "";
  const slotsLimit = parseInt(process.env.SLOTS_LIMIT || process.env.MAX_SLOTS || "4", 10);
  const companyName = (process.env.COMPANY_NAME || process.env.CLIENT_COMPANY || "").trim();

  let adminSeeded = false;

  // 1. Ensure instance_settings table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS instance_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 2. Save / update slots limit and company info
  const setSettingStmt = db.prepare(`
    INSERT INTO instance_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  setSettingStmt.run("slots_limit", String(slotsLimit));
  if (companyName) {
    setSettingStmt.run("company_name", companyName);
  }

  // 3. Seed initial admin user if configured
  if (adminEmail) {
    const existingUser = db.prepare("SELECT id, role FROM users WHERE email = ?").get(adminEmail) as { id: string; role?: string } | undefined;

    if (!existingUser) {
      let finalHash = adminPasswordHash;

      if (!finalHash || !finalHash.startsWith("$2")) {
        const rawPassword = adminPassword || "InHubFlow2026!";
        finalHash = bcrypt.hashSync(rawPassword, 10);
      }

      const userId = randomUUID();
      db.prepare(`
        INSERT INTO users (id, email, password_hash, role, company_name, slots_limit, subscription_status, plan_tier)
        VALUES (?, ?, ?, 'admin', ?, 999, 'active', 'custom')
      `).run(
        userId,
        adminEmail,
        finalHash,
        companyName || "InHubFlow SuperAdmin"
      );

      adminSeeded = true;
      console.log(`[InHubFlow AutoSeed] ✅ Initial admin user seeded successfully: ${adminEmail}`);
    } else {
      // Ensure existing admin user has admin role and full slots
      db.prepare("UPDATE users SET role = 'admin', slots_limit = 999 WHERE id = ?").run(existingUser.id);
      console.log(`[InHubFlow AutoSeed] ℹ️ Admin user verified and updated to role 'admin': ${adminEmail}`);
    }
  }

  // 4. Ensure the default workspace SDR Agent exists but remains fail-closed.
  try {
    const workspaceOwner = db.prepare(
      "SELECT id FROM users WHERE email = ? AND owner_id IS NULL",
    ).get(adminEmail) as { id: string } | undefined;
    if (workspaceOwner) ensureSdrAgent(db, workspaceOwner.id);
  } catch (err) {
    console.error("[InHubFlow AutoSeed] SDR seeding warning:", err);
  }

  // 5. Enforce safe LinkedIn daily limits on all accounts (max 20)
  try {
    db.prepare(`
      UPDATE accounts
      SET
        daily_connection_limit = MIN(20, COALESCE(daily_connection_limit, 20)),
        daily_message_limit = MIN(20, COALESCE(daily_message_limit, 20)),
        daily_inmail_limit = MIN(20, COALESCE(daily_inmail_limit, 20))
      WHERE daily_connection_limit > 20 OR daily_message_limit > 20 OR daily_inmail_limit > 20
    `).run();
  } catch (err) {
    console.warn("[InHubFlow AutoSeed] Accounts limits clamp warning:", err);
  }

  // 6. Ensure Demo Workspace exists (for sales meetings & live demonstrations)
  try {
    const demoUser = db.prepare("SELECT id FROM users WHERE email = 'demo@inhubflow.com'").get();
    if (!demoUser) {
      seedDemoWorkspace(db);
    }
  } catch (err) {
    console.error("[InHubFlow AutoSeed] Demo workspace seeding error:", err);
  }

  console.log(`[InHubFlow AutoSeed] 🚀 Instance initialized with ${slotsLimit} slots limit${companyName ? ` for '${companyName}'` : ""}.`);

  return {
    adminSeeded,
    adminEmail: adminEmail || undefined,
    slotsLimit,
    companyName,
  };
}

/**
 * Helper to fetch instance limits
 */
export function getInstanceSettings(db: Database.Database): { slotsLimit: number; companyName: string } {
  try {
    const rows = db.prepare("SELECT key, value FROM instance_settings").all() as { key: string; value: string }[];
    const settingsMap = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return {
      slotsLimit: parseInt(settingsMap.slots_limit || "4", 10),
      companyName: settingsMap.company_name || "",
    };
  } catch {
    return { slotsLimit: 4, companyName: "" };
  }
}
