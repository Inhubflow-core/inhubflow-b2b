import type Database from "better-sqlite3";
import { unipile, UnipileClient } from "@/lib/unipile/client";
import type { UnipileAccount } from "@/lib/unipile/types";

export interface ResolvedUnipileAccount {
  localAccountId: string;
  unipileAccountId: string;
  account: UnipileAccount | null;
}

function accountType(account: UnipileAccount): string {
  return String(account.type || account.provider || "").toUpperCase();
}

function accountStatus(account: UnipileAccount): string {
  const sourceStatus = account.sources?.find((source) => source.status)?.status;
  return String(sourceStatus || account.status || "").toUpperCase();
}

export function isUsableLinkedInAccount(account: UnipileAccount): boolean {
  return accountType(account) === "LINKEDIN" && accountStatus(account) === "OK";
}

/**
 * Resolves the remote Unipile identity for a local InHubFlow account.
 * A local UUID is never accepted as a provider account ID.
 */
export async function resolveUnipileAccount(
  db: Database.Database,
  localAccountId: string,
  client: UnipileClient = unipile,
): Promise<ResolvedUnipileAccount> {
  const local = db.prepare(`
    SELECT id, unipile_account_id, unipile_status
    FROM accounts
    WHERE id = ?
  `).get(localAccountId) as {
    id: string;
    unipile_account_id?: string | null;
    unipile_status?: string | null;
  } | undefined;

  if (!local) throw new Error("Cuenta local de LinkedIn no encontrada");
  if (!client.isConfigured()) throw new Error("Unipile no está configurado");

  if (local.unipile_account_id) {
    const remote = await client.getAccount(local.unipile_account_id);
    const status = accountStatus(remote);
    db.prepare("UPDATE accounts SET unipile_status = ?, is_authenticated = ? WHERE id = ?")
      .run(status || "UNKNOWN", isUsableLinkedInAccount(remote) ? 1 : 0, local.id);
    if (!isUsableLinkedInAccount(remote)) {
      throw new Error(`La cuenta de LinkedIn de Unipile no está lista (estado ${status || "UNKNOWN"})`);
    }
    return {
      localAccountId: local.id,
      unipileAccountId: local.unipile_account_id,
      account: remote,
    };
  }

  const accounts = await client.listAccounts();
  const mappedIds = new Set(
    (db.prepare(`
      SELECT unipile_account_id FROM accounts
      WHERE id != ? AND unipile_account_id IS NOT NULL
    `).all(local.id) as Array<{ unipile_account_id: string }>).map((row) => row.unipile_account_id),
  );
  const usable = (accounts.items || []).filter(
    (account) => isUsableLinkedInAccount(account) && !mappedIds.has(account.id),
  );
  if (usable.length === 0) {
    throw new Error("No hay una cuenta de LinkedIn de Unipile conectada y lista (estado OK)");
  }

  // The local account is unbound. The first deterministic usable LinkedIn account
  // is the documented fallback; Hosted Auth will persist an explicit mapping later.
  const selected = usable[0];
  db.prepare(`
    UPDATE accounts
    SET unipile_account_id = ?, unipile_status = ?, is_authenticated = 1
    WHERE id = ?
  `).run(selected.id, accountStatus(selected), local.id);

  return {
    localAccountId: local.id,
    unipileAccountId: selected.id,
    account: selected,
  };
}

export { accountStatus };
