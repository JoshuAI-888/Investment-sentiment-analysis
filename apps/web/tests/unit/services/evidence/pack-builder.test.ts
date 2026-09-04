import { describe, expect, it } from 'vitest';
import { evidencePack } from '@/contracts/evidence-pack';
import { FixtureModelBackend } from '@/services/evidence/model-client';
import { buildEvidencePack, MAX_PACK_ITEMS } from '@/services/evidence/pack-builder';
import { fakeEvidenceDb, fakeEvidenceItem, loadEvidencePackFixture } from './helpers';

const ASOF = new Date('2026-09-04T00:00:00Z');
const WINDOW = { from: new Date('2026-08-28T00:00:00Z'), to: ASOF };

function relevantJson(itemIds: readonly string[]) {
  return {
    kind: 'json' as const,
    body: itemIds.map((itemId) => ({ itemId, relevant: true, rationale: 'about the security' })),
  };
}

describe('buildEvidencePack — F10 §4.3 assembly', () => {
  it('produces a pack that validates against the frozen EvidencePack contract', async () => {
    const fixture = loadEvidencePackFixture('clear_bullish');
    const db = fakeEvidenceDb(fixture.items);
    const relevantIds = fixture.items.map((i) => i.id);
    const backend = new FixtureModelBackend([relevantJson(relevantIds)]);

    const pack = await buildEvidencePack(
      {
        securityId: fixture.security.id,
        asOfInstant: ASOF,
        window: WINDOW,
        retrievalQuery: `security:${fixture.security.id}`,
        security: fixture.security,
      },
      { db, modelBackend: backend, model: 'test-model' },
    );

    expect(() => evidencePack.parse(pack)).not.toThrow();
    expect(pack.frames).toHaveLength(3);
    expect(pack.items.length).toBeGreaterThan(0);
    expect(pack.retrievalWindow).toEqual(WINDOW);
  });

  it('caps items at 30 and orders relevant-then-recency', async () => {
    const securityId = '00000000-0000-0000-0000-0000000000c1';
    const security = { id: securityId, symbol: 'ACME', companyName: 'Acme Corporation' };
    const items = Array.from({ length: 40 }, (_, i) =>
      fakeEvidenceItem({
        securityId,
        provider: 'reddit',
        title: `Acme Corporation update number ${i}`,
        snippet: 'Acme Corporation is doing fine.',
        sourceUrl: `https://reddit.com/r/acme/comments/${i}`,
        rawHash: `hash-cap-${i}`,
        availableAt: new Date(ASOF.getTime() - i * 60_000),
      }),
    );
    const db = fakeEvidenceDb(items);
    const backend = new FixtureModelBackend([relevantJson(items.map((i) => i.id))]);

    const pack = await buildEvidencePack(
      { securityId, asOfInstant: ASOF, window: WINDOW, retrievalQuery: 'q', security },
      { db, modelBackend: backend, model: 'test-model' },
    );

    expect(pack.items).toHaveLength(MAX_PACK_ITEMS);
    // Most recent 30 (index 0..29) should be the ones kept, in descending recency order.
    expect(pack.items[0]?.item.title).toBe('Acme Corporation update number 0');
    expect(pack.items[29]?.item.title).toBe('Acme Corporation update number 29');
  });

  it('cross-source dedupe collapses a story shared across axes into one item', async () => {
    const fixture = loadEvidencePackFixture('conflicting_sources');
    const db = fakeEvidenceDb(fixture.items);
    const backend = new FixtureModelBackend([relevantJson(fixture.items.map((i) => i.id))]);

    const pack = await buildEvidencePack(
      {
        securityId: fixture.security.id,
        asOfInstant: ASOF,
        window: WINDOW,
        retrievalQuery: 'q',
        security: fixture.security,
      },
      { db, modelBackend: backend, model: 'test-model' },
    );

    // Fixture has 4 raw items, 2 of which share a dedupeKey (substack + reddit crosspost).
    expect(pack.items).toHaveLength(3);
    const urls = pack.items.map((i) => i.item.sourceUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('excludes an item with no mention of the security at all, with a reason, no LLM call spent', async () => {
    const securityId = '00000000-0000-0000-0000-0000000000c2';
    const security = { id: securityId, symbol: 'ACME', companyName: 'Acme Corporation' };
    const items = [
      fakeEvidenceItem({
        securityId,
        provider: 'reddit',
        title: 'The market rallied broadly today',
        snippet: 'Nothing about any specific company here.',
        rawHash: 'hash-none-1',
      }),
    ];
    const db = fakeEvidenceDb(items);
    const backend = new FixtureModelBackend([{ kind: 'throw', message: 'must not be called' }]);

    const pack = await buildEvidencePack(
      { securityId, asOfInstant: ASOF, window: WINDOW, retrievalQuery: 'q', security },
      { db, modelBackend: backend, model: 'test-model' },
    );

    expect(pack.items).toHaveLength(1);
    expect(pack.items[0]?.relevant).toBe(false);
    expect(pack.items[0]?.excludedReason).toMatch(/no mention/);
  });

  describe('ticker-collision guard end-to-end', () => {
    it('excludes an uncorroborated ambiguous mention without calling the guard', async () => {
      const fixture = loadEvidencePackFixture('ticker_collision');
      const db = fakeEvidenceDb(fixture.items);
      // Only the collision-guard-eligible items (2 and 5) should ever reach the backend.
      const backend = new FixtureModelBackend([
        {
          kind: 'json',
          body: [
            { itemId: '30000000-0000-0000-0000-000000000002', aboutSecurity: true, rationale: 'genuine' },
            { itemId: '30000000-0000-0000-0000-000000000005', aboutSecurity: false, rationale: 'coincidental' },
          ],
        },
        // Second call is relevance.filter, for cashtag item 1, and the collision-confirmed item 2.
        relevantJson([
          '30000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000002',
        ]),
      ]);

      const pack = await buildEvidencePack(
        {
          securityId: fixture.security.id,
          asOfInstant: ASOF,
          window: WINDOW,
          retrievalQuery: 'q',
          security: fixture.security,
        },
        { db, modelBackend: backend, model: 'test-model' },
      );

      const byId = new Map(pack.items.map((i) => [i.item.id, i]));
      // item 1: cashtag, direct relevance candidate, confirmed relevant.
      expect(byId.get('30000000-0000-0000-0000-000000000001')?.relevant).toBe(true);
      // item 2: ambiguous + corroborated, guard confirms, relevance confirms.
      expect(byId.get('30000000-0000-0000-0000-000000000002')?.relevant).toBe(true);
      // item 3: ambiguous, uncorroborated -- excluded pre-LLM.
      const item3 = byId.get('30000000-0000-0000-0000-000000000003');
      expect(item3?.relevant).toBe(false);
      expect(item3?.flags).toContain('ticker_collision');
      expect(item3?.excludedReason).toMatch(/no corroborating/);
      // item 4: no mention of the security at all (generic "AI stocks", not ambiguous-token match
      // against this security's own symbol context) -- wait, item 4's text contains bare "AI"
      // too, so it is also an ambiguous, uncorroborated candidate.
      const item4 = byId.get('30000000-0000-0000-0000-000000000004');
      expect(item4?.relevant).toBe(false);
      // item 5: ambiguous + corroborated (literal company name present) but the guard rejects it.
      const item5 = byId.get('30000000-0000-0000-0000-000000000005');
      expect(item5?.relevant).toBe(false);
      expect(item5?.flags).toContain('ticker_collision');
      expect(item5?.excludedReason).toMatch(/coincidental/);
    });
  });

  it('passes stanceLabel/stanceScore through unchanged -- never invents a stance (D-13)', async () => {
    const fixture = loadEvidencePackFixture('sarcasm');
    const db = fakeEvidenceDb(fixture.items);
    const backend = new FixtureModelBackend([relevantJson(fixture.items.map((i) => i.id))]);

    const pack = await buildEvidencePack(
      {
        securityId: fixture.security.id,
        asOfInstant: ASOF,
        window: WINDOW,
        retrievalQuery: 'q',
        security: fixture.security,
      },
      { db, modelBackend: backend, model: 'test-model' },
    );

    for (const classified of pack.items) {
      const original = fixture.items.find((i) => i.id === classified.item.id);
      expect(classified.item.stanceLabel).toBe(original?.stanceLabel ?? null);
      expect(classified.stanceConfidence).toBe(original?.stanceScore ?? null);
    }
  });

  it('is honestly empty for a quiet axis rather than fabricating coverage (thin evidence)', async () => {
    const fixture = loadEvidencePackFixture('thin_evidence');
    const db = fakeEvidenceDb(fixture.items);
    const backend = new FixtureModelBackend([relevantJson(fixture.items.map((i) => i.id))]);

    const pack = await buildEvidencePack(
      {
        securityId: fixture.security.id,
        asOfInstant: ASOF,
        window: WINDOW,
        retrievalQuery: 'q',
        security: fixture.security,
      },
      { db, modelBackend: backend, model: 'test-model' },
    );

    expect(pack.frames).toHaveLength(3);
    const x = pack.frames.find((f) => f.axis === 'x');
    const substack = pack.frames.find((f) => f.axis === 'substack');
    expect(x?.retrievedCount).toBe(0);
    expect(x?.usedCount).toBe(0);
    expect(substack?.retrievedCount).toBe(0);
    const reddit = pack.frames.find((f) => f.axis === 'reddit');
    expect(reddit?.retrievedCount).toBe(1);
  });

  it('never dispatches an LLM call, and abstains, when the budget gate denies', async () => {
    const securityId = '00000000-0000-0000-0000-0000000000c3';
    const security = { id: securityId, symbol: 'ACME', companyName: 'Acme Corporation' };
    const items = [
      fakeEvidenceItem({ securityId, provider: 'reddit', title: 'Acme Corporation news', rawHash: 'hash-budget-1' }),
    ];
    const db = fakeEvidenceDb(items);
    const backend = new FixtureModelBackend([{ kind: 'throw', message: 'must not be called' }]);

    const pack = await buildEvidencePack(
      { securityId, asOfInstant: ASOF, window: WINDOW, retrievalQuery: 'q', security },
      {
        db,
        modelBackend: backend,
        model: 'test-model',
        checkBudget: async () => ({ allowed: false, message: 'global ceiling reached' }),
      },
    );

    expect(pack.items[0]?.relevant).toBe(false);
    expect(pack.items[0]?.excludedReason).toMatch(/budget denied/);
  });

  it('records one cost-attributable call record per relevance/collision batch dispatched', async () => {
    const securityId = '00000000-0000-0000-0000-0000000000c4';
    const security = { id: securityId, symbol: 'ACME', companyName: 'Acme Corporation' };
    const items = [
      fakeEvidenceItem({ securityId, provider: 'reddit', title: 'Acme Corporation update', rawHash: 'hash-cost-1' }),
    ];
    const db = fakeEvidenceDb(items);
    const backend = new FixtureModelBackend([relevantJson(items.map((i) => i.id))]);

    const records: Array<{ methodTitle: string }> = [];

    await buildEvidencePack(
      { securityId, asOfInstant: ASOF, window: WINDOW, retrievalQuery: 'q', security },
      {
        db,
        modelBackend: backend,
        model: 'test-model',
        onModelCallRecord: (_record, methodTitle) => {
          records.push({ methodTitle });
        },
      },
    );

    expect(records).toEqual([{ methodTitle: 'Relevance filter' }]);
  });
});
