import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@/contracts/evidence';
import type { Security } from '@/contracts/security';
import type { ModelCallMeta, ModelClassifyInput, ModelClient, ModelClientResult } from '@/services/llm/ports';
import { buildEvidencePack, MAX_PACK_ITEMS, MAX_SOCIAL_SNIPPETS } from '@/services/evidence/pack';

function evidenceRow(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    securityId: '00000000-0000-4000-8000-000000000001',
    evidenceType: 'social_result',
    provider: 'x',
    title: 'a post',
    snippet: 'a snippet',
    sourceUrl: 'https://x.example/1',
    publisher: null,
    authorRef: null,
    stanceLabel: null,
    stanceScore: null,
    relevanceScore: null,
    publishedAt: new Date('2026-09-01T00:00:00.000Z'),
    availableAt: new Date('2026-09-01T00:00:00.000Z'),
    ingestedAt: new Date('2026-09-01T00:05:00.000Z'),
    lastCheckedAt: null,
    availability: 'available',
    licenseClass: 'own_collected',
    coverageClass: 'licensed_sample',
    rawHash: 'h',
    metadata: {},
    ...overrides,
  };
}

const AAPL: Pick<Security, 'symbol' | 'name' | 'aliases'> = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  aliases: ['Apple'],
};

const C3AI: Pick<Security, 'symbol' | 'name' | 'aliases'> = {
  symbol: 'AI',
  name: 'C3.ai, Inc.',
  aliases: [],
};

const okMeta: ModelCallMeta = {
  modelId: 'fake',
  route: 'fake',
  promptVersion: 'x',
  temperature: '0',
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
  requestId: 'r',
  latencyMs: 0,
  requestedAt: '2026-09-01T00:00:00.000Z',
};

/** Decides relevance/collision purely by matching a marker string embedded in the item text. */
function markerModelClient(): ModelClient {
  return {
    classify: async <T>(input: ModelClassifyInput): Promise<ModelClientResult<T>> => {
      if (input.task === 'relevance') {
        const relevant = !input.prompt.includes('NOT_RELEVANT');
        return {
          ok: true,
          data: { itemId: 'x', relevant, relevanceScore: relevant ? 0.8 : 0.1, reason: 'fake' } as T,
          meta: okMeta,
        };
      }
      const confirmed = input.prompt.includes('CONFIRM_COLLISION');
      return {
        ok: true,
        data: { itemId: 'x', token: 'AI', confirmed, corroboration: confirmed ? 'context' : 'none', reason: 'fake' } as T,
        meta: okMeta,
      };
    },
  };
}

