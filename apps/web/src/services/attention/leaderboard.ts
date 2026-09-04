/**
 * `assembleAttentionLeaderboard` — F08's read path. Storage-only: every value comes from a
 * Redis pointer (`redis.ts`) written by the collector (`pipeline.ts`) or from the
 * `attention_snapshot` row it persisted — no provider call happens here, matching F07's own
 * "no provider call in the read path" precedent (`services/dashboard/assemble.ts`'s own doc).
 */
import type { CalculationArtifact } from '@/calc/artifact';
import { loadArtifact, METHOD_REGISTRY } from '@/services/calculations';
import { latestAttentionSnapshot } from '@/repositories/attention';
import { findActiveConfigVersion } from '@/repositories/versions';
import type { AttentionSnapshot } from '@/contracts/security';
import { listActiveSecurities } from '@/repositories/security';
import type { Queryable } from '@/repositories/client';
import type {
  AttentionLeaderboardResponse,
  AttentionMetricView,
  AttentionPageState,
  AttentionRowView,
  NotableMoverView,
} from './contract';
import { KEYS, resolveRedisClient, type RedisClient } from './redis';
import { ATTENTION_CONFIG_ENVIRONMENT, materializeAttentionMetricsForSecurity } from './pipeline';

export const APEWISDOM_BOARD_URL = 'https://apewisdom.io/';
export const APEWISDOM_METHODOLOGY_URL = 'https://apewisdom.io/methodology/';

/** F08 §4.4's own floor — distinct from `attention.rank_change`'s 25-mention eligibility gate. */
export const THIN_SAMPLE_MENTION_FLOOR = 5;

/** F08 §4.4: top three movers, refreshed only this often. */
export const NOTABLE_MOVERS_CACHE_SECONDS = 30 * 60;

/**
 * Lane-review finding 5: staleness derived independently of whatever a persisted artifact
 * happens to say — see this module's own doc and `compute.ts`'s doc for why a stored artifact's
 * `eligibility` can be permanently stuck at whatever it was the first time an observation was
 * computed. Reuses `attention.rank_change`'s own registered `stalenessMinutes` rather than a
 * second hardcoded threshold, so the two can never silently disagree on what "stale" means.
 */
function isDataStale(observedAt: Date, now: Date): boolean {
  const stalenessMinutes = METHOD_REGISTRY.latest('attention.rank_change').stalenessMinutes;
  if (stalenessMinutes === null) return false;
  return now.getTime() - observedAt.getTime() > stalenessMinutes * 60_000;
}

async function loadPointerArtifact(
  redis: RedisClient,
  key: string,
  db: Queryable | undefined,
): Promise<CalculationArtifact | null> {
  const calculationId = await redis.get(key);
  if (calculationId === null) return null;
  return loadArtifact(calculationId, db);
}

/**
 * Lane-review round 4 finding 1. `runAttentionCollection` (`pipeline.ts`) writes every
 * security's `attention_snapshot` row first, then materializes Redis pointers in a second,
 * unguarded loop — so a security whose materialization step failed or hasn't run yet for the
 * newest observation can have a fresh Postgres row paired with a Redis pointer left over from an
 * *older* one. Reading the raw cells from the fresh row and every delta from the stale pointer
 * (the bug this function exists to catch) renders a real move as a near-zero one, with a
 * `calculationId` that resolves to inputs contradicting the raw cells shown beside it.
 *
 * Detected the same way `attention.rank_change`'s own inputs declare their provenance: the
 * pointer artifact's `rank_now` input carries the `observedAt` of whichever snapshot it was
 * actually computed from (`inputs.ts#snapshotInput`). If that disagrees with the snapshot this
 * read just fetched from Postgres, the pointer is describing a different observation and must be
 * treated exactly like a missing pointer — recomputed and re-pointed — never rendered as if it
 * still agreed.
 *
 * **Compares parsed instants, never the raw strings — lane-review round 5 finding 1.** A first
 * version compared `rankNowInput.provenance.observedAt === current.observedAt.toISOString()`
 * directly. That is not a staleness check, it is an unconditional `false`:
 * `repositories/artifacts.ts` formats a loaded input's `observed_at` at **microsecond** precision
 * (`to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, F05 lane-review finding 6), while
 * `Date.prototype.toISOString()` always emits **millisecond** precision — the two string forms of
 * the identical instant never match, so every pointer, however fresh, was silently discarded and
 * recomputed on every single read. Parsing both to a `Date` and comparing `getTime()` compares
 * the instants the two representations actually name, not their formatting.
 *
 * **`key` is configurable — lane-review round 6 finding 2.** `rank_change` is not the only
 * pointer `pipeline.ts` writes, and it is written first of five separate, sequential
 * `redis.set`/`del` calls — an interruption partway through leaves `rank_change` fresh while a
 * suffix of the other four pointers still describes the old observation. Every one of the five
 * artifacts this feature computes carries a `mentions_now` input sourced from `current` (never
 * from a predecessor, unlike `rank_now`, which only `rank_change` has), so `buildRow` passes
 * `'mentions_now'` here to check the other four the identical way.
 *
 * **Also compares `ingestedAt` — round-14 lane-review finding 1.** `observedAt` alone cannot
 * distinguish a genuinely unchanged reading from a *revision* of it: `repositories/attention.ts`
 * stores a revision as a successor row with the identical `(security_id, source, observed_at)`
 * but a later `ingested_at` and a new `raw_hash`, and `attentionSnapshotHistory`'s `distinct on
 * (observed_at) … order by ingested_at desc` makes that revised row the one every later read
 * returns — under the same `observedAt` the original pointer already matched. Traced live: a
 * revision landing after the original was already pointed at renders the revised raw cells
 * (`current`, fetched fresh from Postgres) beside the *original* reading's deltas and
 * `calculationId` — permanently, since `materializeAttentionMetricsForSecurity`'s deterministic
 * id re-derives to the same value and re-points to the same artifact, and this guard kept
 * returning `true` for the one axis it checked. `snapshotInput` (`inputs.ts`) stamps
 * `provenance.ingestedAt` from the exact snapshot it was built from, so a revision's later
 * `ingested_at` shows up here the same way a genuinely different `observed_at` already did.
 */
export function pointerMatchesCurrent(
  artifact: CalculationArtifact,
  current: AttentionSnapshot,
  key: string = 'rank_now',
): boolean {
  const matchedInput = artifact.inputs.find((input) => input.key === key);
  if (matchedInput === undefined || matchedInput.provenance.observedAt === null) return false;
  const pointerObservedAt = new Date(matchedInput.provenance.observedAt).getTime();
  if (Number.isNaN(pointerObservedAt)) return false;
  if (pointerObservedAt !== current.observedAt.getTime()) return false;

  if (matchedInput.provenance.ingestedAt === null) return false;
  const pointerIngestedAt = new Date(matchedInput.provenance.ingestedAt).getTime();
  if (Number.isNaN(pointerIngestedAt)) return false;
  return pointerIngestedAt === current.ingestedAt.getTime();
}

