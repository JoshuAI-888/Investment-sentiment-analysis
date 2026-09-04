/**
 * Tier C gate logic — F12 §4.3, `01-PRODUCT-SPEC.md` §4: "mean ≥ 4.0 across the corpus, with no
 * single answer below 3 on C2 (groundedness), and zero Tier-B violations."
 *
 * **The C2 floor is a hard gate, never averaged away** (F12 §4.3: "A C2 failure is a defect to
 * fix, not a score to average away"). `evaluateTierCGate` checks it as an independent condition
 * from the mean — a corpus that clears 4.0 on average with one answer at C2=2 still fails.
 */
import { D } from '@/calc/decimal';
import type { JudgeOutput } from './schema';

export const TIER_C_MEAN_GATE = '4.0';
export const TIER_C_C2_FLOOR = 3;

export type JudgeGateInput = {
  readonly answerId: string;
  readonly scores: Pick<JudgeOutput, 'c1' | 'c2' | 'c3' | 'c4' | 'violations'>;
};

export type TierBViolation = {
  readonly answerId: string;
  readonly source: 'deterministic_check' | 'judge_reported';
  readonly detail: string;
};

export type TierCGateResult = {
  readonly ok: boolean;
  readonly corpusMean: string;
  readonly perAnswerMean: Readonly<Record<string, string>>;
  readonly c2Floor: { readonly ok: boolean; readonly failing: readonly { readonly answerId: string; readonly c2: number }[] };
  readonly tierBViolations: readonly TierBViolation[];
  readonly reasons: readonly string[];
};

function meanOf(scores: Pick<JudgeOutput, 'c1' | 'c2' | 'c3' | 'c4'>) {
  return new D(scores.c1).plus(scores.c2).plus(scores.c3).plus(scores.c4).dividedBy(4);
}

export function evaluateTierCGate(
  inputs: readonly JudgeGateInput[],
  externalTierBViolations: readonly TierBViolation[] = [],
): TierCGateResult {
  if (inputs.length === 0) {
    return {
      ok: false,
      corpusMean: '0',
      perAnswerMean: {},
      c2Floor: { ok: true, failing: [] },
      tierBViolations: externalTierBViolations,
      reasons: ['no answers were scored — an empty corpus cannot pass the Tier C gate'],
    };
  }

  const perAnswerMean: Record<string, string> = {};
  let sum = new D(0);
  for (const input of inputs) {
    const mean = meanOf(input.scores);
    perAnswerMean[input.answerId] = mean.toFixed(4);
    sum = sum.plus(mean);
  }
  const corpusMean = sum.dividedBy(inputs.length);

  const failingC2 = inputs
    .filter((input) => input.scores.c2 < TIER_C_C2_FLOOR)
    .map((input) => ({ answerId: input.answerId, c2: input.scores.c2 }));

  const judgeReportedViolations: TierBViolation[] = inputs.flatMap((input) =>
    input.scores.violations.map((detail) => ({ answerId: input.answerId, source: 'judge_reported' as const, detail })),
  );
  const tierBViolations = [...externalTierBViolations, ...judgeReportedViolations];

  const meanOk = corpusMean.greaterThanOrEqualTo(new D(TIER_C_MEAN_GATE));
  const c2Ok = failingC2.length === 0;
  const tierBOk = tierBViolations.length === 0;

  const reasons: string[] = [];
  if (!meanOk) reasons.push(`corpus mean ${corpusMean.toFixed(4)} is below the ${TIER_C_MEAN_GATE} gate`);
  if (!c2Ok) reasons.push(`${String(failingC2.length)} answer(s) scored below ${String(TIER_C_C2_FLOOR)} on C2 (groundedness) — a hard floor, never averaged away`);
  if (!tierBOk) reasons.push(`${String(tierBViolations.length)} Tier-B violation(s) found`);

  return {
    ok: meanOk && c2Ok && tierBOk,
    corpusMean: corpusMean.toFixed(4),
    perAnswerMean,
    c2Floor: { ok: c2Ok, failing: failingC2 },
    tierBViolations,
    reasons,
  };
}

/** F12 §4.2's second use of the seeded-error corpus: "a judge scoring a seeded-error answer ≥ 4
 * on groundedness is itself a defect and fails the harness." Independent of `evaluateTierCGate`
 * — this asks a narrower, adversarial question about individual seeded-error scores, not about a
 * corpus mean. */
export type JudgeAdversarialResult = {
  readonly ok: boolean;
  readonly failing: readonly { readonly answerId: string; readonly faultClass: string; readonly c2: number }[];
};

export function evaluateJudgeAdversarialValidation(
  scored: readonly { readonly answerId: string; readonly faultClass: string; readonly c2: number }[],
): JudgeAdversarialResult {
  const failing = scored.filter((entry) => entry.c2 >= 4);
  return { ok: failing.length === 0, failing };
}
