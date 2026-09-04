import { describe, expect, it } from 'vitest';
import { estimatePostReadCostUsd, fetchRecentSearch } from '@/adapters/x';
import { harness } from './fakes';

const withCase = (fixtureCase: string) => ({ headers: { 'x-fixture-case': fixtureCase } });

/**
 * A single, clearly-labeled placeholder query used everywhere in this file — never a real
 * governed cohort (see `adapters/x.ts`'s module doc; D-23 defers that question).
 */
const PLACEHOLDER_QUERY = '$AAPL -is:retweet lang:en';

describe('estimatePostReadCostUsd', () => {
  it('computes exact decimal cents at $0.005/unit, with no floating-point drift', () => {
    expect(estimatePostReadCostUsd(1)).toBe('0.005');
    expect(estimatePostReadCostUsd(10)).toBe('0.050');
    expect(estimatePostReadCostUsd(100)).toBe('0.500');
    expect(estimatePostReadCostUsd(200)).toBe('1.000');
  });

  it('rejects a non-integer or negative unit count rather than silently truncating', () => {
    expect(() => estimatePostReadCostUsd(1.5)).toThrow(/positive integer/);
    expect(() => estimatePostReadCostUsd(-1)).toThrow(/positive integer/);
  });

  /**
   * Finding 6 (review round). `estimatePostReadCostUsd(0)` used to return `'0.000'` — a
   * real-looking-but-fake-zero cost string that `contracts/provider.ts` and `wrapper.ts`'s own
   * doc both forbid ("never `'0'`"; null means unpriced). Unreachable from `fetchRecentSearch`
   * today (`maxResults` is clamped to a minimum of 10), but the function is exported standalone
   * from `adapters/index.ts`, and a future caller computing a remaining-read allowance that
   * lands on exactly zero must not be able to manufacture a fake-zero `cost_event` from it.
   */
  it('rejects zero rather than returning a fake-zero cost string', () => {
    expect(() => estimatePostReadCostUsd(0)).toThrow(/positive integer/);
  });
});

