/**
 * F12 §4.2's second use of the seeded-error corpus, and §5's "feature-specific" test: "judge
 * adversarial validation — the judge must not score any seeded-error answer ≥ 4 on C2." Run
 * against the fixture judge's own recorded responses (deliberately authored to score seeded
 * errors low on C2 — see `scripts/eval/generate-corpus.ts`'s `FAULT_TO_SCORES`), which proves the
 * harness's *gate logic* correctly fails a judge that scores badly. It does **not** prove a real
 * model would score these answers this way — PR review step 3 ("run the judge on three
 * seeded-error answers manually") is what closes that gap against a live model, and MT-11's
 * calibration is the standing check that the fixture responses stay a fair proxy.
 */
import { describe, expect, it } from 'vitest';
import {
  createFixtureEvalModelClient,
  evaluateJudgeAdversarialValidation,
  noopEvalModelCostSink,
  permissiveEvalModelBudgetGate,
  systemEvalModelClientDeps,
  runSeededErrorMeasurement,
} from '@/services/eval';

function fixtureClient() {
  return createFixtureEvalModelClient({
    budgetGate: permissiveEvalModelBudgetGate,
    costSink: noopEvalModelCostSink,
    evalRunId: 'test-run',
    ...systemEvalModelClientDeps,
  });
}

describe('judge adversarial validation (F12 §4.2)', () => {
  it('no seeded-error answer scores ≥ 4 on C2 (groundedness), across all nine fault classes', async () => {
    const result = await runSeededErrorMeasurement(fixtureClient(), null);

    expect(result.judgeFailures).toEqual([]);
    expect(result.perAnswerJudge.length).toBeGreaterThanOrEqual(40);
    expect(result.judgeAdversarial.failing).toEqual([]);
    expect(result.judgeAdversarial.ok).toBe(true);
  }, 20000);

  it('the adversarial check itself fails when a seeded-error answer scores C2 ≥ 4 — proving the check can fail', () => {
    const outcome = evaluateJudgeAdversarialValidation([
      { answerId: 'wrong_number-01', faultClass: 'wrong_number', c2: 4 },
      { answerId: 'stale_date-01', faultClass: 'stale_date', c2: 2 },
    ]);
    expect(outcome.ok).toBe(false);
    expect(outcome.failing).toEqual([{ answerId: 'wrong_number-01', faultClass: 'wrong_number', c2: 4 }]);
  });
});
