/**
 * F10 test plan (§5, "Contract"): "Reddit / Substack / X fixtures → normalized items, each
 * tagged with its frame; F20 `ScoreResult` schema validation; a scorer that is unreachable
 * produces abstention, never a substituted number (D-13)."
 *
 * This lane never calls the scorer (F20 owns that, asynchronously, off the request path) — what
 * this suite proves is the other half of that same invariant from F10's side of the boundary:
 * every fixture-driven pack this feature actually builds (a) validates against the frozen
 * `EvidencePack`/`ClassifiedItem` contract, (b) tags each item with the correct frame, and (c)
 * never invents a stance for an item the scorer has not scored — `stanceLabel: null` in is
 * `stanceLabel: null` out, exactly, never coerced into `'neutral'` or any other value.
 */
import { describe, expect, it } from 'vitest';
import { evidencePack } from '@/contracts/evidence-pack';
import { scoreResultSchema, scoreDistributionIssues } from '@/adapters/scorer';
import { FixtureModelBackend } from '@/services/evidence/model-client';
import { buildEvidencePack } from '@/services/evidence/pack-builder';
import { DETERMINISTIC_CANDIDACY_VERSION_TAG } from '@/services/evidence/method-registry';
import { fakeEvidenceDb, loadEvidencePackFixture } from '../unit/services/evidence/helpers';

const ASOF = new Date('2026-09-04T00:00:00Z');
const WINDOW = { from: new Date('2026-08-28T00:00:00Z'), to: ASOF };
const ALWAYS_ALLOWED = () => Promise.resolve({ allowed: true });

const SCENARIOS = ['clear_bullish', 'sarcasm', 'ticker_collision', 'conflicting_sources', 'thin_evidence'] as const;

/**
 * A response body admissible to **both** `relevanceRowSchema` and `collisionGuardRowSchema` at
 * once (neither is `.strict()`, so each simply ignores the other's field) — deliberately, so
 * this single script answers correctly regardless of whether the collision guard or the
 * relevance filter is dispatched first, or how many times either is called. An earlier version
 * of this test hardcoded the two calls in the wrong order (collision guard actually dispatches
 * first when there are ambiguous-and-corroborated candidates) and passed anyway, because it only
 * asserted schema validity rather than that classification had actually happened — the exact gap
 * lane-review finding 7 found.
 */
function combinedShapeResponse(itemIds: readonly string[]) {
  return {
    kind: 'json' as const,
    body: itemIds.map((itemId) => ({
      itemId,
      relevant: true,
      aboutSecurity: true,
      rationale: 'about the security',
    })),
  };
}

describe('EvidencePack contract — fixture-driven, per scenario', () => {
  it.each(SCENARIOS)('%s builds a pack that validates against the frozen contract, with real classification', async (scenario) => {
    const fixture = loadEvidencePackFixture(scenario);
    const db = fakeEvidenceDb(fixture.items);
    // A single-entry script suffices regardless of how many calls this scenario actually
    // dispatches (collision guard, relevance filter, both, or neither) — `FixtureModelBackend`
    // repeats its last scripted entry once exhausted, and the body is admissible to either
    // method's row schema (see `combinedShapeResponse`'s own docstring).
    const backend = new FixtureModelBackend([combinedShapeResponse(fixture.items.map((i) => i.id))]);

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

    const result = evidencePack.safeParse(pack);
    expect(result.success).toBe(true);

    // Finding 7: schema validity alone would stay green even if classification were deleted
    // entirely (an all-excluded pack is still schema-valid). Assert real classification
    // happened: at least one item was actually confirmed relevant, and at least one item's
    // `relevanceMethodVersion` names a real registered method (not just the "never attempted"
    // deterministic sentinel), proving an LLM method was genuinely dispatched and admitted.
    expect(pack.items.some((item) => item.relevant)).toBe(true);
    expect(pack.items.some((item) => item.relevanceMethodVersion !== DETERMINISTIC_CANDIDACY_VERSION_TAG)).toBe(true);
  });

  it('tags every classified item with the axis matching its provider', async () => {
    const fixture = loadEvidencePackFixture('clear_bullish');
    const db = fakeEvidenceDb(fixture.items);
    const backend = new FixtureModelBackend([
      { kind: 'json', body: fixture.items.map((i) => ({ itemId: i.id, relevant: true, rationale: 'x' })) },
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

    for (const classified of pack.items) {
      expect(classified.axis).toBe(classified.item.provider);
    }
  });

  it('an item with no stored stance (scorer has not scored it) carries stanceConfidence null, never a substituted value', async () => {
    const fixture = loadEvidencePackFixture('clear_bullish');
    const unscored = fixture.items.map((item) => ({ ...item, stanceLabel: null, stanceScore: null }));
    const db = fakeEvidenceDb(unscored);
    const backend = new FixtureModelBackend([
      { kind: 'json', body: unscored.map((i) => ({ itemId: i.id, relevant: true, rationale: 'x' })) },
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

    expect(pack.items.length).toBeGreaterThan(0);
    for (const classified of pack.items) {
      expect(classified.item.stanceLabel).toBeNull();
      expect(classified.stanceConfidence).toBeNull();
    }
  });
});

describe('F20 ScoreResult schema — this lane never produces one, but must recognise one', () => {
  it('validates a well-formed ScoreResult', () => {
    const result = scoreResultSchema.safeParse({
      itemId: 'item-1',
      label: 'bullish',
      scores: { bullish: '0.700000', bearish: '0.100000', neutral: '0.200000' },
      scorer: {
        scorerId: 'finbert',
        scorerVersion: 'org/finbert@' + 'a'.repeat(40),
        runtimeVersion: '1.0.0',
      },
      scoredAt: '2026-09-04T00:00:00.000Z',
      inputHash: 'b'.repeat(64),
      truncated: false,
    });
    expect(result.success).toBe(true);
  });

  it('scoreDistributionIssues flags a distribution that does not sum to 1 -- abstention, never a substituted number', () => {
    const issues = scoreDistributionIssues('bullish', {
      bullish: '12.340000',
      bearish: '-0.500000',
      neutral: '0.000000',
    });
    expect(issues.length).toBeGreaterThan(0);
  });
});
