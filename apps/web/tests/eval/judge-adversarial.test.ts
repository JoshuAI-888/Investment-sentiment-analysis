/**
 * F12 §5 test plan, Feature-specific row: "judge adversarial validation: the judge must not
 * score any seeded-error answer ≥ 4 on C2." (F12 §4.2, §4.3; product spec §4 Tier C.)
 *
 * What this actually proves, honestly: that `checkAdversarialValidation` catches a forgiving
 * judge when one occurs, against fixture judge responses — not that a real LLM judge would
 * behave correctly on live seeded-error text. That claim needs F11's real synthesiser output
 * and a real judge model call; see the lane report's DEFERRED field.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCorpusFromDir } from '../../src/services/eval/corpus';
import { loadSeededErrorsFromDir } from '../../src/services/eval/seeded-errors';
import {
  createFixtureJudgeClient,
  loadJudgeResponseMap,
  mergeJudgeResponseMaps,
} from '../../src/services/eval/fixture-judge-client';
import { buildJudgeInput, checkAdversarialValidation, runJudge } from '../../src/services/eval/judge';
import type { JudgeModelClient } from '../../src/services/eval/judge';

const CORPUS_DIR = join(__dirname, '../../fixtures/eval/corpus');
const SEEDED_DIR = join(__dirname, '../../fixtures/eval/seeded-errors');
const JUDGE_DIR = join(__dirname, '../../fixtures/eval/judge-responses');

async function scoreSeededErrors(client: JudgeModelClient) {
  const seeded = loadSeededErrorsFromDir(SEEDED_DIR);
  const packs = new Map(loadCorpusFromDir(CORPUS_DIR).map((p) => [p.id, p]));

  const scored = [];
  for (const answer of seeded) {
    const pack = packs.get(answer.packId);
    if (pack === undefined) {
      throw new Error(`test fixture inconsistency: seeded answer ${answer.id} references unknown pack ${answer.packId}`);
    }
    const input = buildJudgeInput({
      answerText: answer.answer,
      items: pack.pack.items,
      storedMetrics: pack.storedMetrics,
    });
    const response = await runJudge(client, input);
    scored.push({ answerId: answer.id, faultClass: answer.faultClass, response });
  }
  return scored;
}

describe('judge adversarial validation', () => {
  it('passes: no seeded-error answer scores >= 4 on C2 when the judge behaves correctly', async () => {
    const responses = loadJudgeResponseMap(join(JUDGE_DIR, 'seeded-errors.json'));
    const client = createFixtureJudgeClient(responses);

    const scored = await scoreSeededErrors(client);
    expect(scored.length).toBeGreaterThan(0);

    const verdict = checkAdversarialValidation(scored);
    expect(verdict.passed).toBe(true);
    expect(verdict.offenders).toEqual([]);
  });

  it('catches a forgiving judge — a judge scoring a seeded-error answer >= 4 on C2 is itself a defect and fails the harness', async () => {
    const correct = loadJudgeResponseMap(join(JUDGE_DIR, 'seeded-errors.json'));
    const forgiving = loadJudgeResponseMap(join(JUDGE_DIR, 'seeded-errors-adversarial-failure.json'));
    // The forgiving fixture overrides exactly one answer's response; everything else stays correct.
    const responses = mergeJudgeResponseMaps(correct, forgiving);
    const client = createFixtureJudgeClient(responses);

    const scored = await scoreSeededErrors(client);
    const verdict = checkAdversarialValidation(scored);

    expect(verdict.passed).toBe(false);
    expect(verdict.offenders).toHaveLength(1);
    expect(verdict.offenders[0]!.c2).toBeGreaterThanOrEqual(4);
  });
});
