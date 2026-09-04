/**
 * Spearman rank correlation — MT-11's calibration statistic (F12 §4.4): "reports Spearman
 * correlation between human and judge [scores]."
 *
 * **Decimal, disclosed as a deliberate choice, not an oversight.** `CLAUDE.md`: "Decimal-safe in
 * any calculation path ... if it's purely a test-harness statistic rather than a product-facing
 * metric, plain JS math with disclosed precision may be acceptable — disclose the choice either
 * way." This module uses `calc/decimal`'s `D` throughout rather than plain JS math: MT-11's
 * output feeds a real product gate ("below 0.7, the judge's thresholds are raised" — F12 §4.4),
 * not a scratch number, and the corpus this ever runs against is small (≤ 30 pairs) so the
 * decimal cost is negligible. Ranking itself (comparisons, not arithmetic) stays in plain JS —
 * `Array.prototype.sort` has no float-precision failure mode to guard against.
 */
import { D, type Dec } from '@/calc/decimal';

export type ScorePair = { readonly id: string; readonly human: number; readonly judge: number };

/** Average (fractional) ranks — the standard tie-handling for Spearman's ρ. 1-indexed, ascending. */
function rank(values: readonly number[]): readonly Dec[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array<Dec>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]?.value === indexed[i]?.value) j += 1;
    // Average rank for the tied block [i, j], 1-indexed.
    const avgRank = new D(i + 1).plus(j + 1).dividedBy(2);
    for (let k = i; k <= j; k += 1) {
      const entry = indexed[k];
      if (entry !== undefined) ranks[entry.index] = avgRank;
    }
    i = j + 1;
  }
  return ranks;
}

export class InsufficientDataError extends Error {
  constructor(n: number) {
    super(`Spearman correlation needs at least 2 pairs with variance in both series; got ${String(n)}`);
    this.name = 'InsufficientDataError';
  }
}

/**
 * Spearman's ρ over the two rank sequences: `1 - (6 * Σd²) / (n(n²-1))`, the standard formula
 * (equivalent to Pearson's r on the ranks, which is what the average-rank tie handling above
 * makes this actually compute — the direct-formula shortcut is only exact with no ties).
 */
export function spearman(pairs: readonly ScorePair[]): string {
  const n = pairs.length;
  if (n < 2) throw new InsufficientDataError(n);

  const humanRanks = rank(pairs.map((p) => p.human));
  const judgeRanks = rank(pairs.map((p) => p.judge));

  const allHumanSame = humanRanks.every((r) => r.equals(humanRanks[0] as Dec));
  const allJudgeSame = judgeRanks.every((r) => r.equals(judgeRanks[0] as Dec));
  if (allHumanSame || allJudgeSame) {
    throw new InsufficientDataError(n);
  }

  let sumSquaredDiff = new D(0);
  for (let i = 0; i < n; i += 1) {
    const d = (humanRanks[i] as Dec).minus(judgeRanks[i] as Dec);
    sumSquaredDiff = sumSquaredDiff.plus(d.times(d));
  }

  const nD = new D(n);
  const rho = new D(1).minus(sumSquaredDiff.times(6).dividedBy(nD.times(nD.times(nD).minus(1))));
  return rho.toFixed(4);
}

export const CALIBRATION_GATE = '0.7';

export function meetsCalibrationGate(rho: string): boolean {
  return new D(rho).greaterThanOrEqualTo(new D(CALIBRATION_GATE));
}
