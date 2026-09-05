/**
 * Calibration (F12 §4.4, `DEPLOY.md` MT-11). A script/function that samples answers for the
 * owner to hand-score, then reports Spearman correlation between human and judge scores.
 * Non-blocking to the loop; blocking to any claim that the Tier C gate means something.
 *
 * The actual entry point the owner runs is `scripts/calibration-report.ts`, which uses
 * `reduceToScalar` and `sampleForCalibration`/`computeCalibration` below (lane-review round 1
 * finding 7: this file previously had the library functions but no script and no reduction
 * function, so DoD item 7 could not be honestly checked).
 */
import Decimal from 'decimal.js';
import { spearmanCorrelation } from './spearman';
import type { CalibrationResult, JudgeResponse } from './contracts';

export const CALIBRATION_SAMPLE_SIZE = 20;
export const CALIBRATION_SPEARMAN_THRESHOLD = '0.7';

export type CalibrationSample = {
  id: string;
  humanScore: number;
  judgeScore: number;
};

/**
 * Reduces a full four-axis `JudgeResponse` to the single scalar MT-11 correlates against the
 * owner's hand-score: the mean across the same four axes the owner is asked to score on ("the
 * same rubric", F12 §4.4). `decimal.js` because this is a mean of small integers, the same
 * near-threshold-rounding concern `gate.ts`'s `axisMean` exists to avoid.
 */
export function reduceToScalar(response: Pick<JudgeResponse, 'c1' | 'c2' | 'c3' | 'c4'>): number {
  return new Decimal(response.c1)
    .plus(response.c2)
    .plus(response.c3)
    .plus(response.c4)
    .dividedBy(4)
    .toNumber();
}

/**
 * Fisher-Yates over a copy of `pool` — never mutates the caller's array. `rng` is injected so
 * this is deterministic under test; production calls it with `Math.random`.
 */
export function sampleForCalibration<T>(
  pool: readonly T[],
  sampleSize: number = CALIBRATION_SAMPLE_SIZE,
  rng: () => number = Math.random,
): T[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i]!;
    const b = copy[j]!;
    copy[i] = b;
    copy[j] = a;
  }
  return copy.slice(0, Math.min(sampleSize, copy.length));
}

/**
 * `pending` is a first-class, honest outcome — MT-11 is a one-time **manual** owner task, and
 * this harness has no owner hand-scores to compute against until that happens. Reporting
 * `pending` (rather than fabricating a correlation or silently omitting the field) is what DoD
 * item 7 ("its result, or its pending status, is recorded") actually asks for.
 */
export function computeCalibration(samples: readonly CalibrationSample[]): CalibrationResult {
  if (samples.length === 0) {
    return {
      status: 'pending',
      reason:
        'No owner hand-scores recorded yet (DEPLOY.md MT-11, non-blocking to the build loop). ' +
        'Run this script with a completed hand-scoring pass to compute the Spearman figure.',
    };
  }

  const rho = spearmanCorrelation(
    samples.map((s) => s.humanScore),
    samples.map((s) => s.judgeScore),
  );

  if (rho === null) {
    return {
      status: 'pending',
      reason:
        'Spearman correlation is undefined for this sample (zero variance in the human or judge ' +
        'series) — more, or more varied, hand-scores are needed before this is a meaningful measurement.',
    };
  }

  return {
    status: 'complete',
    n: samples.length,
    spearman: rho,
    threshold: CALIBRATION_SPEARMAN_THRESHOLD,
    trusted: rho >= Number(CALIBRATION_SPEARMAN_THRESHOLD),
  };
}
