/**
 * The trigger path (F16 §4.1b, D-15). Runs as part of the `market_data_poll` job's own
 * execution — see `services/jobs/collectors.ts` — never as a separate dispatch.
 *
 * Three things this module is responsible for, matching §4.1b's own numbered steps:
 *
 * 2. Evaluate `market.spike_detection` (`calc/methods/market-spike-detection.ts`) for every
 *    security that got a genuinely **new** observation this poll, and persist the verdict as a
 *    `CalculationArtifact` — fired or not. Only newly-inserted observations are evaluated: a bar
 *    that was already stored (an intraday re-poll re-observing the same still-current daily
 *    close, since D-31 runs this on daily bars) has nothing new to evaluate, and re-evaluating
 *    it every five minutes would both waste work and — absent the idempotency key below — invite
 *    exactly the "one spike, many windows" failure §4.1b's binding rules forbid.
 * 3–4. For a fired verdict, look up the trigger-eligible job and check it against the X read
 *    budget (`x-budget.ts`) **before** anything is dispatched. A refusal is recorded as a
 *    `CoverageGap` (`reason: 'budget_denied'`), never a smaller window — F22's own `gapReason`
 *    enum already names this case (migration/contract predates this PR).
 *
 * What this module does **not** do: dispatch the window job itself. It returns a list of
 * `TriggerDispatchRequest`s that passed every check, and its caller (`job-service.ts`) is what
 * actually calls `JobService.execute` for them — kept separate so this module never needs to
 * import `job-service.ts`, which avoids a job-service → collectors → trigger → job-service import
 * cycle.
 */
import { randomUUID } from 'node:crypto';
import { buildArtifact, type CalculationInputValue, type ResolvedAssumption, type Subject } from '@/calc/artifact';
import {
  computeMarketSpikeDetection,
  DEFAULT_SPIKE_THRESHOLD_PCT,
  MARKET_SPIKE_DETECTION_ID,
  MARKET_SPIKE_DETECTION_VERSION,
} from '@/calc/methods/market-spike-detection';
import { persistArtifact } from '@/services/calculations';
import type { JobDefinition } from '@/contracts/operations';
import type { CollectMarketSnapshotsOutcome } from '@/services/market/collector';
import { findTriggerEligibleJobDefinition } from '@/repositories/jobs';
import { recordGap } from '@/repositories/coverage';
import { marketSnapshotHistory } from '@/repositories/market';
import { getPool, type Queryable } from '@/repositories/client';
import { checkXReadBudget } from './x-budget';
import { triggeredIdempotencyKey } from './idempotency';

export const X_SAMPLING_WINDOW_JOB_KEY = 'x_sampling_window';

/** D-20/D-32's own named figure for a trigger event's read spend — used only to size the refused request; the ceiling itself is what actually decides (`x-budget.ts`). */
export const DEFAULT_X_READS_PER_TRIGGER_EVENT = 100;

/** A bounded sampling window, per §4.1b step 3 ("a bounded job with an explicit read budget, not an open-ended subscription"). One hour is a deliberately simple Wave 1 starting shape — F18/F16b's admin plane is where this becomes configurable. */
export const DEFAULT_X_SAMPLING_WINDOW_MS = 60 * 60 * 1000;

export type SpikeVerdict = {
  readonly securityId: string;
  readonly symbol: string;
  readonly calculationId: string;
  readonly fired: boolean;
  readonly observedAt: string;
};

export type TriggerDispatchRequest = {
  readonly job: JobDefinition;
  readonly idempotencyKey: string;
  readonly securityId: string;
  readonly symbol: string;
  readonly reason: string;
};

export type TriggerPassResult = {
  readonly verdicts: readonly SpikeVerdict[];
  /** Windows that passed every check and are ready for `JobService.execute`. Empty under D-32's zero ceiling — see `x-budget.ts`. */
  readonly dispatchRequests: readonly TriggerDispatchRequest[];
};

function provenance(observedAt: string) {
  return {
    provider: 'fmp',
    providerField: 'market_snapshot.price',
    sourceUrl: null,
    observedAt,
    availableAt: observedAt,
    ingestedAt: new Date().toISOString(),
    rawPayloadId: null,
    licenseClass: 'provider_terms' as const,
    redactionClass: 'public' as const,
  };
}

const SPIKE_THRESHOLD_ASSUMPTION: ResolvedAssumption = {
  key: 'spike_threshold_pct',
  value: DEFAULT_SPIKE_THRESHOLD_PCT,
  unit: 'ratio',
  source: 'code_invariant',
  officialValue: DEFAULT_SPIKE_THRESHOLD_PCT,
  min: null,
  max: null,
  editable: false,
};

/**
 * One security's spike evaluation. Always persists an artifact (§4.1b step 2's binding rule —
 * "including the ones that do not fire") and never throws for a normal abstention (no prior
 * close yet, a bad price) — `buildArtifact` already turns those into a recorded abstention
 * rather than an exception.
 */
