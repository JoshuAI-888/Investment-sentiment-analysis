/**
 * Orchestrates one full eval harness run — F12 §3 "Produces", §4.5 "results are stored per run".
 * Two independent passes, matching F12 §4.2's "used twice": `runCorpusJudgeGate` scores the
 * frozen corpus's gold answers against Tier C (§4.3); `runSeededErrorMeasurement` measures the
 * verifier (B7/B8, §4.2) and validates the judge adversarially against the same seeded corpus.
 * Neither pass requires the other to run — a caller with no live model keys can still run the
 * deterministic-only half of `runSeededErrorMeasurement` (see `verifier-metrics.ts`'s own
 * disclosure of that boundary).
 */
import { runDeterministicChecks, type VerifyContext } from '@/services/research/deterministic-checks';
import type { ModelVerificationResult } from '@/services/research/verify';
import { loadCorpus, loadSeededErrorCorpus, type EvalCorpusPack } from './corpus';
import { buildJudgePayload, renderAnswerText, runJudge } from './judge';
import type { EvalModelClient } from './judge-model';
import { evaluateJudgeAdversarialValidation, evaluateTierCGate, type JudgeGateInput, type TierBViolation, type TierCGateResult, type JudgeAdversarialResult } from './gate';
import { aggregateVerifierMeasurement, verifySeededAnswer, b7Passes, b8Passes, toMetricFact, type VerifierMeasurement, type SeededAnswerVerdict } from './verifier-metrics';
import type { NewEvalResult } from '@/repositories/eval';

export type CorpusJudgeRunResult = {
  readonly gate: TierCGateResult;
  readonly perAnswer: readonly { readonly packId: string; readonly answerId: string; readonly judgeC1: number; readonly judgeC2: number; readonly judgeC3: number; readonly judgeC4: number; readonly judgeViolations: readonly string[]; readonly judgeRationale: string }[];
  readonly failures: readonly { readonly packId: string; readonly detail: string }[];
};

/**
 * Scores every corpus pack's `goldOutput` against Tier C, plus the corpus's own deterministic
 * checks (contributing to "zero Tier-B violations" — a gold answer that trips a deterministic
 * check is a defect in the corpus's own labelling, and the gate reports it as such rather than
 * only reporting judge-self-reported violations).
 */
export async function runCorpusJudgeGate(
  client: EvalModelClient,
  root?: string,
): Promise<CorpusJudgeRunResult> {
  const packs = await loadCorpus(root);
  const inputs: JudgeGateInput[] = [];
  const perAnswer: CorpusJudgeRunResult['perAnswer'][number][] = [];
  const failures: CorpusJudgeRunResult['failures'][number][] = [];
  const tierBViolations: TierBViolation[] = [];

  for (const pack of packs) {
    const ctx: VerifyContext = {
      output: pack.meta.goldOutput,
      pack: pack.pack,
      metrics: pack.meta.metrics.map(toMetricFact),
      subjectSymbol: pack.meta.subjectSymbol,
    };
    const deterministic = runDeterministicChecks(ctx);
    for (const violation of deterministic.violations) {
      tierBViolations.push({
        answerId: pack.meta.id,
        source: 'deterministic_check',
        detail: `${violation.check}: ${violation.detail}`,
      });
    }

    const answerText = renderAnswerText(pack.meta.goldOutput);
    const payload = buildJudgePayload({ answerText, pack: pack.pack, metrics: pack.meta.metrics });
    const result = await runJudge(payload, client, undefined, pack.meta.id);
    if (!result.ok) {
      failures.push({ packId: pack.meta.id, detail: result.detail });
      continue;
    }

    inputs.push({ answerId: pack.meta.id, scores: result.output });
    perAnswer.push({
      packId: pack.meta.id,
      answerId: pack.meta.id,
      judgeC1: result.output.c1,
      judgeC2: result.output.c2,
      judgeC3: result.output.c3,
      judgeC4: result.output.c4,
      judgeViolations: result.output.violations,
      judgeRationale: result.output.rationale,
    });
  }

  const gate = evaluateTierCGate(inputs, tierBViolations);
  return { gate, perAnswer, failures };
}

export type SeededErrorRunResult = {
  readonly verifierMeasurement: VerifierMeasurement;
  readonly b7Pass: boolean;
  readonly b8Pass: boolean;
  readonly judgeAdversarial: JudgeAdversarialResult;
  readonly judgeFailures: readonly { readonly answerId: string; readonly detail: string }[];
  readonly verdicts: readonly SeededAnswerVerdict[];
  readonly perAnswerJudge: readonly { readonly answerId: string; readonly packId: string; readonly faultClass: string; readonly c1: number; readonly c2: number; readonly c3: number; readonly c4: number; readonly violations: readonly string[]; readonly rationale: string }[];
};

