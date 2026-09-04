import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScoreRequestItem } from '@/adapters/scorer';
import { readFixture } from '@/adapters/fixtures';
import {
  postScoreBatch,
  SCORER_TIMEOUT_MS,
  scoreDistributionIssues,
  scoreRequestBody,
} from '@/adapters/scorer';
import { harness } from './fakes';

/**
 * Writes a one-off `success` fixture into a scratch tree, so a test can vary a recorded payload
 * without adding a committed fixture for a case that is only interesting once. The same
 * `mkdtemp` discipline `fixtures.test.ts` already uses, and for the same reason: the committed
 * `fixtures/` namespace stays a record of real payloads.
 */
async function scratchFixtures(body: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'scorer-fixture-'));
  await mkdir(join(root, 'scorer', 'score'), { recursive: true });
  await writeFile(
    join(root, 'scorer', 'score', 'success.json'),
    JSON.stringify({ status: 200, headers: { 'content-type': 'application/json' }, body }),
  );
  return root;
}

const ITEMS: ScoreRequestItem[] = [
  { itemId: '11111111-1111-4111-8111-111111111111', text: 'bullish quarter', kind: 'finbert' },
  { itemId: '22222222-2222-4222-8222-222222222222', text: 'a long essay', kind: 'finbert' },
  { itemId: '33333333-3333-4333-8333-333333333333', text: 'bearish take', kind: 'tweet-roberta' },
];

const withCase = (fixtureCase: string) => ({ headers: { 'x-fixture-case': fixtureCase } });

describe('the scorer adapter — F20 §3 on the wire', () => {
  it('returns one ScoreResult per requested item, in order', async () => {
    const h = harness();

    const result = await postScoreBatch({ items: ITEMS }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rejected).toEqual([]);
    expect(result.data.admitted.map((r) => r.itemId)).toEqual(ITEMS.map((item) => item.itemId));
    expect(result.data.admitted[1]!.truncated).toBe(true);
    expect(result.data.admitted[0]!.scores.bullish).toBe('0.900000');
    expect(result.data.admitted[2]!.scorer.scorerId).toBe('tweet-roberta');
  });

  it('sends {itemId, text, kind}, with kind carrying the routed scorer id', () => {
    // `kind` is the scorer id, not a source kind: `services/scorer/app.py` keys its backends by
    // `scorer_id` and returns 400 for anything else. See the module doc.
    expect(JSON.parse(scoreRequestBody(ITEMS))).toEqual([
      { itemId: ITEMS[0]!.itemId, text: 'bullish quarter', kind: 'finbert' },
      { itemId: ITEMS[1]!.itemId, text: 'a long essay', kind: 'finbert' },
      { itemId: ITEMS[2]!.itemId, text: 'bearish take', kind: 'tweet-roberta' },
    ]);
  });

  it('is unpriced and reserves no quota — it is our own container, not a metered vendor', async () => {
    const h = harness();

    const result = await postScoreBatch({ items: ITEMS }, 'fixture', h.deps);

    expect(result.meta.costUsd).toBeNull();
    expect(h.costs).toEqual([]);
    expect(h.trace).toContain('quota.reserve:0');
  });

  it('never caches — every batch is a distinct set of items, so a hit would be a bug', async () => {
    const h = harness();

    await postScoreBatch({ items: ITEMS }, 'fixture', h.deps);

    expect(h.trace).not.toContain('cache.get');
    expect(h.cacheEntries.size).toBe(0);
  });

  it('logs the call under provider "scorer", so an outage is visible in provider_call_log', async () => {
    const h = harness();

    await postScoreBatch({ items: ITEMS }, 'fixture', h.deps);

    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({ provider: 'scorer', operation: 'score', itemsReturned: 3 });
  });

  it('gives the scorer longer than a JSON API, because CPU inference is slower', () => {
    expect(SCORER_TIMEOUT_MS).toBeGreaterThan(10_000);
  });
});