export async function evaluateMarketSpike(
  security: { readonly id: string; readonly symbol: string },
  configVersion: string,
  asOfInstant: Date,
  db: Queryable,
): Promise<SpikeVerdict> {
  const history = await marketSnapshotHistory(
    { securityId: security.id, asOfInstant, session: 'eod', limit: 2 },
    db,
  );
  // `marketSnapshotHistory` orders most-recent-first.
  const [current, prior] = history;

  const observedAt = current?.observedAt.toISOString() ?? asOfInstant.toISOString();

  const inputs: CalculationInputValue[] = [];
  if (current !== undefined) {
    inputs.push({
      key: 'close_now',
      value: current.price,
      unit: 'usd',
      dataType: 'decimal',
      source: 'market',
      quality: 'ok',
      freshness: 'fresh',
      provenance: provenance(current.observedAt.toISOString()),
    });
  }
  if (prior !== undefined) {
    inputs.push({
      key: 'close_prior',
      value: prior.price,
      unit: 'usd',
      dataType: 'decimal',
      source: 'market',
      quality: 'ok',
      freshness: 'fresh',
      provenance: provenance(prior.observedAt.toISOString()),
    });
  }

  const subject: Subject = { kind: 'security', id: security.id, label: security.symbol };
  const calculationId = randomUUID();

  const artifact = buildArtifact({
    method: {
      methodId: MARKET_SPIKE_DETECTION_ID,
      version: MARKET_SPIKE_DETECTION_VERSION,
      unit: 'flag',
      roundingRule: 'int_0dp_half_even',
      workingPrecision: 34,
      compute: computeMarketSpikeDetection,
    },
    subject,
    // `current` may be undefined only when `market_snapshot` genuinely has nothing for this
    // security yet — `computeMarketSpikeDetection` itself still needs an `asOf` and abstains on
    // the missing `close_now` input the same way it does on a missing `close_prior`.
    asOf: current?.observedAt.toISOString() ?? asOfInstant.toISOString(),
    inputs,
    assumptions: [SPIKE_THRESHOLD_ASSUMPTION],
    configVersion,
    scenario: { kind: 'official' },
    calculationId,
    computedAt: asOfInstant.toISOString(),
  });

  await persistArtifact(artifact);

  const fired = artifact.result?.exact === '1';
  return { securityId: security.id, symbol: security.symbol, calculationId, fired, observedAt };
}

export type TriggerPassOptions = {
  readonly db?: Queryable;
  readonly now?: Date;
  /** Injectable so a test can prove the refused-window path without ever setting a real ceiling above zero. */
  readonly budgetCheck?: typeof checkXReadBudget;
  readonly readsPerEvent?: number;
  readonly windowMs?: number;
};

/**
 * Runs the trigger evaluation for every **newly-inserted** result in a `collectMarketSnapshots`
 * outcome. `pollJob` supplies the `config_version` every artifact and coverage-gap detail is
 * stamped with — the same frozen config the poll's own `job_run` recorded (D-11).
 */
export async function runTriggerPass(
  pollOutcome: CollectMarketSnapshotsOutcome,
  pollJob: Pick<JobDefinition, 'configVersion'>,
  options: TriggerPassOptions = {},
): Promise<TriggerPassResult> {
  const db = options.db ?? getPool();
  const now = options.now ?? new Date();
  const budgetCheck = options.budgetCheck ?? checkXReadBudget;
  const readsPerEvent = options.readsPerEvent ?? DEFAULT_X_READS_PER_TRIGGER_EVENT;
  const windowMs = options.windowMs ?? DEFAULT_X_SAMPLING_WINDOW_MS;

  const newlyObserved = pollOutcome.results.filter((result) => result.inserted);

  const verdicts: SpikeVerdict[] = [];
  const dispatchRequests: TriggerDispatchRequest[] = [];

  for (const result of newlyObserved) {
    const verdict = await evaluateMarketSpike(
      { id: result.securityId, symbol: result.symbol },
      pollJob.configVersion,
      now,
      db,
    );
    verdicts.push(verdict);
    if (!verdict.fired) continue;

    // §4.1b binding rule: "may never dispatch a job that was not registered as trigger-eligible."
    const xJob = await findTriggerEligibleJobDefinition(X_SAMPLING_WINDOW_JOB_KEY, db);
    if (xJob === null) {
      // Not a budget refusal — this axis has no eligible, enabled job to dispatch to at all
      // (Wave 1 seeds `x_sampling_window` with `enabled = false`; see the seed migration). Not
      // recorded as a `CoverageGap` here: a gap records a refused, *specific* window that was
      // actually checked against a budget, and there is no budget check to have refused this one
      // against — the axis is simply not wired up yet, which is a different, disclosed fact
      // (`services/jobs/x-budget.ts`'s own doc, D-32).
      continue;
    }

    // Anchored to the *triggering bar's own* observed_at, not `now` — stable across every
    // five-minute tick that re-observes the same still-current daily close, which is what makes
    // "the same spike detected twice in one interval yields one window" true even without
    // relying on the `inserted`-only filter above.
    const idempotencyKey = triggeredIdempotencyKey(xJob.id, result.securityId, verdict.observedAt);

    const budget = budgetCheck(readsPerEvent);
    if (!budget.allowed) {
      const from = new Date(verdict.observedAt);
      await recordGap(
        {
          axis: 'x',
          from,
          to: new Date(from.getTime() + windowMs),
          reason: 'budget_denied',
          detail: {
            jobKey: X_SAMPLING_WINDOW_JOB_KEY,
            securityId: result.securityId,
            symbol: result.symbol,
            calculationId: verdict.calculationId,
            readsRequested: readsPerEvent,
            idempotencyKey,
            refusalReason: budget.reason,
          },
        },
        db,
      );
      continue;
    }

    dispatchRequests.push({
      job: xJob,
      idempotencyKey,
      securityId: result.securityId,
      symbol: result.symbol,
      reason: `market.spike_detection fired for ${result.symbol} at ${verdict.observedAt}`,
    });
  }

  return { verdicts, dispatchRequests };
}
