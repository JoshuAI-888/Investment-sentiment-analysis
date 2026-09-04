/**
 * The whole F08 §4.1 collector job: fetch ApeWisdom, persist snapshots, compute and persist the
 * five registered metrics for every matched security, and point the leaderboard's read path
 * (`leaderboard.ts`) at the results.
 *
 * **Nothing calls `runAttentionCollection` in production — lane-review finding 8.** This module
 * is built and tested (`tests/integration/attention-pipeline.test.ts`), but no scheduler, cron
 * route or job service invokes it; `app/api/cron/dispatch/route.ts` has no entry for it. Wiring a
 * new job into the dispatch/scheduling path is COLLECT-lane territory (F16a), not something this
 * SURFACE-owned module can add for itself. Until that wiring lands, nothing advances the warm-up
 * clock this feature depends on (F06 §4.1's depth-14 gate, F08 §4.1's `HistoryDepth`) except a
 * test or a manual/operator call — under D-16, mistaking "this function exists and is correct"
 * for "collection has started" is the exact gap between believing data is accruing and it
 * genuinely never having begun.
 *
 * **Metrics are recomputed for every matched security on every run, including one whose
 * observation is unchanged — lane-review finding 3.** An earlier version of this file skipped
 * recomputing whenever `repositories/attention.ts` reported `inserted: false` (an unchanged
 * reading), reasoning that identical inputs would collide with
 * `calculation_snapshot_identity_unique` (F07's own `testing.ts` records the same constraint).
 * That reasoning was correct about the collision but wrong about the fix: skipping recomputation
 * also skips **re-pointing Redis** at the (already-correct) artifact, so a lost pointer store —
 * an in-memory Redis fallback surviving a process restart, an Upstash flush — was never restored
 * by a subsequent successful run against unchanged data. The page then falsely reported "no
 * observation has ever been recorded" over a database full of real history, with no way back
 * short of the provider's numbers happening to move. `compute.ts`'s `computeAndStore` now derives
 * a **deterministic** `calculationId` from the exact identity fields the unique constraint keys
 * on, so a second computation of identical inputs either inserts the first time or safely no-ops
 * on a duplicate it already knows holds the same content — recomputing is no longer unsafe, so
 * skipping it is no longer necessary, and every run now leaves Redis correctly pointed regardless
 * of what changed.
 */
import { findActiveConfigVersion } from '@/repositories/versions';
import type { Queryable } from '@/repositories/client';
import { collectAttentionSnapshots, type CollectAttentionSnapshotsOptions } from './collector';
import { computeAttentionMetrics } from './compute';
import { KEYS, resolveRedisClient, type RedisClient } from './redis';

/** Mirrors `services/dashboard/refresh.ts`'s `DASHBOARD_CONFIG_ENVIRONMENT` — one environment,
 *  always, until an operator-selectable one exists. Kept as this feature's own constant rather
 *  than importing the dashboard's: the two name the same fact today, but a future feature that
 *  needs a *different* environment should not have to touch this file to get one. */
export const ATTENTION_CONFIG_ENVIRONMENT = 'production';

export type RunAttentionCollectionOptions = CollectAttentionSnapshotsOptions & {
  readonly redis?: RedisClient;
};

export type RunAttentionCollectionOutcome =
  | {
      readonly ok: true;
      readonly observedAt: string;
      readonly computed: number;
      readonly unmatchedTickers: readonly string[];
      readonly malformedEntries: readonly { readonly ticker: string; readonly reason: string }[];
    }
  | {
      readonly ok: false;
      readonly reason: 'provider_unavailable' | 'no_active_config_version';
      readonly message: string;
    };

export type MaterializeAttentionMetricsArgs = {
  readonly securityId: string;
  readonly symbol: string;
  readonly configVersion: string;
  readonly db?: Queryable | undefined;
  readonly redis: RedisClient;
  readonly now?: Date;
};

/**
 * Computes and persists one security's five metrics and points the read path at them —
 * `runAttentionCollection`'s per-security step, factored out so `testing.ts` can seed a fully
 * real leaderboard state (real `attention_snapshot` rows, real registry arithmetic, real
 * pointers) without going through the ApeWisdom adapter at all. Returns `null` when
 * `computeAttentionMetrics` finds nothing to compute (no snapshot exists for this security yet).
 */
