/**
 * The X (formerly Twitter) adapter — F04 §4.3, `provider: 'x'`.
 *
 * **Scope, decided explicitly for this slice.** This module is mechanical plumbing only: HTTP
 * wrapper integration, request/response parsing and `ProviderResult` wrapping against X API
 * v2's recent-search endpoint. It does **not** decide, or hardcode, a governed list of tracked
 * accounts or cashtags — `docs/PROGRESS.md`'s Deferred table records "Governed X account
 * taxonomy" as deliberately punted (D-23: X is ~5% of the corpus by design) until X exceeds 15%
 * of scored items or a cohort question becomes load-bearing. `fetchRecentSearch` below takes an
 * arbitrary `query` string in X's own search-operator syntax, so naming a real cohort is a
 * caller decision this adapter never makes. Every fixture and test in this slice exercises a
 * single, clearly-labeled placeholder query (`$AAPL -is:retweet lang:en`) purely to prove the
 * shape works — it is not a claim about what the product will ever track.
 *
 * **Schema confidence note, same discipline as `sec-edgar.ts` and `marketaux.ts`.** This
 * session has no working live credential and no network path to X's API, so
 * `xSearchResponse` below is built from X API v2's own published documentation for
 * `GET /2/tweets/search/recent`, not a response this session observed. F04 §4.4's entitlement
 * probe is what confirms this shape (and X's actual entitlement tier) against a real response
 * before anything depends on it in production.
 *
 * **Known, disclosed gap: X's real 429 does not use a standard `Retry-After` header.** X's
 * documented rate-limit signal is `x-rate-limit-reset` (a Unix-epoch second timestamp on every
 * response, not just 429s), not RFC 9110's `Retry-After`. `wrapper.ts`'s stage-6 retry logic
 * (`errors.ts#parseRetryAfter`) reads only `retry-after`, generically, for every provider — it
 * is shared code this slice was told not to reimplement. So a live X 429 will currently fall
 * through to `retryAfterMs: 0` unless X *also* sends a standard header (undocumented; unknown
 * whether it does). This adapter's `rate_limited_with_retry_after` / `_without_retry_after`
 * fixtures exercise the wrapper's generic behaviour, the same as every other adapter's matrix —
 * they are not a claim that the `with_retry_after` case reflects X's real wire behaviour. Fixing
 * this precisely needs either a provider-specific pre-parse hook in the wrapper (touches every
 * adapter, out of scope here) or an X-specific header read the wrapper does not currently
 * support. Flagged for whoever next wires this adapter to a live call.
 *
 * **Cost is a pre-dispatch, worst-case estimate, not a reconciled actual.** X bills
 * **$0.005 per Post read** (source §4.3's cost-shape table) — the price scales with how many
 * posts are *returned*, not with the call itself. But `wrapper.ts` stage 1's budget pre-check
 * must know a cost *before* the request is sent, and `CostSink`/`CallLogSink` never receive a
 * second, post-hoc correction once the response is known (no adapter has needed one before this
 * one — every other priced-in-principle source here is actually free or flat-rate). So
 * `estimatedCostUsd` is computed off `maxResults` — the most posts this call could possibly
 * return. **Round-2 lane-review finding 1 corrected the rest of this note**: this upper bound is
 * no longer what gets recorded once the response is known. `wrapper.ts`'s `countBillableUnits`
 * hook (see the call site below) reconciles to the actual `data.length` — zero when a query
 * matches nothing, `maxResults` at most — so `estimatedCostUsd` is only ever billed for the
 * items it turned out to have priced. What is *not* reconciled is the partial case: a query
 * matching, say, 40 posts when `maxResults` is 100 is still billed the full $0.500 ceiling, not
 * $0.200 — narrowing that gap would need the wrapper to accept a *cost* computed per unit
 * (`costUsd = estimatedCostUsd * billableUnits / quotaUnits`), which is a real capability gap
 * across every adapter's cost shape, not something this adapter can paper over on its own —
 * recorded as a residual risk, not fixed here. The read-ledger side of the same reconciliation
 * (quota units, as opposed to dollars) *is* fully proportional — see `countBillableUnits` below.
 *
 * **A dispatched call that reads zero billable Posts is billed nothing, not the worst-case
 * ceiling — whether it failed outright or succeeded with nothing to bill.** `wrapper.ts`'s
 * `finish()` only records `costUsd` when a call both reached the provider, came back `ok`, *and*
 * (via `countBillableUnits`) actually read at least one Post. A 403, a 5xx exhausted through
 * retries, a timeout or a contract failure reports `costUsd: null`, the same as a call refused
 * before dispatch — and so does a 200 that matched zero posts, which is the ordinary shape of
 * the `empty` fixture and, for a trigger-sampled cashtag query, the common case in production,
 * not an edge one.
 *
 * **What this adapter does not do, stated rather than implied.** It returns full post `text` as
 * received; D-17's "bounded snippet, re-hydrated on demand" is a persistence-layer truncation
 * policy, not a parsing concern, and is not applied here. It also does not implement
 * `05-TEST-STRATEGY.md` §2.1's X fixture unit ("one trigger event and the read window it
 * produced, including the market-data state that fired it") — that is a collector-level
 * concept tying this adapter to F16a's price-trigger path (still `blocked` on MT-04), which does
 * not exist yet to produce such a fixture against. This module instead carries the same
 * per-endpoint nine-case matrix every other F04 adapter does (§2, not §2.1); see the module's
 * test file for which of the nine apply.
 */
