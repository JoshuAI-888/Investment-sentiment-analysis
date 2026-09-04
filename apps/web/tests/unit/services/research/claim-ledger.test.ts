import { describe, expect, it } from 'vitest';
import { buildClaimLedger, validateLedgerShape } from '../../../../src/services/research/claim-ledger';
import type { VerifierContext } from '../../../../src/services/research/verifier/checks';
import type { FlatClaim } from '../../../../src/services/research/synthesis';
import type { EvidencePack } from '../../../../src/contracts/evidence-pack';

const EVIDENCE_ID = '11111111-1111-1111-1111-111111111111';
const RUN_ID = '33333333-3333-3333-3333-333333333333';

function pack(): EvidencePack {
  return {
    id: 'pack-1',
    securityId: 'sec-1',
    retrievalQuery: 'q',
    retrievalWindow: { from: new Date('2026-08-20T00:00:00Z'), to: new Date('2026-08-27T00:00:00Z') },
    items: [
      {
        item: {
          id: EVIDENCE_ID,
          securityId: 'sec-1',
          evidenceType: 'social_result',
          provider: 'reddit',
          title: 'NVDA thread',
          snippet: 'body',
          sourceUrl: null,
          publisher: null,
          authorRef: null,
          stanceLabel: 'bullish',
          stanceScore: '0.8',
          relevanceScore: '0.9',
          publishedAt: new Date('2026-08-25T00:00:00Z'),
          availableAt: new Date('2026-08-25T00:00:00Z'),
          ingestedAt: new Date('2026-08-26T00:00:00Z'),
          lastCheckedAt: null,
          availability: 'available',
          licenseClass: 'standard',
          coverageClass: 'sampled',
          rawHash: 'a'.repeat(64),
          metadata: {},
        },
        axis: 'reddit',
        relevant: true,
        relevanceMethodVersion: 'relevance.filter@1',
        stanceConfidence: '0.75',
        flags: [],
        excludedReason: null,
      },
    ],
    frames: [
      {
        axis: 'reddit',
        frameStatement: 'observed sample',
        window: { from: new Date('2026-08-20T00:00:00Z'), to: new Date('2026-08-27T00:00:00Z') },
        retrievedCount: 10,
        usedCount: 8,
      },
    ],
    createdAt: new Date('2026-08-27T00:00:00Z'),
  } as EvidencePack;
}

function ctx(): VerifierContext {
  return {
    pack: pack(),
    metrics: [],
    runWindow: { from: new Date('2026-08-20T00:00:00Z'), to: new Date('2026-08-27T00:00:00Z') },
    subjectSymbols: new Set(['NVDA']),
    sampleSizeByAxis: { reddit: 8, x: 0, substack: 0 },
    minStanceSample: 5,
    statedFreshnessAsOf: new Date('2026-08-25T00:00:00Z'),
  };
}

const GOOD_CLAIM: FlatClaim = {
  section: 'summary',
  text: 'Mentions rose this week.',
  kind: 'fact',
  evidenceIds: [EVIDENCE_ID],
  metricIds: [],
  assertsStanceForAxis: null,
};

describe('buildClaimLedger', () => {
  it('marks a claim "verified" when it passes deterministic checks and the model supports it', () => {
    const ledger = buildClaimLedger({
      runId: RUN_ID,
      claims: [GOOD_CLAIM],
      ctx: ctx(),
      modelVerdict: { verdicts: [{ claimIndex: 0, supported: true, rationale: 'ok' }] },
    });
    expect(ledger[0]?.verificationStatus).toBe('verified');
    expect(ledger[0]?.materiality).toBe('material');
  });

  it('marks a claim "contradicted" when it fails a deterministic check, regardless of the model verdict', () => {
    const badClaim: FlatClaim = { ...GOOD_CLAIM, evidenceIds: ['99999999-9999-9999-9999-999999999999'] };
    const ledger = buildClaimLedger({
      runId: RUN_ID,
      claims: [badClaim],
      ctx: ctx(),
      modelVerdict: { verdicts: [{ claimIndex: 0, supported: true, rationale: 'ok' }] },
    });
    expect(ledger[0]?.verificationStatus).toBe('contradicted');
  });

  it('marks a claim "unsupported" when the deterministic checks pass but the model disagrees', () => {
    const ledger = buildClaimLedger({
      runId: RUN_ID,
      claims: [GOOD_CLAIM],
      ctx: ctx(),
      modelVerdict: { verdicts: [{ claimIndex: 0, supported: false, rationale: 'does not follow' }] },
    });
    expect(ledger[0]?.verificationStatus).toBe('unsupported');
  });

  it('marks every claim "withheld" when no model pass ever ran', () => {
    const ledger = buildClaimLedger({ runId: RUN_ID, claims: [GOOD_CLAIM], ctx: ctx(), modelVerdict: null });
    expect(ledger[0]?.verificationStatus).toBe('withheld');
  });

  it('marks an interpretation claim "supporting", not "material"', () => {
    const interpretive: FlatClaim = { ...GOOD_CLAIM, kind: 'interpretation' };
    const ledger = buildClaimLedger({ runId: RUN_ID, claims: [interpretive], ctx: ctx(), modelVerdict: null });
    expect(ledger[0]?.materiality).toBe('supporting');
  });
});

describe('validateLedgerShape', () => {
  it('accepts a material fact claim that carries evidence ids', () => {
    const ledger = buildClaimLedger({ runId: RUN_ID, claims: [GOOD_CLAIM], ctx: ctx(), modelVerdict: null });
    expect(validateLedgerShape(ledger)).toEqual([]);
  });

  it('flags a material fact claim with neither evidence nor metric ids (product invariant §6.3)', () => {
    const bareClaim: FlatClaim = { ...GOOD_CLAIM, evidenceIds: [], metricIds: [] };
    const ledger = buildClaimLedger({ runId: RUN_ID, claims: [bareClaim], ctx: ctx(), modelVerdict: null });
    expect(validateLedgerShape(ledger).length).toBeGreaterThan(0);
  });
});