export async function materializeAttentionMetricsForSecurity(
  args: MaterializeAttentionMetricsArgs,
): Promise<Awaited<ReturnType<typeof computeAttentionMetrics>>> {
  const metrics = await computeAttentionMetrics({
    securityId: args.securityId,
    symbol: args.symbol,
    configVersion: args.configVersion,
    ...(args.now === undefined ? {} : { now: args.now }),
    db: args.db,
  });
  if (metrics === null) return null;

  await args.redis.set(
    KEYS.metricPointer(args.securityId, 'attention.rank_change'),
    metrics.rankChange.calculationId,
  );
  // `del` rather than "leave whatever was there" on `null`: a security whose mention delta was
  // computable last run and is suppressed this run (a methodology boundary just landed) must not
  // keep showing last run's now-stale pointer as though it were still current.
  if (metrics.mentionDelta !== null) {
    await args.redis.set(
      KEYS.metricPointer(args.securityId, 'attention.mention_delta'),
      metrics.mentionDelta.calculationId,
    );
  } else {
    await args.redis.del(KEYS.metricPointer(args.securityId, 'attention.mention_delta'));
  }
  if (metrics.mentionGrowth !== null) {
    await args.redis.set(
      KEYS.metricPointer(args.securityId, 'attention.mention_growth'),
      metrics.mentionGrowth.calculationId,
    );
  } else {
    await args.redis.del(KEYS.metricPointer(args.securityId, 'attention.mention_growth'));
  }
  await args.redis.set(
    KEYS.metricPointer(args.securityId, 'attention.engagement_per_mention'),
    metrics.engagementPerMention.calculationId,
  );
  await args.redis.set(
    KEYS.metricPointer(args.securityId, 'attention.mentions_zscore'),
    metrics.mentionsZscore.calculationId,
  );
  // Lane-review round 7 finding 1: `historyDepth`/`rankChangeSource`/`comparisonWindowHours` used
  // to be written here as three more side-channel Redis keys, read back unconditionally by
  // `leaderboard.ts` with no freshness check of their own — the round-4/5/6 pointer-freshness
  // guard covered the five `metricPointer` keys and stopped there, leaving these three exposed to
  // the identical interruption they were built to guard against. `leaderboard.ts` now derives all
  // three directly from the already-verified-fresh `rank_change`/`mentions_zscore` artifacts
  // instead, so there is nothing left for these keys to do — removed rather than left as unused,
  // silently-stale writes nothing reads.

  return metrics;
}