describe('what the adapter refuses to admit into the corpus', () => {
  /** Every refusal is now attributed to the one item it concerns — see `admitPerItem`. */
  const rejectionFor = (result: Awaited<ReturnType<typeof postScoreBatch>>, itemId: string) => {
    if (!result.ok) throw new Error('expected ok:true with a per-item rejection');
    return result.data.rejected.find((row) => row.itemId === itemId);
  };

  it('rejects a score sent as a JSON number instead of a decimal string', async () => {
    const h = harness();

    const result = await postScoreBatch({ items: ITEMS, ...withCase('float_score') }, 'fixture', h.deps);

    expect(rejectionFor(result, ITEMS[0]!.itemId)?.issues.join(' ')).toContain('never JSON numbers');
    expect(h.violations).toHaveLength(1);
  });

  it('rejects a scorerVersion that is a moveable tag rather than a commit SHA', async () => {
    const h = harness();

    const result = await postScoreBatch({ items: ITEMS, ...withCase('unpinned_version') }, 'fixture', h.deps);

    // The client-side half of the service's boot assertion: even a mis-pinned service that
    // somehow booted cannot get a score past this point.
    expect(rejectionFor(result, ITEMS[0]!.itemId)?.issues.join(' ')).toContain('40-hex-commit-sha');
  });

  it('rejects a response that answers for an item nobody asked about', async () => {
    const h = harness();

    const result = await postScoreBatch({ items: ITEMS, ...withCase('wrong_item') }, 'fixture', h.deps);

    // Attaching this score to the wrong item is the silent substitution §4.2 rule 2 forbids,
    // and the zod schema alone cannot see it — only the request/response comparison can.
    expect(rejectionFor(result, ITEMS[0]!.itemId)?.issues.join(' ')).toContain('returned no result');
    expect(JSON.stringify(h.violations)).toContain('was not requested');
    // The unrequested row is discarded, not attached to anything.
    expect(result.ok && result.data.admitted.map((r) => r.itemId)).not.toContain(
      '99999999-9999-4999-8999-999999999999',
    );
  });

  it('rejects an empty answer to a non-empty batch, item by item', async () => {
    const h = harness();

    const result = await postScoreBatch({ items: ITEMS, ...withCase('empty') }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.admitted).toEqual([]);
    expect(result.data.rejected.map((row) => row.itemId)).toEqual(ITEMS.map((item) => item.itemId));
  });

  it('rejects a result scored by a different model than the item was routed to', async () => {
    const h = harness();

    const result = await postScoreBatch({ items: ITEMS, ...withCase('wrong_scorer') }, 'fixture', h.deps);

    // Two models inside one series is exactly what Tier D3 rejects; catching it at the wire is
    // cheaper than catching it in an aggregate three weeks later.
    expect(rejectionFor(result, ITEMS[0]!.itemId)?.issues.join(' ')).toContain(
      'was routed to finbert but was scored by tweet-roberta',
    );
  });

  it('admits the good rows in a response that also contains a bad one', async () => {
    const h = harness();

    // `float_score` poisons only the first row. Before lane-review finding 1 this returned a
    // single contract error for the whole response, and the worker charged it to all three.
    const result = await postScoreBatch({ items: ITEMS, ...withCase('float_score') }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.admitted.map((r) => r.itemId)).toEqual([ITEMS[1]!.itemId, ITEMS[2]!.itemId]);
    expect(result.data.rejected.map((r) => r.itemId)).toEqual([ITEMS[0]!.itemId]);
  });

  it('accepts a field the service grew, and ignores it', async () => {
    const h = harness();

    const result = await postScoreBatch({ items: ITEMS, ...withCase('unexpected_field') }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rejected).toEqual([]);
    expect(result.data.admitted[0]).not.toHaveProperty('calibrationVersion');
  });
});

