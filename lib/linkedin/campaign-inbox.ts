import type Database from "better-sqlite3";

export interface CampaignInboxMessage {
  id: string;
  accountId: string;
  targetId: string;
  runId: string | null;
  workflowId: string | null;
  externalThreadId: string;
  externalMessageId: string;
  direction: "inbound" | "outbound";
  senderExternalId: string | null;
  senderName: string | null;
  body: string;
  sentAt: string;
  capturedAt: string;
  identityMode: string;
  metadataJson: string;
}

export interface CampaignInboxEventSummary {
  accountId: string;
  targetId: string;
  runId: string | null;
  workflowId: string | null;
  externalThreadId: string;
  externalMessageId: string;
  body: string;
  sentAt: string;
}

export function getCampaignLinkedInThread(
  db: Database.Database,
  targetId: string,
  accountId?: string,
  threadId?: string,
): CampaignInboxMessage[] {
  const conditions: string[] = ["target_id = ?"];
  const params: unknown[] = [targetId];

  if (accountId) {
    conditions.push("account_id = ?");
    params.push(accountId);
  }
  if (threadId) {
    conditions.push("external_thread_id = ?");
    params.push(threadId);
  }

  return db.prepare(`
    SELECT
      id,
      account_id AS accountId,
      target_id AS targetId,
      run_id AS runId,
      workflow_id AS workflowId,
      external_thread_id AS externalThreadId,
      external_message_id AS externalMessageId,
      direction,
      sender_external_id AS senderExternalId,
      sender_name AS senderName,
      body,
      sent_at AS sentAt,
      captured_at AS capturedAt,
      identity_mode AS identityMode,
      metadata_json AS metadataJson
    FROM linkedin_inbox_messages
    WHERE ${conditions.join(" AND ")}
    ORDER BY datetime(sent_at) ASC, id ASC
  `).all(...params) as CampaignInboxMessage[];
}

export function getLatestCampaignLinkedInEvent(
  db: Database.Database,
  targetId: string,
  accountId?: string,
): CampaignInboxEventSummary | null {
  const accountFilter = accountId ? "AND m.account_id = ?" : "";
  const params = accountId ? [targetId, accountId] : [targetId];
  return (db.prepare(`
    SELECT account_id AS accountId, target_id AS targetId,
      run_id AS runId, workflow_id AS workflowId,
      external_thread_id AS externalThreadId,
      external_message_id AS externalMessageId,
      body, sent_at AS sentAt
    FROM linkedin_inbox_messages m
    WHERE m.target_id = ? ${accountFilter}
    ORDER BY datetime(m.sent_at) DESC, m.id DESC
    LIMIT 1
  `).get(...params) as CampaignInboxEventSummary | undefined) ?? null;
}

export function listLatestCampaignLinkedInEvents(
  db: Database.Database,
  accountId?: string,
): CampaignInboxEventSummary[] {
  const accountFilter = accountId ? "WHERE account_id = ?" : "";
  const params = accountId ? [accountId] : [];
  return db.prepare(`
    SELECT account_id AS accountId, target_id AS targetId,
      run_id AS runId, workflow_id AS workflowId,
      external_thread_id AS externalThreadId,
      external_message_id AS externalMessageId,
      body, sent_at AS sentAt
    FROM (
      SELECT m.*, ROW_NUMBER() OVER (
        PARTITION BY target_id ${accountId ? ", account_id" : ""}
        ORDER BY datetime(sent_at) DESC, id DESC
      ) AS row_num
      FROM linkedin_inbox_messages m
      ${accountFilter}
    ) ranked
    WHERE row_num = 1
  `).all(...params) as CampaignInboxEventSummary[];
}
