/**
 * Computing and persisting the five registered `attention.*` artifacts for one security, from
 * whatever `attention_snapshot` rows are already stored — F08 §4.3/§4.4, F06 §4.1.
 *
 * No provider call happens here — every input comes from `repositories/attention.ts`, which is
 * itself read-only storage. This is what lets the leaderboard's read path (`leaderboard.ts`)
 * treat "recompute this security's metrics" as a cheap, storage-only operation the collector runs
 * once per poll rather than something a page view has to redo (F08 §4.4: the notable-movers card
 * is "cached 30 minutes" precisely because recomputing on every request would be wasted work
 * against data that only changes once per collector run).
 *
 * **Deterministic `calculationId`, not `randomUUID()` — lane-review finding 3.** Redis holds the
 * only pointer from "this security's current metric" to "which artifact that is"; losing it (a
 * cache flush, a fresh process with no Upstash configured) must be recoverable by simply running
 * this function again, not a source of false "no data" pages. A `randomUUID()` id makes that
 * impossible: recomputing identical inputs a second time would collide with
 * `calculation_snapshot_identity_unique` (same metric/subject/config/input_hash, a different id)
 * and throw, which is exactly why an earlier version of this pipeline had to *skip* recomputing
 * unchanged data — and therefore never restored a lost pointer either. Deriving the id from the
 * exact identity fields instead means a second computation of the identical facts produces the
 * identical id, so persisting it again is either a first insert or a safely-ignorable duplicate
 * of a row already known to hold the same content — never new information to reconcile.
 *
 * **A genuine limit this does not paper over.** `calculation_snapshot_identity_unique`
 * (`migrations/0004_calculations.sql`) keys on `input_hash`, which `calc/canonical.ts`'s
 * `computeInputHash` derives from `inputs`/`assumptions`/`methodId`/`methodVersion` only —
 * `asOf` is not part of it, by a design this feature does not own (`repositories/`/`calc/` are
 * SPINE's). So if the underlying `attention_snapshot` reading is ever bit-for-bit unchanged
 * across two compute calls, **only the first call's artifact can ever be stored** — a second
 * call's freshly-recomputed `eligibility` (finding 5's own fix) cannot be persisted under any
 * `calculationId`, deterministic or not, because the database itself refuses the second row.
 * Folding a time bucket into just this module's own id does not change that: it was tried and
 * measured against a real Postgres to confirm it does not work (the insert still collides on
 * `input_hash`, independent of `id`), which is why it is not here. This is reported under this
 * feature's `RISKS`/`CONTRACTS`, not hidden — and it is why `leaderboard.ts` additionally derives
 * staleness **at read time**, directly from `current.observedAt` against the real clock, rather
 * than trusting only whatever eligibility got persisted whenever an artifact was first computed.
 *
 * **What "the in-memory artifact is byte-for-byte what is already stored" actually requires —
 * lane-review round 2 finding 3, corrected by round 3 finding 1.** Two things, together:
 * `deterministicCalculationId` folds in the *actual* `computeInputHash` result — the exact same
 * hash `calc/artifact.ts` computes and persists, not a second, independently-maintained
 * projection of its inputs (round 3 finding 1: an earlier version hashed only `{key, value,
 * dataType}` per input, silently dropping `provenance`, which `computeInputHash` does include —
 * two ordinary polls of unchanged data an hour apart then shared an id while genuinely differing
 * in `input_hash`, since only `observedAt`/`ingestedAt` had moved). And `computeAndStore`'s catch
 * no longer trusts a bare `23505` (or even which constraint fired — an exact duplicate row can
 * trip `calculation_snapshot_pkey` before Postgres ever evaluates the identity index) as proof of
 * that equivalence. It reads the existing row back and compares `inputHash` directly, and raises a
 * loud, specific error on a real divergence rather than silently keeping stale content under a
 * colliding id.
 */
import type { CalculationArtifact, CalculationInputValue, ResolvedAssumption, Subject } from '@/calc/artifact';
import { canonicalHash, computeInputHash } from '@/calc/canonical';
import { computeArtifact, loadArtifact, METHOD_REGISTRY, persistArtifact } from '@/services/calculations';
import { officialAssumptions } from '@/services/dashboard/inputs';
import { attentionSnapshotHistory } from '@/repositories/attention';
import type { AttentionSnapshot } from '@/contracts/security';
import type { Queryable } from '@/repositories/client';
import {
  comparisonWindowHours,
  engagementPerMentionInputs,
  mentionDeltaInputs,
  mentionGrowthInputs,
  mentionsZscoreInputs,
  rankChangeInputs,
  resolvePriorSource,
  type PriorSource,
} from './inputs';

