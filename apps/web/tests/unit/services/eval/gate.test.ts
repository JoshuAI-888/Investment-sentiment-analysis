import { describe, expect, it } from 'vitest';
import { evaluateTierCGate, evaluateJudgeAdversarialValidation, TIER_C_MEAN_GATE, TIER_C_C2_FLOOR } from '@/services/eval/gate';

function perfectAnswer(id: string) {
  return { answerId: id, scores: { c1: 5, c2: 5, c3: 5, c4: 5, violations: [] as string[] } };
}

describe('evaluateTierCGate', () => {
  it('passes a corpus that clears the mean, the C2 floor, and has zero Tier-B violations', () => {
    const result = evaluateTierCGate([perfectAnswer('a'), perfectAnswer('b')]);
    expect(result.ok).toBe(true);
    expect(result.corpusMean).toBe('5.0000');
    expect(result.reasons).toEqual([]);
  });

  it('fails on mean alone when every answer is mediocre', () => {
    const mediocre = { answerId: 'a', scores: { c1: 3, c2: 3, c3: 3, c4: 3, violations: [] as string[] } };
    const result = evaluateTierCGate([mediocre]);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('mean'))).toBe(true);
  });

  it('the C2 floor is a hard gate, never averaged away — a corpus with a strong mean still fails if one answer is below 3 on C2', () => {
    // 9 perfect answers (mean contribution 5.0) plus one answer with C2=2, everything else 5 —
    // the corpus mean stays comfortably ≥ 4.0, and the gate must still fail.
    const answers = [
      ...Array.from({ length: 9 }, (_, i) => perfectAnswer(`good-${String(i)}`)),
      { answerId: 'bad', scores: { c1: 5, c2: 2, c3: 5, c4: 5, violations: [] as string[] } },
    ];
    const result = evaluateTierCGate(answers);

    expect(Number(result.corpusMean)).toBeGreaterThanOrEqual(Number(TIER_C_MEAN_GATE));
    expect(result.ok).toBe(false);
    expect(result.c2Floor.ok).toBe(false);
    expect(result.c2Floor.failing).toEqual([{ answerId: 'bad', c2: 2 }]);
    expect(result.reasons.some((r) => r.includes('C2'))).toBe(true);
  });

  it(`a C2 exactly at the floor (${String(TIER_C_C2_FLOOR)}) passes; one below it fails`, () => {
    const atFloor = evaluateTierCGate([{ answerId: 'a', scores: { c1: 5, c2: TIER_C_C2_FLOOR, c3: 5, c4: 5, violations: [] } }]);
    expect(atFloor.c2Floor.ok).toBe(true);

    const belowFloor = evaluateTierCGate([{ answerId: 'a', scores: { c1: 5, c2: TIER_C_C2_FLOOR - 1, c3: 5, c4: 5, violations: [] } }]);
    expect(belowFloor.c2Floor.ok).toBe(false);
  });

  it('a judge-reported violation fails the gate even with a perfect mean and C2', () => {
    const result = evaluateTierCGate([
      { answerId: 'a', scores: { c1: 5, c2: 5, c3: 5, c4: 5, violations: ['recommendation language found'] } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.tierBViolations).toHaveLength(1);
  });

  it('an externally-supplied Tier-B violation (a deterministic check failure) also fails the gate', () => {
    const result = evaluateTierCGate([perfectAnswer('a')], [{ answerId: 'a', source: 'deterministic_check', detail: 'numeric mismatch' }]);
    expect(result.ok).toBe(false);
    expect(result.tierBViolations).toHaveLength(1);
  });

  it('an empty corpus never passes', () => {
    const result = evaluateTierCGate([]);
    expect(result.ok).toBe(false);
  });
});

describe('evaluateJudgeAdversarialValidation', () => {
  it('passes when every seeded-error answer scores below 4 on C2', () => {
    const result = evaluateJudgeAdversarialValidation([
      { answerId: 'a', faultClass: 'wrong_number', c2: 2 },
      { answerId: 'b', faultClass: 'stale_date', c2: 3 },
    ]);
    expect(result.ok).toBe(true);
  });

  it('fails — and names the offending answer — when a seeded-error answer scores ≥ 4 on C2', () => {
    const result = evaluateJudgeAdversarialValidation([
      { answerId: 'a', faultClass: 'wrong_number', c2: 4 },
      { answerId: 'b', faultClass: 'stale_date', c2: 3 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.failing.map((f) => f.answerId)).toEqual(['a']);
  });
});
