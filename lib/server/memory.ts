/**
 * Per-user cross-session memory.
 *
 * Adds the piece that plain per-session RAG doesn't have: when a returning
 * visitor asks a question, the bot has semantic context from prior
 * conversations under the same stable `endUserId` (cookie / telegram / whatsapp).
 *
 * Reads are pgvector cosine similarity on an `observations` table, keyed to
 * (bot, endUserId). Writes happen at the end of each turn via a cheap LLM
 * extraction call. Both stay well under 300ms in the common case.
 *
 * No query-time LLM cost on the read path — the pgvector lookup + a couple
 * of by-recency reads is all it takes. Extraction runs after the response
 * is already streaming back to the user, so it never sits in the user's
 * critical path (see `chat-pipeline.ts`).
 */
import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  endUsers,
  observations,
  type EndUser,
  type Observation,
} from '@/db/schema';
import { getChatClient } from '@/lib/server/chat';
import { getEmbeddingsClient } from '@/lib/server/embed';

/**
 * Maximum observations to include in the "About this returning visitor"
 * block. Split between top-K semantic hits and most-recent by time so a
 * customer's latest observation always makes the prompt even when it's
 * semantically off-topic.
 */
const RECALL_TOP_K_SIMILAR = 5;
const RECALL_MOST_RECENT = 3;

/** Absolute wall-clock cap on the extractor. Failures never block the response. */
const EXTRACT_TIMEOUT_MS = 6_000;

/** Get-or-create the `endUsers` row for this (bot, endUserId). Idempotent. */
export async function upsertEndUser(
  botId: string,
  endUserId: string,
): Promise<EndUser> {
  // Try select first — the common case is a returning visitor with a row
  // already present. Insert-on-conflict would be one round trip, but the
  // select-first path skips the row-locking on the unique index for hot rows.
  const existing = await db.query.endUsers.findFirst({
    where: and(eq(endUsers.botId, botId), eq(endUsers.endUserId, endUserId)),
  });
  if (existing) return existing;

  const [row] = await db
    .insert(endUsers)
    .values({ botId, endUserId })
    .onConflictDoUpdate({
      target: [endUsers.botId, endUsers.endUserId],
      set: { updatedAt: new Date() },
    })
    .returning();
  return row!;
}

/**
 * Fetch observations for the current visitor, mixing top-K semantic hits
 * with N most-recent-by-time. Returned in the order the prompt renders:
 * most-relevant first, then most-recent (deduplicated by id).
 *
 * Returns `[]` when the visitor is new, when the query is empty, or when
 * the embedding provider isn't configured — the caller can rely on empty
 * meaning "no memory block to prepend".
 */