/**
 * Round-9 lane-review finding 4 fixed a real bug (this query's `limit` fell back to
 * `attentionSnapshotHistory`'s own `DEFAULT_HISTORY_LIMIT = 100`, a bound
 * `repositories/attention.ts`'s own doc says exists "for a UI trend," not for this method's
 * window) — but round 9's own fix, `1_000_000`, was wrong in the other direction, caught by
 * round-10 lane-review finding 1. Every row this query returns becomes one persisted
 * `history_N` `calculation_input` row (`inputs.ts#mentionsZscoreInputs`, one INSERT each,
 * sequentially) on every poll, for every security — an uncapped window means that count grows
 * without bound as collection continues (measured: 300 polls on one security already produced
 * 45,150 z-score input rows; the existing `check:storage` projection has no line item for this
 * feature at all, so nothing catches it before it ships). `countComparableAttentionSnapshots`
 * (F06's own depth *gate* — "has this security accrued at least 14 comparable snapshots at all,
 * ever") is a different question from "how many recent points feed this poll's median/MAD," and
 * the two are not supposed to track each other past the window below: the method's own doc
 * ("with a 14–30-element window") already names the deliberate size. `ZSCORE_HISTORY_QUERY_LIMIT`
 * is 31 (30 comparable priors plus the current row, which `priorHistory` below filters back out)
 * — the upper end of that named range, not an invented number and not a repository default
 * reused for an unrelated purpose. `deriveHistoryDepth` (`leaderboard.ts`) still derives the
 * *rendered* depth from the persisted artifact's actual `history_N` inputs, so the page never
 * claims more history informed a reading than genuinely did — it now honestly caps at 30 instead
 * of a repository default's accidental 99, or an unbounded true count the calculation never saw.
 *
 * **This module's own separate, uncapped `historyDepth` field — round-30 lane-review finding 2,
 * removed.** A second call, to `countComparableAttentionSnapshots`, used to run alongside the
 * bounded one above and return the true, uncapped comparable-snapshot count on every single
 * compute call. `deriveHistoryDepth(zscoreArtifact)` (`leaderboard.ts`) is what the UI's own
 * depth-14 gate actually reads (`AttentionTable.tsx`'s `row.historyDepth`), and it renders the
 * identical answer for gating purposes: `attention.mentions_zscore`'s own `min_history: '14'`
 * eligibility rule already abstains below 14 comparable snapshots, so a true count under 14 and
 * the bounded (≤30) `history_N` count under 14 agree exactly, and above 14 the gate has already
 * opened either way — nothing downstream of this module ever read the removed field for anything
 * else (`pipeline.ts`, `leaderboard.ts` build the row's `historyDepth` entirely from the artifact
 * itself). `countComparableAttentionSnapshots` reads via `attentionSnapshotHistory`, which
 * materialises and `zod`-parses every comparable row rather than a `count(*)` — an O(entire
 * history) cost, per security, on every single collector poll, for a value nothing consumed.
 * Harmless at today's daily-ish cadence; once F16a's 5-minute dispatcher lands over D-30's
 * 100-name universe, this would have meant on the order of 10.5M rows parsed per year to compute
 * a number nothing reads. Removed rather than optimized, the same way round 7's own three
 * side-channel Redis keys were removed once `leaderboard.ts` stopped needing them (this module's
 * own doc above) — there is nothing left for this call to do.
 */
const ZSCORE_HISTORY_WINDOW = 30;
const ZSCORE_HISTORY_QUERY_LIMIT = ZSCORE_HISTORY_WINDOW + 1;

export type AttentionMetricArtifacts = {
  readonly current: AttentionSnapshot;
  readonly rankChange: CalculationArtifact;
  /** `null` when there is nothing to compute from (no prior mentions at all) or the newest
   *  observation crosses a `provider_methodology_version` boundary (F08 §4.2). */
  readonly mentionDelta: CalculationArtifact | null;
  readonly mentionGrowth: CalculationArtifact | null;
  readonly engagementPerMention: CalculationArtifact;
  readonly mentionsZscore: CalculationArtifact;
  readonly rankChangeSource: PriorSource['sourceKind'];
  /** Lane-review finding 2 — the real span the delta was computed over, in hours. */
  readonly comparisonWindowHours: number;
  /** Lane-review finding 4 — surfaced so the caller (and the row view) can render the same
   *  suppression `rank_change` already renders, rather than a silently-absent cell. */
  readonly isMethodologyBoundary: boolean;
};

