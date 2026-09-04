/**
 * Turning a persisted `attention_snapshot` row (plus, where one exists, its own local
 * predecessor and comparable history) into the `CalculationInputValue[]` each registered
 * `attention.*` method reads — F08 §4.1/§4.4, F06 §4.1.
 *
 * **Two possible sources for "the prior observation," and why both are legitimate.** F08 §4.1:
 * *"local history is what makes rank change ours rather than the provider's. Until depth ≥ 14
 * comparable snapshots, ... deltas are labelled provider-defined."* Read literally:
 *
 * - Once a security has at least one earlier local `attention_snapshot`, the "prior" observation
 *   for `rank_now`/`rank_prior` and `mentions_prior` is **that row** — our own, independently
 *   timestamped and independently methodology-stamped observation, which is what lets a
 *   methodology-boundary crossing be *detected* at all (ApeWisdom's own bundled 24h-ago fields
 *   can never cross a boundary; they are one field of one response).
 * - The one case that cannot use a local predecessor is the very first observation this
 *   deployment has ever recorded for a security — there is no earlier local row to compare
 *   against, so the *only* available "prior" is ApeWisdom's own embedded `rank_24h_ago`/
 *   `mentions_24h_ago` fields on the current reading itself.
 * - `sourceKind` names **which fields actually fed the computation**, and nothing else: `
 *   'own_history'` whenever a local predecessor exists (regardless of depth), `'provider_reported'`
 *   only in the one forced bootstrap case above. **Depth must never change this label** — a
 *   caption is a claim about where the number came from, and a delta genuinely computed from our
 *   own two local snapshots was never "provider-defined" no matter how shallow the local history
 *   is (lane-review finding 1: an earlier version of this file gated the label on
 *   `historyDepth >= 14`, which attributed a locally-computed number to ApeWisdom whenever depth
 *   was still warming up — captioning a real 30-rank move as "provider-defined", which would
 *   imply ApeWisdom's own much smaller bundled delta instead). Depth still matters to a reader,
 *   but as a **confidence qualifier on top of an accurate source label**, not a source label
 *   itself — `ui/attention/AttentionTable.tsx` appends "warm-up window" to `'own_history'` below
 *   the depth-14 floor, never relabels it `'provider_reported'`.
 */
import type { CalculationInputValue } from '@/calc/artifact';
import type { AttentionSnapshot } from '@/contracts/security';

/** F04 §4.3's licence note, mirrored from `services/attention-rank-change.ts`'s walking slice. */
export const APEWISDOM_ATTENTION_LICENSE_CLASS = 'attribution_required';

/** The endpoint the collector actually polls (`services/attention/collector.ts`). */
export const APEWISDOM_SOURCE_URL = 'https://apewisdom.io/api/v1.0/filter/all-stocks/page/1';

/** ApeWisdom's own "not on the board" sentinel, mirrored from `calc/methods/attention-rank-change-v1_1.ts`. */
export const ABSENT_FROM_BOARD = '0';

/**
 * **`freshness` — round-50 lane-review finding 2.** Unconditionally `'fresh'` used to mean every
 * historical comparison input — `rank_prior`/`mentions_prior`/`methodology_version_prior`
 * (deliberately an earlier reading, whether a real local predecessor or ApeWisdom's own bundled
 * 24h-ago field) and `history_0…29` (up to a month of prior comparable snapshots) — carried the
 * identical claim as `rank_now`/`mentions_now`. `CalculationInspector.tsx` renders `freshness`
 * beside each input's own `observed_at`, so `history_29`'s row could read "2026-08-04… / fresh"
 * next to a current reading three weeks later — the same "asserts recency it does not have"
 * failure this feature spent rounds 47–50 removing from its own UI copy, reached one layer deeper
 * into the one surface (§6.2's Inspector) whose entire job is provenance.
 *
 * Derived from the input's *role*, never from `now`: `'fresh'` for the current observation,
 * `'stale'` for any input that is, by construction, a reading from an earlier point in time. This
 * stays a pure function of which snapshots fed the computation — never of wall-clock time — so it
 * cannot change `computeInputHash`'s output for the same underlying facts between two runs, which
 * would collide with `compute.ts`'s deterministic-id design (see that module's own doc). `'stale'`
 * here states a fact about the data's age, not a claim of malfunction — a historical comparison
 * point is exactly as old as this feature's own methodology requires it to be.
 */
