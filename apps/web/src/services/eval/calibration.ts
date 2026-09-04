/**
 * MT-11 — the one-time human calibration script's logic (F12 §4.4): "samples 20 answers for the
 * owner to hand-score on the same rubric, then reports Spearman correlation between human and
 * judge." Non-blocking to the build loop; blocking to any claim that the Tier C gate means
 * something (F12 §4.4, verbatim).
 *
 * **This module cannot itself produce a real Spearman number in this sandbox.** `sampleForOwner`
 * and `computeCalibration` are both fully implemented and unit-tested; what is genuinely missing
 * is the owner's hand-scored input, which no agent can fabricate without becoming exactly the
 * "labels produced partly by an LLM ... graded [by] a pipeline that contains an LLM" circularity
 * D-35 already names and rejects for a different corpus. `pendingCalibrationStatus()` is the
 * honest status this build records instead of inventing a number — F12 §6 DoD's own item: "its
 * result **or its pending status** is recorded."
 */
import { spearman, meetsCalibrationGate, InsufficientDataError, type ScorePair } from './spearman';
import type { JudgeOutput } from './schema';

export const CALIBRATION_SAMPLE_SIZE = 20;

export type CalibrationCandidate = { readonly answerId: string; readonly judgeScores: JudgeOutput };

/**
 * Deterministic sampling — every `n`th scored answer by sorted id, not a random draw. A
 * calibration script whose sample changes between runs would make "the owner hand-scored these
 * 20" an unreproducible claim the moment anyone re-ran it.
 */
export function sampleForOwner(
  scored: readonly CalibrationCandidate[],
  sampleSize: number = CALIBRATION_SAMPLE_SIZE,
): readonly CalibrationCandidate[] {
  const sorted = [...scored].sort((a, b) => a.answerId.localeCompare(b.answerId));
  if (sorted.length <= sampleSize) return sorted;
  const stride = sorted.length / sampleSize;
  const picked: CalibrationCandidate[] = [];
  for (let i = 0; i < sampleSize; i += 1) {
    const idx = Math.min(sorted.length - 1, Math.floor(i * stride));
    const candidate = sorted[idx];
    if (candidate !== undefined) picked.push(candidate);
  }
  return picked;
}

/**
 * The mean judge score per answer, ready to line up against a human's mean score for that same
 * answer. **Disclosed as plain JS math, deliberately** (`CLAUDE.md`'s decimal-safety rule): the
 * four inputs are integers 1-5, their sum is at most 20, and `/4` of any such sum is exactly
 * representable in IEEE 754 double precision — there is no rounding to lose. This value only ever
 * feeds `spearman()` as a rank input (comparative ordering, not an exact-match gate) and is never
 * itself stored or compared for equality, unlike `gate.ts#meanScore`'s decimal-string mean, which
 * *is* compared against the exact `4.0` Tier C gate and stays on `calc/decimal`'s `D` for that
 * reason.
 */
function judgeMean(scores: JudgeOutput): number {
  return (scores.c1 + scores.c2 + scores.c3 + scores.c4) / 4;
}

export type HumanScore = { readonly answerId: string; readonly c1: number; readonly c2: number; readonly c3: number; readonly c4: number };

export type CalibrationOutcome =
  | { readonly status: 'measured'; readonly spearmanRho: string; readonly meetsGate: boolean; readonly n: number }
  | { readonly status: 'pending'; readonly reason: string; readonly sampleSize: number };

/**
 * `humanScores` is `null`/empty when — as in this build — no human hand-scoring pass has
 * happened yet. That is not a failure of this function; it is the expected, disclosed state F12
 * §6 DoD names explicitly, and `pendingCalibrationStatus` below is what a caller should record.
 */
export function computeCalibration(
  candidates: readonly CalibrationCandidate[],
  humanScores: readonly HumanScore[],
): CalibrationOutcome {
  if (humanScores.length === 0) {
    return pendingCalibrationStatus(candidates.length);
  }

  const judgeByAnswer = new Map(candidates.map((c) => [c.answerId, judgeMean(c.judgeScores)]));
  const pairs: ScorePair[] = [];
  for (const human of humanScores) {
    const judge = judgeByAnswer.get(human.answerId);
    if (judge === undefined) continue;
    pairs.push({ id: human.answerId, human: (human.c1 + human.c2 + human.c3 + human.c4) / 4, judge });
  }

  try {
    const rho = spearman(pairs);
    return { status: 'measured', spearmanRho: rho, meetsGate: meetsCalibrationGate(rho), n: pairs.length };
  } catch (error) {
    if (error instanceof InsufficientDataError) {
      return { status: 'pending', reason: error.message, sampleSize: pairs.length };
    }
    throw error;
  }
}

export function pendingCalibrationStatus(sampleSize: number): CalibrationOutcome {
  return {
    status: 'pending',
    reason:
      'MT-11 requires the owner to hand-score a sample on the Tier C rubric. No human scores ' +
      'have been recorded for this run — this is the disclosed, non-blocking pending state F12 ' +
      '§4.4/§6 DoD name, not a fabricated Spearman number.',
    sampleSize,
  };
}
