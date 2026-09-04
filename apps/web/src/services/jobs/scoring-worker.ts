/**
 * The consumer half of F20 §4.2's queue: one worker pass.
 *
 * ## What this function is not allowed to do, and how that is enforced
 *
 * §4.2 rule 1 — *a scorer outage grows the backlog; it does not stop collection or lose data.*
 * A leased entry is `ack`ed only when something durable was written about it, or when the item
 * demonstrably already holds a live score. Every other path ends in `release`.
 *
 * §4.2 rule 2 — *no silent substitution.* This module writes nothing when the scorer fails. It
 * has no fallback scorer, no cached score, no LLM path and no default label; the only thing it
 * writes on failure is the outage timestamp that makes `stance-availability.ts` abstain. That
 * is the whole of the "outage ⇒ abstention" wiring, and it is one direction: an outage can
 * suppress a number, it can never produce one.
 *
 * §4.3 — every row carries the six provenance fields, because `ScoreRow` makes all six
 * non-nullable and this is the only module that constructs one.
 *
 * ## The attempt budget, and what may spend it
 *
 * **Only a failure attributable to one specific item spends that item's attempts.** This was
 * wrong in the first cut and lane-review found it: the adapter used to return a single
 * `{kind:'contract'}` verdict for a whole response, and this worker charged it to every entry in
 * the batch — so one malformed row eventually marked all 32 items unscoreable, permanently, in
 * the feature whose whole purpose is losing nothing. `postScoreBatch` now returns per-item
 * `admitted`/`rejected`, and only `rejected` items are charged.
 *
 * A batch-level `ok:false` says nothing about any one item, so **nothing is ever charged for
 * one**, whatever the status code. A second-round lane-review pass tried narrowing this to
 * "charge a 4xx client fault, since it will reproduce on retry" — and was reverted, because
 * `services/scorer/app.py` returns its whole-request 400 when *any single item* in the batch
 * carries an unregistered `kind` or a missing field. A batch-level 400 therefore says exactly as
 * little about which item is at fault as the `contract` case above, and charging every leased
 * entry for it reintroduces the identical bug this section already names: one bad item, now
 * behind an HTTP status instead of a malformed envelope, permanently marks its batch-mates
 * `unscoreable` with a detail string ("the scorer returned an inadmissible result for this item
 * N times") that is false for every one of them. A real, permanent misconfiguration (an
 * unregistered scorer kind, a stale entitlement) is a genuine gap this leaves — the backlog grows
 * forever instead of surfacing as something an operator must fix — but that gap is safer than the
 * alternative: D-16 forbids backfill, and losing or mislabelling data is not a trade this module
 * makes to get a clearer banner. Distinguishing the two without per-item attribution from the
 * service is future work, not a case this pass can charge its way out of.
 *
 * ## Giving up on an entry without losing what it already had
 *
 * Two paths end an entry without a new score: the attempt budget running out, and the item's
 * re-scoreable text having vanished (D-17). Neither may write an `UnscoreableRow` for an item
 * that **already holds a live score** — a re-score whose body was purged between enqueue and
 * lease still has a perfectly good predecessor, and recording it unscoreable would drop it from
 * `n` on every dependent metric and label it "no score can ever exist", which is false. Those
 * entries are *abandoned*: acked, with the predecessor left standing as the current score.
 * `rescore.ts` already stated this rule; it was not implemented here. Found by lane-review.
 */
import type { ProviderError, ProviderResult } from '@/contracts/provider';
import type { ScoreBatchOutcome, ScoreRequestItem } from '@/adapters/scorer';
import type { Clock } from '@/adapters/ports';
import type {
  LeasedScoringEntry,
  RawItemReaderPort,
  ScoreIdFactory,
  ScoreRow,
  ScoreStorePort,
  ScorerHealthPort,
  ScoringQueuePort,
  ScoringQueueStats,
  UnscoreableRow,
} from './ports';
import { V1_SCORER_PROVENANCE } from './ports';
import { latestScoreByItem } from './scores';

export const DEFAULT_SCORING_BATCH_SIZE = 32;

/**
 * How many times an entry may be released for a reason that was its own fault before it is
 * given up on. Five, matching the circuit breaker's threshold (source §9.4) — there is no deep
 * reason for the number, only that it is bounded and stated in one place.
 */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** The scorer, as the worker sees it. `adapters/scorer.ts` provides the real one. */
export type ScoreBatchPort = (
  items: readonly ScoreRequestItem[],
) => Promise<ProviderResult<ScoreBatchOutcome>>;

