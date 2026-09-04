/**
 * The Tier C gate (F12 §4.3, `01-PRODUCT-SPEC.md` §4 Tier C): mean ≥ 4.0 across the corpus, no
 * single answer below 3 on C2 (groundedness), and zero Tier-B violations. "A C2 failure is
 * treated as a defect, not a score" — so it is reported by name, not averaged away.
 */
import Decimal from 'decimal.js';
import type { JudgeResponse, TierCGateVerdict } from './contracts';

/** A decimal string, not a JS number literal — every comparison below stays in `decimal.js`. */
export const TIER_C_MEAN_THRESHOLD = '4.0';
export const TIER_C_C2_FLOOR = 3;

export type CorpusJudgeResult = {
  packId: string;
  response: JudgeResponse;
};

/**
 * Mean of an axis's scores across the corpus, in `decimal.js`.
 *
 * **Review finding (lane-review round 1).** The previous implementation summed and divided in
 * floating point. Three answers scoring `{4,5,4,4}`, `{4,4,3,4}`, `{4,4,4,4}` have an *exact*
 * overall mean of `4.0`, but `(4 + 13/3 + 11/3 + 4) / 4` computed in IEEE-754 doubles lands at
 * `3.9999999999999996` — a hair below the threshold — while a naive `.toFixed(2)` on that same
 * float still displays `"4.00"`. The report would have printed "Overall 4.00 (threshold 4.00)"
 * next to "Tier C gate: FAIL", a self-contradiction on the product's headline quality number.
 * `decimal.js` computes the exact rational value instead, so a corpus whose true mean sits
 * exactly at the threshold passes, and the displayed figure always agrees with the verdict.
 */
function axisMean(results: readonly CorpusJudgeResult[], axis: 'c1' | 'c2' | 'c3' | 'c4'): Decimal {
  const sum = results.reduce((total, r) => total.plus(r.response[axis]), new Decimal(0));
  return sum.dividedBy(results.length);
}

export function evaluateTierCGate(
  results: readonly CorpusJudgeResult[],
  tierBViolationCount: number,
): TierCGateVerdict {
  if (results.length === 0) {
    throw new Error('evaluateTierCGate: cannot evaluate a gate against zero judged answers');
  }

  const c1 = axisMean(results, 'c1');
  const c2 = axisMean(results, 'c2');
  const c3 = axisMean(results, 'c3');
  const c4 = axisMean(results, 'c4');

  /**
   * Computed as the mean of the four per-axis means because that is the breakdown the report
   * table (`run.ts`) needs to print — **not**, as an earlier version of this comment claimed,
   * because it protects against one axis "swamping" another. That claim was false: since every
   * judged answer always carries all four axis scores, mean-of-per-axis-means and a flat
   * average across every individual score in the corpus are algebraically identical
   * ((Σc1+Σc2+Σc3+Σc4)/(4n) either way). Corrected per lane-review round 1 finding 2.
   */
  const overallMean = c1.plus(c2).plus(c3).plus(c4).dividedBy(4);

  const c2Failures = results.filter((r) => r.response.c2 < TIER_C_C2_FLOOR).map((r) => r.packId);

  const judgeReportedViolations = results.reduce((sum, r) => sum + r.response.violations.length, 0);
  const totalViolations = tierBViolationCount + judgeReportedViolations;

  const reasons: string[] = [];
  if (overallMean.lessThan(TIER_C_MEAN_THRESHOLD)) {
    reasons.push(
      `overall mean ${overallMean.toFixed(4)} is below the ${new Decimal(TIER_C_MEAN_THRESHOLD).toFixed(2)} threshold`,
    );
  }
  if (c2Failures.length > 0) {
    reasons.push(
      `${c2Failures.length} answer(s) scored below ${TIER_C_C2_FLOOR} on C2 (groundedness): ${c2Failures.join(', ')} — a C2 failure is a defect, not a score to average away`,
    );
  }
  if (totalViolations > 0) {
    reasons.push(`${totalViolations} Tier-B violation(s) recorded across the corpus; the gate requires zero`);
  }

  return {
    passed: reasons.length === 0,
    perAxisMean: { c1: c1.toFixed(4), c2: c2.toFixed(4), c3: c3.toFixed(4), c4: c4.toFixed(4) },
    overallMean: overallMean.toFixed(4),
    c2Floor: TIER_C_C2_FLOOR,
    c2Failures,
    tierBViolationCount: totalViolations,
    reasons,
  };
}
