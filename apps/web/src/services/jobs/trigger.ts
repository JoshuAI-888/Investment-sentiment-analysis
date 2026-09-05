/**
 * The price trigger (F16 §4.1b, D-15).
 *
 * "The market-data poll is an ordinary clock job... It writes its observations and calls F06's
 * registered spike method. The verdict is a `CalculationArtifact` like any other... A positive
 * verdict enqueues a sampling window... Before dispatch, the window is checked against F18's X
 * read ceilings... A window that would breach a ceiling is not truncated — it is refused, and
 * the refusal is recorded as a coverage gap."
 *
 * This module calls `price.regime` (F06's real registered method, `calc/methods/
 * price-regime.ts`) rather than inventing a second detector — F16 §2's own scope line is
 * explicit that "spike detection itself... is F06's registered method — this feature dispatches
 * on the verdict, it does not compute it." Firing is decided from that method's own `r_5` step
 * (the 5-session return) crossing a configured absolute threshold.
 *
 * **A disclosed limitation, found while building this, independent of the X-ceiling-zero gap
 * below.** `services/dashboard/inputs.ts#priceRegimeInputs` — the one existing, reviewed input
 * builder for this method, reused here rather than duplicated — declares `quote_kind:
 * 'close_unadjusted'`, honestly, because `adapters/market.ts#DailyBar` does not carry FMP's
 * `adjClose` field at all (already an open F04/F07 `CONTRACTS` item). `computePriceRegime`
 * refuses to compute over anything but `adjusted_close` (a registry-level prohibition, not a
 * preference), so **every real invocation of this trigger abstains today** (`eligibility:
 * 'not_applicable'`) — it cannot yet fire against genuine market data, structurally, until F04
 * adds adjusted-close bars. This is a second, independent reason Wave 1 spends nothing on X,
 * alongside D-32's zero ceiling — both disclosed and tested here rather than accidental. The
 * artifact is still computed and persisted on every poll regardless (the DoD's own "including
 * the ones that do not fire"), and `evaluateSpikeVerdict` below is unit-tested directly against
 * hand-built eligible/ineligible inputs so the *decision* logic is proven correct independently
 * of whether today's real data can ever reach the eligible branch.
 */
import { randomUUID } from 'node:crypto';
import type { DailyBar } from '@/adapters/market';
import type { CalculationArtifact, Eligibility } from '@/calc/artifact';
import { dec, isDecimalString } from '@/calc/decimal';
import { PRICE_REGIME_ID } from '@/calc/methods/price-regime';
import type { Queryable } from '@/repositories/client';
import { recordGap } from '@/repositories/coverage';
import { findTriggerEligibleJobDefinition } from '@/repositories/jobs';
import { computeArtifact, persistArtifact } from '@/services/calculations';
import { officialAssumptions, priceRegimeInputs } from '@/services/dashboard/inputs';
import type { DispatchTriggeredJobInput, DispatchTriggeredJobResult } from './registry';
import { buildDispatchIdempotencyKey } from './idempotency';
import { DEFAULT_TRIGGER_WINDOW_REQUESTED_READS, readXCeilings, type XCeilings } from './x-ceiling';

/** The job_key a fired trigger asks `JobService` to run (seeded by `scripts/seed-job-definitions.ts`). */
export const X_SAMPLING_WINDOW_JOB_KEY = 'x.sampling_window';

/**
 * How long a refused window's `CoverageGap` spans. D-15 describes the window as "a bounded job
 * with an explicit read budget" — a point-in-time refusal alone does not say *what could not be
 * sampled*, so the gap is recorded over a bounded interval starting at the refusal, the same
 * duration a funded window would have run for. Wave 1 policy value; F18 owns making this
 * configurable once it exists.
 */
export const TRIGGER_WINDOW_DURATION_MINUTES = 60;

/**
 * An absolute 5-session return this codebase treats as "unusual" for the purpose of opening a
 * sampling window. **Not derived from any source document** — nothing in `docs/features/
 * F16-scheduler-dispatcher.md`, `docs/MEMORY.md`'s D-15/D-31/D-32, or F06's own registry entry
 * for `price.regime` names a specific move threshold for *this* purpose (F06's own `±0.35`
 * boundary, `src/analytics/registry.ts`, labels `price.regime`'s own *trend_strength* score, a
 * different, already-normalised quantity — not a raw `r_5` move). This is therefore a declared
 * Wave 1 assumption, override with `PRICE_SPIKE_R5_THRESHOLD`, flagged under this feature's
 * `RISKS`/`DECISIONS` for the product owner to confirm or replace — the same discipline F20's
 * README already applies to its own declared label-mapping assumption.
 */