import { z } from 'zod';
import type { ProviderResult } from '@/contracts/provider';
import { createFetcher } from './fixtures';
import type { WrapperDeps } from './wrapper';
import { callProvider } from './wrapper';

/** X charges per post returned, not per call (source §4.3's cost-shape table). */
export const USD_PER_POST_READ_MILLIS = 5n; // $0.005 == 5 thousandths of a dollar

/**
 * Exact decimal arithmetic in thousandths of a dollar, so `10 * 0.005` never becomes a
 * floating-point artifact like `0.05000000000000001` on its way into a `decimalString`
 * (`contracts/primitives.ts`). `units` is always a small non-negative integer (`maxResults`),
 * never user-supplied floating input.
 */
export function estimatePostReadCostUsd(units: number): string {
  // Zero is rejected alongside negative/non-integer input, not accepted as a degenerate case.
  // `contracts/provider.ts` and this module's own `costUsd` never allow a real-looking `'0'` —
  // null means unpriced, not "priced at zero" — and `'0.000'` is exactly that trap: a caller
  // computing a remaining-read allowance that lands on exactly zero (a plausible F16a shape)
  // must not be able to turn that zero into a cost estimate at all. Zero reads means "do not
  // make this call," which is a decision for the caller to make before ever reaching here.
  if (!Number.isInteger(units) || units < 1) {
    throw new Error(`estimatePostReadCostUsd: units must be a positive integer, got ${units}`);
  }
  const milliDollars = BigInt(units) * USD_PER_POST_READ_MILLIS;
  const dollars = milliDollars / 1000n;
  const thousandths = (milliDollars % 1000n).toString().padStart(3, '0');
  return `${dollars}.${thousandths}`;
}

export type XPostMetrics = {
  retweetCount: number;
  replyCount: number;
  likeCount: number;
  quoteCount: number;
  /** Added to the v2 object model after launch — absent on some entitlement tiers. */
  bookmarkCount: number | null;
  impressionCount: number | null;
};

export type XPost = {
  id: string;
  text: string;
  authorId: string;
  /** `null` when `includes.users` did not carry a matching author (should not happen; defensive). */
  authorUsername: string | null;
  /** ISO-8601, as X returns it. `null` when `tweet.fields=created_at` was not honoured. */
  createdAt: string | null;
  lang: string | null;
  metrics: XPostMetrics;
};

const xPublicMetrics = z.object({
  retweet_count: z.number(),
  reply_count: z.number(),
  like_count: z.number(),
  quote_count: z.number(),
  bookmark_count: z.number().optional(),
  impression_count: z.number().optional(),
});

const xPostSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  author_id: z.string().min(1),
  created_at: z.string().optional(),
  lang: z.string().optional(),
  public_metrics: xPublicMetrics,
});

const xUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  name: z.string().min(1),
});

/**
 * X returns HTTP 200 with a top-level `errors` array when part of a request could not be
 * fulfilled (e.g. an expansion referencing a user that no longer exists) — the response is
 * schema-valid and `ok`, but its `data` is a partial result, not the complete one `meta.
 * result_count` describes. Round-2 lane-review finding 3: this must be parsed, not silently
 * dropped by an object schema that only reads the keys it expects.
 */
const xApiErrorSchema = z.object({ title: z.string().optional(), detail: z.string().optional() }).passthrough();

/**
 * `data` is optional, deliberately: X API v2's documented behaviour for recent-search is to
 * omit the `data` key entirely when a query matches nothing, returning only `meta`
 * (`{"meta":{"result_count":0}}`) — there is no empty array on the wire to parse. Modelling it
 * as optional rather than requiring a `z.array(...)` that a real empty response would fail is
 * what makes the `empty` fixture case representative rather than synthetic.
 */