describe('scores must be a probability distribution (lane-review finding 4)', () => {
  const distribution = (bullish: string, bearish: string, neutral: string) => ({
    bullish,
    bearish,
    neutral,
  });

  it('accepts a well-formed distribution', () => {
    expect(scoreDistributionIssues('bullish', distribution('0.900000', '0.050000', '0.050000'))).toEqual([]);
  });

  it('rejects a value outside [0, 1]', () => {
    // The exact response lane-review named: three well-formed decimal strings, every syntactic
    // rule satisfied, and it would have been persisted as `scorer_provenance: 'pinned'` under a
    // correctly pinned SHA — a number the corpus could never explain.
    const issues = scoreDistributionIssues('bullish', distribution('12.34', '-0.5', '0'));
    expect(issues.join(' ')).toContain('outside [0, 1]');
    expect(issues).toHaveLength(2);
  });

  it('rejects three values that do not sum to 1', () => {
    const issues = scoreDistributionIssues('bullish', distribution('0.900000', '0.900000', '0.900000'));
    expect(issues.join(' ')).toContain('sum to 2.7, not 1');
  });

  it('tolerates the rounding the service actually does, and nothing wider', () => {
    // scoring.py formats each softmax probability to six places, so three half-up-rounded
    // values can miss an exact 1 by at most 1.5e-6.
    expect(scoreDistributionIssues('neutral', distribution('0.333333', '0.333333', '0.333334'))).toEqual([]);
    expect(scoreDistributionIssues('neutral', distribution('0.333333', '0.333333', '0.333333'))).toEqual([]);
    // An order of magnitude beyond that is a defect, not rounding.
    expect(
      scoreDistributionIssues('bullish', distribution('0.500000', '0.400000', '0.050000')).join(' '),
    ).toContain('not 1');
  });

  it('rejects a label that is not a maximum of its own distribution', () => {
    const issues = scoreDistributionIssues('bullish', distribution('0.050000', '0.900000', '0.050000'));
    expect(issues.join(' ')).toContain("label is 'bullish'");
    expect(issues.join(' ')).toContain('must be a maximum');
  });

  it('allows a tie, because six-decimal rounding can produce one', () => {
    // `models.py` picks the label with `max()` on the *unrounded* floats, so two genuinely
    // different probabilities can arrive as the same string. Requiring a strict maximum here
    // would reject a correct response — a false rejection that would eventually mark a real
    // item unscoreable.
    expect(scoreDistributionIssues('bullish', distribution('0.500000', '0.500000', '0.000000'))).toEqual([]);
    expect(scoreDistributionIssues('bearish', distribution('0.500000', '0.500000', '0.000000'))).toEqual([]);
  });

  it('refuses a bad distribution at the wire, per item', async () => {
    const h = harness();
    const body = (await readFixture('scorer', 'score', 'success')).body as Array<{
      scores: Record<string, string>;
    }>;
    const skewed = structuredClone(body);
    skewed[0]!.scores = { bullish: '12.34', bearish: '-0.5', neutral: '0' };

    const result = await postScoreBatch(
      { items: ITEMS, ...withCase('success') },
      'fixture',
      { ...h.deps, fixturesRoot: await scratchFixtures(skewed) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rejected.map((r) => r.itemId)).toEqual([ITEMS[0]!.itemId]);
    expect(result.data.admitted).toHaveLength(2);
  });
});

describe('the outage, as the collector sees it', () => {
  it('returns an upstream error for a 503 rather than throwing into the worker', async () => {
    const h = harness();

    const result = await postScoreBatch({ items: ITEMS, ...withCase('server_error') }, 'fixture', h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'upstream', status: 503 });
    // Not a contract violation: the service is down, it has not changed shape.
    expect(h.violations).toEqual([]);
  });

  it("reports the service's own 400 for a malformed batch as an upstream failure", async () => {
    const h = harness();

    const result = await postScoreBatch({ items: ITEMS, ...withCase('bad_request') }, 'fixture', h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'upstream', status: 400 });
  });
});

describe('mode and argument guards', () => {
  it('reads the recorded batch with no network at all', async () => {
    const h = harness();

    const result = await postScoreBatch({ items: ITEMS }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    // The injected fetcher was replaced by the fixture reader, so the "network" was never used.
    expect(h.calls()).toBe(0);
  });

  it('refuses a live call with no base URL rather than posting to a placeholder host', async () => {
    const h = harness();

    await expect(postScoreBatch({ items: ITEMS }, 'live', h.deps)).rejects.toThrow('baseUrl is required');
  });

  it('refuses an empty batch, which is a caller bug and not a provider condition', async () => {
    const h = harness();

    await expect(postScoreBatch({ items: [] }, 'fixture', h.deps)).rejects.toThrow('empty batch');
  });
});
