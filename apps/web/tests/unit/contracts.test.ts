import { describe, expect, it } from 'vitest';
import { decimalString, bigintString } from '../../src/contracts/primitives';
import { attentionSnapshot, security } from '../../src/contracts/security';
import { sentimentSnapshot } from '../../src/contracts/evidence';
import { calculationSnapshot } from '../../src/contracts/calculation';
import { claimLedgerEntry, researchRun } from '../../src/contracts/research';
import { appSetting, selectionSource, universeVersion } from '../../src/contracts/config';
import { costEvent } from '../../src/contracts/cost';

describe('decimalString', () => {
  it.each(['0', '0.1', '-12.34', '1234567890.123456789'])('accepts %s', (value) => {
    expect(decimalString.parse(value)).toBe(value);
  });

  it.each([0.1, '1e5', '1.2.3', 'NaN', '', 'Infinity'])('rejects %s', (value) => {
    expect(decimalString.safeParse(value).success).toBe(false);
  });

  it('rejects a number even when the number is exact', () => {
    // `100` is exactly representable. The rule is not about this value, it is about the type:
    // once a decimal is a JS number, the next one through the same code path is 0.1.
    expect(decimalString.safeParse(100).success).toBe(false);
  });
});

describe('bigintString', () => {
  it('accepts a bigserial rendered as a string', () => {
    expect(bigintString.parse('9007199254740993')).toBe('9007199254740993');
  });

  it('rejects a JS number', () => {
    expect(bigintString.safeParse(1).success).toBe(false);
  });
});

