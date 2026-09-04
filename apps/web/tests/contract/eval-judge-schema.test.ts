import { describe, expect, it } from 'vitest';
import { judgeInput, judgeResponse } from '../../src/services/eval/contracts';

const VALID_RESPONSE = { c1: 5, c2: 4, c3: 5, c4: 3, violations: [], rationale: 'grounded in the cited evidence' };

describe('judgeResponse schema', () => {
  it('accepts a well-formed response', () => {
    expect(judgeResponse.safeParse(VALID_RESPONSE).success).toBe(true);
  });

  it('rejects a score of 0 (below the 1-5 range)', () => {
    expect(judgeResponse.safeParse({ ...VALID_RESPONSE, c2: 0 }).success).toBe(false);
  });

  it('rejects a score of 6 (above the 1-5 range)', () => {
    expect(judgeResponse.safeParse({ ...VALID_RESPONSE, c2: 6 }).success).toBe(false);
  });

  it('rejects a non-integer score', () => {
    expect(judgeResponse.safeParse({ ...VALID_RESPONSE, c2: 3.5 }).success).toBe(false);
  });

  it('rejects a response missing rationale', () => {
    const { rationale: _rationale, ...withoutRationale } = VALID_RESPONSE;
    expect(judgeResponse.safeParse(withoutRationale).success).toBe(false);
  });

  it('rejects a response whose violations is not an array of strings', () => {
    expect(judgeResponse.safeParse({ ...VALID_RESPONSE, violations: 'none' }).success).toBe(false);
  });
});

describe('judgeInput schema', () => {
  it('accepts a well-formed input with no stored metrics', () => {
    expect(
      judgeInput.safeParse({ answerText: 'answer', evidenceText: ['item text'], storedMetrics: [] }).success,
    ).toBe(true);
  });

  it('rejects an empty answerText', () => {
    expect(
      judgeInput.safeParse({ answerText: '', evidenceText: ['item text'], storedMetrics: [] }).success,
    ).toBe(false);
  });
});
