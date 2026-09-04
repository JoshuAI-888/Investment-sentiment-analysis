import { describe, expect, it } from 'vitest';
import { synthesisOutput } from '../../src/services/research/synthesis';
import { modelVerificationVerdict } from '../../src/services/research/verifier/model-pass';
import { streamEvent, streamEventDetail } from '../../src/services/research/stream-events';

const EVIDENCE_ID = '11111111-1111-1111-1111-111111111111';

function claim(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    text: 'Mentions rose.',
    kind: 'fact',
    evidenceIds: [EVIDENCE_ID],
    metricIds: [],
    assertsStanceForAxis: null,
    ...overrides,
  };
}

describe('synthesisOutput — the frozen shape a real model response must satisfy', () => {
  const WELL_FORMED = {
    summary: [claim()],
    themes: [{ title: 't', claims: [claim()], singleSource: true }],
    bullishCase: [claim()],
    bearishCase: [claim()],
    whatChanged: [claim()],
    whatToMonitor: [claim()],
    statedFreshnessAsOf: '2026-08-25T00:00:00.000Z',
  };

  it('round-trips a well-formed response', () => {
    const result = synthesisOutput.safeParse(WELL_FORMED);
    expect(result.success).toBe(true);
  });

  it('rejects a response missing the required statedFreshnessAsOf field', () => {
    const { statedFreshnessAsOf: _omitted, ...withoutFreshness } = WELL_FORMED;
    expect(synthesisOutput.safeParse(withoutFreshness).success).toBe(false);
  });

  it('rejects a claim with a malformed evidence id (not a uuid)', () => {
    const malformed = { ...WELL_FORMED, summary: [claim({ evidenceIds: ['not-a-uuid'] })] };
    expect(synthesisOutput.safeParse(malformed).success).toBe(false);
  });
});

describe('modelVerificationVerdict — the frozen shape the bounded model pass must return', () => {
  it('accepts a well-formed verdict list', () => {
    expect(
      modelVerificationVerdict.safeParse({ verdicts: [{ claimIndex: 0, supported: true, rationale: 'r' }] }).success,
    ).toBe(true);
  });

  it('rejects a verdict missing a rationale', () => {
    expect(modelVerificationVerdict.safeParse({ verdicts: [{ claimIndex: 0, supported: true }] }).success).toBe(false);
  });
});

describe('streamEventDetail — the wire shape, closed to anything provider- or prompt-shaped', () => {
  it('accepts every documented event kind', () => {
    const cases = [
      { kind: 'stage', stage: 'gathering' },
      { kind: 'evidence_gathered', retrievedCount: 1, usedCount: 1 },
      { kind: 'metric', metricId: 'm', displayValue: '+1', unit: 'rank' },
      { kind: 'budget_overrun', stage: 'fan_out', budgetMs: 8000 },
      { kind: 'claim', section: 'summary', text: 't' },
      { kind: 'outcome', status: 'complete', reason: null },
    ];
    for (const detail of cases) {
      expect(streamEventDetail.safeParse(detail).success).toBe(true);
    }
  });

  it('rejects an unknown event kind — the closed vocabulary is the enforcement', () => {
    expect(streamEventDetail.safeParse({ kind: 'raw_model_token', text: 'leaked' }).success).toBe(false);
  });

  it('round-trips a full streamEvent envelope', () => {
    const event = {
      runId: '11111111-1111-1111-1111-111111111111',
      sequence: 0,
      createdAt: '2026-08-25T00:00:00.000Z',
      detail: { kind: 'stage', stage: 'queued' },
    };
    expect(streamEvent.safeParse(event).success).toBe(true);
  });
});
