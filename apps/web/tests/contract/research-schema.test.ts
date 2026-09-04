import { describe, expect, it } from 'vitest';
import { synthesisOutput, modelVerifyOutput, followupQuestionsOutput } from '@/services/research/schema';
import { researchRun, researchEvent, claimLedgerEntry } from '@/contracts/research';

/**
 * F11 §5's contract level: "synthesis and verifier response schemas; streaming event schema."
 * `state-machine.test.ts`/`verify.test.ts` exercise these shapes through real code paths;
 * this file pins the schemas' own accept/reject boundary directly, independent of any caller.
 */
describe('synthesisOutput schema', () => {
  const valid = {
    summary: 'A summary.',
    statedFreshness: '2026-08-31T00:00:00.000Z',
    themes: [
      {
        title: 'Theme',
        singleSource: false,
        claims: [
          {
            claimId: 'c1',
            text: 'A claim.',
            kind: 'fact',
            evidenceIds: ['00000000-0000-4000-8000-000000000001'],
            metricIds: [],
            relatedTickers: ['AAPL'],
            assertedDate: null,
          },
        ],
      },
    ],
    bullishCase: [],
    bearishCase: [],
    whatChanged: [],
    whatToMonitor: [],
  };

  it('accepts a well-formed synthesis response', () => {
    expect(synthesisOutput.safeParse(valid).success).toBe(true);
  });

  it('rejects more than three themes', () => {
    const tooMany = { ...valid, themes: [valid.themes[0], valid.themes[0], valid.themes[0], valid.themes[0]] };
    expect(synthesisOutput.safeParse(tooMany).success).toBe(false);
  });

  it('rejects an unknown extra field (strict schema — never silently padded)', () => {
    expect(synthesisOutput.safeParse({ ...valid, recommendation: 'buy' }).success).toBe(false);
  });

  it('rejects a claim missing evidenceIds/metricIds arrays entirely', () => {
    const broken = { ...valid, whatChanged: [{ claimId: 'c2', text: 'x', kind: 'fact', relatedTickers: [], assertedDate: null }] };
    expect(synthesisOutput.safeParse(broken).success).toBe(false);
  });
});

describe('modelVerifyOutput schema', () => {
  it('accepts a well-formed verify response', () => {
    const valid = { results: [{ claimId: 'c1', verdict: 'supported', reason: 'matches' }] };
    expect(modelVerifyOutput.safeParse(valid).success).toBe(true);
  });

  it('rejects an unknown verdict value', () => {
    const invalid = { results: [{ claimId: 'c1', verdict: 'probably', reason: 'x' }] };
    expect(modelVerifyOutput.safeParse(invalid).success).toBe(false);
  });
});

describe('followupQuestionsOutput schema', () => {
  it('rejects more than five questions', () => {
    const questions = Array.from({ length: 6 }, (_, i) => ({ id: `q${String(i)}`, text: 'x' }));
    expect(followupQuestionsOutput.safeParse({ questions }).success).toBe(false);
  });
});

describe('research contracts (already-merged contracts/research.ts) — streaming event and run shapes', () => {
  it('researchEvent accepts the shape state-machine.ts#EmitFn produces', () => {
    const event = { runId: '00000000-0000-4000-8000-000000000001', sequence: 1, eventType: 'state', label: 'gathering', payload: {}, createdAt: new Date() };
    expect(researchEvent.safeParse(event).success).toBe(true);
  });

  it('a retracted researchRun without reason/actor/time is rejected by the schema itself (R-18)', () => {
    const run = {
      id: '00000000-0000-4000-8000-000000000001',
      userId: 'u1',
      securityId: null,
      question: 'q',
      status: 'retracted',
      coverageStatus: 'unknown',
      inputCutoff: new Date(),
      startedAt: new Date(),
      completedAt: null,
      promptVersion: 'synthesis-v1',
      modelRoute: {},
      toolManifest: {},
      costUsd: '0',
      result: null,
      error: null,
      retractedReason: null,
      retractedBy: null,
      retractedAt: null,
    };
    expect(researchRun.safeParse(run).success).toBe(false);
  });

  it('claimLedgerEntry rejects a material fact claim with neither evidenceIds nor metricIds', () => {
    const claim = {
      id: '00000000-0000-4000-8000-000000000001',
      runId: '00000000-0000-4000-8000-000000000002',
      claimText: 'x',
      claimType: 'fact',
      materiality: 'material',
      evidenceIds: [],
      metricIds: [],
      verificationStatus: 'verified',
      verifierNotes: null,
    };
    expect(claimLedgerEntry.safeParse(claim).success).toBe(false);
  });
});