/** Postgres's unique-violation code. Recognises *a* collision; `computeAndStore` below still has
 *  to check *which* collision (see its own doc) before deciding it is safe to swallow. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

/**
 * Derives a stable id from exactly the fields `calculation_snapshot_identity_unique` keys on
 * (metric, subject, method version, config version, input hash) — see this module's own doc for
 * why determinism here, not randomness, is what makes a lost Redis pointer recoverable rather
 * than a source of a false "no data" page. Not a cryptographic construction; a `uuid` column
 * only requires the standard 32-hex-digit, dashed shape, which this always produces regardless of
 * the version/variant nibbles a `randomUUID()` would set.
 *
 * **This id incorporates the *actual* `input_hash`, not a hand-copied projection of it — lane
 * review round 2 finding 3, and round 3 finding 1's correction of that fix.** An earlier version
 * of this function built its own `canonicalHash` over `{key, value, dataType}` per input plus
 * `assumptions` — a *projection* of what `calc/artifact.ts`'s `computeInputHash` actually hashes,
 * which is the **full** `CalculationInputValue` including `provenance` (`observedAt`/
 * `availableAt`/`ingestedAt`). The two field lists silently drifted: two ordinary polls of an
 * unchanged security an hour apart share every input *value* but not every input's `provenance`,
 * so they got the *same* id from the projection while Postgres computed a genuinely *different*
 * `input_hash` for each — exactly the divergence `computeAndStore`'s own content-comparison check
 * exists to catch, except this was the routine case, not the rare one, and every single ordinary
 * re-poll of unchanged data started throwing instead of safely no-op'ing.
 *
 * The fix is not another hand-written field list to keep in sync by discipline — it is calling
 * `computeInputHash` itself and folding its result in here, so this id **cannot** diverge from
 * `input_hash` the way a second, independently-maintained hash always eventually can:
 * `input_hash` is not merely mirrored, it is a direct input to this id's own hash. `byKey` matches
 * `calc/artifact.ts`'s own pre-hash normalization (sorted by key, full objects, no projection) so
 * the two calls agree on exactly what "the inputs" and "the assumptions" mean.
 *
 * `input_hash` alone under-determines identity: `calculation_snapshot_identity_unique` also keys
 * on `subject_id`, `method_version` and `config_version`, none of which `computeInputHash` covers
 * (`methodVersion` is folded into `input_hash` itself; `subjectId`/`configVersion` are not part of
 * its contract at all) — folded in as an outer hash so identical inputs for two different
 * securities, or the same security under two different config versions, still get different ids.
 */
