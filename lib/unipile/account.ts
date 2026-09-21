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
    SELECT id, name, unipile_account_id, unipile_status
    FROM accounts
    WHERE id = ?
  `).get(localAccountId) as {
    id: string;
    name: string | null;
    unipile_account_id?: string | null;
    unipile_status?: string | null;
  } | undefined;

  if (!local) throw new Error("Cuenta local de LinkedIn no encontrada");
  if (!client.isConfigured()) throw new Error("El motor de LinkedIn no está configurado");

  // Fetch available remote accounts from Unipile
  let remoteAccounts: { items?: UnipileAccount[] } = { items: [] };
  if (typeof client.listAccounts === "function") {
    try {
      remoteAccounts = await client.listAccounts();
    } catch {
      // List accounts failure should not block direct getAccount by ID
    }
  }
  const usable = (remoteAccounts.items || []).filter(isUsableLinkedInAccount);

  // If local has a name, check if there is an exact name match in Unipile
  // to auto-correct any mismatch (e.g. mapping "Roberto OrSe" to the actual "Roberto OrSe" Unipile account)
  if (local.name && usable.length > 0) {
    const nameMatch = usable.find(
      (a) => a.name?.trim().toLowerCase() === local.name?.trim().toLowerCase()
    );
    if (nameMatch && nameMatch.id !== local.unipile_account_id) {
      console.log(`[resolveUnipileAccount] Auto-correcting Unipile account ID for "${local.name}" from ${local.unipile_account_id} to ${nameMatch.id}`);
      db.prepare("UPDATE accounts SET unipile_account_id = ?, unipile_status = ?, is_authenticated = 1 WHERE id = ?")
        .run(nameMatch.id, accountStatus(nameMatch), local.id);
      return {
        localAccountId: local.id,
        unipileAccountId: nameMatch.id,
        account: nameMatch,
      };
    }
  }

  if (local.unipile_account_id) {
    const remote = await client.getAccount(local.unipile_account_id);
    const status = accountStatus(remote);
    db.prepare("UPDATE accounts SET unipile_status = ?, is_authenticated = ? WHERE id = ?")
      .run(status || "UNKNOWN", isUsableLinkedInAccount(remote) ? 1 : 0, local.id);
    if (!isUsableLinkedInAccount(remote)) {
      throw new Error(`La cuenta de LinkedIn no está lista (estado ${status || "UNKNOWN"})`);
    }
    return {
      localAccountId: local.id,
      unipileAccountId: local.unipile_account_id,
      account: remote,
    };
  }

  const mappedIds = new Set(
    (db.prepare(`
      SELECT unipile_account_id FROM accounts
      WHERE id != ? AND unipile_account_id IS NOT NULL
    `).all(local.id) as Array<{ unipile_account_id: string }>).map((row) => row.unipile_account_id),
  );
  const unmappedUsable = (remoteAccounts.items || []).filter(
    (account) => isUsableLinkedInAccount(account) && !mappedIds.has(account.id),
  );
  if (unmappedUsable.length === 0) {
    throw new Error("No hay una cuenta de LinkedIn conectada y lista (estado OK)");
  }

  // The local account is unbound. The first deterministic usable LinkedIn account
  // is the documented fallback; Hosted Auth will persist an explicit mapping later.
  const selected = unmappedUsable[0];
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
