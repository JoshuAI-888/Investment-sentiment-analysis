/**
 * The one function every adapter call passes through — F04 §4.1.
 *
 *   1 budget pre-check · 2 quota ledger · 3 cache · 4 rate limit · 5 request
 *   6 retry · 7 circuit breaker · 8 validate · 9 record
 *
 * **The order is the specification, and F04 §7 step 2 reviews it in code order rather than in
 * intent.** Stages 1 and 2 exist to refuse *before* spending: a budget checked after the
 * request has already cost the money, and a quota checked after dispatch is just a 429 with
 * extra steps. So `callProvider` is written top-to-bottom in that order, and the tests assert
 * on the sequence of port calls rather than only on the returned value — an implementation
 * that got the right answer by checking the budget last would pass every value-based test.
 */
import type { z } from 'zod';
import type { ProviderError, ProviderId, ProviderMeta, ProviderResult } from '@/contracts/provider';
import { admit, recordFailure, recordSuccess } from './breaker';
import { cacheKey, requestFingerprint } from './cache-key';
import { classifyStatus, classifyThrown, errorClass, parseRetryAfter, RequestTimeout, TRANSIENT_STATUSES } from './errors';
import type {
  BreakerStore,
  BudgetGate,
  CacheStore,
  CallLogSink,
  Clock,
  ContractViolationSink,
  CostEntry,
  CostSink,
  Fetcher,
  QuotaLedger,
  RateLimiterStore,
} from './ports';
import { BUCKETS, acquire } from './rate-limit';
import { type BackoffPolicy, defaultBackoff, retryDecision } from './retry';

export const DEFAULT_TIMEOUT_MS = 10_000;

export type WrapperDeps = {
  fetcher: Fetcher;
  clock: Clock;
  cache: CacheStore;
  quota: QuotaLedger;
  budget: BudgetGate;
  breaker: BreakerStore;
  rateLimiter: RateLimiterStore;
  callLog: CallLogSink;
  cost: CostSink;
  onContractViolation: ContractViolationSink;
  backoff?: BackoffPolicy;
};

export type CallOptions<T> = {
  provider: ProviderId;
  /** The endpoint name as it appears in the cache key and the call log. */
  operation: string;
  segments?: readonly string[];
  schema: z.ZodType<T>;
  request: {
    url: string;
    method?: string;
    headers?: Readonly<Record<string, string>>;
    body?: string;
  };
  timeoutMs?: number;
  /** How long a cached value is fresh. Omit to bypass the cache entirely. */
  cacheTtlMs?: number;
  /** How long past `cacheTtlMs` a stale value may still be served. */
  maxStaleMs?: number;
  quotaUnits?: number;
  /** A decimal string, or null for an unpriced call. Never `'0'` — see `contracts/provider.ts`. */
  estimatedCostUsd?: string | null;
  unitType?: CostEntry['unitType'];
  /**
   * Round-2 lane-review finding (F04-x-adapter). For a call priced and rate-limited per item
   * *returned* (X only, so far — `quotaUnits` there is a post-read count, not a call count),
   * this translates the validated response into the actual number of billable items. Without
   * it, a dispatched call that returns fewer items than the worst-case `quotaUnits` reservation
   * both bills the full ceiling and holds the full reservation forever — for a query that
   * matches nothing, that is a real dollar charge and a ledger debit for zero items, on every
   * call. Omit for a flat-rate/per-call adapter, where one dispatch always spends exactly the
   * one unit `quotaUnits` already reserved and no reconciliation is needed.
   */
  countBillableUnits?: (data: T) => number;
};

function isTransient(error: ProviderError): boolean {
  return (
    error.kind === 'timeout' ||
    error.kind === 'rate_limit' ||
    (error.kind === 'upstream' && TRANSIENT_STATUSES.has(error.status))
  );
}