export type ScoringWorkerDeps = {
  queue: ScoringQueuePort;
  items: RawItemReaderPort;
  store: ScoreStorePort;
  health: ScorerHealthPort;
  score: ScoreBatchPort;
  clock: Clock;
  newScoreId: ScoreIdFactory;
};

/**
 * A re-score that came back under a revision the operator did not ask for.
 *
 * Reported rather than written. The successor is *not* persisted: doing so would record the
 * migration as having happened when the service is still on the old pin, and nothing downstream
 * could then tell the difference.
 */
export type StaleRevision = {
  itemId: string;
  expected: string;
  actual: string;
};

export type ScoringWorkerOutcome = {
  leased: number;
  /** Rows appended to the score store on this pass. */
  scored: number;
  /** Entries recorded as permanently unscoreable, with the reason. */
  unscoreable: readonly UnscoreableRow[];
  /**
   * Entries dropped without a new score **and** without an unscoreable row, because the item
   * already holds a live one. Nothing was lost; the predecessor is still current.
   */
  abandoned: readonly string[];
  /** Entries handed back to the backlog rather than lost. */
  returnedToQueue: number;
  /**
   * Re-scores refused because the service answered under the wrong pin. Non-empty here means
   * *"the re-score job is running but the scorer was never redeployed"* — an operator-visible
   * state distinct from both success and an outage.
   */
  staleRevisions: readonly StaleRevision[];
  /** `false` when the scorer failed on this pass — the fact `stance-availability.ts` reads. */
  scorerAvailable: boolean;
  /** Present only when the scorer failed, so a caller can log the taxonomy, not a string. */
  error: ProviderError | null;
  backlog: ScoringQueueStats;
};

/**
 * §4.2 rule 3: backlog depth and oldest-unscored age are operator-visible (F15, F18).
 *
 * `oldestUnscoredAgeMs` is a duration counter, not a measurement anything computes with — no
 * artifact, no metric and no rendered number derives from it, so a JS number is the right type
 * here and the decimal rule (ARCH §4.2) is not in play.
 */
export function scoringBacklogCounters(
  stats: ScoringQueueStats,
  at: Date,
): { depth: number; leased: number; oldestUnscoredAgeMs: number | null } {
  return {
    depth: stats.depth,
    leased: stats.leased,
    oldestUnscoredAgeMs:
      stats.oldestEnqueuedAt === null
        ? null
        : Math.max(0, at.getTime() - Date.parse(stats.oldestEnqueuedAt)),
  };
}

/** The ids among `itemIds` that already hold a live (non-superseded) score. */
async function itemsWithLiveScore(
  itemIds: readonly string[],
  store: ScoreStorePort,
): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const rows = await store.readScores({ itemIds });
  return new Set(latestScoreByItem(rows).keys());
}

