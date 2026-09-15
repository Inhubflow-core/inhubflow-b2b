import type Database from "better-sqlite3";

export interface LinkedInTargetAccountState {
  account_id: string;
  target_id: string;
  unipile_provider_id: string | null;
  unipile_chat_id: string | null;
  degree: number | null;
  connection_requested_at: string | null;
  connected_at: string | null;
  message_sent_at: string | null;
}

interface LegacyTargetState {
  id: string;
  unipile_provider_id?: string | null;
  unipile_chat_id?: string | null;
  degree?: number | null;
  connection_requested_at?: string | null;
  connected_at?: string | null;
  message_sent_at?: string | null;
  last_replied_account_id?: string | null;
}

/**
 * Returns account-scoped LinkedIn state, creating a compatibility projection for
 * older single-account installations when needed.
 */
export function ensureLinkedInTargetAccountState(
  db: Database.Database,
  accountId: string,
  target: LegacyTargetState,
): LinkedInTargetAccountState {
  const existing = db.prepare(`
    SELECT account_id, target_id, unipile_provider_id, unipile_chat_id, degree,
      connection_requested_at, connected_at, message_sent_at
    FROM linkedin_target_accounts WHERE account_id = ? AND target_id = ?
  `).get(accountId, target.id) as LinkedInTargetAccountState | undefined;
  if (existing) return existing;

  const accountCount = (db.prepare("SELECT COUNT(*) AS count FROM accounts").get() as { count: number }).count;
  const scopedChat = db.prepare(`
    SELECT external_thread_id FROM linkedin_inbox_messages
    WHERE account_id = ? AND target_id = ?
    ORDER BY datetime(sent_at) DESC, id DESC LIMIT 1
  `).get(accountId, target.id) as { external_thread_id?: string } | undefined;
  const mayInheritRelationship = accountCount <= 1 || target.last_replied_account_id === accountId;
  const state: LinkedInTargetAccountState = {
    account_id: accountId,
    target_id: target.id,
    unipile_provider_id: target.unipile_provider_id || null,
    unipile_chat_id: scopedChat?.external_thread_id || (mayInheritRelationship ? target.unipile_chat_id || null : null),
    degree: mayInheritRelationship ? target.degree ?? null : null,
    connection_requested_at: mayInheritRelationship ? target.connection_requested_at || null : null,
    connected_at: mayInheritRelationship ? target.connected_at || null : null,
    message_sent_at: mayInheritRelationship ? target.message_sent_at || null : null,
  };
  db.prepare(`
    INSERT INTO linkedin_target_accounts (
      account_id, target_id, unipile_provider_id, unipile_chat_id, degree,
      connection_requested_at, connected_at, message_sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, target_id) DO NOTHING
  `).run(
    state.account_id,
    state.target_id,
    state.unipile_provider_id,
    state.unipile_chat_id,
    state.degree,
    state.connection_requested_at,
    state.connected_at,
    state.message_sent_at,
  );
  return db.prepare(`
    SELECT account_id, target_id, unipile_provider_id, unipile_chat_id, degree,
      connection_requested_at, connected_at, message_sent_at
    FROM linkedin_target_accounts WHERE account_id = ? AND target_id = ?
  `).get(accountId, target.id) as LinkedInTargetAccountState;
}

export function updateLinkedInTargetAccountState(
  db: Database.Database,
  accountId: string,
  targetId: string,
  updates: Partial<Omit<LinkedInTargetAccountState, "account_id" | "target_id">>,
): void {
  const allowed = [
    "unipile_provider_id",
    "unipile_chat_id",
    "degree",
    "connection_requested_at",
    "connected_at",
    "message_sent_at",
  ] as const;
  const entries = allowed.filter((field) => Object.prototype.hasOwnProperty.call(updates, field));
  if (entries.length === 0) return;
  db.prepare(`
    INSERT INTO linkedin_target_accounts (account_id, target_id)
    VALUES (?, ?)
    ON CONFLICT(account_id, target_id) DO NOTHING
  `).run(accountId, targetId);
  const setClause = entries.map((field) => `${field} = ?`).join(", ");
  const values = entries.map((field) => updates[field]);
  db.prepare(`
    UPDATE linkedin_target_accounts
    SET ${setClause}, updated_at = datetime('now')
    WHERE account_id = ? AND target_id = ?
  `).run(...values, accountId, targetId);
}

export function projectLinkedInTargetState(
  db: Database.Database,
  targetId: string,
  updates: Partial<Omit<LinkedInTargetAccountState, "account_id" | "target_id">>,
): void {
  const allowed = [
    "unipile_provider_id",
    "unipile_chat_id",
    "degree",
    "connection_requested_at",
    "connected_at",
    "message_sent_at",
  ] as const;
  const entries = allowed.filter((field) => Object.prototype.hasOwnProperty.call(updates, field));
  if (entries.length === 0) return;
  const setClause = entries.map((field) => `${field} = ?`).join(", ");
  const values = entries.map((field) => updates[field]);
  db.prepare(`UPDATE targets SET ${setClause} WHERE id = ?`).run(...values, targetId);
}

export function markLinkedInTargetState(
  db: Database.Database,
  accountId: string,
  targetId: string,
  updates: Partial<Omit<LinkedInTargetAccountState, "account_id" | "target_id">>,
): void {
  updateLinkedInTargetAccountState(db, accountId, targetId, updates);
  projectLinkedInTargetState(db, targetId, updates);
}