/**
 * Round-29 lane-review finding 2. `steps.some(status === 'clamped')` — never one hardcoded step
 * key — so this stays correct for whichever method the artifact happens to be (`toMetricView` is
 * shared across `mention_delta`/`mention_growth`/`rank_change`/`mentions_zscore`).
 *
 * **Not only `attention.mentions_zscore` — round-33 lane-review finding 1 corrected this
 * comment's own claim.** `attention.rank_change`'s `bounded_rank_delta` step
 * (`calc/methods/attention-rank-change-v1_1.ts`) sets `status: 'clamped'` exactly the same way
 * whenever a measured rank move exceeds the board size — reachable on the ordinary bootstrap
 * path (an unbounded provider-reported `rank_24h_ago` against a 100-name board). This function
 * was already correct for that case since it checks every step, not one hardcoded key; only the
 * doc's claim about which methods reach it was wrong, and a caller reading it could have assumed
 * `rankChange.isClamped` was never worth rendering.
 */
export function toMetricView(artifact: CalculationArtifact, metricId: string, label: string): AttentionMetricView {
  return {
    calculationId: artifact.calculationId,
    metricId,
    label,
    display: artifact.result?.display ?? null,
    unit: artifact.result?.unit ?? '',
    roundingRule: artifact.result?.roundingRule ?? '',
    eligibility: artifact.eligibility,
    reason: artifact.abstention?.message ?? null,
    isClamped: artifact.steps.some((step) => step.status === 'clamped'),
  };
}

/**
 * A raw, observed fact (current mentions, upvotes, rank) rather than a computed result. It still
 * carries a real `calculationId` — the artifact that declared this exact value as one of its own
 * frozen inputs, so "How this was calculated" opens a real Inspector page that shows this figure
 * with its full provenance, even though the artifact's own headline result is a different number
 * (a delta). `ui/metric-manifest.ts` is the canonical place this judgment call is stated for
 * `check:calc-coverage`'s purposes — `mentions_now`/`rank_now` name `attention.rank_change` as
 * the method, `engagement_now` names `attention.engagement_per_mention` (lane-review round 6
 * finding 3), each naming the artifact that actually declares the value as a frozen input.
 */
function toRawMetricView(
  artifact: CalculationArtifact,
  metricId: string,
  label: string,
  displayValue: string | null,
): AttentionMetricView {
  return {
    calculationId: artifact.calculationId,
    metricId,
    label,
    display: displayValue,
    unit: '',
    roundingRule: 'int_0dp_half_even',
    eligibility: displayValue === null ? 'not_applicable' : 'ok',
    reason: displayValue === null ? 'Not reported for this observation.' : null,
    // A raw observed fact, never a computed result with a denominator to floor.
    isClamped: false,
  };
}

/**
 * Lane-review round 7 finding 1. `rank_change`'s own `rank_prior` input already names, via its
 * `providerField`, whether the comparison used a local predecessor (`'rank'`) or the provider's
 * bundled bootstrap field (`'rank_24h_ago'`) — round 6 finding 1's own fix. Deriving both the
 * source label and the real comparison window from that one already-verified-fresh artifact,
 * instead of two more side-channel Redis keys, means there is nothing left to go stale between
 * `pipeline.ts`'s sequential writes: whatever `rank_change` says is exactly what this reads.
 *
 * Exported (round-8 lane-review finding 5): a mutant that gutted this function and
 * `deriveHistoryDepth` entirely still left all unit/contract/integration tests green — only
 * `tests/e2e/attention.spec.ts`'s source-label and depth-14 assertions caught it, and nothing at
 * any level asserted the `windowHours` half specifically. Exported and unit-tested directly, the
 * same way `pointerMatchesCurrent` below is, so a regression here fails fast in `vitest` rather
 * than only in the much slower, much later e2e suite.
 */
