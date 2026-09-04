/**
 * Tier D1 (`01-PRODUCT-SPEC.md` §4): "Stance accuracy against a hand-labelled set, per platform
 * axis — a single blended figure is not admissible (D-14)." Threshold: macro-F1 ≥ 0.80 per axis.
 *
 * **Review finding (lane-review round 1).** D1 is a v1 gate assigned to F12 by the spec's D-09
 * amendment line and by `docs/PROGRESS.md`'s global counters — it was built and reported here
 * for the first time in response to that finding, not carried over from an earlier pass.
 *
 * **What this is, honestly, on a 10-11 pack starter corpus.** The computation below is real:
 * it reads `itemLabel.expectedStance` (the human label) against `item.item.stanceLabel` (the
 * value actually stored on the fixture item) and produces a genuine macro-F1 per axis. But a
 * macro-F1 computed from a handful of hand-authored items per axis is not a measurement anyone
 * should cite as "D1 passing" — the real Tier D1 gate needs the same larger, D-35-methodology
 * labelled set the ≥30-pack corpus does. See the lane report's DEFERRED field. This module
 * exists so the *machinery* is real and testable now, not so today's number means anything yet.
 */
import Decimal from 'decimal.js';
import { socialAxis, type SocialAxis } from '@/contracts/primitives';
import type { CorpusPack, StanceAxisF1, StanceMacroF1Report } from './contracts';

export const D1_MACRO_F1_THRESHOLD = '0.80';

type StanceClass = 'bullish' | 'bearish' | 'neutral' | 'unclear';

/** The shared `stanceLabel` enum is never widened to `'unclear'` (frozen contract) — `null` means unclear here instead. */
function classOf(stance: string | null): StanceClass {
  return stance === null ? 'unclear' : (stance as StanceClass);
}

/**
 * Macro-F1: the unweighted mean of each class's F1, so a rare class (e.g. `unclear`) counts as
 * much as a common one. All arithmetic in `decimal.js` — precision/recall are exact ratios of
 * small integers, and summing several of them in floating point is exactly the kind of
 * near-threshold rounding error `gate.ts`'s own fix (lane-review round 1 finding 2) exists to
 * avoid repeating here.
 */
function macroF1(pairs: readonly { predicted: StanceClass; actual: StanceClass }[]): Decimal {
  const classes = Array.from(new Set(pairs.flatMap((pair) => [pair.predicted, pair.actual])));

  const perClassF1 = classes.map((cls) => {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    for (const pair of pairs) {
      if (pair.predicted === cls && pair.actual === cls) truePositive += 1;
      else if (pair.predicted === cls && pair.actual !== cls) falsePositive += 1;
      else if (pair.predicted !== cls && pair.actual === cls) falseNegative += 1;
    }

    const precision =
      truePositive + falsePositive === 0 ? new Decimal(0) : new Decimal(truePositive).dividedBy(truePositive + falsePositive);
    const recall =
      truePositive + falseNegative === 0 ? new Decimal(0) : new Decimal(truePositive).dividedBy(truePositive + falseNegative);
    const denominator = precision.plus(recall);
    return denominator.isZero() ? new Decimal(0) : precision.times(2).times(recall).dividedBy(denominator);
  });

  return perClassF1.reduce((sum, f1) => sum.plus(f1), new Decimal(0)).dividedBy(perClassF1.length);
}

/**
 * Reads every labelled item in `packs`, grouped by its `axis` (D-14: platforms are never
 * blended), and computes macro-F1 per axis. An axis with zero labelled items in the corpus
 * reports `{ macroF1: null, n: 0 }` — a missing axis is a missing measurement, not a zero.
 */
export function computeStanceMacroF1(packs: readonly CorpusPack[]): StanceMacroF1Report {
  const byAxis: Record<SocialAxis, { predicted: StanceClass; actual: StanceClass }[]> = {
    reddit: [],
    x: [],
    substack: [],
  };

  for (const pack of packs) {
    const labelByItemId = new Map(pack.labels.map((label) => [label.itemId, label]));
    for (const classifiedItem of pack.pack.items) {
      const label = labelByItemId.get(classifiedItem.item.id);
      if (label === undefined) continue;
      byAxis[classifiedItem.axis].push({
        predicted: classOf(classifiedItem.item.stanceLabel),
        actual: classOf(label.expectedStance),
      });
    }
  }

  const axisReport = (axis: SocialAxis): StanceAxisF1 => {
    const pairs = byAxis[axis];
    if (pairs.length === 0) return { macroF1: null, n: 0 };
    return { macroF1: macroF1(pairs).toFixed(4), n: pairs.length };
  };

  return {
    reddit: axisReport('reddit'),
    x: axisReport('x'),
    substack: axisReport('substack'),
  };
}

export type D1GateVerdict = {
  passed: boolean;
  perAxis: Record<SocialAxis, { macroF1: string | null; n: number; passed: boolean }>;
  reasons: string[];
};

/**
 * Gates every axis that has any labelled items against the 0.80 threshold. An axis with zero
 * labelled items is reported but never gates — there is nothing to measure yet, which is a
 * missing-corpus problem, not a failing-accuracy one.
 */
export function evaluateD1Gate(report: StanceMacroF1Report): D1GateVerdict {
  const reasons: string[] = [];
  const perAxis = {} as D1GateVerdict['perAxis'];

  for (const axis of socialAxis.options) {
    const { macroF1: value, n } = report[axis];
    const passed = value === null ? true : new Decimal(value).greaterThanOrEqualTo(D1_MACRO_F1_THRESHOLD);
    perAxis[axis] = { macroF1: value, n, passed };
    if (value !== null && !passed) {
      reasons.push(`${axis}: macro-F1 ${value} is below the ${D1_MACRO_F1_THRESHOLD} threshold (n=${n})`);
    }
  }

  return { passed: reasons.length === 0, perAxis, reasons };
}
