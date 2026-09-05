/**
 * Spearman rank correlation (F12 §4.4, `docs/05-TEST-STRATEGY.md` §5.3's calibration gate).
 *
 * This is judge-calibration arithmetic, not a metric a user ever sees, so it lives in
 * `services/eval/` rather than `analytics/` or `calc/` — those two layers are reserved for
 * user-facing deterministic metrics (`02-ARCHITECTURE-CONTRACTS.md` §3). Still float-free where
 * it matters: ranks and the final coefficient are plain numbers (a correlation coefficient is
 * not a stored, displayed decimal under product invariant §6.2), but every step is written out
 * so the arithmetic is auditable rather than a black-box library call.
 */

/**
 * Fractional (average) ranks, 1-indexed, with ties sharing the mean of the ranks they'd occupy.
 * Standard treatment for Spearman's rho — a naive ordinal rank on tied values biases the
 * correlation toward whichever direction the tie-break happens to fall.
 */
function fractionalRanks(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.value === indexed[i]!.value) j += 1;
    // Ranks i..j (0-indexed) occupy 1-indexed positions (i+1)..(j+1); their shared rank is the mean.
    const sharedRank = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k += 1) {
      const entry = indexed[k]!;
      ranks[entry.index] = sharedRank;
    }
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman's rho on two equal-length samples. Returns `null` when either series has zero
 * variance (all ties) — the coefficient is undefined there, and `null` is what stops a caller
 * from silently treating an undefined correlation as zero, which would read as "no relationship"
 * rather than "not computable from this sample".
 */
export function spearmanCorrelation(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length) {
    throw new Error(
      `spearmanCorrelation: series lengths differ (${xs.length} vs ${ys.length}) — every human score must pair with exactly one judge score`,
    );
  }
  const n = xs.length;
  if (n < 2) return null;

  const rankX = fractionalRanks(xs);
  const rankY = fractionalRanks(ys);

  const meanX = rankX.reduce((sum, v) => sum + v, 0) / n;
  const meanY = rankY.reduce((sum, v) => sum + v, 0) / n;

  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = rankX[i]! - meanX;
    const dy = rankY[i]! - meanY;
    numerator += dx * dy;
    sumSqX += dx * dx;
    sumSqY += dy * dy;
  }

  if (sumSqX === 0 || sumSqY === 0) return null;

  return numerator / Math.sqrt(sumSqX * sumSqY);
}
