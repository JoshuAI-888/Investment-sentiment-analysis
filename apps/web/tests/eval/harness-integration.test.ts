/**
 * F12 §5 test plan, Integration row: "full harness against the frozen corpus; a
 * deliberately-broken answer fails the gate; verifier metrics computed from the seeded set."
 *
 * This is the suite `pnpm test:eval` runs (F12 §4.6 / DoD item 8). It exercises the harness
 * machinery end to end against the committed starter corpus and a fixture judge client — never
 * a live model call (`PROVIDER_MODE=fixture`, `04-BUILD-LOOP.md` §2.3).
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCorpusFromDir } from '../../src/services/eval/corpus';
import { loadSeededErrorsFromDir } from '../../src/services/eval/seeded-errors';
import { createFixtureJudgeClient, loadJudgeResponseMap } from '../../src/services/eval/fixture-judge-client';
import { buildJudgeInput, runJudge } from '../../src/services/eval/judge';
import { evaluateTierCGate, type CorpusJudgeResult } from '../../src/services/eval/gate';
import { measureVerifier, type Verifier } from '../../src/services/eval/verifier-harness';
import { formatEvalReport, runEvalHarness } from '../../src/services/eval/run';

const CORPUS_DIR = join(__dirname, '../../fixtures/eval/corpus');
const SEEDED_DIR = join(__dirname, '../../fixtures/eval/seeded-errors');
const JUDGE_DIR = join(__dirname, '../../fixtures/eval/judge-responses');

async function judgeCorpus(): Promise<CorpusJudgeResult[]> {
  const packs = loadCorpusFromDir(CORPUS_DIR);
  const responses = loadJudgeResponseMap(join(JUDGE_DIR, 'corpus.json'));
  const client = createFixtureJudgeClient(responses);

  const judged: CorpusJudgeResult[] = [];
  for (const pack of packs) {
    const input = buildJudgeInput({
      answerText: pack.referenceAnswer,
      items: pack.pack.items,
      storedMetrics: pack.storedMetrics,
    });
    const response = await runJudge(client, input);
    judged.push({ packId: pack.id, response });
  }
  return judged;
}

describe('F12 eval harness — integration against the frozen starter corpus', () => {
  it('the Tier C gate passes when every reference answer is well-judged', async () => {
    const judged = await judgeCorpus();
    const verdict = evaluateTierCGate(judged, 0);
    expect(verdict.passed).toBe(true);
    expect(Number(verdict.overallMean)).toBeGreaterThanOrEqual(4.0);
    expect(verdict.c2Failures).toEqual([]);
    expect(verdict.tierBViolationCount).toBe(0);
  });

  it('a deliberately-broken answer fails the gate', async () => {
    const judged = await judgeCorpus();
    const [first, ...rest] = judged;
    const broken: CorpusJudgeResult[] = [
      { packId: first!.packId, response: { ...first!.response, c2: 2 } },
      ...rest,
    ];
    const verdict = evaluateTierCGate(broken, 0);
    expect(verdict.passed).toBe(false);
    expect(verdict.c2Failures).toEqual([first!.packId]);
    expect(verdict.reasons.some((r) => r.includes('defect'))).toBe(true);
  });

  it('verifier metrics (B7/B8) are computed from the seeded-error corpus, with B8 deduped by distinct base answer', () => {
    const seeded = loadSeededErrorsFromDir(SEEDED_DIR);
    // A small stand-in for a subset of F11's real deterministic checks
    // (`05-TEST-STRATEGY.md` §6) — not F11's actual verifier, which this lane does not own and
    // which is not merged. See the lane report's DEFERRED field.
    const verify: Verifier = (answerText) => {
      const reasons: string[] = [];
      if (/you should buy|price target/i.test(answerText)) reasons.push('banned recommendation/price-target language');
      if (/shrunk score 0\.91|shrunk score 0\.45/.test(answerText)) reasons.push('numeric token does not match a stored metric');
      if (/as of 2026-08-25/.test(answerText)) reasons.push('freshness claim postdates every cited item\'s availableAt');
      return { flagged: reasons.length > 0, reasons };
    };
    const measurement = measureVerifier(seeded, verify);
    const distinctBaseAnswers = new Set(seeded.map((s) => s.baseAnswer)).size;
    expect(measurement.seededCount).toBe(seeded.length);
    expect(measurement.goodCount).toBe(distinctBaseAnswers);
    expect(measurement.goodCount).toBeLessThan(measurement.seededCount); // several fixtures share a base answer
    // This toy verifier only catches a subset of the nine fault classes by design (it is not
    // F11's real checks) — the assertion is only that the arithmetic runs end to end.
    expect(Number(measurement.catchRate)).toBeGreaterThan(0);
    expect(Number(measurement.falsePositiveRate)).toBe(0);
  });

  it('runEvalHarness assembles a full run record and formatEvalReport prints a per-axis table and the Tier B/C/D1 verdicts', async () => {
    const judged = await judgeCorpus();
    const packs = loadCorpusFromDir(CORPUS_DIR);
    const record = runEvalHarness({
      runId: 'starter-corpus-test-run',
      runAt: new Date('2026-09-04T00:00:00.000Z'),
      corpusVersion: 'starter-corpus-v1',
      modelRoute: { judgeModelId: 'fixture-judge', judgeModelVersion: 'test-fixture', temperature: 0 },
      judged,
      tierBViolationCount: 0,
      calibration: { status: 'pending', reason: 'MT-11 hand-scoring has not run yet (non-blocking).' },
      corpusPacks: packs,
    });

    expect(record.tierC.passed).toBe(true);
    expect(record.stanceD1).not.toBeNull();

    const report = formatEvalReport(record);
    expect(report).toContain('Tier C gate: PASS');
    expect(report).toContain('C1');
    expect(report).toContain('C2');
    expect(report).toContain('C3');
    expect(report).toContain('C4');
    expect(report).toContain('Tier D1 stance macro-F1');
    expect(report).toContain('Calibration (MT-11): pending');
    // F12 §4.6: the harness prints the table on every run.
    console.log(report);
  });
});