export async function recallObservations(
  botId: string,
  endUserId: string,
  query: string,
): Promise<Observation[]> {
  if (!query.trim()) return [];

  const endUser = await db.query.endUsers.findFirst({
    where: and(eq(endUsers.botId, botId), eq(endUsers.endUserId, endUserId)),
  });
  if (!endUser) return [];

  const [embedding] = await getEmbeddingsClient()
    .embed([query])
    .catch(() => [null] as const);
  if (!embedding) return [];

  const embeddingLiteral = `[${embedding.join(',')}]`;

  // Two cheap queries in parallel — hnsw index covers the similarity leg,
  // the (endUserRefId, createdAt) B-tree covers the recency leg.
  const [similar, recent] = await Promise.all([
    db
      .select({
        observation: observations,
        distance: sql<number>`${observations.embedding} <=> ${embeddingLiteral}::vector`.as(
          'distance',
        ),
      })
      .from(observations)
      .where(eq(observations.endUserRefId, endUser.id))
      .orderBy(sql`distance`)
      .limit(RECALL_TOP_K_SIMILAR),
    db
      .select()
      .from(observations)
      .where(eq(observations.endUserRefId, endUser.id))
      .orderBy(desc(observations.createdAt))
      .limit(RECALL_MOST_RECENT),
  ]);

  const seen = new Set<string>();
  const merged: Observation[] = [];
  for (const row of similar) {
    if (seen.has(row.observation.id)) continue;
    seen.add(row.observation.id);
    merged.push(row.observation);
  }
  for (const row of recent) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

/** Format observations into the system-prompt block. `null` when empty. */
export function renderMemoryBlock(items: Observation[]): string | null {
  if (items.length === 0) return null;
  const lines = items.map((o) => `- ${o.content}`).join('\n');
  return [
    '## About this returning visitor',
    'The following facts were learned from prior conversations with this same person. Use them if relevant; do not restate them verbatim; ignore any that are irrelevant to the current question.',
    lines,
  ].join('\n');
}

/**
 * Extract 0-N durable facts from one exchange (user turn + assistant reply).
 * Small LLM call; result is a plain array of short sentences. Ephemera like
 * "user said hello" gets filtered out both by the prompt and by trivial
 * length/keyword rules before we persist.
 *
 * Returns `[]` on any failure — the caller writes zero observations rather
 * than blocking the user's turn.
 */
export async function extractObservations(
  userMessage: string,
  assistantMessage: string,
): Promise<string[]> {
  const trimmed = userMessage.trim();
  if (trimmed.length < 10 || GREETING_RE.test(trimmed)) return [];

  const { client, model } = getChatClient();

  const system = [
    'You extract DURABLE FACTS about a customer from one chat exchange.',
    'A durable fact is something that will still be true and useful in a future conversation:',
    '  - their name, role, company, product tier, timezone, preferences',
    '  - a specific order/ticket/account ID they mentioned',
    '  - a recurring problem, a stated goal, a decision they made',
    'Skip small talk, one-off pleasantries, and information already implied by the bot channel.',
    'Return JSON: {"facts": ["<short sentence>", ...]}. Return {"facts": []} if the exchange has nothing worth remembering.',
    'Never invent facts not clearly present in the exchange.',
  ].join('\n');

  const user = [
    `Customer message:\n${userMessage}`,
    '',
    `Assistant reply:\n${assistantMessage}`,
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  let assembled = '';
  try {
    const stream = client.stream({
      model,
      system,
      messages: [{ role: 'user', content: user }],
    });
    for await (const piece of stream) {
      if (controller.signal.aborted) break;
      assembled += piece;
    }
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }

  return parseFactsResponse(assembled);
}

/** Persist extracted facts as observations with embeddings. Never throws. */
export async function persistObservations(
  botId: string,
  endUserRefId: string,
  sourceMessageId: string | null,
  facts: string[],
): Promise<number> {
  if (facts.length === 0) return 0;
  const embeddings = await getEmbeddingsClient()
    .embed(facts)
    .catch(() => [] as number[][]);
  if (embeddings.length !== facts.length) return 0;

  const rows = facts.map((content, i) => ({
    botId,
    endUserRefId,
    content,
    embedding: embeddings[i]!,
    sourceMessageId,
  }));
  await db.insert(observations).values(rows);
  return rows.length;
}

// ─── Internals ──────────────────────────────────────────────────────────────

const GREETING_RE =
  /^\s*(hi|hey|hello|yo|sup|good\s+(morning|afternoon|evening)|thanks|thank\s+you|ok|okay|cool|great|👍|👋)\s*[.!?]*\s*$/i;

/**
 * Parse the extractor's JSON response into a bounded, sanitised list.
 * Robust against fenced code blocks the LLM sometimes wraps around JSON.
 */
export function parseFactsResponse(raw: string): string[] {
  if (!raw.trim()) return [];
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) return [];
  const payload = raw.slice(jsonStart, jsonEnd + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || !('facts' in parsed)) return [];
  const facts = (parsed as { facts: unknown }).facts;
  if (!Array.isArray(facts)) return [];

  return facts
    .filter((f): f is string => typeof f === 'string')
    .map((f) => f.trim())
    .filter((f) => f.length >= 6 && f.length <= 300)
    .slice(0, 5);
}