export async function runScoringWorkerOnce(
  deps: ScoringWorkerDeps,
  options: { batchSize?: number; maxAttempts?: number } = {},
): Promise<ScoringWorkerOutcome> {
  const batchSize = options.batchSize ?? DEFAULT_SCORING_BATCH_SIZE;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const at = deps.clock.now();

  const leased = await deps.queue.lease({ max: batchSize, at });
  const unscoreable: UnscoreableRow[] = [];
  const abandoned: string[] = [];
  const staleRevisions: StaleRevision[] = [];

  const finish = async (
    partial: Pick<ScoringWorkerOutcome, 'scored' | 'returnedToQueue' | 'scorerAvailable' | 'error'>,
  ): Promise<ScoringWorkerOutcome> => ({
    ...partial,
    unscoreable,
    abandoned,
    staleRevisions,
    leased: leased.length,
    backlog: await deps.queue.stats({ at: deps.clock.now() }),
  });

  if (leased.length === 0) {
    // Nothing to do is not evidence of anything. In particular it is **not** evidence that the
    // scorer is healthy: marking it so here would clear a real outage the moment the backlog
    // happened to empty, and F18's degraded banner would flicker off while the service was
    // still down.
    return finish({ scored: 0, returnedToQueue: 0, scorerAvailable: true, error: null });
  }

  // ── Entries that are ending here, one way or another ─────────────────────────────────────
  const exhausted = leased.filter((entry) => entry.attempts >= maxAttempts);
  const remaining = leased.filter((entry) => entry.attempts < maxAttempts);

  // The re-scoreable unit, per D-17. An id that comes back absent has no text left at all —
  // an X post deleted upstream and purged.
  const texts = await deps.items.readScoreableText({
    itemIds: remaining.map((entry) => entry.itemId),
  });
  const textById = new Map(texts.map((text) => [text.itemId, text.text]));

  const missing = remaining.filter((entry) => {
    const text = textById.get(entry.itemId);
    return text === undefined || text === '';
  });
  const missingLeaseIds = new Set(missing.map((entry) => entry.leaseId));
  const candidates = remaining.filter((entry) => !missingLeaseIds.has(entry.leaseId));

  // One read covers both ending paths. An item that already has a live score is abandoned
  // rather than recorded unscoreable — see the module doc.
  const ending = [...exhausted, ...missing];
  const exhaustedLeaseIds = new Set(exhausted.map((entry) => entry.leaseId));
  const alreadyScored = await itemsWithLiveScore(
    ending.map((entry) => entry.itemId),
    deps.store,
  );

  for (const entry of ending) {
    if (alreadyScored.has(entry.itemId)) {
      abandoned.push(entry.itemId);
      continue;
    }
    unscoreable.push(
      exhaustedLeaseIds.has(entry.leaseId)
        ? {
            itemId: entry.itemId,
            reason: 'scorer_contract_violation',
            detail: `the scorer returned an inadmissible result for this item ${entry.attempts} times`,
            recordedAt: at.toISOString(),
          }
        : {
            itemId: entry.itemId,
            reason: 'text_unavailable',
            detail:
              'no re-scoreable text is retained for this item (D-17: an upstream deletion that ' +
              'has been purged is the one unrecoverable case)',
            recordedAt: at.toISOString(),
          },
    );
  }

  if (unscoreable.length > 0) await deps.store.appendUnscoreable({ rows: unscoreable });
  if (ending.length > 0) {
    await deps.queue.ack({ leaseIds: ending.map((entry) => entry.leaseId), at });
  }

  if (candidates.length === 0) {
    return finish({ scored: 0, returnedToQueue: 0, scorerAvailable: true, error: null });
  }

  // ── The call ─────────────────────────────────────────────────────────────────────────────
  const request: ScoreRequestItem[] = candidates.map((entry) => ({
    itemId: entry.itemId,
    // `text` is present: `missing` removed every entry without one.
    text: textById.get(entry.itemId) as string,
    kind: entry.scorerId,
  }));

  const result = await deps.score(request);

  if (!result.ok) {
    // Nothing is written. Not a default, not a previous value, not another method's number —
    // §4.2 rule 2. The backlog grows by exactly the batch that failed, and no attempt is spent:
    // a batch-level failure says nothing about any individual item, whatever its status code —
    // see the module doc for the second-round attempt at narrowing this, and why it was reverted.
    await deps.health.markOutage({ at: deps.clock.now(), error: result.error });
    await deps.queue.release({
      leaseIds: candidates.map((entry) => entry.leaseId),
      at: deps.clock.now(),
      countsAsAttempt: false,
    });
    return finish({
      scored: 0,
      returnedToQueue: candidates.length,
      scorerAvailable: false,
      error: result.error,
    });
  }

  const admittedById = new Map(result.data.admitted.map((row) => [row.itemId, row]));
  const recordedAt = deps.clock.now().toISOString();

  const rows: ScoreRow[] = [];
  const done: LeasedScoringEntry[] = [];
  // Chargeable entries that reflect a genuine contract violation by the scorer, as opposed to a
  // stale-revision refusal (see below). Only this bucket means the scorer itself misbehaved —
  // it is what decides whether the pass ends in `markOutage` or `markHealthy`. Found by
  // lane-review: a pass in which *every* chargeable entry was a stale revision fell into the
  // outage branch, marking a perfectly healthy, correctly-answering scorer as being down.
  const contractRejected: LeasedScoringEntry[] = [];
  const staleRevisionEntries: LeasedScoringEntry[] = [];

  for (const entry of candidates) {
    const scored = admittedById.get(entry.itemId);

    if (scored === undefined) {
      // Either explicitly `rejected` by the adapter, or — through a `ScoreBatchPort` that is
      // not `postScoreBatch` — simply absent from both lists. Attributable to this item only
      // when the *same response* admitted at least one other item — see the charging decision
      // below. Handled rather than thrown either way: throwing would abandon the whole batch,
      // and losing data is the one outcome this feature exists to prevent.
      contractRejected.push(entry);
      continue;
    }

    if (
      entry.targetScorerVersion !== null &&
      scored.scorer.scorerVersion !== entry.targetScorerVersion
    ) {
      // The re-score ran, the service answered, and it is still on the old pin. Writing this
      // successor would record a migration that did not happen — and because the window would
      // stay homogeneous, nothing downstream could ever tell. The entry goes back to the queue,
      // charged, so a service that is never redeployed does not spin at the head of the backlog
      // forever; when the attempts run out it is *abandoned*, not marked unscoreable, because
      // the predecessor is still perfectly good. This is *not* a contract violation — the
      // scorer answered correctly, just under a pin nobody redeployed — so it never reaches
      // `contractRejected` and never marks the scorer as down. Being in `admittedById` at all
      // means this entry is unconditionally attributable — unlike `contractRejected` below, its
      // charge never depends on whether anything else in the response was admitted.
      staleRevisions.push({
        itemId: entry.itemId,
        expected: entry.targetScorerVersion,
        actual: scored.scorer.scorerVersion,
      });
      staleRevisionEntries.push(entry);
      continue;
    }

    rows.push({
      scoreId: deps.newScoreId(),
      itemId: entry.itemId,
      label: scored.label,
      scores: scored.scores,
      scorerId: scored.scorer.scorerId,
      scorerVersion: scored.scorer.scorerVersion,
      runtimeVersion: scored.scorer.runtimeVersion,
      inputHash: scored.inputHash,
      truncated: scored.truncated,
      // v1 only ever writes 'pinned' (§4.3). The capacity fallback is a provisioned column,
      // not a built path, and nothing in this module can set the other value.
      scorerProvenance: V1_SCORER_PROVENANCE,
      supersedesScoreId: entry.supersedesScoreId,
      scoredAt: scored.scoredAt,
      recordedAt,
    });
    done.push(entry);
  }

  if (rows.length > 0) {
    // Append **then** ack. If the process dies between the two, the entry is leased-but-unacked
    // and is redelivered on the next lease — a normal event for an at-least-once queue, not a
    // crash edge case. `scoreId` is freshly minted per call and cannot make redelivery
    // idempotent on its own: a second pass over the same entry mints a *different* scoreId, so
    // `ScoreStorePort.appendScores` is required to dedupe on the row's natural key —
    // `(itemId, scorerVersion, inputHash, supersedesScoreId)` — and treat a repeat of it as a
    // no-op, not a second live row. (Wrong in an earlier draft, which named `scoreId`
    // uniqueness as the guard; `scoreId` never repeats across calls, so it could never have
    // caught anything. Found by lane-review.) Acking first would lose the item on exactly the
    // same crash, which `appendUnscoreable`/`ack` above already avoids the same way.
    await deps.store.appendScores({ rows });
    await deps.queue.ack({ leaseIds: done.map((entry) => entry.leaseId), at: deps.clock.now() });
  }

  // A rejected entry is only chargeable if the *same response* admitted at least one other
  // item — proof the service is working and this item specifically is the odd one out. A
  // response that admits nothing at all (every row rejected, or `admitted` and `rejected` both
  // empty against a real `ScoreBatchPort`) is exactly as unattributable as the batch-level
  // `ok:false` case above: a systemic regression (a scorer deploy that regressed to emitting
  // JSON numbers, say) would otherwise charge every leased entry identically to one bad item,
  // and after `maxAttempts` passes permanently mark the whole batch `unscoreable` with a detail
  // string ("the scorer returned an inadmissible result for this item N times") that is false
  // for all of them — the same failure mode the batch-level revert above exists to avoid,
  // reachable through the `ok:true`-but-nothing-admitted door instead. Found by a third
  // lane-review pass. Stale-revision entries are unaffected: being in `admittedById` at all
  // already proves `result.data.admitted` is non-empty, so this gate can never block them.
  const anyAdmitted = result.data.admitted.length > 0;
  if (contractRejected.length > 0) {
    await deps.queue.release({
      leaseIds: contractRejected.map((entry) => entry.leaseId),
      at: deps.clock.now(),
      countsAsAttempt: anyAdmitted,
    });
  }
  if (staleRevisionEntries.length > 0) {
    await deps.queue.release({
      leaseIds: staleRevisionEntries.map((entry) => entry.leaseId),
      at: deps.clock.now(),
      countsAsAttempt: true,
    });
  }

  // The queue is draining iff something was admitted. A response in which *every* row was
  // refused means the service is up and producing nothing usable, which dependent metrics must
  // see as an outage — otherwise they would render against a silently frozen corpus. But a
  // refusal that is *only* a stale-revision skip is not that: the scorer answered every request
  // correctly, just under a pin nobody redeployed. Marking that an outage was found by
  // lane-review — it stalls the whole backlog behind a "scorer unavailable" banner that is
  // false, on a scorer that is up and correctly serving every item that wasn't a re-score.
  //
  // **A known, disclosed limitation, not fixed here.** A `contractRejected` entry that is
  // permanently unattributable (leased alone, with nothing else in the same response to prove
  // the scorer is working — see the charging decision above) is never charged and so never
  // leaves the backlog. Every time it is leased alone, this branch reports `outage`, even
  // seconds after the same scorer correctly scored something else. A fifth lane-review pass
  // named this and the honest fix: a third state — "scorer up, this item stuck, nothing
  // substituted" — distinct from both `ok` and `outage`, which `ScorerHealth` (`ports.ts`) does
  // not have today, the same gap `stance-availability.ts`'s own doc names for
  // `InsufficiencyReason` ("a `scoring_backlog` member has been requested from SPINE"). Adding
  // it is a real contract change, not a worker-local patch, and is left to whoever picks that up
  // next rather than attempted here under time pressure that has already produced two
  // regressions this session. Until then: a permanently-stuck solo item costs an intermittently
  // false "unavailable" reading, in exchange for the guarantee this module will not
  // mislabel a systemic failure as that item's individual defect (`countsAsAttempt` above).
  // That trade is accepted, not accidental.
  if (rows.length > 0 || contractRejected.length === 0) {
    await deps.health.markHealthy({ at: deps.clock.now() });
  } else {
    await deps.health.markOutage({
      at: deps.clock.now(),
      error: {
        kind: 'contract',
        issues: result.data.rejected.flatMap((row) =>
          row.issues.map((issue) => `${row.itemId}: ${issue}`),
        ),
      },
    });
  }

  return finish({
    scored: rows.length,
    returnedToQueue: contractRejected.length + staleRevisionEntries.length,
    scorerAvailable: rows.length > 0 || contractRejected.length === 0,
    error: null,
  });
}

