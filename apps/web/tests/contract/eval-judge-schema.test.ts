import { describe, expect, it } from 'vitest';
import { judgeEvidenceItem, judgeInput, judgeResponse } from '../../src/services/eval/contracts';

const VALID_EVIDENCE = {
  id: '11111111-1111-1111-1111-111111111111',
  text: 'item text',
  publishedAt: new Date('2026-08-01T00:00:00.000Z'),
  availableAt: new Date('2026-08-01T00:00:00.000Z'),
};

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

describe('judgeEvidenceItem schema', () => {
  it('accepts a well-formed evidence item, including a null publishedAt', () => {
    expect(judgeEvidenceItem.safeParse(VALID_EVIDENCE).success).toBe(true);
    expect(judgeEvidenceItem.safeParse({ ...VALID_EVIDENCE, publishedAt: null }).success).toBe(true);
  });

  it('rejects a missing id — the judge needs it to detect a fabricated or unrelated citation', () => {
    const { id: _id, ...withoutId } = VALID_EVIDENCE;
    expect(judgeEvidenceItem.safeParse(withoutId).success).toBe(false);
  });

  it('requires a non-null availableAt — the judge needs it to detect a stale-date claim', () => {
    expect(judgeEvidenceItem.safeParse({ ...VALID_EVIDENCE, availableAt: null }).success).toBe(false);
  });
});

describe('judgeInput schema', () => {
  it('accepts a well-formed input with no stored metrics', () => {
    expect(
      judgeInput.safeParse({ answerText: 'answer', evidence: [VALID_EVIDENCE], storedMetrics: [] }).success,
    ).toBe(true);
  });

  it('rejects an empty answerText', () => {
    expect(
      judgeInput.safeParse({ answerText: '', evidence: [VALID_EVIDENCE], storedMetrics: [] }).success,
    ).toBe(false);
  });

  it('accepts an empty evidence array (a thin-evidence pack may carry none)', () => {
    expect(judgeInput.safeParse({ answerText: 'answer', evidence: [], storedMetrics: [] }).success).toBe(true);
  });
});