export function deriveRankChangeProvenance(
  rankChangeArtifact: CalculationArtifact,
  current: AttentionSnapshot,
): { readonly source: AttentionRowView['rankChangeSource']; readonly windowHours: number } {
  const rankPriorInput = rankChangeArtifact.inputs.find((input) => input.key === 'rank_prior');
  const priorObservedAtRaw = rankPriorInput?.provenance.observedAt ?? null;
  const isOwnHistory = rankPriorInput?.provenance.providerField === 'rank' && priorObservedAtRaw !== null;
  if (!isOwnHistory) {
    return { source: 'provider_reported', windowHours: current.windowHours };
  }
  const priorObservedAt = new Date(priorObservedAtRaw as string).getTime();
  if (Number.isNaN(priorObservedAt)) return { source: 'provider_reported', windowHours: current.windowHours };
  return {
    source: 'own_history',
    windowHours: (current.observedAt.getTime() - priorObservedAt) / MS_PER_HOUR,
  };
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * `mentions_zscore`'s own `history_N` inputs (`inputs.ts#mentionsZscoreInputs`) are exactly the
 * comparable snapshots the depth-14 gate counts — reading their count off the artifact that used
 * them, rather than a separately-written counter, is the same "derive from what was actually
 * used" move as `deriveRankChangeProvenance` above.
 */
export function deriveHistoryDepth(zscoreArtifact: CalculationArtifact): number {
  return zscoreArtifact.inputs.filter((input) => input.key.startsWith('history_')).length;
}

/**
 * Lane-review round 25 finding 2. `mentions_zscore` is an aggregate over 14–30 prior
 * observations, not a depth-gated count with "no time window applies" — its own `history_N`
 * inputs (the same ones `deriveHistoryDepth` counts) each carry the real `observedAt` of the
 * snapshot they were built from, exactly like `rank_prior` does for `deriveRankChangeProvenance`
 * above. `attentionSnapshotHistory` orders `observed_at desc`, so the *oldest* comparable
 * snapshot in this artifact's own window is whichever `history_N` input's `observedAt` is
 * smallest — never assumed to be the last index, since a mid-run revision or an out-of-order
 * write could in principle disturb that.
 *
 * Today's daily-ish cadence spans this window over roughly a month; once F16a's 5-minute
 * dispatch cadence lands, the identical `n=30` spans roughly 2.5 hours instead — a reader cannot
 * tell the two apart from `n` and source alone, which is exactly what §6.1 requires a rendered
 * aggregate to carry. `null` only if the artifact somehow carries no `history_N` input at all
 * (never reachable through the depth-14 gate that guards whether this cell renders at all, but
 * this function makes no assumption about its own caller).
 */
export function deriveZscoreWindowHours(
  zscoreArtifact: CalculationArtifact,
  current: AttentionSnapshot,
): number | null {
  const historyObservedAts = zscoreArtifact.inputs
    .filter((input) => input.key.startsWith('history_') && input.provenance.observedAt !== null)
    .map((input) => new Date(input.provenance.observedAt as string).getTime())
    .filter((ms) => !Number.isNaN(ms));
  if (historyObservedAts.length === 0) return null;
  const oldest = Math.min(...historyObservedAts);
  return (current.observedAt.getTime() - oldest) / MS_PER_HOUR;
}

async function buildRow(
  security: { readonly id: string; readonly symbol: string; readonly name: string },
  current: AttentionSnapshot,
  redis: RedisClient,
  db: Queryable | undefined,
  now: Date,
  configVersion: string | null,
  malformedTickers: ReadonlySet<string>,
): Promise<AttentionRowView | null> {
  let rankChangeArtifact = await loadPointerArtifact(
    redis,
    KEYS.metricPointer(security.id, 'attention.rank_change'),
    db,
  );
  // Lane-review round 4 finding 1: a pointer that resolves but describes an older observation
  // than `current` is not "present," it is wrong — fall through to the same recovery path a
  // missing pointer takes, rather than rendering raw cells from `current` beside deltas computed
  // from whatever observation the stale pointer still points at.
  let needsRecovery = rankChangeArtifact === null || !pointerMatchesCurrent(rankChangeArtifact, current);
  if (needsRecovery) rankChangeArtifact = null;

  let mentionDeltaArtifact: CalculationArtifact | null = null;
  let mentionGrowthArtifact: CalculationArtifact | null = null;
  let engagementArtifact: CalculationArtifact | null = null;
  let zscoreArtifact: CalculationArtifact | null = null;

  if (!needsRecovery) {
    [mentionDeltaArtifact, mentionGrowthArtifact, engagementArtifact, zscoreArtifact] = await Promise.all([
      loadPointerArtifact(redis, KEYS.metricPointer(security.id, 'attention.mention_delta'), db),
      loadPointerArtifact(redis, KEYS.metricPointer(security.id, 'attention.mention_growth'), db),
      loadPointerArtifact(redis, KEYS.metricPointer(security.id, 'attention.engagement_per_mention'), db),
      loadPointerArtifact(redis, KEYS.metricPointer(security.id, 'attention.mentions_zscore'), db),
    ]);

    // Lane-review round 6 finding 2: `pipeline.ts` writes these five pointers as five separate,
    // sequential `redis.set`/`del` calls, `rank_change` first. Any interruption between them (an
    // Upstash REST failure, a serverless timeout, a later security in the same run throwing)
    // leaves `rank_change` pointing at the new observation while some suffix of the other four
    // still points at the old one — round 4's guard covered only `rank_change`, so this exact
    // partial-materialization state passed through unrecovered. Every one of the five artifacts
    // carries a `mentions_now` input sourced from `current` (never from a predecessor), so it is
    // as reliable a per-artifact freshness check as `rank_change`'s own `rank_now`. If *any*
    // loaded artifact disagrees with `current`, the whole row is treated as needing recovery —
    // not just the one pointer that happened to disagree — since a partial recompute would leave
    // the same inconsistency in a different shape.
    const anyStale = [mentionDeltaArtifact, mentionGrowthArtifact, engagementArtifact, zscoreArtifact].some(
      (artifact) => artifact !== null && !pointerMatchesCurrent(artifact, current, 'mentions_now'),
    );
    // Lane-review round 7 finding 2: `engagement_per_mention` and `mentions_zscore` are
    // *unconditionally* computed (`compute.ts`'s return type has no `| null` on either) — unlike
    // `mention_delta`/`mention_growth`, which are legitimately `del`'d on a methodology boundary
    // (`pipeline.ts`'s own comment). A missing pointer for either of the always-computed two can
    // only mean an interrupted materialization, never a real suppression, so it must trigger
    // recovery exactly like a stale one — the earlier version treated "absent" as healthy here,
    // which left an interrupted run's `engagement_per_mention`/`mentions_zscore` pointer missing
    // forever, falling back (`engagementSource` below) to `rank_change`'s own artifact, whose
    // inputs contain no `engagement` figure at all. `mention_delta`/`mention_growth`'s absence
    // stays accepted as ambiguous — genuinely and deliberately null on a boundary, not (yet)
    // distinguishable here from "not written yet" without more information than this read has.
    const alwaysComputedMissing = engagementArtifact === null || zscoreArtifact === null;
    needsRecovery = anyStale || alwaysComputedMissing;
  }

  if (needsRecovery) {
    // Lane-review round 2 finding 1: Redis is a performance cache for the assembled view, not
    // the sole source of truth for whether this security's attention data exists at all. A cold
    // cache — a fresh serverless invocation under `resolveRedisClient()`'s current in-memory
    // fallback (MT-03/Upstash still not provisioned, `DEPLOY.md`), or any real Upstash flush —
    // must not read as "no observation has ever been recorded" when Postgres already has
    // everything the collector wrote. `materializeAttentionMetricsForSecurity` does no provider
    // I/O (`compute.ts`'s own doc): it is a storage-only replay of exactly what the collector
    // already persisted, using the same deterministic `calculationId` (lane-review round-1
    // finding 3), so recomputing here either re-reads an artifact already on disk or, at worst,
    // computes the identical one again — never new information. It also repoints Redis as a side
    // effect, so this recovery happens at most once per security per cold cache, not on every
    // request.
    if (configVersion === null) return null;
    const recovered = await materializeAttentionMetricsForSecurity({
      securityId: security.id,
      symbol: security.symbol,
      configVersion,
      db,
      redis,
      now,
    });
    if (recovered === null) return null;
    rankChangeArtifact = recovered.rankChange;
    mentionDeltaArtifact = recovered.mentionDelta;
    mentionGrowthArtifact = recovered.mentionGrowth;
    engagementArtifact = recovered.engagementPerMention;
    zscoreArtifact = recovered.mentionsZscore;
    // Lane-review round 5 finding 2: this row's numbers just changed (a missing or stale pointer
    // was recomputed), but the 30-minute notable-movers cache (`cachedNotableMovers` below,
    // populated from whatever `rows` looked like on some earlier read) has no way to know that —
    // it is `del`'d only at the end of a successful collector run (`pipeline.ts`) or by the e2e
    // seed harness, neither of which fires here. Left alone, the "Notable rank changes" cards
    // would keep showing a stale Δ Rank and a stale `calculation_id` for this security, silently
    // disagreeing with the freshly recomputed table row on the same page. Invalidating here means
    // `cachedNotableMovers`, called once after every row in this read has been built, recomputes
    // from the now-correct `rows` instead of serving a snapshot computed before this recovery.
    await redis.del(KEYS.notableMovers());
  }
  // `rankChangeArtifact`/`engagementArtifact`/`zscoreArtifact` are all non-null past this point:
  // the recovery branch returns `null` whenever `recovered` is null, and the fast path only
  // reaches here when all three were already known non-null and fresh (round 7 finding 2) — these
  // guards satisfy the type checker without a cast.
  if (rankChangeArtifact === null || engagementArtifact === null || zscoreArtifact === null) return null;

  const abstentionReason = rankChangeArtifact.abstention?.reason ?? null;
  const { source: rankChangeSource, windowHours: observationWindowHours } = deriveRankChangeProvenance(
    rankChangeArtifact,
    current,
  );
  const depth = deriveHistoryDepth(zscoreArtifact);
  const mentionsZscoreWindowHours = deriveZscoreWindowHours(zscoreArtifact, current);

  return {
    securityId: security.id,
    symbol: security.symbol,
    companyName: security.name,
    mentions: toRawMetricView(rankChangeArtifact, 'attention.mentions_now', 'Mentions', String(current.mentions)),
    mentionDelta:
      mentionDeltaArtifact === null ? null : toMetricView(mentionDeltaArtifact, 'attention.mention_delta', 'Δ Mentions'),
    mentionGrowth:
      mentionGrowthArtifact === null
        ? null
        : toMetricView(mentionGrowthArtifact, 'attention.mention_growth', 'Mention growth'),
    // Lane-review round 7 finding 2: `engagementArtifact` is guaranteed non-null past the guard
    // above — no more `?? rankChangeArtifact` fallback, which used to hand this cell an artifact
    // with no `engagement` input in it whenever the real one's pointer was merely absent.
    upvotes: toRawMetricView(
      engagementArtifact,
      'attention.engagement_now',
      'Upvotes',
      current.engagement === null ? null : String(current.engagement),
    ),
    rank: toRawMetricView(
      rankChangeArtifact,
      'attention.rank_now',
      'Rank',
      current.rank === null ? null : String(current.rank),
    ),
    rankChange: toMetricView(rankChangeArtifact, 'attention.rank_change', 'Δ Rank'),
    mentionsZscore:
      zscoreArtifact === null ? null : toMetricView(zscoreArtifact, 'attention.mentions_zscore', 'Anomaly (z-score)'),
    mentionsZscoreWindowHours,
    observedAt: current.observedAt,
    observationWindowHours,
    historyDepth: { securityId: security.id, comparableSnapshots: depth, requiredForZscore: 14 },
    isNew: abstentionReason === 'new_to_board',
    isDroppedFromBoard: abstentionReason === 'dropped_from_board',
    isMethodologyBoundary: abstentionReason === 'methodology_version_boundary',
    isThinSample: current.mentions < THIN_SAMPLE_MENTION_FLOOR,
    rankChangeSource,
    isStale: isDataStale(current.observedAt, now),
    // Round-33 lane-review finding 3: `malformedTickers` is this read's own snapshot of
    // `pipeline.ts`'s last-run write (`KEYS.malformedTickers()`), never a persisted field on the
    // row itself — so a security that parsed cleanly on a later run stops carrying this flag the
    // moment `assembleAttentionLeaderboard` re-reads the key, with nothing here to go stale.
    wasMalformedLastRun: malformedTickers.has(security.symbol.toUpperCase()),
  };
}

/**
 * F08 §4.4's own cache. Read here (30-minute TTL, so repeat page views within a window see a
 * stable top three rather than one that flickers on every request); invalidated by
 * `pipeline.ts` at the end of every collector run that actually changed something, so a fresh
 * collection is never masked by a stale cache entry for up to half an hour.
 *
 * **Recomputed and re-cached the moment any cached mover is no longer valid — round-13
 * lane-review finding 1, correcting round 12's own fix.** `selectNotableMovers`'s staleness
 * exclusion (round 9 finding 2) only ran at the moment this cache was populated; nothing
 * invalidates the cache merely because time passed. Round 12's fix filtered the cached blob
 * against live `isStale` on every read, which closed the "serves a stale mover" hole but opened
 * two more: (a) removing an entry from a *fixed three-slot* cached list never lets a genuinely
 * fresh, otherwise-eligible security take the now-vacated slot — a live mover stays hidden for the
 * rest of the TTL exactly because a *different* one went stale; (b) a cached mover for a security
 * no longer in `rows` at all (deactivated, or otherwise dropped from `listActiveSecurities`) was
 * never removed, since the filter only ever checked `isStale`, never presence. Falling through to
 * a fresh `selectNotableMovers(rows)` computation — and re-caching that — the moment *any* cached
 * entry is found invalid closes both: the result is always either the untouched cache (still
 * fully valid) or a complete, correct recomputation, never a partial list quietly missing a slot.
 *
 * **Also compares `calculationId`, not just presence and `isStale` — round-15 lane-review
 * finding 2.** `pipeline.ts` invalidates this cache with one `redis.del` issued after its whole
 * per-security materialization loop finishes. An interruption strictly after the last security
 * (an Upstash REST failure, a serverless timeout on that final call) leaves every pointer fresh —
 * so `buildRow`'s own recovery never fires and this cache's `del` never runs — while the *cache*
 * still holds the previous run's movers. `rowsBySecurityId.get(...)?.isStale === false` alone
 * cannot catch this: the row is present and is fresh, it is simply a *different* fresh reading
 * than the one the cache described. Comparing the row's current `rankChange`/`mentionDelta`
 * `calculationId` against the cached mover's own is the same "derive validity from the artifact
 * actually in hand, never trust a side channel" move round 7 finding 1 already applied to
 * `historyDepth`/`rankChangeSource`/`comparisonWindowHours` — without it, the table could render
 * a freshly recomputed Δ Rank while this card kept the previous run's number and Inspector link
 * for up to the rest of the 30-minute TTL, both real numbers with real, but disagreeing,
 * `calculation_id`s.
 *
 * **An empty cached list is never trusted as valid — round-16 lane-review finding 1.**
 * `parsed.every(...)` on an empty array is vacuously `true`, so a cache warmed during a genuine
 * warm-up window (nothing yet clears the notable-mover bar) survives, unexamined, straight
 * through every check above — there is no cached *member* for any of them to apply to. The same
 * interruption class finding 2 (above) describes then leaves this stale `"[]"` in place: a later
 * collector run makes a security genuinely eligible, its pointers are fresh so no recovery-
 * triggered invalidation fires, and the empty list is served forever (up to the TTL) beside a
 * table row visibly showing `eligibility: 'ok'` and a real Δ Rank — "no security clears the bar"
 * asserted directly beside the security that does. `selectNotableMovers` is a pure, cheap
 * in-memory filter over `rows` the read already holds, so recomputing rather than trusting an
 * empty cache costs nothing worth protecting against.
 */
async function cachedNotableMovers(
  redis: RedisClient,
  rows: readonly AttentionRowView[],
  lastCollectedAt: Date,
): Promise<NotableMoverView[]> {
  const cached = await redis.get(KEYS.notableMovers());
  if (cached !== null) {
    try {
      const parsed = JSON.parse(cached) as NotableMoverView[];
      const rowsBySecurityId = new Map(rows.map((row) => [row.securityId, row]));
      const stillValid =
        parsed.length > 0 &&
        parsed.every((mover) => {
          const row = rowsBySecurityId.get(mover.securityId);
          if (row === undefined || row.isStale) return false;
          if (row.observedAt.getTime() < lastCollectedAt.getTime()) return false;
          if (row.rankChange.calculationId !== mover.rankChange.calculationId) return false;
          if ((row.mentionDelta?.calculationId ?? null) !== (mover.mentionDelta?.calculationId ?? null)) return false;
          // Round-34 lane-review finding 1: `rankChangeSource`/`observationWindowHours` (round-33
          // finding 2) are required fields on this cached shape, but nothing here checked a cached
          // blob actually carries them — a blob written before that change (or by any future
          // schema change to this cache) would be served with both `undefined`, which
          // `rankChangeSourceCaption`/`windowLabel` render as a false "this deployment's own
          // comparison" and a bare "NaN-hour" label rather than failing loudly. Comparing against
          // the live row's own values is the same "derive validity from the artifact actually in
          // hand" check the two lines above already apply to `calculationId` — a mismatch or an
          // absent field fails this exactly the same way a stale `calculationId` already does.
          if (row.rankChangeSource !== mover.rankChangeSource) return false;
          if (row.observationWindowHours !== mover.observationWindowHours) return false;
          // Round-42 lane-review finding 2 added `isWarmingUp` as a third required field on this
          // same cached shape — the identical staleness class round 34 already found twice here.
          const isWarmingUp = row.historyDepth.comparableSnapshots < row.historyDepth.requiredForZscore;
          return isWarmingUp === mover.isWarmingUp;
        });
      if (stillValid) return parsed;
    } catch {
      // A cache entry that no longer parses is treated as absent, not fatal.
    }
  }
  const computed = selectNotableMovers(rows, lastCollectedAt);
  await redis.set(KEYS.notableMovers(), JSON.stringify(computed));
  await redis.expire(KEYS.notableMovers(), NOTABLE_MOVERS_CACHE_SECONDS);
  return computed;
}

/**
 * F08 §4.4: the top three movers by absolute rank-change magnitude, excluding a thin-sample row
 * (current mentions < 5) and any row `attention.rank_change` could not compute at all.
 *
 * **Also excludes a stale row — round-9 lane-review finding 2.** `attention.rank_change`'s own
 * stored `eligibility` can never be updated back to `'stale'` for a security whose observation
 * stopped changing (`calculation_snapshot_identity_unique` keys on `input_hash`, which does not
 * include `asOf` — the exact limit `compute.ts`'s own doc records), so a security that fell off
 * ApeWisdom's board months ago can carry `eligibility: 'ok'` and a large historical Δ Rank
 * forever. Without this exclusion, that permanently-stale move can outrank every genuinely fresh
 * one and lead "The three largest moves this run" — a card with no `observedAt`, no
 * `FreshnessBadge` and no window (`NotableMoverView`, `NotableMovers.tsx`) — asserting a recency
 * about a run it was never part of. `row.isStale` (round 5 finding 5's read-time check,
 * independent of the frozen artifact) is exactly the signal `AttentionTable`'s own
 * `FreshnessBadge` already uses for this; the movers card gets the same guarantee by excluding
 * the row outright rather than rendering it with no freshness signal of its own to disclose.
 *
 * **Also excludes a row that predates the collection frontier — round-21 lane-review finding 2.**
 * `!row.isStale` alone is a fixed six-hour wall-clock window, not membership in *this run* —
 * under any collection cadence shorter than that floor (the intended production shape once F16a
 * wires the dispatcher), a security that fell off ApeWisdom's board an hour ago is not yet
 * `isStale` but was still not part of the most recent collection attempt. `AttentionTable.tsx`'s
 * own per-row copy (round 19/20) already answers "was this row part of the most recent run" by
 * comparing `observedAt` against `lastCollectedAt` — every security a poll matches shares one
 * identical `observedAt` (`collector.ts`'s one timestamp per board fetch) — and this card, which
 * carries no `observedAt` of its own to let a reader check, needs the identical guarantee: never
 * lead "the three largest moves this run" with a security that was not part of it.
 *
 * **Carries `rankChangeSource`/`observationWindowHours` — round-33 lane-review finding 2.**
 * Without them this card ranked Δ Rank values computed over unlike spans and unlike sources (a
 * same-run provider-bootstrap delta beside a five-day, this-deployment's-own-comparison delta) as
 * one undifferentiated list, with neither qualifier visible — `AttentionTable.tsx` already
 * discloses both for the identical security. Read directly off the same `row` this mover is
 * selected from, so the two can never disagree.
 */
export function selectNotableMovers(rows: readonly AttentionRowView[], lastCollectedAt: Date): NotableMoverView[] {
  const eligible = rows.filter(
    (row) =>
      !row.isThinSample &&
      !row.isStale &&
      row.observedAt.getTime() >= lastCollectedAt.getTime() &&
      row.rankChange.eligibility === 'ok' &&
      row.rankChange.display !== null,
  );
  const sorted = [...eligible].sort((a, b) => {
    const magnitudeA = Math.abs(Number(a.rankChange.display));
    const magnitudeB = Math.abs(Number(b.rankChange.display));
    return magnitudeB - magnitudeA;
  });
  return sorted.slice(0, 3).map((row) => ({
    securityId: row.securityId,
    symbol: row.symbol,
    companyName: row.companyName,
    rankChange: row.rankChange,
    mentionDelta: row.mentionDelta,
    rankChangeSource: row.rankChangeSource,
    observationWindowHours: row.observationWindowHours,
    // Round-42 lane-review finding 2: the identical warm-up test `AttentionTable.tsx`'s own
    // `rankChangeSourceLabel` applies to this row's `historyDepth`, so the card's caption can
    // never disagree with the table's for the same security.
    isWarmingUp: row.historyDepth.comparableSnapshots < row.historyDepth.requiredForZscore,
  }));
}

/**
 * Round-11 lane-review finding 1. `NotableMovers`'s stale-specific empty-state copy (round 10
 * finding 3) was gated on `leaderboard.state === 'stale'`, but `pageState` checks `degraded`
 * *before* `collectionStale` and returns on the first match (`tests/unit/services/attention/
 * leaderboard.test.ts` pins that precedence deliberately) — so a provider outage that has lasted
 * past the six-hour staleness floor reads `state: 'degraded'`, never `'stale'`, even though every
 * row is by then individually stale too. Traced live: a degraded run with one row carrying a
 * real, eligible Δ Rank of 40, excluded from `selectNotableMovers` purely for staleness — the
 * card rendered `stale === false` and told the reader "no security clears the notable-mover bar,"
 * the exact misattribution round 10 fixed for the `'stale'` case, reachable through the *more*
 * common of the two doors (an outage long enough to also age its own rows past the floor). The
 * correct signal is not which page state fired, but whether staleness is what actually emptied
 * (or would shrink) the movers list — computed here directly from the same predicate
 * `selectNotableMovers` uses, so the two can never drift apart.
 *
 * **Accepts `eligibility: 'stale'`, not just `'ok'` — round-14 lane-review finding 2.**
 * `buildRow`'s cold-cache recovery path (`materializeAttentionMetricsForSecurity`, called with
 * `now` the read's own wall clock) recomputes `attention.rank_change` fresh, and
 * `calc/artifact.ts`'s own eligibility rule (`args.stale === true ? 'stale' : 'ok'`) freezes
 * `eligibility: 'stale'` on that exact recomputation whenever the observation has already aged
 * past the staleness floor — precisely the row this predicate exists to catch. Requiring
 * `=== 'ok'` excluded it from this signal (while `selectNotableMovers` had already dropped it via
 * `row.isStale`), so the very first read after a cold start — the ordinary case while MT-03/
 * Upstash remains unprovisioned — showed the generic "no security clears the notable-mover bar"
 * copy instead of the accurate staleness explanation. `'ok'` and `'stale'` are the only two
 * eligibilities that ever carry a `result` at all (`calc/artifact.ts`: every abstention branch
 * sets `result: null`), so `row.rankChange.display !== null` already narrows to exactly those
 * two — the eligibility check only needs to stop treating one of them as disqualifying.
 *
 * **Also true for a row excluded as predating the collection frontier — round-21 lane-review
 * finding 2.** `selectNotableMovers` gained a second exclusion (a row older than `lastCollectedAt`
 * is not part of the run the card's own caption claims) that this predicate's own doc already
 * promises never drifts from — kept true here the same way: a row otherwise eligible but for
 * being non-frontier is exactly as much "excluded for a freshness reason" as one past the
 * six-hour floor, and the reader needs the same explanation either way.
 */
export function hasNotableMoverExcludedForStaleness(rows: readonly AttentionRowView[], lastCollectedAt: Date): boolean {
  return rows.some(
    (row) =>
      !row.isThinSample &&
      (row.isStale || row.observedAt.getTime() < lastCollectedAt.getTime()) &&
      (row.rankChange.eligibility === 'ok' || row.rankChange.eligibility === 'stale') &&
      row.rankChange.display !== null,
  );
}

/**
 * Round-36 lane-review finding 1. `wasMalformedLastRun` (on `AttentionRowView`) is computed
 * inside `buildRow`, which `assembleAttentionLeaderboard` never calls for a security with no
 * snapshot at all — so a security whose board entries have **never once** parsed has no row to
 * carry that flag, and silently vanishes from the board with nothing explaining the gap. Derived
 * page-level, against every *active* security this read has a symbol for.
 *
 * **Takes `observedSymbols`, never `rows` — round-38 lane-review finding 1, correcting round
 * 36's own implementation (round 37 patched one symptom of this one branch over, at the
 * `unavailable` return; this fixes the actual cause on every return path).** "Absent from `rows`"
 * is not "never observed": `buildRow` also returns `null` for a security whose observation
 * genuinely exists (`current !== null` in the caller's own loop) but needs recovery it cannot
 * perform with `configVersion === null` — a real, if currently unrenderable, corpus, not a never-
 * parsed one. `observedSymbols` is exactly "did this read find a snapshot for this security at
 * all," independent of whether a *row* could be built from it, so this function can no longer
 * assert "no observation has ever been recorded" over data that exists.
 * Exported and unit-tested directly, the same way `hasNotableMoverExcludedForStaleness` above is.
 */
export function deriveNeverCollectedMalformedSymbols(
  securities: readonly { readonly symbol: string }[],
  observedSymbols: ReadonlySet<string>,
  malformedTickers: ReadonlySet<string>,
): string[] {
  return securities
    .filter((security) => malformedTickers.has(security.symbol.toUpperCase()) && !observedSymbols.has(security.symbol.toUpperCase()))
    .map((security) => security.symbol);
}

export function pageState(args: {
  readonly hasEverCollected: boolean;
  readonly degraded: boolean;
  readonly rowCount: number;
  /**
   * Round-8 lane-review finding 3: this used to be `anyRowStale`, true whenever a *single* row's
   * own observation had aged past the staleness floor. `contract.ts`'s own doc defines page-level
   * `stale` as "a snapshot exists but the provider is currently unreachable" — a fact about the
   * *collection run*, not about any one security. D-30 seeds the universe from ApeWisdom's own
   * top-100 page, and `match.ts` only ever snapshots a name while it is present on that page — so
   * the moment any single security falls off page 1 (routine board churn, not a collector
   * problem), its last snapshot ages past the floor and stays there permanently, pinning the page
   * to `stale` forever even while every other name collects normally. Traced live: AAPL last
   * observed 8h ago (dropped off the board), GME observed 2 minutes ago, collection healthy →
   * the old logic returned `state: 'stale'` regardless. This field instead asks whether the
   * *collection run itself* is stale — how long since `lastCollectedAt` — which is the one fact
   * this state exists to carry, and cannot be forced stuck by one security leaving the board.
   * Per-row staleness (`AttentionRowView#isStale`) is untouched by this change; only the
   * page-level rollup moves.
   */
  readonly collectionStale?: boolean;
}): AttentionPageState {
  if (!args.hasEverCollected || args.rowCount === 0) return 'unavailable';
  if (args.degraded) return 'degraded';
  if (args.collectionStale === true) return 'stale';
  return 'ok';
}

export type AssembleAttentionLeaderboardOptions = {
  readonly redis?: RedisClient;
  readonly db?: Queryable;
  readonly now?: Date;
};

export async function assembleAttentionLeaderboard(
  options: AssembleAttentionLeaderboardOptions = {},
): Promise<AttentionLeaderboardResponse> {
  const redis = options.redis ?? resolveRedisClient();
  const db = options.db;
  const now = options.now ?? new Date();

  const [lastCollectedAtRaw, degradedRaw, degradedReasonRaw, malformedTickersRaw] = await Promise.all([
    redis.get(KEYS.lastCollectedAt()),
    redis.get(KEYS.degraded()),
    redis.get(KEYS.degradedReason()),
    redis.get(KEYS.malformedTickers()),
  ]);
  const degraded = degradedRaw === 'true';
  // Round-33 lane-review finding 3. Parsed once per read, defaulting to an empty set on a cold
  // cache or a value that no longer parses — never treated as fatal, the same "absent cache entry
  // is not an error" discipline `cachedNotableMovers` below already applies to its own cache read.
  const malformedTickers: ReadonlySet<string> = (() => {
    if (malformedTickersRaw === null) return new Set<string>();
    try {
      const parsed: unknown = JSON.parse(malformedTickersRaw);
      if (!Array.isArray(parsed)) return new Set<string>();
      return new Set(parsed.filter((value): value is string => typeof value === 'string'));
    } catch {
      return new Set<string>();
    }
  })();

  // Lane-review round 25 finding 1: computed here, before the `rows.length === 0` early return
  // below, and used on *both* return paths. It used to be computed only after that early return,
  // so a real provider outage recorded in Redis (`pipeline.ts` writes `attention:degraded` and
  // `attention:degraded_reason` on every failed run, regardless of whether any row can be built)
  // was silently discarded whenever the page also had zero renderable rows — the exact case an
  // outage is most likely to produce. `GET /api/social/reddit` returned `degraded: false` over a
  // known, current outage, and the UI's own "still warming up" copy is a materially different
  // claim from "the collector cannot reach the provider" (F08 §4.5 / F-05).
  const degradedReason: 'provider_unreachable' | 'no_new_data' | 'provider_contract_changed' | null = !degraded
    ? null
    : degradedReasonRaw === 'no_new_data'
      ? 'no_new_data'
      : degradedReasonRaw === 'provider_contract_changed'
        ? 'provider_contract_changed'
        : 'provider_unreachable';
  // Round-27 lane-review finding 1. The reason-specific half of `degradedMessage` (what actually
  // happened) does not depend on whether any row exists to render — only the trailing sentence
  // does, so it is factored out here rather than baked into three full-sentence strings that
  // would otherwise need a second, zero-row-specific copy of each (as the bug this finding fixes
  // demonstrated: hoisting `degradedMessage` above the `rows.length === 0` early return, round 25,
  // reused the has-rows text verbatim on the response branch that hardcodes `rows: []`).
  // Round-32 lane-review finding 1. `pipeline.ts`'s `no_new_data` fires on `results.length === 0`,
  // which `collectAttentionSnapshots` reaches three distinct ways: every entry malformed, every
  // ticker unmatched, or — `fixtures/apewisdom/filter/empty.json`'s own committed shape, exercised
  // end to end by `tests/integration/attention-pipeline.test.ts` — a genuinely empty board
  // (`results: []`, no entries at all). The old text asserted "every entry on the board was either
  // malformed or matched no tracked security" unconditionally — a vacuous truth over an empty set,
  // read by an operator as a positive claim that pins the fault on `match.ts`/local parsing when
  // the provider itself sent zero rows to begin with. The "either/or" framing below is true under
  // all three sub-causes without needing to plumb which one actually fired through Redis.
  const degradedReasonExplanation: (reason: 'provider_unreachable' | 'no_new_data' | 'provider_contract_changed') => string = (
    reason,
  ) =>
    reason === 'no_new_data'
      ? "ApeWisdom was reached on the last collection run, but nothing new could be added — the board was empty, or every entry on it was malformed or matched no tracked security."
      : reason === 'provider_contract_changed'
        ? "ApeWisdom was reached on the last collection run, but its response no longer matched the expected shape — the provider may have changed its API."
        : 'ApeWisdom could not be reached on the last collection run.';
  const degradedMessage =
    degradedReason === null
      ? null
      : `${degradedReasonExplanation(degradedReason)} The rows below are the most recent successful observations, each marked with its own age.`;

  // Lane-review round 2 finding 1: `lastCollectedAtRaw` is Redis's own bookkeeping key, not
  // Postgres — deciding "unavailable" from it alone, before ever asking Postgres, turns a cache
  // miss into a false "no observation has ever been recorded" page over a database full of real
  // history. Postgres (via `listActiveSecurities`/`latestAttentionSnapshot` below) is the actual
  // source of truth for whether any observation exists; a missing *individual* Redis pointer is
  // recovered per-security inside `buildRow`, not treated as page-wide unavailability.
  const activeConfig = await findActiveConfigVersion(ATTENTION_CONFIG_ENVIRONMENT, db);

  const securities = await listActiveSecurities(db);
  const rows: AttentionRowView[] = [];
  // Round-38 lane-review finding 1, correcting round 37's own fix. Round 37 suppressed
  // `neverCollectedMalformedSymbols` under `unavailableReason === 'no_active_config_version'`,
  // reasoning "absent from `rows`" over-claimed "never observed" — but that over-claim survives
  // on the *main* return path too: `buildRow` can return `null` for a security whose observation
  // genuinely exists (`current !== null`) but needs recovery it cannot perform with
  // `configVersion === null`, while a different security's already-warm pointer takes the fast
  // path regardless, keeping `rows.length &gt; 0` and this whole loop off the `unavailable` branch.
  // `observedSymbols` tracks the one fact that actually answers "has this security ever been
  // observed" — `current !== null` from this same loop, independent of whether a *row* could be
  // built from it — so the field below is never wrong for either return path, and round 37's own
  // branch-specific suppression is no longer needed (removed rather than left as now-redundant
  // special-casing).
  const observedSymbols = new Set<string>();
  // Round-42 lane-review finding 1. `activeConfig === null` does not, by itself, make this read
  // reach the `unavailable` branch below: a security whose five Redis pointers are already warm
  // takes `buildRow`'s fast path, which never consults `configVersion` at all, so `rows.length`
  // can stay positive while a *different* security — a real Postgres observation, a cold pointer
  // — silently drops out of `rows` at `buildRow`'s own `if (configVersion === null) return null`.
  // Nothing on the main return path below said so: `unavailableReason` is hardcoded `null` there,
  // and `degraded` is untouched by this cause. Tracked here, the one place that can distinguish
  // "no row because this security was never observed" (`observedSymbols` above) from "no row
  // because this read cannot currently record a calculation against anything" — the latter is a
  // real, if temporary, coverage loss on an otherwise-`ok`-looking board.
  const configVersionGapSymbols: string[] = [];
  let providerMethodologyVersion: string | null = null;
  let latestObservedAt: Date | null = null;

  for (const security of securities) {
    const current = await latestAttentionSnapshot(
      { securityId: security.id, source: 'apewisdom', asOfInstant: now },
      db,
    );
    if (current === null) continue;
    observedSymbols.add(security.symbol.toUpperCase());
    // Round-9 lane-review finding 3: this used to be a plain overwrite — `providerMethodologyVersion
    // = current.providerMethodologyVersion` on every iteration — so the banner showed whichever
    // active security happened to sort last by symbol (`listActiveSecurities` orders by symbol),
    // not the version the page's own current observations were actually collected under. Traced
    // live: a security last collected 10 days ago under an old methodology version, sorting after
    // every currently-collecting security, silently became the version the whole page reported.
    // `latestObservedAt` two lines down already tracks the true max the correct way; this now
    // takes the version paired with that same freshest observation, never a stale straggler's.
    if (latestObservedAt === null || current.observedAt.getTime() > latestObservedAt.getTime()) {
      latestObservedAt = current.observedAt;
      providerMethodologyVersion = current.providerMethodologyVersion;
    }

    const row = await buildRow(
      security,
      current,
      redis,
      db,
      now,
      activeConfig === null ? null : activeConfig.id,
      malformedTickers,
    );
    if (row !== null) {
      rows.push(row);
    } else if (activeConfig === null) {
      configVersionGapSymbols.push(security.symbol);
    }
  }

  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const neverCollectedMalformedSymbols = deriveNeverCollectedMalformedSymbols(securities, observedSymbols, malformedTickers);

  // Redis's own `lastCollectedAt` bookkeeping key when it is warm (the common, fast case); the
  // most recent observation this read actually found in Postgres otherwise — never a hardcoded
  // "unavailable" just because that one key happened to be cold.
  const lastCollectedAt = lastCollectedAtRaw !== null ? new Date(lastCollectedAtRaw) : latestObservedAt;

  if (lastCollectedAt === null || rows.length === 0) {
    // Round-10 lane-review finding 4. `buildRow` returns `null` for every security whenever
    // `activeConfig === null` (its own recovery path requires a config version to freeze a
    // calculation against), which collapses into `rows.length === 0` exactly like the ordinary
    // "nothing has ever been collected" cold start — even when Postgres holds real
    // `attention_snapshot` rows and computed `attention.*` artifacts. Traced live: a superseded
    // active `config_version`, two real snapshots and ten real artifacts already in Postgres, cold
    // Redis (`resolveRedisClient`'s in-memory fallback is the ordinary production read today,
    // MT-03/Upstash unprovisioned) — the page read `unavailable` with "the collector has not
    // produced a reading, or the product is still warming up," which is false: the collector ran
    // fine, and an operator reading that copy would look in the wrong place. `latestObservedAt`
    // set despite zero rows is exactly this signature — a real observation was found for at least
    // one security, but no row could be built from it.
    //
    // **No longer requires `latestObservedAt !== null` — round-26 lane-review finding 3.** The
    // condition above was scoped to the live-traced case (a corpus that existed, then lost its
    // active config version), but `runAttentionCollection` refuses to call `collectAttentionSnapshots`
    // at all when `activeConfig === null` (its own early return, `pipeline.ts`) — so a deployment
    // whose config version was *never* activated has an equally empty Postgres corpus and took
    // this same narrower branch, reading `'never_collected'`/"still warming up" forever on a fault
    // that will never self-resolve by waiting, and setting no `degraded` bookkeeping either (that
    // early return precedes every `redis.set` in the function). `activeConfig === null` alone is
    // the actual cause, independent of whether Postgres happens to hold history from before it
    // went missing.
    const unavailableReason: 'never_collected' | 'no_active_config_version' =
      activeConfig === null ? 'no_active_config_version' : 'never_collected';
    // Round-27 lane-review finding 1. `degradedMessage`'s own trailing sentence ("the rows below
    // are the most recent successful observations") asserts rows exist — false on this branch,
    // which hardcodes `rows: []` two lines below. A zero-row-specific trailing sentence, built
    // from the same `degradedReasonExplanation` the has-rows message uses, keeps the "what
    // happened" half accurate for both branches without duplicating it.
    //
    // **Also branches on `unavailableReason` — round-28 lane-review finding 2.** The
    // "no observation has been recorded... yet" half is itself false when the real cause is
    // `'no_active_config_version'`: a config version active during an outage, then superseded,
    // leaves `degraded`/`degradedReason` set in Redis (nothing clears them on a config change)
    // over a Postgres that may hold a real, populated corpus from before the outage — the exact
    // scenario `unavailableReason` itself exists to distinguish (round-10/26 lane-review). Reusing
    // `AttentionUnavailable.tsx`'s own config-fault wording keeps the two honest in the same way.
    //
    // **No longer says only "on the last collection run" — round-46 lane-review finding 1.**
    // `degradedReasonExplanation`'s own text describes whatever the *last* run found, phrased as
    // if that run were recent — true on the main return path below, where every row carries its
    // own age. It is not true here: `pipeline.ts`'s early return on `activeConfig === null` means
    // no run has been attempted since the config version was lost, and this branch hardcodes
    // `lastCollectedAt: null` two lines down, so nothing on the page lets a reader judge how stale
    // that "last run" actually is — it could be the same age as the config gap itself, which has
    // no floor. The added clause says so plainly instead of leaving the reader to assume "last
    // run" means "recently."
    //
    // **No longer attributes the missing run to the config gap — round-49 lane-review finding 2.**
    // "The collector has not been able to attempt another run since, because there is also no
    // active config version" gave a false cause: `pipeline.ts`'s own doc comment confirms nothing
    // calls `runAttentionCollection` in production at all yet, config version or not — no
    // dispatcher is wired (F16a). The two facts are independent; stating the config gap on its
    // own, without the false "because," keeps only what is actually known.
    const unavailableDegradedMessage =
      degradedReason === null
        ? null
        : unavailableReason === 'no_active_config_version'
          ? `${degradedReasonExplanation(degradedReason)} There is also no active config version to record a calculation against — this could be significantly out of date, and may be hiding attention data this deployment has already collected.`
          : `${degradedReasonExplanation(degradedReason)} No observation has been recorded for any tracked security yet.`;
    return {
      state: 'unavailable',
      providerMethodologyVersion: null,
      lastCollectedAt: null,
      rows: [],
      notableMovers: [],
      degraded,
      degradedMessage: unavailableDegradedMessage,
      degradedReason,
      unavailableReason,
      notableMoversExcludedForStaleness: false,
      boardSourceUrl: APEWISDOM_BOARD_URL,
      boardMethodologyUrl: APEWISDOM_METHODOLOGY_URL,
      // Round-37 lane-review finding 2 special-cased `unavailableReason ===
      // 'no_active_config_version'` here to `[]`, reasoning `rows: []` on that branch is an
      // infrastructure fault, not evidence these securities were never observed. Round 38 fixed
      // the actual cause at the source (`deriveNeverCollectedMalformedSymbols` now takes
      // `observedSymbols`, not `rows`), which already excludes any security with a real
      // Postgres snapshot regardless of which return path it reaches — so the same, unmodified
      // value is correct here too, and the special case is gone.
      neverCollectedMalformedSymbols,
      configVersionGapSymbols,
      activeConfigVersionMissing: activeConfig === null,
    };
  }

  // Round-11 lane-review finding 2, widened by round-12 finding 2: `degraded` covers three
  // distinct causes — a genuine provider fetch failure, a 200 response that yielded nothing
  // usable (an empty board, every ticker unmatched, or every entry malformed), and a 200 response
  // whose shape no longer matched the recorded schema — and only the first means "ApeWisdom could
  // not be reached." Normalized once above (round-25 finding 1 hoisted it before the early return)
  // into a typed value, both for `degradedMessage`'s text and (round-13 finding 4) for
  // `degradedReason` itself, so the page can decide whether the shared `DegradedPanel`'s "a
  // provider is currently unavailable" claim is one it should show at all — it was previously
  // rendered unconditionally, contradicting `degradedMessage`'s own accurate text directly beneath
  // it for the two causes where that claim is false.
  return {
    state: pageState({
      hasEverCollected: true,
      degraded,
      rowCount: rows.length,
      collectionStale: isDataStale(lastCollectedAt, now),
    }),
    providerMethodologyVersion,
    lastCollectedAt,
    rows,
    notableMovers: await cachedNotableMovers(redis, rows, lastCollectedAt),
    degraded,
    degradedMessage,
    degradedReason,
    unavailableReason: null,
    notableMoversExcludedForStaleness: hasNotableMoverExcludedForStaleness(rows, lastCollectedAt),
    boardSourceUrl: APEWISDOM_BOARD_URL,
    boardMethodologyUrl: APEWISDOM_METHODOLOGY_URL,
    neverCollectedMalformedSymbols,
    configVersionGapSymbols,
    activeConfigVersionMissing: activeConfig === null,
  };
}
