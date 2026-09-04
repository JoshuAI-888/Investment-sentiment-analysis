/**
 * F08 §3 — "Produces: the leaderboard response contract; `HistoryDepth`, read by F07's
 * cold-start state and reported in `PROGRESS.md`."
 *
 * **Not placed in `src/contracts/`.** SPINE owns that directory (`docs/progress/surface.md`,
 * `CLAUDE.md`); this lane consumes it but does not add to it. Same precedent as F07's
 * `services/dashboard/contract.ts` — see that file's own doc comment for the follow-up SPINE
 * should make once it is convenient to coordinate a shared move.
 */
import { z } from 'zod';
import { timestamp } from '@/contracts/primitives';

export const metricEligibility = z.enum(['ok', 'insufficient_data', 'not_applicable', 'stale']);
export type MetricEligibility = z.infer<typeof metricEligibility>;

/** What `InspectableMetric` needs, plus the §6.1 labelling invariant (source, `n`, window, freshness). */
export const attentionMetricView = z.object({
  calculationId: z.string().min(1),
  metricId: z.string().min(1),
  label: z.string().min(1),
  display: z.string().nullable(),
  unit: z.string(),
  roundingRule: z.string(),
  eligibility: metricEligibility,
  reason: z.string().nullable(),
  /**
   * Round-29 lane-review finding 2. `true` when any step in the artifact that produced `display`
   * hit a hard floor rather than computing from real spread (`attention.mentions_zscore`'s own
   * `scaled_mad` step, `calc/methods/attention-mentions-zscore.ts`, floors the MAD-scaled
   * denominator at `epsilon` whenever at least half the comparison window shares the median —
   * routine for a low-mention security's tail). Without this, a floored denominator renders as a
   * plain, `eligibility: 'ok'` number with no visible difference from one computed off a genuine
   * spread — reachable concretely as a mid-tens-of-thousands "Anomaly" value on this product's
   * most visible surface, `AttentionTable.tsx`'s own doc traces the exact scenario. `false` for
   * every metric that carries no such step (the field always exists so no call site needs to
   * special-case which metrics can clamp).
   */
  isClamped: z.boolean(),
});
export type AttentionMetricView = z.infer<typeof attentionMetricView>;

/**
 * F08 §4.1: the local depth this deployment has actually accrued for one security's comparable
 * history — what gates the z-score's visibility and what F07's cold-start state and
 * `PROGRESS.md` both read.
 */
export const historyDepth = z.object({
  securityId: z.string().uuid(),
  comparableSnapshots: z.number().int().nonnegative(),
  /** F06 §4.1's own floor — mirrored here so a UI need not hardcode it a second time. */
  requiredForZscore: z.literal(14),
});
export type HistoryDepth = z.infer<typeof historyDepth>;