export async function runAttentionCollection(
  options: RunAttentionCollectionOptions = {},
): Promise<RunAttentionCollectionOutcome> {
  const db: Queryable | undefined = options.db;
  const redis = options.redis ?? resolveRedisClient();

  const activeConfig = await findActiveConfigVersion(ATTENTION_CONFIG_ENVIRONMENT, db);
  if (activeConfig === null) {
    return {
      ok: false,
      reason: 'no_active_config_version',
      message:
        `No active config_version row for environment '${ATTENTION_CONFIG_ENVIRONMENT}'. A ` +
        'calculation cannot be recorded without one to freeze (02-ARCHITECTURE-CONTRACTS.md §6) ' +
        '— an infrastructure prerequisite, not a provider condition.',
    };
  }

  const collected = await collectAttentionSnapshots(options);
  if (!collected.ok) {
    await redis.set(KEYS.degraded(), JSON.stringify(true));
    // Round-12 lane-review finding 2: `error.kind === 'contract'` is a 200 response ApeWisdom
    // actually sent — the wire reality is "reached, answered, shape mismatch," never
    // "unreachable." Every other `ProviderError` kind (`timeout`, `upstream`, `rate_limit`,
    // `entitlement`, `quota`, `budget_denied`, `circuit_open`) is a genuine failure to get a
    // usable response, which is what `'provider_unreachable'` means.
    await redis.set(
      KEYS.degradedReason(),
      collected.error.kind === 'contract' ? 'provider_contract_changed' : 'provider_unreachable',
    );
    return { ok: false, reason: 'provider_unavailable', message: collected.message };
  }
  await redis.set(KEYS.degraded(), JSON.stringify(false));
  // Round-33 lane-review finding 3: written unconditionally here, on every successful provider
  // contact — not only inside the `noProgress` branch below — so a *partial* malformed board (most
  // entries parse, a few don't) leaves a durable record of exactly which securities were dropped
  // this run, rather than nothing at all. Always this run's own set, including an empty one: a
  // security flagged by a prior run must stop being flagged the moment it parses cleanly again.
  //
  // **Excludes a ticker this run actually wrote — round-35 lane-review finding 1.** A duplicate
  // ticker on one board response (`collector.ts`'s own `duplicateTickers` handling) lands in
  // `malformedEntries` for the drop note ("the best-ranked entry was kept") *and* in `results` for
  // that same kept entry — genuinely written, not dropped. Recording it here anyway meant a row
  // that predates no frontier and was written this exact run could still surface as
  // "could not be parsed, so no new observation was recorded" once it later went stale with no
  // newer run to correct it — both halves of that claim false about the one row it was written
  // for. `writtenTickers` is exactly "did this run persist a snapshot for this symbol," the same
  // fact `collected.results` already answers for `noProgress` below.
  const writtenTickers = new Set(collected.results.map((result) => result.symbol.toUpperCase()));
  await redis.set(
    KEYS.malformedTickers(),
    JSON.stringify(
      collected.malformedEntries
        .map((entry) => entry.ticker.toUpperCase())
        .filter((ticker) => !writtenTickers.has(ticker)),
    ),
  );

  let computed = 0;
  for (const result of collected.results) {
    // Recomputed unconditionally, including when `result.inserted` is `false` (an unchanged
    // observation) — see this module's own doc for why that is what keeps Redis pointers correct
    // rather than an optimisation this pipeline can afford to skip.
    const metrics = await materializeAttentionMetricsForSecurity({
      securityId: result.securityId,
      symbol: result.symbol,
      configVersion: activeConfig.id,
      db,
      redis,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    if (metrics !== null) computed += 1;
  }

  // Round-8 lane-review finding 2, broadened by round-9 finding 1, corrected by round-10
  // finding 2: a run that persists nothing to `attention_snapshot` must never advance
  // `lastCollectedAt` or read as healthy, regardless of *why* nothing was persisted. Round 9's
  // `computed === 0` went a step too far the other way: `computed` counts *metric
  // materialisations*, not *snapshots written*, and those can legitimately diverge —
  // `collectAttentionSnapshots` stamps `observed_at = options.now`, while `insertAttentionSnapshot`
  // stamps `ingested_at` at the real wall-clock instant of the insert (a moment *later* than
  // `now` whenever a caller pins `now`, exactly as this file's own tests and F16a's future
  // dispatcher both do); `computeAttentionMetrics` then reads as-of that same `now`, and
  // `as-of.ts`'s look-ahead guard correctly excludes a fact not yet "available" as of the instant
  // being read — so the very rows this run just wrote are invisible to its own immediately-following
  // compute step, and every `materializeAttentionMetricsForSecurity` call returns `null` even
  // though the corpus genuinely advanced. Traced live: two snapshots persisted,
  // `computed === 0` under round 9's guard, and the page rendered "ApeWisdom could not be reached
  // on the last collection run" — false; the provider was reached and wrote real data. The
  // question this guard exists to answer is "did the corpus advance," which
  // `collected.results.length` answers directly (a matched entry only reaches `results` after a
  // real `insertAttentionSnapshot` write — a malformed or unmatched entry never does), independent
  // of whether this run's own metric recomputation happened to keep pace. A security whose
  // metrics lag behind self-heals on the next read regardless: `leaderboard.ts#buildRow`'s
  // existing recovery path recomputes a missing pointer at read time, once `now` has genuinely
  // passed the row's `ingested_at`.
  const noProgress = collected.results.length === 0;
  if (noProgress) {
    await redis.set(KEYS.degraded(), JSON.stringify(true));
    // Round-11 lane-review finding 2: this branch fires when ApeWisdom answered 200 but nothing
    // usable came of it (an empty board, every ticker unmatched, or every entry malformed) — the
    // provider was reached. `degradedReason` records that distinction so the read path never
    // renders "ApeWisdom could not be reached" for a run where it plainly was.
    await redis.set(KEYS.degradedReason(), 'no_new_data');
  } else {
    await redis.set(KEYS.lastCollectedAt(), collected.observedAt);
  }
  // F08 §4.4: a genuinely new collection always invalidates the notable-movers cache, so its
  // 30-minute TTL never masks fresh data — see `leaderboard.ts`'s `cachedNotableMovers` doc.
  if (computed > 0) await redis.del(KEYS.notableMovers());
  return {
    ok: true,
    observedAt: collected.observedAt,
    computed,
    unmatchedTickers: collected.unmatchedTickers,
    malformedEntries: collected.malformedEntries,
  };
}