const VALID_SECURITY = {
  id: '11111111-1111-1111-1111-111111111111',
  symbol: 'NVDA',
  name: 'NVIDIA',
  exchange: 'NASDAQ',
  assetType: 'equity',
  sector: null,
  industry: null,
  cik: null,
  currency: 'USD',
  active: true,
  aliases: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('security', () => {
  it('round-trips a valid row', () => {
    expect(security.parse(VALID_SECURITY).symbol).toBe('NVDA');
  });

  it.each([
    ['id', 'not-a-uuid'],
    ['symbol', ''],
    ['assetType', 'crypto'],
    ['currency', 'DOLLARS'],
    ['active', 'yes'],
  ])('rejects a malformed %s', (field, value) => {
    expect(security.safeParse({ ...VALID_SECURITY, [field]: value }).success).toBe(false);
  });
});

describe('attentionSnapshot', () => {
  const VALID = {
    securityId: '11111111-1111-1111-1111-111111111111',
    source: 'apewisdom',
    rank: 3,
    rankPrior: 5,
    mentions: 120,
    mentionsPrior: 90,
    engagement: 400,
    windowHours: 24,
    coverageClass: 'pov_index',
    providerMethodologyVersion: '2026-08-30:subreddits=12',
    observedAt: new Date(),
    ingestedAt: new Date(),
    rawHash: 'h',
  };

  it('requires the methodology version', () => {
    // F-05 / R-03. Without it, a rank change across a boundary silently becomes a number.
    const { providerMethodologyVersion: _omitted, ...without } = VALID;
    expect(attentionSnapshot.safeParse(without).success).toBe(false);
  });

  it('rejects an unknown source', () => {
    expect(attentionSnapshot.safeParse({ ...VALID, source: 'twitter' }).success).toBe(false);
  });
});

describe('sentimentSnapshot', () => {
  it('names the field sampleAdequacy, not confidence', () => {
    // R-01, closing F-03. The old name invited reading a small-sample warning as certainty.
    const shape = sentimentSnapshot.shape;
    expect(Object.keys(shape)).toContain('sampleAdequacy');
    expect(Object.keys(shape)).not.toContain('confidence');
  });
});

describe('calculationSnapshot', () => {
  const VALID = {
    id: '22222222-2222-2222-2222-222222222222',
    metricKey: 'attention.rank_change',
    subjectType: 'security',
    subjectId: '11111111-1111-1111-1111-111111111111',
    observationKey: null,
    scenarioType: 'official',
    officialCalculationId: null,
    ownerUserId: null,
    methodKey: 'attention.rank_change',
    methodVersion: '1.0.0',
    configVersion: '1',
    universeVersion: '1',
    assumptionProfileVersion: null,
    inputCutoff: new Date(),
    status: 'complete',
    exactResult: { value: '-2' },
    displayResult: { value: '-2' },
    points: null,
    assumptions: {},
    warnings: [],
    inputHash: 'a',
    resultHash: 'b',
    predecessorCalculationId: null,
    retentionClass: 'standard',
    computedAt: new Date(),
    expiresAt: null,
  };

  it('accepts a scalar artifact', () => {
    expect(calculationSnapshot.parse(VALID).metricKey).toBe('attention.rank_change');
  });

  it('accepts a series artifact carrying its points', () => {
    // F-07's ruling in one assertion: one artifact, 180 points inside it.
    const series = {
      ...VALID,
      points: Array.from({ length: 180 }, (_, index) => ({
        pointIndex: index,
        observationKey: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
        exactValue: '0.0123',
        displayValue: '1.23%',
      })),
    };
    expect(calculationSnapshot.parse(series).points).toHaveLength(180);
  });

  it('rejects an unknown status', () => {
    expect(calculationSnapshot.safeParse({ ...VALID, status: 'ok' }).success).toBe(false);
  });

  it('rejects an unknown retention class', () => {
    expect(calculationSnapshot.safeParse({ ...VALID, retentionClass: 'forever' }).success).toBe(false);
  });
});

describe('researchRun', () => {
  const VALID = {
    id: '33333333-3333-3333-3333-333333333333',
    userId: 'owner',
    securityId: null,
    question: 'what changed?',
    status: 'complete',
    coverageStatus: 'full',
    inputCutoff: new Date(),
    startedAt: new Date(),
    completedAt: new Date(),
    promptVersion: '1',
    modelRoute: {},
    toolManifest: {},
    costUsd: '0.10',
    result: null,
    error: null,
    retractedReason: null,
    retractedBy: null,
    retractedAt: null,
  };

  it('accepts the states F-10 added', () => {
    for (const status of ['degraded', 'verification_failed']) {
      expect(researchRun.safeParse({ ...VALID, status }).success).toBe(true);
    }
  });

  it('refuses a retraction with no reason or actor', () => {
    // R-18: a retraction with no reason is indistinguishable from a bug.
    expect(researchRun.safeParse({ ...VALID, status: 'retracted' }).success).toBe(false);
  });

  it('accepts a complete retraction', () => {
    expect(
      researchRun.safeParse({
        ...VALID,
        status: 'retracted',
        retractedReason: 'source withdrawn',
        retractedBy: 'owner',
        retractedAt: new Date(),
      }).success,
    ).toBe(true);
  });
});

describe('claimLedgerEntry', () => {
  const VALID = {
    id: '44444444-4444-4444-4444-444444444444',
    runId: '33333333-3333-3333-3333-333333333333',
    claimText: 'Mentions rose 40%',
    claimType: 'fact',
    materiality: 'material',
    evidenceIds: ['55555555-5555-5555-5555-555555555555'],
    metricIds: [],
    verificationStatus: 'verified',
    verifierNotes: null,
  };

  it('accepts a material fact with evidence', () => {
    expect(claimLedgerEntry.parse(VALID).claimType).toBe('fact');
  });

  it('refuses a material fact supported by neither evidence nor a metric', () => {
    // Product invariant §6.3, as a type rather than a review item.
    expect(
      claimLedgerEntry.safeParse({ ...VALID, evidenceIds: [], metricIds: [] }).success,
    ).toBe(false);
  });

  it('allows a supporting claim without either', () => {
    expect(
      claimLedgerEntry.safeParse({
        ...VALID,
        materiality: 'supporting',
        claimType: 'interpretation',
        evidenceIds: [],
        metricIds: [],
      }).success,
    ).toBe(true);
  });
});

describe('appSetting', () => {
  it('refuses a sensitive setting outright', () => {
    // ADR-012: secrets are deployment-only and never enter this catalogue.
    const base = {
      configVersion: '1',
      settingKey: 'k',
      scopeType: 'global',
      scopeId: '',
      value: 1,
      valueType: 'number',
      governanceClass: 'runtime',
      settingSchemaVersion: '1',
      methodAffecting: false,
    };
    expect(appSetting.safeParse({ ...base, sensitive: false }).success).toBe(true);
    expect(appSetting.safeParse({ ...base, sensitive: true }).success).toBe(false);
  });
});

describe('universeVersion', () => {
  it('caps selectedCount at the D-RNI-06 ceiling', () => {
    const base = {
      id: '1',
      environment: 'test',
      configVersion: '1',
      status: 'active',
      parentVersion: null,
      selectionQuery: null,
      impactPreview: {},
      sourceProvider: null,
      sourceEndpoint: null,
      sourceRetrievedAt: null,
      sourcePayloadHash: null,
      providerCallId: null,
      createdBy: 'owner',
      changeReason: 'seed',
      createdAt: new Date(),
      activatedAt: new Date(),
      approvedBy: null,
    };
    expect(universeVersion.safeParse({ ...base, selectedCount: 600 }).success).toBe(true);
    expect(universeVersion.safeParse({ ...base, selectedCount: 601 }).success).toBe(false);
  });

  it('accepts the FMP S&P 500 membership source', () => {
    expect(selectionSource.parse('fmp_sp500')).toBe('fmp_sp500');
  });
});

describe('costEvent', () => {
  const base = {
    id: '66666666-6666-6666-6666-666666666666',
    occurredAt: new Date(),
    provider: 'x',
    service: 'api',
    operationOrModel: 'post_read',
    feature: 'trigger',
    jobRunId: null,
    researchRunId: null,
    userId: null,
    requestId: 'r',
    unitType: 'post_read',
    requestUnits: '1',
    billableUnits: '1',
    unitPrice: null,
    currency: 'USD',
    priceBookVersion: null,
    cacheStatus: 'miss',
    metadata: {},
    supersedesCostEventId: null,
  };

  it('ties null cost to unpriced status in both directions', () => {
    expect(costEvent.safeParse({ ...base, costUsd: null, costStatus: 'unpriced' }).success).toBe(true);
    expect(costEvent.safeParse({ ...base, costUsd: '0.005', costStatus: 'actual' }).success).toBe(true);
    // A priced status with no amount, and an unpriced status with one, are both wrong.
    expect(costEvent.safeParse({ ...base, costUsd: null, costStatus: 'actual' }).success).toBe(false);
    expect(costEvent.safeParse({ ...base, costUsd: '0', costStatus: 'unpriced' }).success).toBe(false);
  });

  it('distinguishes a free call from an unpriced one', () => {
    // Zero means it was free. Null means we do not know. Collapsing them is how a month reads
    // as comfortable on the day the ceiling is exhausted.
    expect(costEvent.safeParse({ ...base, costUsd: '0', costStatus: 'actual' }).success).toBe(true);
  });
});