export const attentionRowView = z.object({
  securityId: z.string().uuid(),
  symbol: z.string().min(1),
  companyName: z.string().min(1),
  mentions: attentionMetricView,
  mentionDelta: attentionMetricView.nullable(),
  mentionGrowth: attentionMetricView.nullable(),
  upvotes: attentionMetricView,
  rank: attentionMetricView,
  rankChange: attentionMetricView,
  mentionsZscore: attentionMetricView.nullable(),
  /**
   * Lane-review round 25 finding 2. `mentions_zscore` is an aggregate over its own `history_N`
   * comparable snapshots (§6.1: every rendered aggregate carries its `n`, window and source) —
   * "no time window applies to a depth-gated count" was the bug, not the reason: the real span is
   * derivable from the same inputs `historyDepth.comparableSnapshots` already counts
   * (`leaderboard.ts#deriveZscoreWindowHours`), and today's daily-ish cadence versus F16a's future
   * 5-minute one render the *identical* `n=30` label over spans differing by more than 300x.
   * `null` only when the artifact carries no `history_N` input at all (unreachable through the
   * depth-14 gate that guards this cell's own rendering, but the type does not assume it).
   */
  mentionsZscoreWindowHours: z.number().nullable(),
  observedAt: timestamp,
  /**
   * Lane-review finding 2: the *actual* elapsed time the rendered deltas were computed over —
   * never `attention_snapshot.window_hours`, which is a fixed provider-board constant (24) that
   * says nothing about the real gap between two local observations. Fractional (a 5-minute
   * dispatch cadence is 0.0833 hours), never rounded up to a whole provider-window unit.
   */
  observationWindowHours: z.number().positive(),
  historyDepth: historyDepth,
  /** F06 §4.1's rank-change amendment: `attention.rank_change`'s own reason, rendered, never swallowed. */
  isNew: z.boolean(),
  /**
   * `true` when `attention.rank_change` abstained with reason `'dropped_from_board'`
   * (`leaderboard.ts`), which fires when the *current* observation's `rank` input was
   * substituted with `ABSENT_FROM_BOARD` (`services/attention/inputs.ts`) — i.e. `current.rank
   * === null` at read time. This is **not** "the provider sent no entry for this security at
   * all" (round-54 lane-review finding, correcting a false claim on the sibling field's own doc
   * comment below): the ticker was matched and an entry exists; what is missing is specifically
   * its `rank` value for this observation.
   */
  isDroppedFromBoard: z.boolean(),
  isMethodologyBoundary: z.boolean(),
  /** F08 §4.4's own floor (current mentions < 5) — distinct from `rank_change`'s own 25-mention gate. */
  isThinSample: z.boolean(),
  /** F08 §4.1: whether the delta shown is this deployment's own comparison or the provider's bundled one. */
  rankChangeSource: z.enum(['own_history', 'provider_reported']),
  /**
   * Lane-review finding 5: derived **at read time** from `observedAt` against the real clock,
   * never solely from a persisted artifact's own `eligibility`. `calculation_snapshot_identity_
   * unique` (SPINE's, `migrations/0004_calculations.sql`) keys on `input_hash`, which does not
   * include `asOf` — so once an observation's artifact is first computed, its own stored
   * `eligibility` can never be updated by a later recompute against the identical reading, no
   * matter how much real time has since passed. This field is what actually keeps D-16's promise
   * ("a stopped collector is permanent data loss") visible on this page regardless of that limit.
   */
  isStale: z.boolean(),
  /**
   * Round-33 lane-review finding 3. Whether the *most recent* collection run received a board
   * entry for this security that failed to parse (`collector.ts#buildAttentionSnapshotInput`) —
   * distinct from `isDroppedFromBoard`, which means the current observation's own `rank` value is
   * absent (see that field's own doc comment) — not that the provider sent no entry at all,
   * which is the same false claim this comment used to make about the sibling field too. A row
   * carrying this flag whose own reading also predates the collection frontier is
   * not "no longer on ApeWisdom's tracked board" (`AttentionTable.tsx`'s per-row freshness copy)
   * — it is on the board, sending data, and that data currently cannot be stored. Derived each
   * read from `pipeline.ts`'s own `KEYS.malformedTickers()` write, never persisted on the row
   * itself, so it always reflects the *last* run's outcome and never sticks once a later run
   * parses the same security cleanly.
   */
  wasMalformedLastRun: z.boolean(),
});
export type AttentionRowView = z.infer<typeof attentionRowView>;

