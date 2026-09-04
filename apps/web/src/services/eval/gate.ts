/**
 * The Tier C gate (F12 §4.3, `01-PRODUCT-SPEC.md` §4 Tier C): mean ≥ 4.0 across the corpus, no
 * single answer below 3 on C2 (groundedness), and zero Tier-B violations. "A C2 failure is
 * treated as a defect, not a score" — so it is reported by name, not averaged away.
 */
import type { JudgeResponse, TierCGateVerdict } from './contracts';

export const TIER_C_MEAN_THRESHOLD = 4.0;
export const TIER_C_C2_FLOOR = 3;

export type CorpusJudgeResult = {
  packId: string;
  response: JudgeResponse;
};

/**
 * `overallMean` is the mean of the four **per-axis** means, not a flat average of every score
 * across the corpus. The distinction matters whenever the corpus is unbalanced across buckets:
 * a flat average would let one axis's scores swamp another's, and the gate is stated per axis
 * in the product spec ("scored 1-5 on four axes") before it is ever combined.
 */
export function evaluateTierCGate(
  results: readonly CorpusJudgeResult[],
  tierBViolationCount: number,
): TierCGateVerdict {
  if (results.length === 0) {
    throw new Error('evaluateTierCGate: cannot evaluate a gate against zero judged answers');
  }

  const axisMean = (axis: 'c1' | 'c2' | 'c3' | 'c4'): number =>
    results.reduce((sum, r) => sum + r.response[axis], 0) / results.length;

  const perAxisMean = { c1: axisMean('c1'), c2: axisMean('c2'), c3: axisMean('c3'), c4: axisMean('c4') };
  const overallMean = (perAxisMean.c1 + perAxisMean.c2 + perAxisMean.c3 + perAxisMean.c4) / 4;

  const c2Failures = results
    .filter((r) => r.response.c2 < TIER_C_C2_FLOOR)
    .map((r) => r.packId);

  const judgeReportedViolations = results.reduce((sum, r) => sum + r.response.violations.length, 0);
  const totalViolations = tierBViolationCount + judgeReportedViolations;

  const reasons: string[] = [];
  if (overallMean < TIER_C_MEAN_THRESHOLD) {
    reasons.push(
      `overall mean ${overallMean.toFixed(2)} is below the ${TIER_C_MEAN_THRESHOLD.toFixed(2)} threshold`,
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
    perAxisMean,
    overallMean,
    c2Floor: TIER_C_C2_FLOOR,
    c2Failures,
    tierBViolationCount: totalViolations,
    reasons,
  };
}
