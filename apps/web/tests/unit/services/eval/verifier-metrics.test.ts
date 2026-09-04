import { describe, expect, it } from 'vitest';
import { aggregateVerifierMeasurement, b7Passes, b8Passes, type SeededAnswerVerdict } from '@/services/eval/verifier-metrics';

function verdict(input: {
  answerId: string;
  faultClass: string;
  faultyClaimId: string;
  faultyCaught: boolean;
  cleanClaimIds: readonly string[];
  cleanCaught: readonly string[];
}): SeededAnswerVerdict {
  return {
    answerId: input.answerId,
    faultClass: input.faultClass as SeededAnswerVerdict['faultClass'],
    faultyClaimId: input.faultyClaimId,
    cleanClaimIds: input.cleanClaimIds,
    claims: [
      { claimId: input.faultyClaimId, caughtByDeterministic: input.faultyCaught, caughtByModel: false },
      ...input.cleanClaimIds.map((id) => ({ claimId: id, caughtByDeterministic: input.cleanCaught.includes(id), caughtByModel: false })),
    ],
  };
}

describe('aggregateVerifierMeasurement', () => {
  it('a perfect verifier over a small corpus scores catchRate=1, falsePositiveRate=0', () => {
    const verdicts = [
      verdict({ answerId: 'a', faultClass: 'wrong_number', faultyClaimId: 'f1', faultyCaught: true, cleanClaimIds: ['c1', 'c2'], cleanCaught: [] }),
      verdict({ answerId: 'b', faultClass: 'wrong_number', faultyClaimId: 'f2', faultyCaught: true, cleanClaimIds: ['c3'], cleanCaught: [] }),
    ];
    const m = aggregateVerifierMeasurement(verdicts, true);
    expect(m.catchRate).toBe('1.0000');
    expect(m.falsePositiveRate).toBe('0.0000');
    expect(b7Passes(m)).toBe(true);
    expect(b8Passes(m)).toBe(true);
  });

  it('a verifier that misses every faulty claim scores catchRate=0', () => {
    const verdicts = [verdict({ answerId: 'a', faultClass: 'wrong_number', faultyClaimId: 'f1', faultyCaught: false, cleanClaimIds: [], cleanCaught: [] })];
    const m = aggregateVerifierMeasurement(verdicts, true);
    expect(m.catchRate).toBe('0.0000');
    expect(b7Passes(m)).toBe(false);
  });

  it('a verifier that flags every clean claim scores falsePositiveRate=1 and fails B8', () => {
    const verdicts = [
      verdict({ answerId: 'a', faultClass: 'wrong_number', faultyClaimId: 'f1', faultyCaught: true, cleanClaimIds: ['c1', 'c2'], cleanCaught: ['c1', 'c2'] }),
    ];
    const m = aggregateVerifierMeasurement(verdicts, true);
    expect(m.falsePositiveRate).toBe('1.0000');
    expect(b8Passes(m)).toBe(false);
  });

  it('breaks catch counts down per fault class', () => {
    const verdicts = [
      verdict({ answerId: 'a', faultClass: 'wrong_number', faultyClaimId: 'f1', faultyCaught: true, cleanClaimIds: [], cleanCaught: [] }),
      verdict({ answerId: 'b', faultClass: 'stale_date', faultyClaimId: 'f2', faultyCaught: false, cleanClaimIds: [], cleanCaught: [] }),
    ];
    const m = aggregateVerifierMeasurement(verdicts, true);
    expect(m.byFaultClass['wrong_number']).toEqual({ total: 1, caught: 1 });
    expect(m.byFaultClass['stale_date']).toEqual({ total: 1, caught: 0 });
  });

  it('an empty verdict list scores both rates 0, not NaN or a divide-by-zero', () => {
    const m = aggregateVerifierMeasurement([], false);
    expect(m.catchRate).toBe('0');
    expect(m.falsePositiveRate).toBe('0');
  });

  it('the B7/B8 gate thresholds are exact — 0.90 passes, just under fails; 0.10 passes, just over fails', () => {
    const base = { totalFaulty: 100, totalClean: 100, byFaultClass: {}, modelVerificationRan: true };
    expect(b7Passes({ ...base, catchRate: '0.9000', falsePositiveRate: '0', caughtFaulty: 90, caughtClean: 0 })).toBe(true);
    expect(b7Passes({ ...base, catchRate: '0.8999', falsePositiveRate: '0', caughtFaulty: 89, caughtClean: 0 })).toBe(false);
    expect(b8Passes({ ...base, catchRate: '1', falsePositiveRate: '0.1000', caughtFaulty: 100, caughtClean: 10 })).toBe(true);
    expect(b8Passes({ ...base, catchRate: '1', falsePositiveRate: '0.1001', caughtFaulty: 100, caughtClean: 10 })).toBe(false);
  });
});