export async function callProvider<T>(
  options: CallOptions<T>,
  deps: WrapperDeps,
): Promise<ProviderResult<T>> {
  const { provider, operation, schema } = options;
  const segments = options.segments ?? [];
  const quotaUnits = options.quotaUnits ?? 1;
  const estimatedCostUsd = options.estimatedCostUsd ?? null;
  const startedAt = deps.clock.now();
  const key = cacheKey({ provider, operation, segments });
  const fingerprint = requestFingerprint({ provider, operation, segments });

  let quotaRemaining: number | null = null;
  let reservedUnits = 0;

  const finish = async (
    outcome:
      | { ok: true; data: T }
      | { ok: false; error: ProviderError },
    detail: {
      cache: ProviderMeta['cache'];
      statusCode: number | null;
      itemsReturned: number | null;
      /**
       * True only when this exit reached stage 5 and a request actually left the process.
       * `cache !== 'miss'` already zeroes cost for a served cache entry, but three other exits
       * — budget denial, quota refusal and an open breaker — *also* report `cache: 'miss'`
       * while never reaching the fetcher. Before this field existed, `costUsd` was gated on
       * `cache === 'miss'` alone, so a refused, never-dispatched call with a non-null
       * `estimatedCostUsd` still produced a `cost_event` — invisible on every adapter built so
       * far because none of them priced a call, and caught only once `x.ts` (F04's first priced
       * adapter) exercised `budgetAllowed: false` against a non-null estimate. Every call site
       * below states this explicitly rather than relying on a default, for the same reason
       * §4.1's stage order is asserted on rather than assumed.
       *
       * `dispatched: true` alone is not sufficient to bill, though — see the `costUsd`
       * computation below, which also requires `outcome.ok`.
       */
      dispatched: boolean;
      /**
       * Round-2 lane-review finding 1. `null`/omitted means "this call's unit is the call
       * itself" (every adapter but X) — unchanged, full-ceiling billing on any `ok` dispatch.
       * A number is the reconciled actual (`options.countBillableUnits`'s result), and `0`
       * specifically must bill nothing: the module's own stated rule ("a query-yield problem
       * is never a billed-at-ceiling problem") is exactly as true for zero items as for one.
       */
      billableUnits?: number | null;
    },
  ): Promise<ProviderResult<T>> => {
    const meta: ProviderMeta = {
      provider,
      endpoint: operation,
      requestedAt: startedAt.toISOString(),
      latencyMs: Math.max(0, deps.clock.now().getTime() - startedAt.getTime()),
      cache: detail.cache,
      // Round-3 lane-review finding 5. Captured once, at stage 2's `QuotaLedger.reserve` call —
      // never updated by a later release. A call priced per item returned (X) can release part
      // or all of its worst-case reservation once the response is known (`countBillableUnits`
      // above), so this can under-report what is actually still available for the *next* call.
      // `contracts/provider.ts#providerMeta` is SPINE-owned, so this caveat lives here rather
      // than as a doc comment on the field itself — read `quotaRemaining` as "remaining after
      // this call's worst-case reservation," not as a live ledger balance.
      quotaRemaining,
      // A served cache entry costs nothing, and a refused-before-dispatch call costs nothing
      // either — `null` is the only honest value in both cases: charging the caller for a
      // request that never happened is how a cost report stops matching the invoice it is
      // supposed to explain.
      //
      // `outcome.ok` matters just as much as `dispatched` here. A provider that is priced per
      // item *returned* (X, `$0.005`/Post — the only priced adapter so far) can dispatch a
      // request that genuinely leaves the process and still deliver nothing billable: a 403,
      // a 5xx exhausted through every retry, or a 200 that fails stage 8's contract check. All
      // three set `dispatched: true` — a real request happened — but `outcome.ok` is `false` in
      // every one of them, and nothing billable came back. Billing the full worst-case estimate
      // for a call that returned zero items is not a worst-case *estimate* anymore; it is a
      // fabricated charge against money that was never actually spent, and it feeds a global
      // budget ceiling (F18/D-32) that would then wrongly refuse real future reads. So cost is
      // only ever recorded for a dispatch that both left the process and came back `ok`.
      costUsd:
        detail.cache === 'miss' &&
        detail.dispatched &&
        outcome.ok &&
        (detail.billableUnits === undefined || detail.billableUnits === null || detail.billableUnits > 0)
          ? estimatedCostUsd
          : null,
      payloadRef: null,
    };

    // Stage 9. Every attempt is logged, including the refusals — source §9.4 asks for all
    // failures in `provider_call_log`, and a budget denial that leaves no trace is invisible
    // exactly when someone is asking why the collector went quiet.
    await deps.callLog({
      provider,
      operation,
      requestFingerprint: fingerprint,
      statusCode: detail.statusCode,
      latencyMs: meta.latencyMs,
      cacheStatus: detail.cache,
      itemsReturned: detail.itemsReturned,
      estimatedCostUsd: meta.costUsd ?? '0',
      startedAt,
      errorClass: outcome.ok ? null : errorClass(outcome.error),
    });

    if (meta.costUsd !== null) {
      await deps.cost({
        provider,
        operation,
        unitType: options.unitType ?? 'call',
        requestUnits: String(quotaUnits),
        costUsd: meta.costUsd,
        requestId: fingerprint,
        occurredAt: startedAt,
      });
    }

    return outcome.ok ? { ok: true, data: outcome.data, meta } : { ok: false, error: outcome.error, meta };
  };

  // ── Stage 1. Budget pre-check. Before everything, because it is the only stage whose whole
  //    purpose is to prevent a spend that cannot be undone once made.
  const budget = await deps.budget.check({ provider, endpoint: operation, estimatedCostUsd });
  if (!budget.allowed) {
    return finish(
      { ok: false, error: { kind: 'budget_denied', scope: budget.scope } },
      { cache: 'miss', statusCode: null, itemsReturned: null, dispatched: false },
    );
  }

  // ── Stage 2. Quota ledger. Refuse before dispatch rather than discover a 429 (F-08).
  const reservation = await deps.quota.reserve({ provider, units: quotaUnits, at: startedAt });
  if (!reservation.granted) {
    return finish(
      { ok: false, error: { kind: 'quota', resetAt: reservation.resetAt } },
      { cache: 'miss', statusCode: null, itemsReturned: null, dispatched: false },
    );
  }
  quotaRemaining = reservation.remaining;
  reservedUnits = quotaUnits;

  /**
   * Any exit that never reaches the provider hands the reservation back.
   *
   * §4.1 orders the ledger *before* the cache, so a cached read holds an allowance unit it
   * never spent. On Marketaux's 100 requests/day a well-cached collection cycle would exhaust
   * the day's allowance without making a single call — the ledger would be empty, the provider
   * untouched, and the logs would show refusals with no matching requests. Recorded as B-16.
   */
  const releaseReservation = async (): Promise<void> => {
    if (reservedUnits === 0) return;
    await deps.quota.release({ provider, units: reservedUnits, at: deps.clock.now() });
    reservedUnits = 0;
  };

  // ── Stage 3. Cache, with stale-while-revalidate.
  const cacheable = options.cacheTtlMs !== undefined;
  if (cacheable) {
    const entry = await deps.cache.get(key);
    if (entry !== null) {
      const ageMs = deps.clock.now().getTime() - Date.parse(entry.storedAt);
      const fresh = ageMs <= (options.cacheTtlMs ?? 0);
      const servableStale = !fresh && ageMs <= (options.cacheTtlMs ?? 0) + (options.maxStaleMs ?? 0);

      if (fresh || servableStale) {
        const parsed = schema.safeParse(entry.value);
        // A cached value that no longer parses means the schema moved under the cache. Drop
        // through to a live fetch rather than serving it or failing: the entry is ours, the
        // provider has done nothing wrong, and there is nothing to report about it.
        if (parsed.success) {
          await releaseReservation();
          return finish(
            { ok: true, data: parsed.data },
            { cache: fresh ? 'hit' : 'stale', statusCode: null, itemsReturned: null, dispatched: false },
          );
        }
      }
    }
  }

  // ── Stage 7 (admission). The breaker is listed seventh because that is where it *reacts*,
  //    but a breaker consulted only after the request has already been sent has never
  //    prevented a call. It is read here and written below.
  const verdict = await admit({ provider, store: deps.breaker, clock: deps.clock });
  if (!verdict.allow) {
    await releaseReservation();
    return finish(
      { ok: false, error: { kind: 'circuit_open', openedAt: verdict.openedAt } },
      { cache: 'miss', statusCode: null, itemsReturned: null, dispatched: false },
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: ProviderError = { kind: 'timeout' };
  let lastStatus: number | null = null;

  // ── Stages 4–6. Rate limit, request, retry.
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    // Stage 4. The bucket is a rate, so exceeding it waits rather than failing.
    const bucket = BUCKETS[provider];
    const acquisition = await acquire({ provider, config: bucket, store: deps.rateLimiter, clock: deps.clock });
    if (!acquisition.acquired) await deps.clock.sleep(acquisition.waitMs);

    // Stage 5. Hard deadline. The controller is aborted in `finally` so a slow response that
    // arrives after the deadline cannot leave a socket open behind the loop.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new RequestTimeout(timeoutMs));
    }, timeoutMs);

    try {
      const response = await deps.fetcher({
        url: options.request.url,
        method: options.request.method ?? 'GET',
        headers: options.request.headers ?? {},
        ...(options.request.body === undefined ? {} : { body: options.request.body }),
        signal: controller.signal,
      });

      lastStatus = response.status;
      const retryAfterMs = parseRetryAfter(response.headers['retry-after'], deps.clock.now());
      const failure = classifyStatus({ status: response.status, endpoint: operation, retryAfterMs });

      if (failure === null) {
        // Stage 8. Validate against the recorded contract.
        const parsed = schema.safeParse(response.body);
        if (!parsed.success) {
          const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
          // Loudly (§4.1 stage 8): a parse failure means the provider changed shape, which is
          // the one failure here that no amount of retrying or waiting will fix.
          deps.onContractViolation({ provider, endpoint: operation, issues, payloadRef: null });
          await recordSuccess({ provider, store: deps.breaker });
          // Round-2 lane-review finding 2: a dispatched-but-failed call read zero billable
          // items, so it must hand back the whole reservation, not just bill nothing for it —
          // otherwise a run of contract failures silently exhausts the day's read ledger.
          await releaseReservation();
          return finish(
            { ok: false, error: { kind: 'contract', issues } },
            { cache: 'miss', statusCode: response.status, itemsReturned: null, dispatched: true },
          );
        }

        await recordSuccess({ provider, store: deps.breaker });
        if (cacheable) {
          await deps.cache.set(key, { value: response.body, storedAt: deps.clock.now().toISOString() });
        }
        // Round-3 lane-review finding 4: an adapter's `countBillableUnits` result is used
        // unvalidated below to both release ledger units and gate billing — a non-integer,
        // negative, or `NaN` return (a bug in a future adapter's reconciliation function, not
        // reachable from `x.ts` today) must not silently zero the cost of a call that did return
        // data or push a fractional/negative amount into `QuotaLedger.release`. Treated as
        // "unreconciled" (`null`) rather than trusted, which falls back to this call site's
        // pre-reconciliation behaviour: full cost billed, nothing released — the safe direction,
        // since it never under-charges or over-releases. A count *larger* than what was reserved
        // (the provider returned more than `max_results` asked for) is clamped down to
        // `reservedUnits` rather than trusted either, so `unused` below can never go negative.
        //
        // Round-4 lane-review finding 2: the call is wrapped in its own try/catch, not left to
        // the surrounding fetch-loop's `catch` — a *throw* from `countBillableUnits` used to be
        // caught there and misclassified as an upstream provider failure (a fabricated
        // `{kind:'upstream', status:0}`), discarding an already-validated, already-cached
        // response and reporting a bug in this in-process function as if the provider had failed.
        let rawBillableUnits: number | null = null;
        let billableUnitsThrowMessage: string | null = null;
        if (options.countBillableUnits) {
          try {
            rawBillableUnits = options.countBillableUnits(parsed.data);
          } catch (thrown) {
            // Round-5 lane-review finding 3: keep the thrown error's own message rather than
            // discarding it for a fixed string — an operator debugging a broken adapter needs to
            // know *what* went wrong, not just that something did.
            billableUnitsThrowMessage = thrown instanceof Error ? thrown.message : String(thrown);
          }
        }
        const billableUnitsThrew = billableUnitsThrowMessage !== null;
        const billableUnitsValid =
          rawBillableUnits !== null && Number.isInteger(rawBillableUnits) && rawBillableUnits >= 0;
        // Round-5 lane-review finding 4: an over-count (the provider returned more items than
        // were reserved) is clamped for billing/release purposes below, but that clamp is itself
        // an adapter/provider mismatch worth the same loud signal every other invalid outcome
        // here gets — silently absorbing it left the read ledger permanently under-counting real
        // consumption by the excess, with no record anywhere.
        const billableUnitsOverCount = rawBillableUnits !== null && billableUnitsValid && rawBillableUnits > reservedUnits;
        // Round-4 lane-review finding 3: an adapter's reconciliation function returning something
        // invalid (thrown, `NaN`, negative, non-integer) is a bug in that adapter, not a provider
        // condition — loud, the same channel stage 8 already uses for "the provider changed
        // shape," so it cannot silently persist as a full-ceiling-forever adapter with no signal
        // anywhere that its own reconciliation is broken.
        if (options.countBillableUnits && (billableUnitsThrew || !billableUnitsValid || billableUnitsOverCount)) {
          deps.onContractViolation({
            provider,
            endpoint: operation,
            issues: [
              billableUnitsThrew
                ? `countBillableUnits threw rather than returning a value: ${billableUnitsThrowMessage}`
                : billableUnitsOverCount
                  ? `countBillableUnits returned ${JSON.stringify(rawBillableUnits)}, more than the ${reservedUnits}-unit reservation — clamped, but the excess is unaccounted for in the read ledger`
                  : `countBillableUnits returned an invalid value: ${JSON.stringify(rawBillableUnits)}`,
            ],
            payloadRef: null,
          });
        }
        const billableUnits = billableUnitsValid ? Math.min(rawBillableUnits as number, reservedUnits) : null;
        if (billableUnits !== null) {
          // Release whatever portion of the worst-case reservation this response did not
          // actually use — a query matching fewer than `maxResults` posts (the common case)
          // must not hold units it never read.
          const unused = Math.max(0, reservedUnits - billableUnits);
          if (unused > 0) {
            await deps.quota.release({ provider, units: unused, at: deps.clock.now() });
            reservedUnits -= unused;
          }
        }
        return finish(
          { ok: true, data: parsed.data },
          {
            cache: 'miss',
            statusCode: response.status,
            itemsReturned: billableUnits ?? (Array.isArray(parsed.data) ? parsed.data.length : null),
            dispatched: true,
            billableUnits,
          },
        );
      }

      lastError = failure;
    } catch (thrown) {
      lastError = classifyThrown(thrown);
      lastStatus = null;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }

    // Stage 7 (reaction). Only transient failures count toward the threshold.
    await recordFailure({
      provider,
      store: deps.breaker,
      clock: deps.clock,
      transient: isTransient(lastError),
    });

    // Stage 6. `retryDecision` is the only thing that decides this, and `entitlement` is in
    // its never-retried set — so a 403 leaves the loop here on the first attempt.
    const decision = retryDecision({
      error: lastError,
      attempt,
      policy: deps.backoff ?? defaultBackoff,
    });
    if (!decision.retry) break;
    await deps.clock.sleep(decision.delayMs);
  }

  // Round-2 lane-review finding 2: every retry attempt was exhausted (or the last attempt threw)
  // with no billable item ever read — the same "hand the reservation back" rule as the contract-
  // failure branch above, so a run of transient failures cannot exhaust the day's read ledger.
  await releaseReservation();
  return finish(
    { ok: false, error: lastError },
    { cache: 'miss', statusCode: lastStatus, itemsReturned: null, dispatched: true },
  );
}