export const notableMoverView = z.object({
  securityId: z.string().uuid(),
  symbol: z.string().min(1),
  companyName: z.string().min(1),
  rankChange: attentionMetricView,
  mentionDelta: attentionMetricView.nullable(),
  /**
   * Round-33 lane-review finding 2. Without these two, this card ranked Δ Rank values computed
   * over unlike spans and unlike sources (a same-run provider-bootstrap delta beside a five-day,
   * this-deployment's-own-comparison delta) as one undifferentiated list — `AttentionTable.tsx`'s
   * per-row cell already discloses both for the identical security; this headline card, which
   * leads the page, disclosed neither. Sourced from the same row `selectNotableMovers` picks
   * this mover from, so the two can never disagree.
   */
  rankChangeSource: z.enum(['own_history', 'provider_reported']),
  observationWindowHours: z.number().positive(),
  /**
   * Round-42 lane-review finding 2. Below F06 §4.1's depth-14 floor, `attention.rank_change`'s
   * own history is thin enough that `AttentionTable.tsx`'s identical row appends "— warm-up
   * window" to this exact caption — a disclosure F08 §4.1 requires on every rendered Δ Rank, not
   * only the table's own copy of it. Without this field the card had no way to know a mover was a
   * warm-up-window delta (as few as two comparable observations) and rendered it indistinguishable
   * from a matured one, on the one surface that ranks deltas against each other by raw magnitude.
   */
  isWarmingUp: z.boolean(),
});
export type NotableMoverView = z.infer<typeof notableMoverView>;

/**
 * F08 §4.5. `unavailable`: no snapshot exists at all, anywhere — the page states so and points
 * elsewhere (F-05). `stale`: a snapshot exists but the provider is currently unreachable — the
 * last one renders with its age. `degraded`: the last collector run failed but an earlier
 * snapshot set still renders. `ok`: a normal, current render.
 */
export const attentionPageState = z.enum(['ok', 'stale', 'degraded', 'unavailable']);
export type AttentionPageState = z.infer<typeof attentionPageState>;

/**
 * Round-10 lane-review finding 4. `state === 'unavailable'` collapses two causes that must not
 * share one message: `'never_collected'` (the ordinary cold-start case — no observation exists
 * anywhere, the product really is warming up) and `'no_active_config_version'` (an infrastructure
 * fault — `pipeline.ts`'s own words, "a calculation cannot be recorded without one to freeze… an
 * infrastructure prerequisite, not a provider condition" — over a Postgres that may hold a
 * populated corpus this read simply cannot render without one). `null` whenever `state` is not
 * `'unavailable'`.
 */
export const attentionUnavailableReason = z.enum(['never_collected', 'no_active_config_version']);
export type AttentionUnavailableReason = z.infer<typeof attentionUnavailableReason>;

/**
 * Round-11 lane-review finding 2 distinguished why `degraded` fired; round-12 finding 2 added the
 * third value. Round-13 lane-review finding 4 exposes the raw reason itself (previously only used
 * internally to pick `degradedMessage`'s text): the page rendered the shared `DegradedPanel` —
 * "One provider is currently unavailable" — directly above `degradedMessage`'s accurate text for
 * the two causes where that claim is false, stating both the wrong thing and the right one in the
 * same block. `page.tsx` uses this to show `DegradedPanel` only for the one cause it actually
 * describes. `null` whenever `degraded` is `false`.
 */
export const attentionDegradedReason = z.enum(['provider_unreachable', 'no_new_data', 'provider_contract_changed']);
export type AttentionDegradedReason = z.infer<typeof attentionDegradedReason>;

