/**
 * `market.spike_detection` — **a standalone cross-lane gap-fill, explicitly authorized for this
 * solo COLLECT session** (`docs/features/F16-scheduler-dispatcher.md` §4.1b, D-15).
 *
 * F16 §4.1b step 2 requires the market-data poll to "call F06's registered spike method" and
 * write its verdict as a `CalculationArtifact` — but F06 has not shipped a spike-detection method
 * (no file under this directory computed one before this commit), and `calc/`/`analytics/` are
 * SPINE-owned paths this lane may not otherwise touch (`CLAUDE.md`). This file follows exactly
 * the precedent `repositories/jobs.ts` already set and documents in its own module doc: a prior
 * solo COLLECT session added that repository as "a standalone cross-lane gap-fill... because SQL
 * lives in `repositories/`... and F16a's dispatch core needs functions over tables that only
 * SPINE can write." The same shape of gap exists here one layer up — F16a's *trigger path*
 * cannot exist without *some* spike-detection arithmetic to call, and nothing else in the tree
 * supplies it.
 *
 * **This is Wave 1's minimal version, not F06's final one — deliberately.** The brief that
 * authorized this file was explicit: "a simple threshold-crossing on `market_snapshot` percent
 * change against a configurable band is sufficient... do not over-build this." F06 owns
 * refining it (a real distributional/volatility-normalised trigger, multiple lookback windows,
 * etc.) whenever it is picked up — this method's job is only to give F16a something honest and
 * decimal-safe to dispatch on today, not to anticipate F06's eventual design.
 *
 * **Not wired into `analytics/registry.ts` or `calc/registry.ts`'s `MethodRegistry` — both are
 * SPINE-owned files this session may not edit.** `calc/artifact.ts#buildArtifact` only needs a
 * structural `BuilderMethod` (id, version, unit, roundingRule, workingPrecision, compute) — see
 * that file's own doc: "Kept structural so `calc/` owns no registry data." `services/jobs/
 * trigger.ts` (COLLECT-owned) constructs that structural descriptor locally and calls
 * `buildArtifact` directly, so this method's arithmetic is exercised through the exact same
 * builder every registered method uses, without requiring a registry entry. **Report to
 * SPINE:** whoever next owns F06 should promote this into `analytics/registry.ts` (giving it a
 * real `MethodDescriptor` — bounds, editable assumptions, goldens) rather than leaving it as a
 * registry-invisible method forever; until then it will not appear in the Inspector's formula
 * catalogue or `check:calc-coverage`.
 *
 * ## The measurement
 *
 * `percent_change = (close_now - close_prior) / close_prior`, compared in absolute value against
 * a fixed threshold band. The **verdict itself — not a downstream policy decision — is the
 * method's own return value**: `1` if the move crossed the band, `0` if it did not. F16 §4.1b
 * step 2's own words are "the verdict is a `CalculationArtifact`," not "an artifact the caller
 * then judges" — so the crossing decision is computed and traced here, inside the method, the
 * same way `price.regime`'s clamp-to-band decision is computed and traced inside that method
 * rather than left to whoever reads its result.
 *
 * `close_prior` is a genuinely absent input (not merely zero) on a security's first-ever poll —
 * `ctx.hasInput` is how this method tells "there is nothing to compare against yet" from "the
 * comparison exists and happens to be zero," the same distinction `market.composite`'s
 * renormalisation already relies on `hasInput` for.
 */
import type { ComputeContext, ComputeResult } from '../artifact';
import { D, exact } from '../decimal';

export const MARKET_SPIKE_DETECTION_ID = 'market.spike_detection';
export const MARKET_SPIKE_DETECTION_VERSION = '1.0.0';

/**
 * D-15/D-31: the trigger runs on FMP Starter's daily bars, so this band is a day-over-day
 * threshold, not an intraday one. 5% is a deliberately round, conservative starting point for
 * Wave 1 — F18/F16b's admin plane (Wave 4) is where this becomes an operator-editable
 * `job_definition`/`app_setting` value; nothing here claims it is empirically derived.
 */
export const DEFAULT_SPIKE_THRESHOLD_PCT = '0.05';

const ZERO = new D('0');
const ONE = new D('1');

export function computeMarketSpikeDetection(ctx: ComputeContext): ComputeResult {
  if (!ctx.hasInput('close_now')) {
    ctx.abstain({
      reason: 'below_sample_threshold',
      message:
        'No current close is available for this security. A spike check has nothing to measure ' +
        'without today\'s observation.',
    });
  }

  if (!ctx.hasInput('close_prior')) {
    ctx.abstain({
      reason: 'below_sample_threshold',
      message:
        'No prior close is available for this security yet — this is its first collected ' +
        'observation (or the only one collection has retained so far). A day-over-day percent ' +
        'change has nothing to compare against, so the spike check abstains rather than treat ' +
        'a single price as a 0% move.',
    });
  }

  const closeNow = ctx.input('close_now');
  const closePrior = ctx.input('close_prior');

  if (closeNow.lessThanOrEqualTo(ZERO) || closePrior.lessThanOrEqualTo(ZERO)) {
    ctx.abstain({
      reason: 'not_applicable',
      message:
        'One of the two closes being compared is zero or negative, which is not a real traded ' +
        'price. A spike verdict computed across a bad price would be fabricated, not measured.',
    });
  }

  const threshold = ctx.assumption('spike_threshold_pct');

  const percentChange = ctx.step({
    key: 'percent_change',
    label: 'Day-over-day percent change',
    expression: '({close_now} - {close_prior}) / {close_prior}',
    operands: { close_now: closeNow, close_prior: closePrior },
    unit: 'ratio',
    evaluate: (operand) => operand('close_now').minus(operand('close_prior')).div(operand('close_prior')),
  });

  const absPercentChange = ctx.step({
    key: 'abs_percent_change',
    label: 'Magnitude of the move, direction discarded',
    expression: 'abs({percent_change})',
    operands: { percent_change: percentChange },
    unit: 'ratio',
    evaluate: (operand) => operand('percent_change').abs(),
  });

  const crossed = absPercentChange.decimal.greaterThanOrEqualTo(threshold);

  const verdict = ctx.step({
    key: 'threshold_crossed',
    label: 'Threshold-crossing verdict',
    expression: '{abs_percent_change} >= {spike_threshold_pct}',
    operands: { abs_percent_change: absPercentChange, spike_threshold_pct: exact(threshold) },
    unit: 'flag',
    status: crossed ? 'applied' : 'excluded',
    evaluate: () => (crossed ? ONE : ZERO),
  });

  return { value: verdict };
}