describe('buildEvidencePack', () => {
  it('handles an empty item set — the emptiest input — without crashing, and abstains honestly', async () => {
    const pack = await buildEvidencePack(
      {
        securityId: 'sec-1',
        asOf: new Date('2026-09-02T00:00:00.000Z'),
        items: [],
        truncatedByScanWindow: false,
        windowFrom: null,
        windowTo: null,
        reddit: { subredditsPolled: [], treeComplete: null },
        x: { watchlistVersion: null, triggerEvent: null },
      },
      { client: markerModelClient(), security: AAPL },
    );

    expect(pack.items).toEqual([]);
    expect(pack.excluded).toEqual([]);
    expect(pack.retrievedCount).toBe(0);
    expect(pack.usedCount).toBe(0);
    expect(pack.disclosures.every((d) => d.retrievedCount === 0 && d.usedCount === 0)).toBe(true);
  });

  it('includes a cashtag-matched, LLM-relevant item and records its methods', async () => {
    const item = evidenceRow({ id: 'i1', title: 'Apple note', snippet: 'Bullish on $AAPL' });
    const pack = await buildEvidencePack(
      {
        securityId: AAPL.symbol,
        asOf: new Date('2026-09-02T00:00:00.000Z'),
        items: [item],
        truncatedByScanWindow: false,
        windowFrom: null,
        windowTo: null,
        reddit: { subredditsPolled: [], treeComplete: null },
        x: { watchlistVersion: 'v1', triggerEvent: 'price_move_2026-09-01' },
      },
      { client: markerModelClient(), security: AAPL },
    );

    expect(pack.items).toHaveLength(1);
    expect(pack.items[0]?.matchedVia).toBe('cashtag');
    expect(pack.items[0]?.methods).toEqual([{ methodId: 'relevance.filter', methodVersion: '1.0.0' }]);
    expect(pack.usedCount).toBe(1);
    expect(pack.retrievedCount).toBe(1);
    expect(pack.excluded).toHaveLength(0);
  });

  it('excludes an item with no deterministic match at all, spending no LLM call', async () => {
    const item = evidenceRow({ id: 'i1', title: 'unrelated', snippet: 'nothing about the ticker here' });
    const pack = await buildEvidencePack(
      {
        securityId: 'sec-1',
        asOf: new Date('2026-09-02T00:00:00.000Z'),
        items: [item],
        truncatedByScanWindow: false,
        windowFrom: null,
        windowTo: null,
        reddit: { subredditsPolled: [], treeComplete: null },
        x: { watchlistVersion: null, triggerEvent: null },
      },
      { client: markerModelClient(), security: AAPL },
    );

    expect(pack.items).toHaveLength(0);
    expect(pack.excluded).toHaveLength(1);
    expect(pack.excluded[0]?.reason).toBe('no_deterministic_match');
  });

  it('excludes an item the LLM judges not relevant', async () => {
    const item = evidenceRow({ id: 'i1', title: 'Apple', snippet: 'NOT_RELEVANT $AAPL mentioned only in passing' });
    const pack = await buildEvidencePack(
      {
        securityId: 'sec-1',
        asOf: new Date('2026-09-02T00:00:00.000Z'),
        items: [item],
        truncatedByScanWindow: false,
        windowFrom: null,
        windowTo: null,
        reddit: { subredditsPolled: [], treeComplete: null },
        x: { watchlistVersion: null, triggerEvent: null },
      },
      { client: markerModelClient(), security: AAPL },
    );

    expect(pack.items).toHaveLength(0);
    expect(pack.excluded[0]?.reason).toBe('not_relevant');
  });

  describe('the ticker-collision guard, inside the pack', () => {
    it('runs the collision guard for a bare ambiguous token and includes it once confirmed', async () => {
      const item = evidenceRow({ id: 'i1', provider: 'x', title: 'earnings', snippet: 'AI beat estimates. CONFIRM_COLLISION' });
      const pack = await buildEvidencePack(
        {
          securityId: 'sec-ai',
          asOf: new Date('2026-09-02T00:00:00.000Z'),
          items: [item],
          truncatedByScanWindow: false,
          windowFrom: null,
          windowTo: null,
          reddit: { subredditsPolled: [], treeComplete: null },
          x: { watchlistVersion: null, triggerEvent: null },
        },
        { client: markerModelClient(), security: C3AI },
      );

      expect(pack.items).toHaveLength(1);
      expect(pack.items[0]?.methods.map((m) => m.methodId)).toEqual([
        'entity.collision_guard',
        'relevance.filter',
      ]);
    });

    it('excludes a bare ambiguous token the guard does not confirm — never assumed confirmed', async () => {
      const item = evidenceRow({ id: 'i1', provider: 'x', title: 'chatbots', snippet: 'AI is changing everything' });
      const pack = await buildEvidencePack(
        {
          securityId: 'sec-ai',
          asOf: new Date('2026-09-02T00:00:00.000Z'),
          items: [item],
          truncatedByScanWindow: false,
          windowFrom: null,
          windowTo: null,
          reddit: { subredditsPolled: [], treeComplete: null },
          x: { watchlistVersion: null, triggerEvent: null },
        },
        { client: markerModelClient(), security: C3AI },
      );

      expect(pack.items).toHaveLength(0);
      expect(pack.excluded[0]?.reason).toBe('ticker_collision_unconfirmed');
    });

    it('never spends a collision-guard call when a cashtag already corroborates the ambiguous token', async () => {
      let collisionCalls = 0;
      const client: ModelClient = {
        classify: async <T>(input: ModelClassifyInput): Promise<ModelClientResult<T>> => {
          if (input.task === 'entity_collision') collisionCalls += 1;
          return {
            ok: true,
            data: { itemId: 'x', relevant: true, relevanceScore: 0.8, reason: 'fake' } as T,
            meta: okMeta,
          };
        },
      };
      const item = evidenceRow({ id: 'i1', provider: 'x', title: 'earnings', snippet: 'AI beat estimates $AI' });
      await buildEvidencePack(
        {
          securityId: 'sec-ai',
          asOf: new Date('2026-09-02T00:00:00.000Z'),
          items: [item],
          truncatedByScanWindow: false,
          windowFrom: null,
          windowTo: null,
          reddit: { subredditsPolled: [], treeComplete: null },
          x: { watchlistVersion: null, triggerEvent: null },
        },
        { client, security: C3AI },
      );
      expect(collisionCalls).toBe(0);
    });
  });

  it('auto-includes a filing/macro item without running either LLM method', async () => {
    const filing = evidenceRow({ id: 'i1', evidenceType: 'filing', provider: 'sec_edgar', title: '10-Q', snippet: null, sourceUrl: null });
    const macro = evidenceRow({ id: 'i2', evidenceType: 'macro', provider: 'fred', title: 'CPI print', snippet: null, securityId: null, sourceUrl: null });
    const pack = await buildEvidencePack(
      {
        securityId: 'sec-1',
        asOf: new Date('2026-09-02T00:00:00.000Z'),
        items: [filing, macro],
        truncatedByScanWindow: false,
        windowFrom: null,
        windowTo: null,
        reddit: { subredditsPolled: [], treeComplete: null },
        x: { watchlistVersion: null, triggerEvent: null },
      },
      { client: markerModelClient(), security: AAPL },
    );

    expect(pack.items).toHaveLength(2);
    expect(pack.items.every((i) => i.methods.length === 0)).toBe(true);
    expect(pack.items.every((i) => i.relevanceScore === '1.000000')).toBe(true);
    expect(pack.items.find((i) => i.item.id === 'i1')?.axis).toBeNull();
  });

  it('orders included items by relevance then recency, and stamps a stable id', async () => {
    const older = evidenceRow({
      id: 'older',
      title: 'Apple',
      snippet: '$AAPL note',
      publishedAt: new Date('2026-08-01T00:00:00.000Z'),
      availableAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const newer = evidenceRow({
      id: 'newer',
      title: 'Apple',
      snippet: '$AAPL update',
      publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      availableAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const pack = await buildEvidencePack(
      {
        securityId: 'sec-1',
        asOf: new Date('2026-09-02T00:00:00.000Z'),
        items: [older, newer],
        truncatedByScanWindow: false,
        windowFrom: null,
        windowTo: null,
        reddit: { subredditsPolled: [], treeComplete: null },
        x: { watchlistVersion: null, triggerEvent: null },
      },
      { client: markerModelClient(), security: AAPL },
    );

    expect(pack.items.map((i) => i.item.id)).toEqual(['newer', 'older']);
    expect(pack.items[0]?.stableId).toBe('newer');
  });

  it('bounds the pack at 30 items and 12 social snippets, excluding the rest as pack_bound_exceeded', async () => {
    const socialItems = Array.from({ length: MAX_SOCIAL_SNIPPETS + 5 }, (_, i) =>
      evidenceRow({
        id: `social-${String(i)}`,
        provider: 'x',
        title: 'Apple',
        snippet: `$AAPL update ${String(i)}`,
        publishedAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
        availableAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
      }),
    );
    const pack = await buildEvidencePack(
      {
        securityId: 'sec-1',
        asOf: new Date('2026-09-02T00:00:00.000Z'),
        items: socialItems,
        truncatedByScanWindow: false,
        windowFrom: null,
        windowTo: null,
        reddit: { subredditsPolled: [], treeComplete: null },
        x: { watchlistVersion: null, triggerEvent: null },
      },
      { client: markerModelClient(), security: AAPL },
    );

    expect(pack.items).toHaveLength(MAX_SOCIAL_SNIPPETS);
    expect(pack.items.length).toBeLessThanOrEqual(MAX_PACK_ITEMS);
    const boundExcluded = pack.excluded.filter((e) => e.reason === 'pack_bound_exceeded');
    expect(boundExcluded).toHaveLength(5);
    expect(pack.retrievedCount).toBe(MAX_SOCIAL_SNIPPETS + 5);
    expect(pack.usedCount).toBe(MAX_SOCIAL_SNIPPETS);
  });

  it('always carries exactly three disclosures, in reddit/x/substack order, and reddit is honestly not-collected', async () => {
    const item = evidenceRow({ id: 'i1', provider: 'substack', title: 'Apple', snippet: '$AAPL analysis' });
    const pack = await buildEvidencePack(
      {
        securityId: 'sec-1',
        asOf: new Date('2026-09-02T00:00:00.000Z'),
        items: [item],
        truncatedByScanWindow: false,
        windowFrom: '2026-08-26T00:00:00.000Z',
        windowTo: '2026-09-02T00:00:00.000Z',
        reddit: { subredditsPolled: ['wallstreetbets'], treeComplete: true },
        x: { watchlistVersion: 'wl-1', triggerEvent: null },
      },
      { client: markerModelClient(), security: AAPL },
    );

    expect(pack.disclosures.map((d) => d.axis)).toEqual(['reddit', 'x', 'substack']);
    const reddit = pack.disclosures[0];
    expect(reddit.meta).toEqual({ kind: 'reddit', collected: false, subredditsPolled: [], treeComplete: null });
    expect(reddit.retrievedCount).toBe(0);
    expect(reddit.usedCount).toBe(0);

    const substack = pack.disclosures[2];
    expect(substack.usedCount).toBe(1);
    expect(substack.statement).toMatch(/curated publication set/i);
  });
});