function snapshotInput(
  key: string,
  value: string,
  unit: string,
  providerField: string,
  snapshot: AttentionSnapshot,
  dataType: CalculationInputValue['dataType'] = 'decimal',
  freshness: CalculationInputValue['freshness'] = 'fresh',
): CalculationInputValue {
  return {
    key,
    value,
    unit,
    dataType,
    source: `apewisdom/${snapshot.source}`,
    quality: 'ok',
    freshness,
    provenance: {
      provider: 'apewisdom',
      providerField,
      sourceUrl: APEWISDOM_SOURCE_URL,
      observedAt: snapshot.observedAt.toISOString(),
      availableAt: snapshot.ingestedAt.toISOString(),
      ingestedAt: snapshot.ingestedAt.toISOString(),
      rawPayloadId: null,
      licenseClass: APEWISDOM_ATTENTION_LICENSE_CLASS,
      redactionClass: 'public',
    },
  };
}

export type PriorSource = {
  readonly rankPriorRaw: string;
  /**
   * **Round-52 lane-review finding 2, corrected by round-53 finding 1.** `rankPriorRaw`
   * substitutes `ABSENT_FROM_BOARD` ('0') whenever the underlying `rank` column is `null` — round
   * 52's reasoning was that `null` means "not reported for this observation" (a data-quality
   * gap), so the substitution should be marked `'imputed'` rather than `'ok'`. That is correct for
   * the **own-history branch below** (`priorLocal.rank === null`): `attention_snapshot.rank` is
   * nullable for exactly the "not reported" reason, and this case is unreachable via the real
   * collector today (`collector.ts`'s `buildAttentionSnapshotInput` rejects a missing or
   * non-positive `rank` outright) — reachable only through a row written directly, as this
   * feature's own integration tests do.
   *
   * **It is backwards for the bootstrap branch.** `current.rankPrior` is null there for exactly
   * one reason, and it is the *ordinary* path, not an edge case: `collector.ts:129,153` sets
   * `rankPrior: null` if and only if ApeWisdom's own `rank_24h_ago` field was its documented
   * "not on the board" sentinel (`'0'`) — a genuinely observed provider fact, translated to `null`
   * only because the persisted column is `.positive()` and cannot store a literal `0`
   * (`collector.ts`'s own doc comment on `buildAttentionSnapshotInput`). Every ticker newly
   * appearing on ApeWisdom's board — routine on a trending board, and exactly what
   * `seedAttentionFresh` seeds for BBBY — takes this path. Marking that substitution `'imputed'`
   * claimed the deployment filled in a value ApeWisdom actually sent, the opposite of what
   * `'imputed'` means, on the Inspector — the one surface whose whole job is provenance. This
   * field is therefore always `false` in the bootstrap case: there is no path to a genuinely
   * missing (as opposed to sentinel-encoded) `rankPrior` once `buildAttentionSnapshotInput`
   * already parses and validates `rank_24h_ago` before a row is ever written.
   */
  readonly rankPriorImputed: boolean;
  /**
   * **Round-54 lane-review finding, the identical mistake round 53 just corrected for
   * `rankPrior`, made again here.** `null` is not "the rare bootstrap case where even the
   * provider reports no prior mentions" — `collector.ts:139-144` sets `mentionsPrior = null`
   * whenever `rank_24h_ago` was ApeWisdom's own `'0'` sentinel, and on that branch the collector
   * never even reads `entry.mentions24hAgo`; it is the deployment declining to look, not the
   * provider declining to report. That branch (a ticker newly appearing on the board) is the
   * *ordinary* new-to-board path, not rare — it is exactly what `seedAttentionFresh` seeds for a
   * trending ticker, and it fires on every board refresh that has one.
   */
  readonly mentionsPriorRaw: string | null;
  readonly methodologyVersionPrior: string;
  /** Which fields actually fed the computation — never gated on depth. See this module's doc. */
  readonly sourceKind: 'own_history' | 'provider_reported';
  /** F08 §4.2: the boundary `attention.rank_change` itself already detects, surfaced here so the
   *  mention-count methods (which have no boundary awareness of their own) can be suppressed
   *  across the identical boundary rather than computing a number across it (lane-review
   *  finding 4). `false` whenever there is no local predecessor to compare against at all — the
   *  bootstrap case can never straddle a boundary, since it is one field of one response. */
  readonly isMethodologyBoundary: boolean;
  /**
   * The actual local predecessor row, when `sourceKind === 'own_history'` — `null` in the
   * bootstrap case. **Lane-review round 6 finding 1.** Every `*_prior` input's `provenance` must
   * name the observation the value actually came from: `priorLocal`'s own `observed_at` and its
   * own `rank`/`mentions` column when `sourceKind` is `'own_history'`, `current`'s bundled
   * `rank_24h_ago`/`mentions_24h_ago` field only in the bootstrap case. An earlier version always
   * stamped `current`'s own provenance on `*_prior` inputs regardless of `sourceKind` — so on
   * every `own_history` row the Inspector told the reader the prior value came from ApeWisdom's
   * bundled field, observed at the *current* instant, while the caption beside it correctly said
   * "this deployment's own comparison." The artifact was wrong in exactly the direction the
   * caption fix (finding 1, an earlier round) was supposed to prevent.
   */
  readonly priorSnapshot: AttentionSnapshot | null;
};

