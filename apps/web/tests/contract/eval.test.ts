/**
 * F12 §5, "Contract": "judge response schema; corpus format validation." Contract tests validate
 * shape, not behaviour — mirrors `tests/contract/score-result.test.ts`'s own scope.
 */
import { describe, expect, it } from 'vitest';
import { judgeOutput, evalCorpusPackMeta, seededErrorFile } from '@/services/eval/schema';
import { evalRun, evalResult, evalCalibrationScore } from '@/contracts/eval';

describe('judgeOutput schema (F12 §4.3)', () => {
  const valid = { c1: 4, c2: 5, c3: 3, c4: 4, violations: [] as string[], rationale: 'Reads well and stays grounded.' };

  it('accepts a well-formed judge response', () => {
    expect(judgeOutput.safeParse(valid).success).toBe(true);
  });

  it('rejects a score outside 1..5', () => {
    expect(judgeOutput.safeParse({ ...valid, c2: 0 }).success).toBe(false);
    expect(judgeOutput.safeParse({ ...valid, c2: 6 }).success).toBe(false);
  });

  it('rejects a non-integer score', () => {
    expect(judgeOutput.safeParse({ ...valid, c1: 4.5 }).success).toBe(false);
  });

  it('rejects a missing rationale', () => {
    const { rationale: _rationale, ...withoutRationale } = valid;
    expect(judgeOutput.safeParse(withoutRationale).success).toBe(false);
  });

  it('rejects an extra, unexpected field — strict, mirrors synthesisOutput\'s own discipline', () => {
    expect(judgeOutput.safeParse({ ...valid, confidence: 0.9 }).success).toBe(false);
  });
});

describe('eval contracts (F03 DoD item 9 shape, F12 §3 "Produces")', () => {
  it('evalRun round-trips a valid corpus-kind run', () => {
    const parsed = evalRun.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'corpus',
      corpusVersion: 'v1',
      modelIds: { judge: 'google/gemini-3-pro' },
      startedAt: new Date().toISOString(),
      completedAt: null,
      summary: null,
      gatePassed: null,
      createdAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });

  it('evalResult requires a well-formed kind and rejects an unknown one', () => {
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      evalRunId: '22222222-2222-4222-8222-222222222222',
      packId: 'clear-01',
      answerId: 'clear-01',
      kind: 'gold',
      faultClass: null,
      judgeC1: 5,
      judgeC2: 5,
      judgeC3: 5,
      judgeC4: 4,
      judgeViolations: [],
      judgeRationale: 'x',
      verifierOutcome: null,
      createdAt: new Date().toISOString(),
    };
    expect(evalResult.safeParse(base).success).toBe(true);
    expect(evalResult.safeParse({ ...base, kind: 'not_a_kind' }).success).toBe(false);
    expect(evalResult.safeParse({ ...base, faultClass: 'not_a_fault_class' }).success).toBe(false);
  });

  it('evalCalibrationScore requires all four human scores in range', () => {
    const valid = {
      id: '11111111-1111-4111-8111-111111111111',
      evalRunId: '22222222-2222-4222-8222-222222222222',
      answerId: 'wrong_number-01',
      humanC1: 3,
      humanC2: 4,
      humanC3: 5,
      humanC4: 2,
      scoredBy: 'owner',
      createdAt: new Date().toISOString(),
    };
    expect(evalCalibrationScore.safeParse(valid).success).toBe(true);
    expect(evalCalibrationScore.safeParse({ ...valid, humanC2: 6 }).success).toBe(false);
  });
});

describe('corpus format validation', () => {
  it('evalCorpusPackMeta rejects an unknown bucket', () => {
    expect(
      evalCorpusPackMeta.safeParse({
        id: 'x',
        bucket: 'not_a_bucket',
        labelSource: 'llm_assisted_pending_human_audit',
        subjectSymbol: 'AAPL',
        metrics: [],
        labels: { perItem: [], expectedDirection: 'bullish', expectedAbstain: false, requiredAbstentions: [] },
        goldOutput: { summary: 's', statedFreshness: '2026-08-01', themes: [], bullishCase: [], bearishCase: [], whatChanged: [], whatToMonitor: [] },
      }).success,
    ).toBe(false);
  });

  it('evalCorpusPackMeta rejects a labelSource other than the disclosed literal (D-35)', () => {
    expect(
      evalCorpusPackMeta.safeParse({
        id: 'x',
        bucket: 'clear_stance',
        labelSource: 'human_labelled',
        subjectSymbol: 'AAPL',
        metrics: [],
        labels: { perItem: [], expectedDirection: 'bullish', expectedAbstain: false, requiredAbstentions: [] },
        goldOutput: { summary: 's', statedFreshness: '2026-08-01', themes: [{ title: 't', claims: [{ claimId: 'c', text: 't', kind: 'fact', evidenceIds: [], metricIds: [], relatedTickers: ['AAPL'], assertedDate: null }], singleSource: true }], bullishCase: [], bearishCase: [], whatChanged: [], whatToMonitor: [] },
      }).success,
    ).toBe(false);
  });

  it('seededErrorFile requires a real faultClass from the nine named classes', () => {
    expect(
      seededErrorFile.safeParse({
        meta: { id: 'x', packId: 'p', faultClass: 'made_up_fault', faultyClaimId: 'c1', cleanClaimIds: [], deterministicallyCatchable: true },
        output: { summary: 's', statedFreshness: '2026-08-01', themes: [], bullishCase: [], bearishCase: [], whatChanged: [], whatToMonitor: [] },
      }).success,
    ).toBe(false);
  });
});