export const DEFAULT_SPIKE_R5_THRESHOLD = '0.05';

export function readSpikeR5Threshold(): string {
  const raw = process.env['PRICE_SPIKE_R5_THRESHOLD'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_SPIKE_R5_THRESHOLD;
  if (!isDecimalString(raw)) {
    throw new Error(`PRICE_SPIKE_R5_THRESHOLD must be a plain decimal string, got '${raw}'`);
  }
  return raw;
}

export type SpikeVerdict = {
  readonly fired: boolean;
  readonly reason: string;
};

/**
 * Pure and independently unit-testable — see this module's own top doc for why a real
 * `price.regime` artifact cannot exercise the `fired: true` branch against today's data. Takes
 * only what it needs from a `CalculationArtifact` rather than the whole shape, so a test can
 * construct exactly the two fields that matter without faking every other artifact field.
 */
export function evaluateSpikeVerdict(
  input: { readonly eligibility: Eligibility; readonly r5ExactValue: string | null },
  thresholdR5: string,
): SpikeVerdict {
  if (input.eligibility !== 'ok') {
    return { fired: false, reason: `price.regime abstained (${input.eligibility}) — no verdict to trigger on` };
  }
  if (input.r5ExactValue === null) {
    return { fired: false, reason: 'price.regime artifact carried no r_5 step to evaluate' };
  }
  const move = dec(input.r5ExactValue).abs();
  const threshold = dec(thresholdR5);
  if (move.greaterThanOrEqualTo(threshold)) {
    return { fired: true, reason: `|r_5| = ${input.r5ExactValue} crossed the ${thresholdR5} threshold` };
  }
  return { fired: false, reason: `|r_5| = ${input.r5ExactValue} did not cross the ${thresholdR5} threshold` };
}

export type TriggerWindowDecision =
  | { readonly kind: 'dispatch'; readonly requestedReads: number }
  | { readonly kind: 'refused'; readonly requestedReads: number; readonly ceilings: XCeilings };

/**
 * D-15 binding rule: "A window that would breach a ceiling is not truncated — it is refused."
 * Checked against the per-event ceiling alone in Wave 1. **Not a shortcut** — every one of the
 * three ceilings defaults to zero (D-32), so refusing on the per-event ceiling is already
 * correct and total: a window that never clears the per-event ceiling can never accumulate
 * daily or monthly usage in the first place. Cumulative daily/monthly *usage* tracking (as
 * opposed to the ceiling *values*, which this reads today) needs a provider-scoped, read-count
 * query this codebase does not have yet — `repositories/cost.ts#spendInWindow` is dollar-scoped,
 * not read-count-scoped — reported under this feature's `CONTRACTS`/`DEFERRED` for F18.
 */
export function decideTriggerWindow(ceilings: XCeilings, requestedReads: number): TriggerWindowDecision {
  if (requestedReads > ceilings.perEventReadCeiling) {
    return { kind: 'refused', requestedReads, ceilings };
  }
  return { kind: 'dispatch', requestedReads };
}

export type DispatchTriggeredJob = (input: DispatchTriggeredJobInput) => Promise<DispatchTriggeredJobResult>;

export type TriggerEvaluationOutcome = {
  readonly securityId: string;
  readonly symbol: string;
  readonly artifact: CalculationArtifact;
  readonly verdict: SpikeVerdict;
  readonly windowDecision?: TriggerWindowDecision;
  readonly coverageGapRecorded: boolean;
  readonly dispatch?: DispatchTriggeredJobResult;
};

export type EvaluateMarketDataTriggerArgs = {
  readonly securityId: string;
  readonly symbol: string;
  readonly bars: readonly DailyBar[];
  readonly configVersion: string;
  readonly asOf: Date;
  readonly db: Queryable;
  readonly now: Date;
  readonly dispatchTriggeredJob: DispatchTriggeredJob;
  /** The market-data poll's own due instant, so a fired window's idempotency key is derived from
   *  the same `(job_id, due_at)` grammar as every other claimed run (`idempotency.ts`). */
  readonly pollDueAt: Date;
  readonly xCeilings?: XCeilings;
  readonly thresholdR5?: string;
};

/**
 * One security's full trigger evaluation for one market-data poll: build and persist the
 * `price.regime` artifact (always, per F16 §4.1b step 2 and this feature's DoD), decide whether
 * it fires, and — only on a genuine fire — check the X ceilings and either dispatch a bounded
 * window through `JobService` or record a refused `CoverageGap`.
 */
export async function evaluateMarketDataTrigger(args: EvaluateMarketDataTriggerArgs): Promise<TriggerEvaluationOutcome> {
  const asOfIso = args.asOf.toISOString();
  const artifact = computeArtifact({
    methodId: PRICE_REGIME_ID,
    subject: { kind: 'security', id: args.securityId, label: args.symbol },
    asOf: asOfIso,
    inputs: priceRegimeInputs(args.symbol, args.bars),
    assumptions: officialAssumptions(PRICE_REGIME_ID),
    configVersion: args.configVersion,
    calculationId: randomUUID(),
    computedAt: asOfIso,
  });

  // F16 §4.1b step 2 / DoD: "Every spike evaluation writes a CalculationArtifact — including the
  // ones that do not fire." Persisted unconditionally, before the verdict is even inspected.
  await persistArtifact(artifact);

  const r5Step = artifact.steps.find((step) => step.key === 'r_5');
  const threshold = args.thresholdR5 ?? readSpikeR5Threshold();
  const verdict = evaluateSpikeVerdict({ eligibility: artifact.eligibility, r5ExactValue: r5Step?.exactValue ?? null }, threshold);

  if (!verdict.fired) {
    return { securityId: args.securityId, symbol: args.symbol, artifact, verdict, coverageGapRecorded: false };
  }

  const ceilings = args.xCeilings ?? readXCeilings();
  const windowDecision = decideTriggerWindow(ceilings, DEFAULT_TRIGGER_WINDOW_REQUESTED_READS);
  const windowFrom = args.now;
  const windowTo = new Date(args.now.getTime() + TRIGGER_WINDOW_DURATION_MINUTES * 60_000);

  if (windowDecision.kind === 'refused') {
    await recordGap(
      {
        axis: 'x',
        from: windowFrom,
        to: windowTo,
        reason: 'budget_denied',
        detail: {
          securityId: args.securityId,
          symbol: args.symbol,
          requestedReads: windowDecision.requestedReads,
          ceilings: windowDecision.ceilings,
          triggeringArtifactId: artifact.calculationId,
          verdict: verdict.reason,
        },
      },
      args.db,
    );
    return { securityId: args.securityId, symbol: args.symbol, artifact, verdict, windowDecision, coverageGapRecorded: true };
  }

  // D-15 binding rule: "may never dispatch a job that was not registered as trigger-eligible."
  // Re-checked here (not assumed from the seed) so a disabled or unseeded window job is a loud,
  // recorded gap rather than a silent no-op that looks identical to "nothing fired."
  const triggerJob = await findTriggerEligibleJobDefinition(X_SAMPLING_WINDOW_JOB_KEY, args.db);
  if (triggerJob === null) {
    await recordGap(
      {
        axis: 'x',
        from: windowFrom,
        to: windowTo,
        reason: 'unknown',
        detail: {
          reason: `job_key '${X_SAMPLING_WINDOW_JOB_KEY}' is not a trigger-eligible, enabled job_definition`,
          securityId: args.securityId,
          symbol: args.symbol,
          triggeringArtifactId: artifact.calculationId,
        },
      },
      args.db,
    );
    return { securityId: args.securityId, symbol: args.symbol, artifact, verdict, windowDecision, coverageGapRecorded: true };
  }

  // D-15 binding rule: "one spike is one window" — the same `(job_id, due_at)` idempotency
  // grammar every other claim uses, extended with the security id so two securities firing on
  // the same poll open two distinct windows rather than colliding on one key.
  const dispatch = await args.dispatchTriggeredJob({
    jobDefinition: triggerJob,
    extraIdempotencyComponent: args.securityId,
    requestReason: `price trigger: ${args.symbol} ${verdict.reason}`,
  });

  return { securityId: args.securityId, symbol: args.symbol, artifact, verdict, windowDecision, coverageGapRecorded: false, dispatch };
}

// Re-exported so a caller building the idempotency key for a triggered dispatch (`service.ts`)
// does not need to import `idempotency.ts` a second time under a different name.
export { buildDispatchIdempotencyKey };