/**
 * The seeded-error corpus's two uses (F12 §4.2), run together since both read the same 40
 * answers: verifier catch-rate/false-positive measurement, and judge adversarial validation.
 * `modelVerify` is optional — see `verifier-metrics.ts`'s own disclosure of what omitting it means
 * for B7/B8's completeness.
 */
export async function runSeededErrorMeasurement(
  judgeClient: EvalModelClient,
  modelVerify: ((ctx: VerifyContext) => Promise<ModelVerificationResult>) | null,
  root?: string,
): Promise<SeededErrorRunResult> {
  const [answers, packs] = await Promise.all([loadSeededErrorCorpus(root), loadCorpus(root)]);
  const packsById = new Map<string, EvalCorpusPack>(packs.map((p) => [p.meta.id, p]));

  const verdicts: SeededAnswerVerdict[] = [];
  const adversarialInputs: { answerId: string; faultClass: string; c2: number }[] = [];
  const judgeFailures: { answerId: string; detail: string }[] = [];
  const perAnswerJudge: SeededErrorRunResult['perAnswerJudge'][number][] = [];

  for (const answer of answers) {
    const pack = packsById.get(answer.meta.packId);
    if (pack === undefined) {
      throw new Error(`seeded-error answer '${answer.meta.id}' references unknown pack '${answer.meta.packId}'`);
    }
    verdicts.push(await verifySeededAnswer(answer, pack, modelVerify));

    const answerText = renderAnswerText(answer.output);
    const payload = buildJudgePayload({ answerText, pack: pack.pack, metrics: pack.meta.metrics });
    const judged = await runJudge(payload, judgeClient, undefined, answer.meta.id);
    if (!judged.ok) {
      judgeFailures.push({ answerId: answer.meta.id, detail: judged.detail });
      continue;
    }
    adversarialInputs.push({ answerId: answer.meta.id, faultClass: answer.meta.faultClass, c2: judged.output.c2 });
    perAnswerJudge.push({
      answerId: answer.meta.id,
      packId: answer.meta.packId,
      faultClass: answer.meta.faultClass,
      c1: judged.output.c1,
      c2: judged.output.c2,
      c3: judged.output.c3,
      c4: judged.output.c4,
      violations: judged.output.violations,
      rationale: judged.output.rationale,
    });
  }

  const verifierMeasurement = aggregateVerifierMeasurement(verdicts, modelVerify !== null);
  const judgeAdversarial = evaluateJudgeAdversarialValidation(adversarialInputs);

  return {
    verifierMeasurement,
    b7Pass: b7Passes(verifierMeasurement),
    b8Pass: b8Passes(verifierMeasurement),
    judgeAdversarial,
    judgeFailures,
    verdicts,
    perAnswerJudge,
  };
}

export function corpusJudgeResultsToEvalResults(runId: string, result: CorpusJudgeRunResult): readonly NewEvalResult[] {
  return result.perAnswer.map((entry) => ({
    evalRunId: runId,
    packId: entry.packId,
    answerId: entry.answerId,
    kind: 'gold' as const,
    faultClass: null,
    judgeC1: entry.judgeC1,
    judgeC2: entry.judgeC2,
    judgeC3: entry.judgeC3,
    judgeC4: entry.judgeC4,
    judgeViolations: entry.judgeViolations,
    judgeRationale: entry.judgeRationale,
    verifierOutcome: null,
  }));
}

/** `verifierOutcome` records whether the verifier (deterministic + optional model pass together)
 * caught this answer's seeded fault; `judgeC1..C4` carry the same judge call `SeededErrorRunResult
 * .perAnswerJudge` already made (F12 §4.2 runs the judge on every seeded-error answer regardless
 * — the two measurements share one judge call, not two). */
export function seededErrorResultsToEvalResults(
  runId: string,
  result: Pick<SeededErrorRunResult, 'verdicts' | 'perAnswerJudge'>,
): readonly NewEvalResult[] {
  const verdictByAnswer = new Map(result.verdicts.map((v) => [v.answerId, v]));

  return result.perAnswerJudge.map((judged) => {
    const verdict = verdictByAnswer.get(judged.answerId);
    const faultyClaim = verdict?.claims.find((c) => c.claimId === verdict.faultyClaimId);
    const caught = faultyClaim === undefined ? null : faultyClaim.caughtByDeterministic || faultyClaim.caughtByModel;
    return {
      evalRunId: runId,
      packId: judged.packId,
      answerId: judged.answerId,
      kind: 'seeded_error' as const,
      faultClass: judged.faultClass as NewEvalResult['faultClass'],
      judgeC1: judged.c1,
      judgeC2: judged.c2,
      judgeC3: judged.c3,
      judgeC4: judged.c4,
      judgeViolations: judged.violations,
      judgeRationale: judged.rationale,
      verifierOutcome: caught === null ? 'not_run' : caught ? 'verification_failed' : 'verified',
    };
  });
}
