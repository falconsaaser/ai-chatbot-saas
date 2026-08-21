/**
 * Cross-session memory tests. Split into two parts:
 *
 *   1. Pure-function tests (renderMemoryBlock, parseFactsResponse) — run
 *      unconditionally, no DB required.
 *   2. Integration flow — gated on RUN_INTEGRATION_TESTS=1 (same convention
 *      as chat-prompt.test.ts) so CI without a Postgres+pgvector instance
 *      still passes the unit slice.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseFactsResponse, renderMemoryBlock } from '@/lib/server/memory';

describe('renderMemoryBlock', () => {
  it('returns null when the observation list is empty (so the prompt gets no block, zero overhead for new visitors)', () => {
    expect(renderMemoryBlock([])).toBeNull();
  });

  it('includes every fact as a bullet under a labelled heading', () => {
    const block = renderMemoryBlock([
      obs('Customer name is Maya Chen.'),
      obs('Prefers SMS delivery updates.'),
    ]);
    expect(block).toContain('About this returning visitor');
    expect(block).toContain('- Customer name is Maya Chen.');
    expect(block).toContain('- Prefers SMS delivery updates.');
  });
});

describe('parseFactsResponse', () => {
  it('extracts facts from a valid JSON body', () => {
    const raw = '{"facts": ["User is on the Pro tier.", "Prefers email over SMS."]}';
    expect(parseFactsResponse(raw)).toEqual([
      'User is on the Pro tier.',
      'Prefers email over SMS.',
    ]);
  });

  it('unwraps JSON from fenced code blocks (some models wrap responses)', () => {
    const raw = '```json\n{"facts": ["one fact"]}\n```';
    expect(parseFactsResponse(raw)).toEqual(['one fact']);
  });

  it('caps at 5 facts even when the LLM returns more', () => {
    const many = Array.from({ length: 10 }, (_, i) => `fact number ${i + 1}`);
    const raw = JSON.stringify({ facts: many });
    expect(parseFactsResponse(raw)).toHaveLength(5);
  });

  it('filters out too-short facts', () => {
    const raw = '{"facts": ["yes", "This is a fact of adequate length."]}';
    expect(parseFactsResponse(raw)).toEqual([
      'This is a fact of adequate length.',
    ]);
  });

  it('filters out overly-long facts (protects the prompt from runaway rambles)', () => {
    const long = 'x'.repeat(400);
    const raw = JSON.stringify({ facts: [long, 'Reasonable fact.'] });
    expect(parseFactsResponse(raw)).toEqual(['Reasonable fact.']);
  });

  it('returns [] on empty or missing facts array', () => {
    expect(parseFactsResponse('{"facts": []}')).toEqual([]);
    expect(parseFactsResponse('{}')).toEqual([]);
    expect(parseFactsResponse('')).toEqual([]);
  });

  it('returns [] on malformed JSON (LLM produced garbage)', () => {
    expect(parseFactsResponse('not-json')).toEqual([]);
    expect(parseFactsResponse('{"facts": [broken}')).toEqual([]);
  });

  it('drops non-string entries defensively', () => {
    const raw = '{"facts": ["good fact here", 42, null, {"a": 1}]}';
    expect(parseFactsResponse(raw)).toEqual(['good fact here']);
  });
});

// ─── Integration slice ──────────────────────────────────────────────────────

const enabled = process.env.RUN_INTEGRATION_TESTS === '1';

describe.skipIf(!enabled)('memory recall + write (integration)', () => {
  type DB = typeof import('@/db');
  type SchemaModule = typeof import('@/db/schema');
  type EmbedModule = typeof import('@/lib/server/embed');
  type ChatModule = typeof import('@/lib/server/chat');
  type MemoryModule = typeof import('@/lib/server/memory');

  let db: DB['db'];
  let schema: SchemaModule;
  let embed: EmbedModule;
  let chat: ChatModule;
  let memory: MemoryModule;

  let userId = '';
  let botId = '';

  beforeAll(async () => {
    if (process.env.REAL_DATABASE_URL) {
      (process.env as Record<string, string>).DATABASE_URL =
        process.env.REAL_DATABASE_URL;
    }
    ({ db } = await import('@/db'));
    schema = await import('@/db/schema');
    embed = await import('@/lib/server/embed');
    chat = await import('@/lib/server/chat');
    memory = await import('@/lib/server/memory');

    // Deterministic embeddings: query and fact "match" iff first component
    // equals. Lets the top-K recall be predictable in tests.
    embed._setEmbeddingsClient({
      async embed(inputs) {
        return inputs.map((t) => {
          const v = new Array(1536).fill(0);
          v[0] = t.includes('order') ? 1 : t.includes('name') ? 0.5 : 0.2;
          return v;
        });
      },
    });
    chat._setChatClient({
      stream() {
        return (async function* () {
          yield '{"facts": ["Customer name is Maya Chen.", "Placed order A-2947."]}';
        })();
      },
    });

    const stamp = Date.now();
    const [u] = await db
      .insert(schema.users)
      .values({ name: 'Mem Tester', email: `mem-${stamp}@example.com` })
      .returning();
    userId = u.id;
    const [b] = await db
      .insert(schema.bots)
      .values({
        userId,
        name: 'Mem Bot',
        publicKey: `bot_mem_${stamp}`,
      })
      .returning();
    botId = b.id;
  });

  afterAll(async () => {
    if (!enabled) return;
    embed._setEmbeddingsClient(null);
    chat._setChatClient(null);
    const { eq } = await import('drizzle-orm');
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it('recall returns [] for a brand-new visitor (no memory block, zero overhead)', async () => {
    const observations = await memory.recallObservations(
      botId,
      'tg:new-visitor',
      'hello',
    );
    expect(observations).toEqual([]);
  });

  it('extractObservations → persistObservations → recallObservations round-trip', async () => {
    const endUser = await memory.upsertEndUser(botId, 'tg:returning');
    const facts = await memory.extractObservations(
      'I need to know the status of my order A-2947',
      'Your order shipped this morning.',
    );
    expect(facts.length).toBeGreaterThan(0);
    const persisted = await memory.persistObservations(
      botId,
      endUser.id,
      null,
      facts,
    );
    expect(persisted).toBe(facts.length);

    // Query "order" should recall the order-related fact via similarity.
    const recalled = await memory.recallObservations(
      botId,
      'tg:returning',
      'what about my order status',
    );
    expect(recalled.length).toBeGreaterThan(0);
    expect(recalled.map((o) => o.content).join(' ')).toMatch(/order/i);
  });

  it('extract returns [] for trivial greetings (no LLM cost, no noise memory)', async () => {
    const facts = await memory.extractObservations('hi', 'Hi there!');
    expect(facts).toEqual([]);
  });

  it('upsertEndUser is idempotent — second call returns the same row', async () => {
    const a = await memory.upsertEndUser(botId, 'wa:idem-test');
    const b = await memory.upsertEndUser(botId, 'wa:idem-test');
    expect(a.id).toBe(b.id);
  });
});

function obs(content: string) {
  // Minimal shape — renderMemoryBlock only reads `.content`.
  return {
    id: 'test',
    endUserRefId: 'test',
    botId: 'test',
    content,
    embedding: null,
    sourceMessageId: null,
    createdAt: new Date(),
  };
}
