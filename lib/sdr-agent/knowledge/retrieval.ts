import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { SdrKnowledgeChunk } from "../providers/provider";
import {
  readKnowledgeContent,
  splitKnowledgeContent,
  type KnowledgeSourceRecord,
} from "./repository";

export interface RetrievedKnowledge {
  chunks: SdrKnowledgeChunk[];
  revision: string;
  availableCitationIds: Set<string>;
}

const STOP_WORDS = new Set([
  "a", "al", "and", "as", "con", "da", "de", "del", "do", "e", "el", "en", "es",
  "for", "how", "la", "las", "los", "o", "of", "para", "por", "que", "the", "to", "un",
  "una", "y", "como", "cómo", "qual", "what", "cuál", "cual",
]);

function terms(value: string): Set<string> {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ");
  return new Set(
    normalized
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3 && !STOP_WORDS.has(term)),
  );
}

function overlapScore(queryTerms: Set<string>, content: string): number {
  if (queryTerms.size === 0) return 0;
  const contentTerms = terms(content);
  let matches = 0;
  for (const term of queryTerms) if (contentTerms.has(term)) matches++;
  return matches / queryTerms.size;
}

function revisionFor(chunks: SdrKnowledgeChunk[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(chunks.map((chunk) => [chunk.sourceId, chunk.revision, chunk.id, chunk.content])),
      "utf8",
    )
    .digest("hex");
}

export function retrieveApprovedKnowledge(
  db: Database.Database,
  input: {
    workspaceOwnerId: string;
    agentId: string;
    query: string;
    limit?: number;
    maxTotalCharacters?: number;
  },
): RetrievedKnowledge {
  const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
  const maxTotalCharacters = Math.max(1_000, Math.min(input.maxTotalCharacters ?? 12_000, 30_000));
  const sources = db.prepare(`
    SELECT * FROM sdr_knowledge_sources
    WHERE workspace_owner_id = ? AND agent_id = ? AND status = 'approved'
    ORDER BY updated_at DESC, id ASC
  `).all(input.workspaceOwnerId, input.agentId) as KnowledgeSourceRecord[];
  const queryTerms = terms(input.query);
  const candidates: Array<SdrKnowledgeChunk & { score: number }> = [];

  for (const source of sources) {
    const rows = db.prepare(`
      SELECT id, source_id, revision, content
      FROM sdr_knowledge_chunks
      WHERE source_id = ? AND workspace_owner_id = ? AND revision = ?
      ORDER BY ordinal ASC
    `).all(source.id, input.workspaceOwnerId, source.revision) as Array<{
      id: string;
      source_id: string;
      revision: number;
      content: string;
    }>;
    const chunks = rows.length > 0
      ? rows.map((row) => ({
          id: row.id,
          sourceId: row.source_id,
          sourceTitle: source.title,
          revision: row.revision,
          content: row.content,
        }))
      : splitKnowledgeContent(readKnowledgeContent(source)).map((content, ordinal) => ({
          id: `${source.id}:r${source.revision}:c${ordinal}`,
          sourceId: source.id,
          sourceTitle: source.title,
          revision: source.revision,
          content,
        }));

    for (const chunk of chunks) {
      const searchable = `${source.title} ${chunk.content}`;
      candidates.push({ ...chunk, score: overlapScore(queryTerms, searchable) });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId) || a.id.localeCompare(b.id));
  const selected: SdrKnowledgeChunk[] = [];
  let totalCharacters = 0;
  for (const candidate of candidates) {
    if (candidate.score <= 0 || selected.length >= limit) break;
    if (totalCharacters + candidate.content.length > maxTotalCharacters) continue;
    selected.push({
      id: candidate.id,
      sourceId: candidate.sourceId,
      sourceTitle: candidate.sourceTitle,
      revision: candidate.revision,
      content: candidate.content,
    });
    totalCharacters += candidate.content.length;
  }

  // Fallback: If no chunks scored > 0 but approved sources exist, include initial chunks
  // from approved sources so conversational messages (e.g. greetings) have company context
  if (selected.length === 0 && candidates.length > 0) {
    for (const candidate of candidates) {
      if (selected.length >= Math.min(limit, 3)) break;
      if (totalCharacters + candidate.content.length > maxTotalCharacters) continue;
      selected.push({
        id: candidate.id,
        sourceId: candidate.sourceId,
        sourceTitle: candidate.sourceTitle,
        revision: candidate.revision,
        content: candidate.content,
      });
      totalCharacters += candidate.content.length;
    }
  }

  return {
    chunks: selected,
    revision: revisionFor(selected),
    availableCitationIds: new Set(selected.map((chunk) => chunk.id)),
  };
}

export function citationsAreValid(
  citationIds: readonly string[],
  availableCitationIds: ReadonlySet<string>,
): boolean {
  return citationIds.length > 0 && citationIds.every((id) => availableCitationIds.has(id));
}