/**
 * Drains the backlog, one pass at a time, stopping the moment the scorer fails.
 *
 * Stopping on the first failure is deliberate: a worker that kept hammering a dead service
 * would trip the circuit breaker on every pass and turn one outage into a stream of them in
 * `provider_call_log`. The backlog is durable, so there is nothing to gain by hurrying.
 */
export async function drainScoringQueue(
  deps: ScoringWorkerDeps,
  options: { batchSize?: number; maxAttempts?: number; maxPasses?: number } = {},
): Promise<{ passes: number; scored: number; outcomes: readonly ScoringWorkerOutcome[] }> {
  const maxPasses = options.maxPasses ?? 100;
  const outcomes: ScoringWorkerOutcome[] = [];
  let scored = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const outcome = await runScoringWorkerOnce(deps, options);
    outcomes.push(outcome);
    scored += outcome.scored;
    if (outcome.leased === 0) break;
    // A real outage always stops the loop, full stop — regardless of anything else the same
    // pass happened to clean up. `exhausted`/`missing` entries are resolved into
    // `unscoreable`/`abandoned` *before* the scorer is even called (see above), so a pass where
    // the scorer call itself fails can still carry a nonzero `unscoreable`/`abandoned` count
    // from unrelated purged-text or exhausted-attempt entries leased in the same batch. A round-
    // 4 version of this check folded that cleanup into "progress" and let it override
    // `scorerAvailable`, which reopened exactly the hazard this function's own doc warns about:
    // a dead scorer plus an ordinary trickle of purged bodies (D-17 is not rare) kept the drain
    // hammering the dead service for the rest of `maxPasses`, once per pass, instead of stopping
    // on the first failure. Found by a fifth lane-review pass.
    if (!outcome.scorerAvailable) break;
    // Nothing landed this pass — no new score, no unscoreable row, no abandoned re-score — and
    // the scorer itself is fine. Before `scorerAvailable` could read `true` on an all-stale-
    // revision pass (lane-review, second round), `!outcome.scorerAvailable` alone (above) was
    // exactly this condition. It no longer is: a pass that is entirely stale-revision refusals
    // is healthy but still made zero forward progress, and without this second check the loop
    // would immediately re-lease the same stuck entries and burn the whole attempt budget
    // inside one call — turning "one attempt per scheduled dispatcher tick" into "the job
    // silently abandons itself in the same tick it was enqueued in." A pass that wrote
    // unscoreable or abandoned rows genuinely drained part of the backlog even at `scored: 0`,
    // and must not be mistaken for one that made no progress at all (lane-review, third round:
    // `scored === 0` alone stopped the loop one batch early on exactly that kind of pass).
    if (outcome.scored === 0 && outcome.unscoreable.length === 0 && outcome.abandoned.length === 0) {
      break;
    }
  }

  return { passes: outcomes.length, scored, outcomes };
}
