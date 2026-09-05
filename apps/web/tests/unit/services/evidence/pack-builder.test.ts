import { describe, expect, it } from 'vitest';
import { evidencePack } from '@/contracts/evidence-pack';
import { FixtureModelBackend } from '@/services/evidence/model-client';
import { buildEvidencePack, MAX_PACK_ITEMS } from '@/services/evidence/pack-builder';
import {
  COLLISION_GUARD_VERSION_TAG,
  DETERMINISTIC_CANDIDACY_VERSION_TAG,
  RELEVANCE_FILTER_VERSION_TAG,
} from '@/services/evidence/method-registry';
import { fakeEvidenceDb, fakeEvidenceItem, loadEvidencePackFixture } from './helpers';

const ASOF = new Date('2026-09-04T00:00:00Z');
const WINDOW = { from: new Date('2026-08-28T00:00:00Z'), to: ASOF };
const ALWAYS_ALLOWED = () => Promise.resolve({ allowed: true });

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
      { db, modelBackend: backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED },
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
      { db, modelBackend: backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED },
    );

    expect(pack.items).toHaveLength(MAX_PACK_ITEMS);
    // Most recent 30 (index 0..29) should be the ones kept, in descending recency order.
    expect(pack.items[0]?.item.title).toBe('Acme Corporation update number 0');
    expect(pack.items[29]?.item.title).toBe('Acme Corporation update number 29');
  });

  it('never collapses two items from different axes, even when they share a url/title (D-14, lane-review finding 1)', async () => {
    const fixture = loadEvidencePackFixture('conflicting_sources');
    const db = fakeEvidenceDb(fixture.items);
    const backend = new FixtureModelBackend([
      relevantJson(fixture.items.map((i) => i.id)),
      relevantJson(fixture.items.map((i) => i.id)),
    ]);

    const pack = await buildEvidencePack(
      {
        securityId: fixture.security.id,
        asOfInstant: ASOF,
        window: WINDOW,
        retrievalQuery: 'q',
        security: fixture.security,
      },
      { db, modelBackend: backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED },
    );

    // Fixture has 4 raw items across 3 axes; items 1 (substack) and 2 (reddit crosspost) share a
    // normalized url/title but are two different sampling-frame observations and must both
    // survive — never collapsed into one, however similar their content.
    expect(pack.items).toHaveLength(4);
    const substackItem = pack.items.find((i) => i.item.provider === 'substack');
    const redditCrosspost = pack.items.find(
      (i) => i.item.provider === 'reddit' && i.item.rawHash === 'hash-conflict-2',
    );
    expect(substackItem).toBeDefined();
    expect(redditCrosspost).toBeDefined();
    expect(substackItem?.axis).toBe('substack');
    expect(redditCrosspost?.axis).toBe('reddit');
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
      { db, modelBackend: backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED },
    );

    expect(pack.items).toHaveLength(1);
    expect(pack.items[0]?.relevant).toBe(false);
    expect(pack.items[0]?.excludedReason).toMatch(/no mention/);
    expect(pack.items[0]?.relevanceMethodVersion).toBe(DETERMINISTIC_CANDIDACY_VERSION_TAG);
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
        { db, modelBackend: backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED },
      );

      const byId = new Map(pack.items.map((i) => [i.item.id, i]));
      // item 1: cashtag, direct relevance candidate, confirmed relevant.
      const item1 = byId.get('30000000-0000-0000-0000-000000000001');
      expect(item1?.relevant).toBe(true);
      expect(item1?.relevanceMethodVersion).toBe(RELEVANCE_FILTER_VERSION_TAG);
      // item 2: ambiguous + corroborated, guard confirms, relevance confirms -- the LAST method
      // attempted (relevance.filter) is what is stamped, since it made the final call.
      const item2 = byId.get('30000000-0000-0000-0000-000000000002');
      expect(item2?.relevant).toBe(true);
      expect(item2?.relevanceMethodVersion).toBe(RELEVANCE_FILTER_VERSION_TAG);
      // item 3: ambiguous, uncorroborated -- excluded pre-LLM, no method ever attempted.
      const item3 = byId.get('30000000-0000-0000-0000-000000000003');
      expect(item3?.relevant).toBe(false);
      expect(item3?.flags).toContain('ticker_collision');
      expect(item3?.excludedReason).toMatch(/no corroborating/);
      expect(item3?.relevanceMethodVersion).toBe(DETERMINISTIC_CANDIDACY_VERSION_TAG);
      // item 4: ambiguous, uncorroborated -- same as item 3.
      const item4 = byId.get('30000000-0000-0000-0000-000000000004');
      expect(item4?.relevant).toBe(false);
      expect(item4?.relevanceMethodVersion).toBe(DETERMINISTIC_CANDIDACY_VERSION_TAG);
      // item 5: ambiguous + corroborated (literal company name present), but the guard rejects it
      // -- the guard WAS attempted, so it (not the deterministic sentinel) must be stamped
      // (lane-review finding 5: a rejection must still attribute the method that ran).
      const item5 = byId.get('30000000-0000-0000-0000-000000000005');
      expect(item5?.relevant).toBe(false);
      expect(item5?.flags).toContain('ticker_collision');
      expect(item5?.excludedReason).toMatch(/coincidental/);
      expect(item5?.relevanceMethodVersion).toBe(COLLISION_GUARD_VERSION_TAG);
    });

    it('attributes the collision guard, not the deterministic sentinel, when the guard is unavailable (lane-review finding 5)', async () => {
      const fixture = loadEvidencePackFixture('ticker_collision');
      // Isolate to just the one corroborated-ambiguous item (item 2) so there is exactly one
      // collision-guard dispatch to observe, and no relevance.filter dispatch to confuse it with.
      const item2 = fixture.items.find((i) => i.id === '30000000-0000-0000-0000-000000000002');
      if (item2 === undefined) throw new Error('fixture item 2 not found');
      const db = fakeEvidenceDb([item2]);
      const backend = new FixtureModelBackend([{ kind: 'throw', message: 'guard unavailable' }]);

      const pack = await buildEvidencePack(
        {
          securityId: fixture.security.id,
          asOfInstant: ASOF,
          window: WINDOW,
          retrievalQuery: 'q',
          security: fixture.security,
        },
        { db, modelBackend: backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED },
      );

      expect(pack.items).toHaveLength(1);
      expect(pack.items[0]?.relevant).toBe(false);
      expect(pack.items[0]?.relevanceMethodVersion).toBe(COLLISION_GUARD_VERSION_TAG);
      expect(pack.items[0]?.excludedReason).toMatch(/unavailable/);
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
      { db, modelBackend: backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED },
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
      { db, modelBackend: backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED },
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
    // Attempted, and denied -- not the "never even tried" sentinel (lane-review finding 5).
    expect(pack.items[0]?.relevanceMethodVersion).toBe(RELEVANCE_FILTER_VERSION_TAG);
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
        checkBudget: ALWAYS_ALLOWED,
        onModelCallRecord: (_record, methodTitle) => {
          records.push({ methodTitle });
        },
      },
    );

    expect(records).toEqual([{ methodTitle: 'Relevance filter' }]);
  });

  describe('the ≤30 cap (lane-review finding 2)', () => {
    it('selects by recency across the whole processed set, so a more recent excluded item is not starved by older relevant volume', async () => {
      const securityId = '00000000-0000-0000-0000-0000000000c5';
      const security = { id: securityId, symbol: 'ACME', companyName: 'Acme Corporation' };

      // 30 older, relevant items -- fills the cap exactly on its own.
      const relevantItems = Array.from({ length: 30 }, (_, i) =>
        fakeEvidenceItem({
          securityId,
          provider: 'reddit',
          title: `Acme Corporation older update ${i}`,
          sourceUrl: `https://reddit.com/r/acme/comments/older-${i}`,
          rawHash: `hash-older-${i}`,
          // All older than the excluded item below.
          availableAt: new Date(ASOF.getTime() - (i + 10) * 60_000),
        }),
      );
      // One item with NO mention of the security at all (a genuine, classification-based
      // exclusion), but more RECENT than every relevant item above.
      const excludedItem = fakeEvidenceItem({
        securityId,
        provider: 'reddit',
        title: 'Completely unrelated market commentary',
        snippet: 'Nothing about any specific company here.',
        sourceUrl: 'https://reddit.com/r/stocks/comments/unrelated',
        rawHash: 'hash-excluded-recent',
        availableAt: new Date(ASOF.getTime() - 60_000),
      });

      const db = fakeEvidenceDb([...relevantItems, excludedItem]);
      const backend = new FixtureModelBackend([relevantJson(relevantItems.map((i) => i.id))]);

      const pack = await buildEvidencePack(
        { securityId, asOfInstant: ASOF, window: WINDOW, retrievalQuery: 'q', security },
        { db, modelBackend: backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED },
      );

      expect(pack.items).toHaveLength(MAX_PACK_ITEMS);
      const excluded = pack.items.find((i) => i.item.rawHash === 'hash-excluded-recent');
      expect(excluded).toBeDefined();
      expect(excluded?.relevant).toBe(false);
      expect(excluded?.excludedReason).toMatch(/no mention/);
      // Its slot came from the single OLDEST relevant item being displaced, not from discarding
      // the excluded item's own reason.
      expect(pack.items.some((i) => i.item.title === 'Acme Corporation older update 29')).toBe(false);
    });

    it('reports a true pre-dedup retrieved count independent of the pack-level cap', async () => {
      const securityId = '00000000-0000-0000-0000-0000000000c6';
      const security = { id: securityId, symbol: 'ACME', companyName: 'Acme Corporation' };
      const items = Array.from({ length: 36 }, (_, i) =>
        fakeEvidenceItem({
          securityId,
          provider: 'reddit',
          title: `Acme Corporation update ${i}`,
          sourceUrl: `https://reddit.com/r/acme/comments/count-${i}`,
          rawHash: `hash-count-${i}`,
          availableAt: new Date(ASOF.getTime() - i * 60_000),
        }),
      );
      const db = fakeEvidenceDb(items);
      const backend = new FixtureModelBackend([relevantJson(items.map((i) => i.id))]);

      const pack = await buildEvidencePack(
        { securityId, asOfInstant: ASOF, window: WINDOW, retrievalQuery: 'q', security },
        { db, modelBackend: backend, model: 'test-model', checkBudget: ALWAYS_ALLOWED },
      );

      const reddit = pack.frames.find((f) => f.axis === 'reddit');
      expect(reddit?.retrievedCount).toBe(36);
      expect(reddit?.usedCount).toBe(MAX_PACK_ITEMS);
      expect(pack.items).toHaveLength(MAX_PACK_ITEMS);
    });
  });
});