const xSearchResponse = z.object({
  data: z.array(xPostSchema).optional(),
  includes: z.object({ users: z.array(xUserSchema).optional() }).optional(),
  meta: z.object({
    result_count: z.number(),
    newest_id: z.string().optional(),
    oldest_id: z.string().optional(),
    next_token: z.string().optional(),
  }),
  errors: z.array(xApiErrorSchema).optional(),
});

const MIN_MAX_RESULTS = 10;
const MAX_MAX_RESULTS = 100;
const DEFAULT_MAX_RESULTS = 10;

export async function fetchRecentSearch(
  options: {
    /**
     * X's own search-operator syntax (e.g. `"$AAPL -is:retweet lang:en"`). This adapter makes
     * no assumption about what belongs here — naming a governed cohort is explicitly out of
     * scope for this slice (see module doc).
     */
    query: string;
    /** X's bound: 10-100. Clamped, never silently ignored past the limit. */
    maxResults?: number;
    /** Required in `live` mode. X API v2 uses App-only OAuth 2.0 Bearer auth. */
    bearerToken?: string;
    cacheTtlMs?: number;
    maxStaleMs?: number;
    headers?: Readonly<Record<string, string>>;
  },
  providerMode: 'fixture' | 'live',
  deps: Omit<WrapperDeps, 'fetcher'> & { fixturesRoot?: string },
): Promise<ProviderResult<XPost[]>> {
  if (providerMode === 'live' && (options.bearerToken === undefined || options.bearerToken === '')) {
    throw new Error('fetchRecentSearch: bearerToken is required when providerMode is "live"');
  }

  const maxResults = Math.min(
    MAX_MAX_RESULTS,
    Math.max(MIN_MAX_RESULTS, options.maxResults ?? DEFAULT_MAX_RESULTS),
  );

  const fetcher = createFetcher(providerMode, {
    provider: 'x',
    endpoint: 'search_recent',
    ...(deps.fixturesRoot === undefined ? {} : { root: deps.fixturesRoot }),
  });

  const url = new URL('https://api.x.com/2/tweets/search/recent');
  url.searchParams.set('query', options.query);
  url.searchParams.set('max_results', String(maxResults));
  url.searchParams.set('tweet.fields', 'created_at,public_metrics,lang,author_id');
  url.searchParams.set('expansions', 'author_id');
  url.searchParams.set('user.fields', 'username,name');

  const result = await callProvider(
    {
      provider: 'x',
      operation: 'search_recent',
      // `max_results` varies the response (X returns up to that many posts), the same reason
      // `apewisdom.ts` includes its own varying `page` in its cache key. Latent today (nothing
      // sets `cacheTtlMs` for X yet), but D-15's trigger spends "up to `X_READS_PER_TRIGGER_
      // EVENT` reads" — making read count exactly the variable that changes per trigger event.
      // Without this, a `maxResults: 100` call after a cached `maxResults: 10` call would
      // incorrectly serve the 10-post entry as a hit.
      segments: [options.query, String(maxResults)],
      schema: xSearchResponse,
      request: {
        url: url.toString(),
        headers: {
          ...options.headers,
          ...(options.bearerToken === undefined ? {} : { Authorization: `Bearer ${options.bearerToken}` }),
        },
      },
      // §4.1 stage 1 needs an estimate *before* dispatch — this is a worst-case upper bound on
      // what this call could cost, not a reconciled actual. See the module doc's cost note.
      estimatedCostUsd: estimatePostReadCostUsd(maxResults),
      // The unit the ledger reserves is a post read, matching D-15's "reads per trigger event"
      // model — not a flat "one call, one unit" the way the free/flat-rate adapters use it.
      quotaUnits: maxResults,
      unitType: 'post_read',
      // Round-2 lane-review finding 1+2: bill and release against what this call actually read,
      // not the worst-case `maxResults` reservation above — a query matching fewer posts (the
      // common case, and the *only* case for the `empty` fixture) must neither be billed at the
      // ceiling nor hold read-ledger units it never spent.
      countBillableUnits: (data) => data.data?.length ?? 0,
      ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
      ...(options.maxStaleMs === undefined ? {} : { maxStaleMs: options.maxStaleMs }),
    },
    { ...deps, fetcher },
  );

  if (!result.ok) return result;

  /**
   * Round-2 lane-review finding 3, corrected by round-3 lane-review findings 1-3. A schema-valid
   * 200 can still be a partial response — X sets a top-level `errors` array, or a `data.length`
   * short of `meta.result_count`, when part of what was requested could not be returned. Round 2
   * treated this as a hard contract failure; round 3 correctly rejected that: X's own documented
   * cause is a routine per-item expansion miss (`unexpected_field.json`'s fixture — "Could not
   * find user with id"), not a provider shape change, and every post that *did* come back is
   * real, priced, billable data. Discarding it under D-16/§6.8's forward-only, no-backfill rule
   * would be strictly worse than surfacing the gap: the wrapper has already billed and
   * quota-debited for exactly the posts in `data` (see `countBillableUnits` above), so returning
   * them as `ok: true` keeps the cost/log/quota accounting and the returned data in agreement —
   * the divergence round 3 finding 2 flagged (a billed success logged, an unbillable failure
   * returned) cannot arise if this path never returns `ok: false`. The gap is still surfaced
   * loudly, via `onContractViolation`, so it is visible without discarding usable data or
   * fabricating a false "coverage confirmed" claim about the corpus these posts feed.
   */
  const actualCount = result.data.data?.length ?? 0;
  const partialErrors = result.data.errors ?? [];

  /**
   * Round-4 lane-review finding 1. Zero real posts against a *nonzero* claimed `result_count` is
   * not the routine per-item expansion miss the tolerant branch below exists for — that case
   * always carries at least the posts that did succeed. A response claiming `result_count: 25`
   * while shipping no `data` at all is byte-for-byte identical, in every billed/logged channel, to
   * the honest `empty` fixture's genuine zero-match query (`countBillableUnits` reads the same
   * `data.length`, so both bill `$0` and release the full reservation) — an operator or a future
   * coverage view has no way to tell "X found nothing" from "X found 25 things and sent none of
   * them." Failing this case loudly, rather than folding it into the tolerant `ok: true` path,
   * is what keeps a zero-post outcome meaning "nothing to bill or read," not "possibly a lot to
   * bill or read that never arrived."
   */
  if (actualCount === 0 && result.data.meta.result_count > 0) {
    const issues = [
      `meta.result_count: reported ${result.data.meta.result_count}, but data carried 0 post(s) ` +
        '— unlike a partial response, there is no real data here to make this the routine case',
      // Round-5 lane-review finding 2: X's own `errors` array is the one place it might say why
      // — discarding it here (the way the tolerant branch below would report it) leaves this
      // failure with no stated cause even when the provider supplied one.
      ...partialErrors.map((error) => `errors: ${error.title ?? 'unknown'} — ${error.detail ?? '(no detail)'}`),
    ];
    // Round-5 lane-review finding 1, disclosed rather than fixed here: `provider_call_log`'s row
    // for this call was already written by `wrapper.ts`'s `finish()` before this function ever
    // ran (stage 9 runs on the underlying `ok: true` dispatch), so that row is byte-for-byte
    // identical to the honest `empty` fixture's — this failure changes what `fetchRecentSearch`
    // *returns*, not what was already logged. Distinguishing the two in the durable log would
    // need the wrapper to defer stage 9 until after an adapter-level post-check, which no adapter
    // needs today; `onContractViolation` is this failure's only distinct, durable signal, and its
    // only current implementation (`services/dashboard/provider-deps.ts#noopContractViolation`)
    // does not persist it either. A real fix needs the call-log/violation-sink wiring, not this
    // adapter.
    deps.onContractViolation({ provider: 'x', endpoint: 'search_recent', issues, payloadRef: null });
    return { ok: false, error: { kind: 'contract', issues }, meta: result.meta };
  }

  if (partialErrors.length > 0 || actualCount !== result.data.meta.result_count) {
    const issues = [
      ...partialErrors.map((error) => `errors: ${error.title ?? 'unknown'} — ${error.detail ?? '(no detail)'}`),
      ...(actualCount !== result.data.meta.result_count
        ? [`meta.result_count: reported ${result.data.meta.result_count}, but data carried ${actualCount} post(s)`]
        : []),
    ];
    deps.onContractViolation({ provider: 'x', endpoint: 'search_recent', issues, payloadRef: null });
  }

  const usersById = new Map((result.data.includes?.users ?? []).map((user) => [user.id, user]));
  const posts: XPost[] = (result.data.data ?? []).map((post): XPost => ({
    id: post.id,
    text: post.text,
    authorId: post.author_id,
    authorUsername: usersById.get(post.author_id)?.username ?? null,
    createdAt: post.created_at ?? null,
    lang: post.lang ?? null,
    metrics: {
      retweetCount: post.public_metrics.retweet_count,
      replyCount: post.public_metrics.reply_count,
      likeCount: post.public_metrics.like_count,
      quoteCount: post.public_metrics.quote_count,
      bookmarkCount: post.public_metrics.bookmark_count ?? null,
      impressionCount: post.public_metrics.impression_count ?? null,
    },
  }));

  return { ok: true, data: posts, meta: result.meta };
}