describe('fetchRecentSearch — F04 §4.3, X (mechanical plumbing only; no governed cohort)', () => {
  it('returns parsed posts, joining author username from includes.users', async () => {
    const h = harness();

    const result = await fetchRecentSearch({ query: PLACEHOLDER_QUERY }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        id: '1900000000000000001',
        text: '$AAPL breaking out on volume, watching the 200-day',
        authorId: '1000000000000000001',
        authorUsername: 'example_trader_one',
        createdAt: '2026-08-30T14:02:11.000Z',
        lang: 'en',
        metrics: {
          retweetCount: 3,
          replyCount: 1,
          likeCount: 12,
          quoteCount: 0,
          bookmarkCount: 2,
          impressionCount: 480,
        },
      });
      // Second post carries no bookmark_count/impression_count — kept null, not fabricated.
      expect(result.data[1]?.metrics.bookmarkCount).toBeNull();
      expect(result.data[1]?.metrics.impressionCount).toBeNull();
    }
  });

  it('returns an empty array, ok:true, when X omits "data" entirely (its documented zero-result shape)', async () => {
    const h = harness();

    const result = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, ...withCase('empty') },
      'fixture',
      h.deps,
    );

    expect(result).toMatchObject({ ok: true, data: [] });
  });

  /**
   * Round-2 lane-review finding 1+2. A dispatched, schema-valid, `ok: true` response that read
   * zero Posts is the ordinary shape of a trigger-sampled query matching nothing — the module
   * doc's own stated rule ("no billable Post ⇒ no charge") must hold for this success case
   * exactly as it already did for a dispatched failure. Before this fix it was billed the full
   * `maxResults × $0.005` ceiling and held the full read-ledger reservation forever.
   */
  it('bills nothing and releases the full quota reservation for a genuine zero-post success', async () => {
    const h = harness();

    const result = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, maxResults: 100, ...withCase('empty') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(true);
    expect(result.meta.costUsd).toBeNull();
    expect(h.costs).toHaveLength(0);
    // The full 100-unit reservation is handed back — none of it was actually read.
    expect(h.released).toEqual([100]);
    expect(h.logs[0]?.itemsReturned).toBe(0);
  });

  it('reports a 200 response missing the required meta envelope as a contract violation, not a crash', async () => {
    const h = harness();

    const result = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, ...withCase('malformed') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  /**
   * Round-2 lane-review finding 3, corrected by round-3 findings 1-3. `unexpected_field` bundles
   * two concerns this test keeps distinct from the one below: real unknown provider fields
   * (`possibly_sensitive`, `conversation_id`, `organic_metrics`), which the schema must tolerate
   * — the `05-TEST-STRATEGY.md` §2 case every other adapter also has — *and* a top-level
   * `errors` array, X's documented shape for a routine per-item expansion miss. Round 2 fixed
   * this case into a hard failure, silently losing the forward-compatibility assertion every
   * peer adapter's `unexpected_field` test makes (round-3 finding 3). Round 3 corrected the
   * behaviour back to `ok: true` (see `x.ts`'s own updated doc: discarding a real, billed,
   * priced post over a benign expansion miss is worse than surfacing the gap loudly), so this
   * restores the peer-consistent assertion while also pinning the loud signal.
   */
  it('tolerates an unknown provider field and surfaces (without failing on) a top-level partial-errors array', async () => {
    const h = harness();

    const result = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, ...withCase('unexpected_field') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(1);
    expect(h.violations).toHaveLength(1);
    expect(h.violations[0]?.issues.join(' ')).toContain('errors:');
    // Billed and quota-debited for the one real post it returned — the failure/success paths
    // never diverge, because this is no longer a failure path (round-3 finding 2).
    expect(result.meta.costUsd).not.toBeNull();
    expect(h.logs[0]?.errorClass).toBeNull();
  });

  it('surfaces (without failing on) a result_count short of the actual post list', async () => {
    const h = harness();

    const result = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, ...withCase('result_count_mismatch') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(1);
    expect(h.violations[0]?.issues.join(' ')).toContain('meta.result_count');
  });

  /**
   * Round-4 lane-review finding 1. A response claiming a nonzero `result_count` while shipping no
   * `data` at all is billed, logged and quota-debited identically to the honest `empty` fixture's
   * genuine zero-match query — there is no real data here to make it the routine partial-response
   * case the test above covers, so it must fail loudly rather than fold into `ok: true`.
   */
  it('fails when result_count is nonzero but no data came back at all — never indistinguishable from an honest empty result', async () => {
    const h = harness();

    const result = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, ...withCase('zero_data_nonzero_count') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
    expect(h.violations[0]?.issues.join(' ')).toContain('meta.result_count');
    expect(result.meta.costUsd).toBeNull();
  });

  /**
   * Round-5 lane-review finding 2. X's `errors` array is the one place it might state why zero
   * data came back despite a nonzero claimed count — discarding it left the failure with no
   * stated cause even when the provider supplied one.
   */
  it('includes the provider-stated errors when a zero-yield-nonzero-claim response also carries them', async () => {
    const h = harness();

    const result = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, ...withCase('zero_data_with_errors') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    expect(h.violations[0]?.issues.join(' ')).toContain('meta.result_count');
    expect(h.violations[0]?.issues.join(' ')).toContain('Not Found Error');
  });

  it('fails the batch on a null where a required metric number is expected (like_count)', async () => {
    const h = harness();

    const result = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, ...withCase('null_where_number') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  it('never throws on a 403', async () => {
    const h = harness();

    const result = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, ...withCase('entitlement_403') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'entitlement', endpoint: 'search_recent', status: 403 });
    }
  });

  it("honours Retry-After on a 429 (the wrapper's generic behaviour — not a claim about X's real header)", async () => {
    const h = harness();

    const result = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, ...withCase('rate_limited_with_retry_after') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'rate_limit', retryAfterMs: 30_000 });
  });

  it('reports rate_limit with retryAfterMs:0 when no Retry-After header is present', async () => {
    const h = harness();

    const result = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, ...withCase('rate_limited_without_retry_after') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'rate_limit', retryAfterMs: 0 });
  });

  it('reports a 5xx as an upstream failure, never throwing', async () => {
    const h = harness();

    const result = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, ...withCase('server_error') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'upstream', status: 503 });
  });

  it('is priced — costUsd is a non-zero decimal string, never null and never "0"', async () => {
    const h = harness();

    const result = await fetchRecentSearch({ query: PLACEHOLDER_QUERY }, 'fixture', h.deps);

    expect(result.meta.costUsd).not.toBeNull();
    expect(result.meta.costUsd).not.toBe('0');
    // Default maxResults is 10 -> 10 * $0.005 = $0.050, the worst-case pre-dispatch estimate.
    expect(result.meta.costUsd).toBe('0.050');
  });

  /**
   * Finding 3 (review round). X bills **per Post returned**, not per call — a dispatched
   * request that comes back with zero posts because it *failed* must not be billed the
   * worst-case ceiling. Before this fix, `wrapper.ts`'s `finish()` billed any call that reached
   * stage 5 (`dispatched: true`), regardless of whether it actually succeeded — so a 403, a 5xx
   * exhausted through every retry, or a contract failure was billed the full
   * `maxResults × $0.005` for zero posts collected, which would drain F18's global budget
   * ceiling (D-32) against money that was never actually spent.
   */
  describe('cost accounting on a dispatched-but-failed call (finding 3)', () => {
    it('bills nothing for a 403 that reached the provider and was refused', async () => {
      const h = harness();
      const result = await fetchRecentSearch(
        { query: PLACEHOLDER_QUERY, ...withCase('entitlement_403') },
        'fixture',
        h.deps,
      );

      expect(result.ok).toBe(false);
      expect(result.meta.costUsd).toBeNull();
      // Distinct from the never-dispatched (budget/quota-refused) case: this call did reach the
      // provider, and the log proves it with a real status code.
      expect(h.logs[0]?.statusCode).toBe(403);
      expect(h.costs).toHaveLength(0);
    });

    it('bills nothing for a 5xx exhausted through every retry', async () => {
      const h = harness();
      const result = await fetchRecentSearch(
        { query: PLACEHOLDER_QUERY, ...withCase('server_error') },
        'fixture',
        h.deps,
      );

      expect(result.ok).toBe(false);
      expect(result.meta.costUsd).toBeNull();
      expect(h.logs[0]?.statusCode).toBe(503);
      expect(h.costs).toHaveLength(0);
    });

    it('bills nothing for a 200 that fails contract validation', async () => {
      const h = harness();
      const result = await fetchRecentSearch(
        { query: PLACEHOLDER_QUERY, ...withCase('malformed') },
        'fixture',
        h.deps,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('contract');
      expect(result.meta.costUsd).toBeNull();
      expect(h.costs).toHaveLength(0);
    });

    it('still bills the worst-case estimate for a genuine successful dispatch, for contrast', async () => {
      const h = harness();
      const result = await fetchRecentSearch({ query: PLACEHOLDER_QUERY }, 'fixture', h.deps);

      expect(result.ok).toBe(true);
      expect(result.meta.costUsd).toBe('0.050');
      expect(h.logs[0]?.statusCode).toBe(200);
      expect(h.costs).toHaveLength(1);
    });
  });

  it('estimates cost off the clamped maxResults, not the actual number of posts returned', async () => {
    const h = harness();

    // The success fixture returns 2 posts; maxResults asked for 50, so cost is billed at the
    // worst-case 50, not the 2 actually returned (see the module doc's cost note).
    const result = await fetchRecentSearch({ query: PLACEHOLDER_QUERY, maxResults: 50 }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(2);
    expect(result.meta.costUsd).toBe('0.250');
  });

  it('clamps maxResults to X\'s documented 10-100 bound rather than sending an out-of-range value', async () => {
    const h = harness();

    const tooFew = await fetchRecentSearch({ query: PLACEHOLDER_QUERY, maxResults: 1 }, 'fixture', h.deps);
    expect(tooFew.meta.costUsd).toBe(estimatePostReadCostUsd(10));

    const tooMany = await fetchRecentSearch({ query: PLACEHOLDER_QUERY, maxResults: 500 }, 'fixture', h.deps);
    expect(tooMany.meta.costUsd).toBe(estimatePostReadCostUsd(100));
  });

  /**
   * Finding 5 (review round). The cache key omitted `max_results`, but the response varies on
   * it — `apewisdom.ts` already includes its own varying `page` in its cache key for exactly
   * this reason. Without `max_results` in the key, a `maxResults: 100` call following a cached
   * `maxResults: 10` call would incorrectly be served the 10-post cached entry as a hit. Latent
   * today (nothing sets `cacheTtlMs` for X yet), but D-15's trigger spends "up to
   * `X_READS_PER_TRIGGER_EVENT` reads" — making read count exactly the variable that changes
   * per trigger event once F16a wires the trigger.
   */
  it('keys the cache on max_results, so a larger read is never served a smaller cached entry', async () => {
    const h = harness();

    const small = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, maxResults: 10, cacheTtlMs: 60_000 },
      'fixture',
      h.deps,
    );
    expect(small.meta.cache).toBe('miss');

    const large = await fetchRecentSearch(
      { query: PLACEHOLDER_QUERY, maxResults: 100, cacheTtlMs: 60_000 },
      'fixture',
      h.deps,
    );
    // Must be a fresh miss against a distinct cache key, never a `hit` against the
    // maxResults:10 entry stored above.
    expect(large.meta.cache).toBe('miss');
  });

  it('reserves quota units equal to maxResults, not a flat one call — reads are the metered unit', async () => {
    const h = harness();

    await fetchRecentSearch({ query: PLACEHOLDER_QUERY, maxResults: 25 }, 'fixture', h.deps);

    expect(h.trace).toContain('quota.reserve:25');
  });

  it('records the cost as unitType post_read', async () => {
    const h = harness();

    await fetchRecentSearch({ query: PLACEHOLDER_QUERY }, 'fixture', h.deps);

    expect(h.costs).toHaveLength(1);
    expect(h.costs[0]?.unitType).toBe('post_read');
  });

  it('checks the budget before every priced request (F04 §4.1 stage 1, before stage 2)', async () => {
    const h = harness();

    await fetchRecentSearch({ query: PLACEHOLDER_QUERY }, 'fixture', h.deps);

    const budgetIndex = h.trace.indexOf('budget.check');
    const quotaIndex = h.trace.findIndex((entry) => entry.startsWith('quota.reserve'));
    expect(budgetIndex).toBeGreaterThanOrEqual(0);
    expect(quotaIndex).toBeGreaterThan(budgetIndex);
  });

  it('never dispatches when the budget denies the call, and never charges a cost for it', async () => {
    const h = harness({ budgetAllowed: false });

    const result = await fetchRecentSearch({ query: PLACEHOLDER_QUERY }, 'fixture', h.deps);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'budget_denied', scope: 'global' });
    // `h.calls()` cannot be used here (and must not be, in this file): `fetchRecentSearch`
    // always builds its own fetcher via `createFetcher(providerMode, ...)` and hands it to the
    // wrapper as `{ ...deps, fetcher }`, overriding the harness's own fake fetcher entirely — so
    // `h.calls()` is 0 for every call in this file, including the ones that dispatch and
    // succeed. Asserting `h.calls() === 0` here would pass even if the budget check ran *after*
    // dispatch. `h.logs[0]?.statusCode`, by contrast, is populated by the wrapper's own
    // `callLog` sink (still wired through `deps`), and is `null` only when a call never reached
    // stage 5 — a real, load-bearing distinction, since D-32 starts X's budget ceiling at zero,
    // making this refusal path X's steady state rather than an edge case.
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]?.statusCode).toBeNull();
    expect(h.costs).toHaveLength(0);
  });

  it('throws fast in live mode with no bearerToken, rather than sending an unauthenticated request', async () => {
    const h = harness();

    await expect(fetchRecentSearch({ query: PLACEHOLDER_QUERY }, 'live', h.deps)).rejects.toThrow(
      /bearerToken is required/,
    );
  });

  // No test exercises the constructed `Authorization` header or the live fetcher end-to-end:
  // `fetchRecentSearch` always rebuilds its own fetcher from `createFetcher(providerMode, ...)`
  // (see `adapters/fixtures.ts`), so nothing this test file controls can intercept the request
  // actually handed to a live `fetch()` without either making a real network call (banned in a
  // unit test) or duplicating the adapter's own URL/header-construction logic in the test —
  // exactly the same limitation every other adapter in this codebase already has, and none of
  // their test files papers over it with a fake assertion either.
});