export const attentionLeaderboardResponse = z.object({
  state: attentionPageState,
  providerMethodologyVersion: z.string().nullable(),
  lastCollectedAt: timestamp.nullable(),
  rows: z.array(attentionRowView),
  notableMovers: z.array(notableMoverView),
  degraded: z.boolean(),
  degradedMessage: z.string().nullable(),
  degradedReason: attentionDegradedReason.nullable(),
  unavailableReason: attentionUnavailableReason.nullable(),
  /**
   * Round-11 lane-review finding 1. Whether at least one row that would otherwise have qualified
   * for `notableMovers` was excluded purely because it is stale — a fact about *why* the list is
   * short or empty that `leaderboard.ts#hasNotableMoverExcludedForStaleness` computes from the
   * same predicate `selectNotableMovers` filters on, independent of `state`: a provider outage
   * long enough to also age its own rows past the staleness floor reads `state: 'degraded'`, not
   * `'stale'` (`pageState` checks `degraded` first), so `state === 'stale'` alone is not a
   * reliable trigger for the UI's staleness-specific empty-state copy.
   *
   * **Not only `isStale` — round-22 lane-review finding 1.** Round 21 widened the underlying
   * predicate to also exclude a row that predates the collection frontier
   * (`row.observedAt < lastCollectedAt`) even when the row is not yet six-hour `isStale` — under a
   * collection cadence shorter than that floor, a name that fell off the board an hour ago is
   * excluded from `notableMovers` for this reason while its own row in `rows` still reads
   * `isStale: false`. A consumer of this field (this API's own UI included) must not assume `true`
   * means every excluded row is individually stale by the clock — only that at least one is not
   * from the most recent collection run, whichever of the two causes produced that.
   */
  notableMoversExcludedForStaleness: z.boolean(),
  boardSourceUrl: z.string().min(1),
  boardMethodologyUrl: z.string().min(1),
  /**
   * Round-36 lane-review finding 1. `wasMalformedLastRun` (on `AttentionRowView`) is derived only
   * for a security that already has *some* prior snapshot to attach the row to — a security whose
   * board entries have **never once** parsed has no row at all (`buildRow` is only ever called for
   * a security `latestAttentionSnapshot` finds something for), so it silently disappears from the
   * 100-name board with nothing anywhere explaining the gap. The only other reader of
   * `KEYS.malformedTickers()`, `wasMalformedLastRun`, cannot reach it — leaving an operator to
   * conclude the security simply isn't on ApeWisdom's board, the exact false reading `wasMalformedLastRun`
   * exists to prevent. This lists every active security whose symbol is in the *current* run's
   * malformed-tickers record and that still has no row to render — page-level, since there is no
   * per-security row for the per-row field to live on.
   */
  neverCollectedMalformedSymbols: z.array(z.string()),
  /**
   * Round-42 lane-review finding 1. `activeConfig === null` does not, by itself, send this read
   * to `state: 'unavailable'` — a security whose Redis pointers are already warm builds a real
   * row through `buildRow`'s fast path regardless (it never consults `configVersion`), so
   * `rows.length` can stay positive while a *different* security — a real Postgres observation,
   * a cold pointer — silently drops out of `rows` at `buildRow`'s own
   * `if (configVersion === null) return null`, with nothing on this response saying so:
   * `unavailableReason` stays `null` and `degraded` is untouched by this cause. This lists every
   * such security by symbol, independent of `state`, so the same infrastructure fault
   * `unavailableReason: 'no_active_config_version'` already discloses when it empties the whole
   * board is also disclosed when it only empties part of it.
   */
  configVersionGapSymbols: z.array(z.string()),
  /**
   * Round-47 lane-review finding 1. `configVersionGapSymbols` only fires for a security whose
   * *own* row failed to build — but `buildRow`'s fast path never consults `configVersion` at all
   * (its Redis pointers, written with no TTL, are enough on their own), so a run where every
   * tracked security's pointers are already warm builds every row successfully even with
   * `activeConfig === null`: `rows.length > 0`, `configVersionGapSymbols: []`,
   * `unavailableReason: null`, `degraded` untouched — `state` reads `'ok'`. The collector has by
   * then permanently stopped (`pipeline.ts`'s early return on a missing active config version
   * fires before it ever contacts ApeWisdom again), which under D-16 is exactly the fault this
   * package ranks above every feature on the board, and nothing on the page said so. This is the
   * page-level fact `configVersionGapSymbols` cannot carry alone: true whenever `activeConfig ===
   * null`, independent of whether any individual row happened to need it — a strict superset of
   * "`configVersionGapSymbols` is non-empty", since that field can only ever be non-empty when
   * this one is also `true`.
   */
  activeConfigVersionMissing: z.boolean(),
});
export type AttentionLeaderboardResponse = z.infer<typeof attentionLeaderboardResponse>;