function deterministicCalculationId(parts: {
  readonly methodId: string;
  readonly methodVersion: string;
  readonly subjectId: string;
  readonly configVersion: string;
  readonly inputs: readonly CalculationInputValue[];
  readonly assumptions: readonly ResolvedAssumption[];
}): string {
  const byKey = <T extends { readonly key: string }>(items: readonly T[]): readonly T[] =>
    [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // The exact hash `calc/artifact.ts#buildArtifact` computes and persists as `input_hash` —
  // reused, not re-derived, so the two cannot silently drift apart the way two independently
  // hand-written field lists eventually did.
  const inputHash = computeInputHash({
    methodId: parts.methodId,
    methodVersion: parts.methodVersion,
    inputs: byKey(parts.inputs),
    assumptions: byKey(parts.assumptions),
  });

  const hash = canonicalHash({
    inputHash,
    subjectId: parts.subjectId,
    configVersion: parts.configVersion,
  });
  const hex = hash.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function computeAndStore(args: {
  readonly methodId: string;
  readonly subject: Subject;
  readonly inputs: readonly CalculationInputValue[];
  readonly configVersion: string;
  readonly asOf: string;
}): Promise<CalculationArtifact> {
  const entry = METHOD_REGISTRY.latest(args.methodId);
  const assumptions = officialAssumptions(args.methodId);
  const calculationId = deterministicCalculationId({
    methodId: args.methodId,
    methodVersion: entry.version,
    subjectId: args.subject.id,
    configVersion: args.configVersion,
    inputs: args.inputs,
    assumptions,
  });

  const artifact = computeArtifact({
    methodId: args.methodId,
    subject: args.subject,
    asOf: args.asOf,
    inputs: args.inputs,
    assumptions,
    configVersion: args.configVersion,
    calculationId,
  });

  try {
    await persistArtifact(artifact);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Lane-review round 2 finding 3: a bare `23505` is not, on its own, proof that "the in-memory
    // artifact is byte-for-byte what is already stored" — a genuinely identical recompute (the
    // safe, expected case this whole scheme exists for) and a *different*-content collision under
    // the same id (the dangerous case: `officialAssumptions` changing without a method-version
    // bump, so `input_hash` moves while this id does not) can both raise `23505`, and not
    // reliably on the constraint one might expect — an exact duplicate row can trip
    // `calculation_snapshot_pkey` before Postgres ever evaluates `calculation_snapshot_identity_
    // unique`, so the constraint name alone cannot tell the two apart either. What can: reading
    // the row already on disk and comparing its own `inputHash` to this artifact's. They match
    // only when the content genuinely is the same — which, given `deterministicCalculationId` now
    // folds `assumptions` in alongside `inputs` (this module's own doc), is the only way two calls
    // can legitimately share this id at all.
    const existing = await loadArtifact(calculationId);
    if (existing !== null && existing.inputHash === artifact.inputHash) {
      // Nothing new to write; the in-memory artifact above is what is already stored.
      return artifact;
    }

    throw new Error(
      `attention.compute: calculationId ${calculationId} (method ${args.methodId}) collided with ` +
        'an existing calculation_snapshot row whose content does not match what was just computed. ' +
        'This means two different inputs/assumptions produced the same deterministic id — the one ' +
        'divergence this module cannot safely paper over, since silently keeping the old row would ' +
        'serve the Inspector a computation under assumptions that no longer match what is displayed.',
    );
  }
  return artifact;
}

export type ComputeAttentionMetricsArgs = {
  readonly securityId: string;
  readonly symbol: string;
  readonly configVersion: string;
  readonly now?: Date;
  readonly db?: Queryable | undefined;
};

/** `null` when this security has no `attention_snapshot` row at all yet — nothing to compute. */
export async function computeAttentionMetrics(
  args: ComputeAttentionMetricsArgs,
): Promise<AttentionMetricArtifacts | null> {
  const now = args.now ?? new Date();

  const recent = await attentionSnapshotHistory(
    { securityId: args.securityId, source: 'apewisdom', asOfInstant: now, limit: 2 },
    args.db,
  );
  const current = recent[0];
  if (current === undefined) return null;
  const priorLocal = recent[1] ?? null;

  const priorSource = resolvePriorSource(current, priorLocal);
  const subject: Subject = { kind: 'security', id: args.securityId, label: args.symbol };
  // Lane-review finding 5: the actual current instant, not the snapshot's own `observedAt`. Every
  // input's freshest `observedAt` IS `current.observedAt` (`inputs.ts`) — if `asOf` were set to
  // that same value, `computeArtifact`'s staleness check (`asOf − freshest input` >
  // `stalenessMinutes`) would always evaluate to exactly zero, no matter how old the underlying
  // observation actually is by the time this runs. `services/dashboard/refresh.ts` already
  // established the correct pattern (`asOf: now.toISOString()`); this now matches it.
  const asOf = now.toISOString();

  const rankChange = await computeAndStore({
    methodId: 'attention.rank_change',
    subject,
    inputs: rankChangeInputs(current, priorSource),
    configVersion: args.configVersion,
    asOf,
  });

  // Lane-review finding 4: `attention.mention_delta`/`mention_growth` have no boundary awareness
  // of their own (unlike `attention.rank_change@1.1.0`) — F08 §4.2 makes rendering the boundary
  // explicitly this feature's job ("F06 §4.1 already returns this; F08 must render it, not
  // swallow it"), so a mention count is never computed across the identical boundary
  // `rank_change` already refuses to cross.
  const suppressMentionMethods = priorSource.isMethodologyBoundary || priorSource.mentionsPriorRaw === null;

  const mentionDelta = suppressMentionMethods
    ? null
    : await computeAndStore({
        methodId: 'attention.mention_delta',
        subject,
        inputs: mentionDeltaInputs(current, priorSource),
        configVersion: args.configVersion,
        asOf,
      });

  const mentionGrowth = suppressMentionMethods
    ? null
    : await computeAndStore({
        methodId: 'attention.mention_growth',
        subject,
        inputs: mentionGrowthInputs(current, priorSource),
        configVersion: args.configVersion,
        asOf,
      });

  const engagementPerMention = await computeAndStore({
    methodId: 'attention.engagement_per_mention',
    subject,
    inputs: engagementPerMentionInputs(current),
    configVersion: args.configVersion,
    asOf,
  });

  const comparableHistory = await attentionSnapshotHistory(
    {
      securityId: args.securityId,
      source: 'apewisdom',
      methodologyVersion: current.providerMethodologyVersion,
      asOfInstant: now,
      limit: ZSCORE_HISTORY_QUERY_LIMIT,
    },
    args.db,
  );
  const priorHistory = comparableHistory.filter(
    (row) => row.observedAt.getTime() !== current.observedAt.getTime(),
  );

  const mentionsZscore = await computeAndStore({
    methodId: 'attention.mentions_zscore',
    subject,
    inputs: mentionsZscoreInputs(current, priorHistory),
    configVersion: args.configVersion,
    asOf,
  });

  return {
    current,
    rankChange,
    mentionDelta,
    mentionGrowth,
    engagementPerMention,
    mentionsZscore,
    rankChangeSource: priorSource.sourceKind,
    comparisonWindowHours: comparisonWindowHours(current, priorLocal),
    isMethodologyBoundary: priorSource.isMethodologyBoundary,
  };
}
