import { describe, expect, it } from 'vitest';
import { checkAdversarialValidation, runJudge, type JudgeModelClient } from '../../../../src/services/eval/judge';
import type { JudgeInput, JudgeResponse } from '../../../../src/services/eval/contracts';

const INPUT: JudgeInput = {
  answerText: 'NVDA sentiment is bullish this window (shrunk score 0.62, n=5).',
  evidence: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      text: 'NVDA earnings beat again — datacenter revenue keeps climbing',
      publishedAt: new Date('2026-08-01T00:00:00.000Z'),
      availableAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  ],
  storedMetrics: [{ metricId: 'sentiment.reddit.shrunkScore', display: '0.62' }],
};

describe('runJudge', () => {
  it('returns a validated response on a well-formed judge reply', async () => {
    const client: JudgeModelClient = {
      async judge() {
        return { c1: 5, c2: 5, c3: 5, c4: 4, violations: [], rationale: 'grounded' };
      },
    };
    const result = await runJudge(client, INPUT);
    expect(result.c2).toBe(5);
  });

  it('throws rather than silently coercing a malformed judge response — a contract failure is not a score', async () => {
    const client: JudgeModelClient = {
      async judge() {
        return { c1: 5, c2: 'five', c3: 5, c4: 5, violations: [], rationale: 'grounded' };
      },
    };
    await expect(runJudge(client, INPUT)).rejects.toThrow(/schema/);
  });

  it('rejects a score outside the 1-5 range', async () => {
    const client: JudgeModelClient = {
      async judge() {
        return { c1: 5, c2: 6, c3: 5, c4: 5, violations: [], rationale: 'grounded' };
      },
    };
    await expect(runJudge(client, INPUT)).rejects.toThrow();
  });
});

function scored(answerId: string, faultClass: string, c2: number): {
  answerId: string;
  faultClass: string;
  response: JudgeResponse;
} {
  return {
    answerId,
    faultClass,
    response: { c1: 2, c2, c3: 2, c4: 2, violations: ['found a fault'], rationale: 'not grounded' },
  };
}

describe('checkAdversarialValidation', () => {
  it('passes when every seeded-error answer scores below the C2 ceiling', () => {
    const verdict = checkAdversarialValidation([
      scored('se-01', 'wrong_number', 1),
      scored('se-02', 'swapped_ticker', 2),
      scored('se-03', 'buy_recommendation', 3),
    ]);
    expect(verdict.passed).toBe(true);
    expect(verdict.offenders).toEqual([]);
  });

  it('fails — the harness catching its own defect-detection gap — when a judge scores a seeded-error answer >= 4 on C2', () => {
    const verdict = checkAdversarialValidation([
      scored('se-01', 'wrong_number', 1),
      scored('se-04', 'buy_recommendation', 5), // the judge was fooled by fluent prose
    ]);
    expect(verdict.passed).toBe(false);
    expect(verdict.offenders).toEqual([{ answerId: 'se-04', faultClass: 'buy_recommendation', c2: 5 }]);
  });
});