/** F06 §4.1's own depth gate. Used only as a *confidence qualifier* on the `'own_history'`
 *  label (`ui/attention/AttentionTable.tsx`) — never to decide the label itself (see this
 *  module's doc and lane-review finding 1). */
export const OWN_HISTORY_MIN_DEPTH = 14;

export function resolvePriorSource(current: AttentionSnapshot, priorLocal: AttentionSnapshot | null): PriorSource {
  if (priorLocal !== null) {
    return {
      rankPriorRaw: priorLocal.rank === null ? ABSENT_FROM_BOARD : String(priorLocal.rank),
      rankPriorImputed: priorLocal.rank === null,
      mentionsPriorRaw: String(priorLocal.mentions),
      methodologyVersionPrior: priorLocal.providerMethodologyVersion,
      sourceKind: 'own_history',
      isMethodologyBoundary: priorLocal.providerMethodologyVersion !== current.providerMethodologyVersion,
      priorSnapshot: priorLocal,
    };
  }
  return {
    rankPriorRaw: current.rankPrior === null ? ABSENT_FROM_BOARD : String(current.rankPrior),
    // Round-53 lane-review finding 1: never imputed here. A null `current.rankPrior` is always
    // ApeWisdom's own "not on the board" sentinel, round-tripped through `null` only because the
    // persisted column can't store a literal `0` — a genuinely observed fact, not a data gap.
    rankPriorImputed: false,
    mentionsPriorRaw: current.mentionsPrior === null ? null : String(current.mentionsPrior),
    methodologyVersionPrior: current.providerMethodologyVersion,
    sourceKind: 'provider_reported',
    isMethodologyBoundary: false,
    priorSnapshot: null,
  };
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * F08 §4.2: "every row shows the observation window" — the actual elapsed time between the two
 * observations a delta was computed from, never the provider's fixed board-window constant.
 * Lane-review finding 2: `attention_snapshot.window_hours` is hardcoded to 24 by the collector
 * (`APEWISDOM_WINDOW_HOURS`) regardless of the real polling cadence, so two snapshots an hour
 * apart still rendered "24-hour observation window" — under a real 5-minute dispatch cadence
 * (once F16a exists) a 5-minute move would be mislabelled a 24-hour one. In the bootstrap case
 * there is no local predecessor to measure a real span against, so the provider's own declared
 * window is what is genuinely being used, and is reported as such rather than a computed span.
 */
export function comparisonWindowHours(current: AttentionSnapshot, priorLocal: AttentionSnapshot | null): number {
  if (priorLocal === null) return current.windowHours;
  return (current.observedAt.getTime() - priorLocal.observedAt.getTime()) / MS_PER_HOUR;
}

export function rankChangeInputs(current: AttentionSnapshot, prior: PriorSource): CalculationInputValue[] {
  // Lane-review round 6 finding 1: the snapshot and provider field a `*_prior` input's provenance
  // names must match where the value actually came from — `priorSnapshot`'s own `rank`/
  // `provider_methodology_version` column in the `own_history` case, `current`'s bundled
  // `rank_24h_ago` field only in the bootstrap case (`priorSnapshot === null`).
  const priorProvenanceSnapshot = prior.priorSnapshot ?? current;
  const priorRankField = prior.priorSnapshot !== null ? 'rank' : 'rank_24h_ago';
  const priorMethodologyField =
    prior.priorSnapshot !== null ? 'provider_methodology_version' : 'methodology_version_24h_ago';
  return [
    // **Round-52 lane-review finding 2.** A `null` `current.rank`/`rankPriorRaw` is substituted
    // with `ABSENT_FROM_BOARD` so `attention.rank_change` has a value to compute against, but
    // `null` means "not reported for this observation" — a data-quality gap — not the genuinely
    // different fact the sentinel exists to state ("ApeWisdom reported this ticker off the
    // board"). Marking the substitution `'imputed'` (mirroring `engagementPerMentionInputs`'s
    // identical round-6 fix) states honestly that this specific value was filled in, not observed
    // — `quality: 'ok'` on a fabricated value is a stronger, false claim about the same case
    // `toRawMetricView` already renders as "Not reported for this observation."
    //
    // **Round-54 lane-review finding, not fully closed by the above.** `quality: 'imputed'` marks
    // the *value* as fabricated, but the value itself still reaches `attention.rank_change`
    // (SPINE-owned, `calc/methods/attention-rank-change-v1_1.ts`), which reads a `rank_now`/
    // `rank_prior` of `ABSENT_FROM_BOARD` as the genuinely different fact the sentinel exists to
    // state, and abstains with a specific, positive claim — "dropped from the board" /
    // "new to the board" — not a generic "data quality" abstention. So a null-rank row reached
    // only by writing directly to `attention_snapshot` (as this module's own integration tests
    // do; `collector.ts` rejects a non-positive `rank` before any row is ever written, so this is
    // unreachable via the real collector today) still renders a board-membership claim the data
    // does not support, contradicting the adjacent Rank cell's own honest "not reported"
    // rendering (`toRawMetricView`). Closing this fully would need either a third, non-sentinel
    // "genuinely unknown" input value `attention.rank_change` recognizes (a SPINE-owned change to
    // that method, out of this lane's reach) or this module refusing to emit `rankChangeInputs`
    // at all for such a row — not done here, since the case does not occur outside a
    // directly-constructed test row.
    {
      ...snapshotInput('rank_now', current.rank === null ? ABSENT_FROM_BOARD : String(current.rank), 'ranks', 'rank', current),
      quality: current.rank === null ? 'imputed' : 'ok',
    },
    {
      ...snapshotInput('rank_prior', prior.rankPriorRaw, 'ranks', priorRankField, priorProvenanceSnapshot, 'decimal', 'stale'),
      quality: prior.rankPriorImputed ? 'imputed' : 'ok',
    },
    snapshotInput('mentions_now', String(current.mentions), 'mentions', 'mentions', current),
    snapshotInput(
      'methodology_version_now',
      current.providerMethodologyVersion,
      '',
      'methodology_version',
      current,
      'identity',
    ),
    snapshotInput(
      'methodology_version_prior',
      prior.methodologyVersionPrior,
      '',
      priorMethodologyField,
      priorProvenanceSnapshot,
      'identity',
      'stale',
    ),
  ];
}

export function mentionDeltaInputs(current: AttentionSnapshot, prior: PriorSource): CalculationInputValue[] {
  const mentionsPriorRaw = prior.mentionsPriorRaw as string;
  // Lane-review round 6 finding 1 — see `rankChangeInputs`'s identical reasoning.
  const priorProvenanceSnapshot = prior.priorSnapshot ?? current;
  const priorMentionsField = prior.priorSnapshot !== null ? 'mentions' : 'mentions_24h_ago';
  return [
    snapshotInput('mentions_now', String(current.mentions), 'mentions', 'mentions', current),
    snapshotInput(
      'mentions_prior',
      mentionsPriorRaw,
      'mentions',
      priorMentionsField,
      priorProvenanceSnapshot,
      'decimal',
      'stale',
    ),
  ];
}

/** Identical shape to `mentionDeltaInputs` — both methods read the same two facts. */
export const mentionGrowthInputs = mentionDeltaInputs;

export function engagementPerMentionInputs(current: AttentionSnapshot): CalculationInputValue[] {
  // Lane-review round 6 finding 4: `engagement` is nullable on `attention_snapshot` — a value not
  // reported for this observation, not a genuine zero. Substituting `0` while marking it
  // `quality: 'ok'` fabricated a real observed figure the provider never sent; `'imputed'` states
  // honestly that this input was filled in, not observed, matching `toRawMetricView`'s own
  // `not_applicable` rendering of the raw Upvotes cell for the identical null.
  const engagementIsReported = current.engagement !== null;
  return [
    {
      ...snapshotInput('engagement', String(current.engagement ?? 0), 'engagement', 'upvotes', current),
      quality: engagementIsReported ? 'ok' : 'imputed',
    },
    snapshotInput('mentions_now', String(current.mentions), 'mentions', 'mentions', current),
  ];
}

/** `history` excludes `current` itself — it is the *prior* comparable observations, per `calc/series.ts`. */
export function mentionsZscoreInputs(
  current: AttentionSnapshot,
  history: readonly AttentionSnapshot[],
): CalculationInputValue[] {
  const historyInputs = history.map((row, index) =>
    snapshotInput(`history_${index}`, String(row.mentions), 'mentions', 'mentions', row, 'decimal', 'stale'),
  );
  return [snapshotInput('mentions_now', String(current.mentions), 'mentions', 'mentions', current), ...historyInputs];
}
