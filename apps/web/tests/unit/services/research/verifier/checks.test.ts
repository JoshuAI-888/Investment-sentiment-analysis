import { describe, expect, it } from 'vitest';
import {
  checkCitationResolves,
  checkCitationWithinWindow,
  checkDateConsistency,
  checkFreshnessMatchesOldest,
  checkNoBannedVocabulary,
  checkNumericMatchesMetric,
  checkStanceSampleFloor,
  checkTickerInSubjectSet,
  oldestUsedObservedAt,
  runDeterministicChecks,
  runPerClaimDeterministicChecks,
  type VerifierContext,
} from '../../../../../src/services/research/verifier/checks';
import type { FlatClaim } from '../../../../../src/services/research/synthesis';
import type { EvidencePack } from '../../../../../src/contracts/evidence-pack';
import type { MetricRef } from '../../../../../src/services/research/ports';

const EVIDENCE_ID_1 = '11111111-1111-1111-1111-111111111111';
const EVIDENCE_ID_2 = '22222222-2222-2222-2222-222222222222';
const OUTSIDE_EVIDENCE_ID = '99999999-9999-9999-9999-999999999999';

function evidenceItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: EVIDENCE_ID_1,
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
    ...overrides,
  };
}

function pack(overrides: Partial<EvidencePack> = {}): EvidencePack {
  return {
    id: 'pack-1',
    securityId: 'sec-1',
    retrievalQuery: 'security_id = sec-1',
    retrievalWindow: { from: new Date('2026-08-20T00:00:00Z'), to: new Date('2026-08-27T00:00:00Z') },
    items: [
      {
        item: evidenceItem(),
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
    ...overrides,
  } as EvidencePack;
}

function claim(overrides: Partial<FlatClaim> = {}): FlatClaim {
  return {
    section: 'summary',
    text: 'NVDA mentions increased.',
    kind: 'fact',
    evidenceIds: [EVIDENCE_ID_1],
    metricIds: [],
    assertsStanceForAxis: null,
    ...overrides,
  };
}

function ctx(overrides: Partial<VerifierContext> = {}): VerifierContext {
  return {
    pack: pack(),
    metrics: [],
    runWindow: { from: new Date('2026-08-20T00:00:00Z'), to: new Date('2026-08-27T00:00:00Z') },
    subjectSymbols: new Set(['NVDA']),
    sampleSizeByAxis: { reddit: 8, x: 0, substack: 0 },
    minStanceSample: 5,
    statedFreshnessAsOf: new Date('2026-08-25T00:00:00Z'),
    ...overrides,
  };
}

const METRIC: MetricRef = {
  metricId: 'm-1',
  methodId: 'attention.rank_change',
  displayValue: '+12',
  unit: 'rank',
  observedAt: new Date('2026-08-26T00:00:00Z'),
};

describe('check 1 — numeric tokens string-match a stored metric', () => {
  it('passes when every number in the claim matches a metric display value', () => {
    const result = checkNumericMatchesMetric([claim({ text: 'Attention rank changed by +12.' })], ctx({ metrics: [METRIC] }));
    expect(result.passed).toBe(true);
  });

  it('fails on a number with no matching stored metric', () => {
    const result = checkNumericMatchesMetric([claim({ text: 'Attention rank changed by +99.' })], ctx({ metrics: [METRIC] }));
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain('+99');
  });

  it('does not misread digits inside a cited ISO date as an unmatched metric', () => {
    const result = checkNumericMatchesMetric([claim({ text: 'As of 2026-08-25, sentiment held steady.' })], ctx({ metrics: [] }));
    expect(result.passed).toBe(true);
  });
});

describe('check 2 — every citation marker resolves to an evidence item', () => {
  it('passes when the cited id is in the pack', () => {
    expect(checkCitationResolves([claim({ evidenceIds: [EVIDENCE_ID_1] })], ctx()).passed).toBe(true);
  });

  it('fails when the cited id is not in the pack', () => {
    const result = checkCitationResolves([claim({ evidenceIds: [OUTSIDE_EVIDENCE_ID] })], ctx());
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain(OUTSIDE_EVIDENCE_ID);
  });
});

describe('check 3 — cited item ingestedAt is inside the run window', () => {
  it('passes when the cited item was ingested inside the window', () => {
    expect(checkCitationWithinWindow([claim({ evidenceIds: [EVIDENCE_ID_1] })], ctx()).passed).toBe(true);
  });

  it('fails when the cited item was ingested outside the window', () => {
    const outsideItem = evidenceItem({ id: EVIDENCE_ID_2, ingestedAt: new Date('2020-01-01T00:00:00Z') });
    const p = pack({
      items: [
        {
          item: outsideItem,
          axis: 'reddit',
          relevant: true,
          relevanceMethodVersion: 'relevance.filter@1',
          stanceConfidence: '0.5',
          flags: [],
          excludedReason: null,
        },
      ],
    } as never);
    const result = checkCitationWithinWindow([claim({ evidenceIds: [EVIDENCE_ID_2] })], ctx({ pack: p }));
    expect(result.passed).toBe(false);
  });
});

describe('check 4 — no banned vocabulary', () => {
  it('passes on ordinary descriptive prose', () => {
    expect(checkNoBannedVocabulary([claim({ text: 'Mentions of NVDA rose this week.' })]).passed).toBe(true);
  });

  it.each([
    'We recommend buying NVDA now.',
    'This stock has a price target of $500.',
    'There is a 90% chance this rallies.',
    'This is a strong buy signal.',
  ])('fails on banned phrase: %s', (text) => {
    const result = checkNoBannedVocabulary([claim({ text })]);
    expect(result.passed).toBe(false);
  });

  // Lane-review finding 7: plural, hyphenated and irregularly-spaced variants that the original
  // exact-phrase regexes missed.
  it.each([
    'Our price targets for the quarter look reasonable.',
    'These signals are strengthening.',
    'Reddit sentiments are mixed this week.',
    'This looks like a strong-buy candidate.',
    'Risk on positioning returned this week.',
    'There is a 90 % chance this rallies.',
    'This is highly likely to rise.',
  ])('fails on the previously-missed variant: %s', (text) => {
    const result = checkNoBannedVocabulary([claim({ text })]);
    expect(result.passed).toBe(false);
  });
});

describe('check 5 — no stance asserted where n < 5', () => {
  it('passes when the sample meets the floor', () => {
    const result = checkStanceSampleFloor([claim({ assertsStanceForAxis: 'reddit' })], ctx({ sampleSizeByAxis: { reddit: 5, x: 0, substack: 0 } }));
    expect(result.passed).toBe(true);
  });

  it('fails when the sample is below the floor', () => {
    const result = checkStanceSampleFloor([claim({ assertsStanceForAxis: 'reddit' })], ctx({ sampleSizeByAxis: { reddit: 4, x: 0, substack: 0 } }));
    expect(result.passed).toBe(false);
  });

  it('passes trivially when the claim asserts no stance at all', () => {
    const result = checkStanceSampleFloor([claim({ assertsStanceForAxis: null })], ctx({ sampleSizeByAxis: { reddit: 0, x: 0, substack: 0 } }));
    expect(result.passed).toBe(true);
  });

  it('fails on a self-reported-null claim whose own text asserts a thin-sample stance (lane-review finding 5)', () => {
    // The exact scenario the finding names: the model never sets `assertsStanceForAxis`, but the
    // claim text itself asserts a directional stance about a named axis.
    const result = checkStanceSampleFloor(
      [claim({ assertsStanceForAxis: null, text: 'The observed Reddit sample leans clearly bullish.' })],
      ctx({ sampleSizeByAxis: { reddit: 1, x: 0, substack: 0 } }),
    );
    expect(result.passed).toBe(false);
  });

  it('passes the same text-derived stance once the sample meets the floor', () => {
    const result = checkStanceSampleFloor(
      [claim({ assertsStanceForAxis: null, text: 'The observed Reddit sample leans clearly bullish.' })],
      ctx({ sampleSizeByAxis: { reddit: 5, x: 0, substack: 0 } }),
    );
    expect(result.passed).toBe(true);
  });
});

describe('check 6 — no claim references a ticker outside the subject set', () => {
  it('passes when only in-subject tickers are mentioned', () => {
    expect(checkTickerInSubjectSet([claim({ text: '$NVDA mentions rose.' })], ctx({ subjectSymbols: new Set(['NVDA']) })).passed).toBe(true);
  });

  it('fails when an out-of-subject ticker is mentioned', () => {
    const result = checkTickerInSubjectSet([claim({ text: '$AMD is also mentioned.' })], ctx({ subjectSymbols: new Set(['NVDA']) }));
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain('AMD');
  });

  it('fails on a bare, non-cashtag ticker outside the subject set (lane-review finding 6)', () => {
    const result = checkTickerInSubjectSet([claim({ text: "AMD's guidance dragged NVDA down." })], ctx({ subjectSymbols: new Set(['NVDA']) }));
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain('AMD');
  });

  it('does not flag common non-ticker acronyms as bare tickers', () => {
    const result = checkTickerInSubjectSet(
      [claim({ text: 'The CEO discussed Q3 guidance and US demand trends.' })],
      ctx({ subjectSymbols: new Set(['NVDA']) }),
    );
    expect(result.passed).toBe(true);
  });
});

describe('check 7 — date claims are consistent with cited evidence timestamps', () => {
  it('passes when the stated date matches a cited item timestamp', () => {
    const result = checkDateConsistency([claim({ text: 'Posted on 2026-08-25.', evidenceIds: [EVIDENCE_ID_1] })], ctx());
    expect(result.passed).toBe(true);
  });

  it('fails when the stated date matches none of the cited evidence', () => {
    const result = checkDateConsistency([claim({ text: 'Posted on 2020-01-01.', evidenceIds: [EVIDENCE_ID_1] })], ctx());
    expect(result.passed).toBe(false);
  });
});

describe('check 8 — stated freshness matches the oldest used input', () => {
  it('passes when stated freshness equals the oldest used item availableAt', () => {
    expect(checkFreshnessMatchesOldest(ctx({ statedFreshnessAsOf: new Date('2026-08-25T00:00:00Z') })).passed).toBe(true);
  });

  it('fails when stated freshness does not match the oldest used item', () => {
    expect(checkFreshnessMatchesOldest(ctx({ statedFreshnessAsOf: new Date('2026-08-26T00:00:00Z') })).passed).toBe(false);
  });

  it('excludes items the classifier marked not-relevant from the oldest calculation', () => {
    const oldExcluded = evidenceItem({ id: EVIDENCE_ID_2, availableAt: new Date('2020-01-01T00:00:00Z') });
    const p = pack({
      items: [
        {
          item: evidenceItem(),
          axis: 'reddit',
          relevant: true,
          relevanceMethodVersion: 'relevance.filter@1',
          stanceConfidence: '0.75',
          flags: [],
          excludedReason: null,
        },
        {
          item: oldExcluded,
          axis: 'reddit',
          relevant: false,
          relevanceMethodVersion: 'relevance.filter@1',
          stanceConfidence: null,
          flags: ['off_topic'],
          excludedReason: 'not about the subject',
        },
      ],
    } as never);
    expect(oldestUsedObservedAt(p)?.toISOString()).toBe(new Date('2026-08-25T00:00:00Z').toISOString());
  });
});

describe('runDeterministicChecks', () => {
  it('reports allPassed true when every check passes', () => {
    const result = runDeterministicChecks([claim()], ctx());
    expect(result.allPassed).toBe(true);
    expect(result.results).toHaveLength(8);
  });

  it('reports allPassed false when any single check fails', () => {
    const result = runDeterministicChecks([claim({ evidenceIds: [OUTSIDE_EVIDENCE_ID] })], ctx());
    expect(result.allPassed).toBe(false);
  });
});

describe('runPerClaimDeterministicChecks', () => {
  it('scopes failures to the one claim under test', () => {
    const good = claim({ evidenceIds: [EVIDENCE_ID_1] });
    const bad = claim({ evidenceIds: [OUTSIDE_EVIDENCE_ID] });
    expect(runPerClaimDeterministicChecks(good, ctx()).passed).toBe(true);
    expect(runPerClaimDeterministicChecks(bad, ctx()).passed).toBe(false);
  });
});
