/**
 * Shared test fixtures for F11's unit suites. Not a `.test.ts` file — `vitest.config.ts` only
 * collects `tests/**\/*.test.ts`, so this module is never run as a suite itself, only imported.
 */
import { randomUUID } from 'node:crypto';
import type { EvidenceItem } from '@/contracts/evidence';
import type { Security } from '@/contracts/security';
import { buildAxisDisclosures } from '@/services/evidence';
import type { EvidencePack, IncludedItem } from '@/services/evidence';
import type { MetricFact } from '@/services/research/metrics';
import type { SynthesisClaim, SynthesisOutput, SynthesisTheme } from '@/services/research/schema';

export const AAPL: Pick<Security, 'symbol' | 'name' | 'aliases'> = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  aliases: ['Apple'],
};

export function makeEvidenceItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: randomUUID(),
    securityId: randomUUID(),
    evidenceType: 'news',
    provider: 'marketaux',
    title: 'Apple reports quarterly results',
    snippet: 'Apple Inc. reported quarterly revenue in line with expectations.',
    sourceUrl: 'https://news.example/1',
    publisher: 'Example Wire',
    authorRef: null,
    stanceLabel: null,
    stanceScore: null,
    relevanceScore: '0.900000',
    publishedAt: new Date('2026-08-30T12:00:00.000Z'),
    availableAt: new Date('2026-08-30T12:05:00.000Z'),
    ingestedAt: new Date('2026-08-30T12:10:00.000Z'),
    lastCheckedAt: null,
    availability: 'available',
    licenseClass: 'provider_terms',
    coverageClass: 'pov_index',
    rawHash: `h-${randomUUID()}`,
    metadata: {},
    ...overrides,
  };
}

export function makeIncludedItem(overrides: Partial<EvidenceItem> = {}, itemOverrides: Partial<IncludedItem> = {}): IncludedItem {
  const item = makeEvidenceItem(overrides);
  return {
    kind: 'included',
    item,
    axis: item.provider === 'reddit' || item.provider === 'x' || item.provider === 'substack' ? item.provider : null,
    relevanceScore: item.relevanceScore ?? '0.900000',
    matchedVia: 'company_name',
    methods: [],
    stableId: item.id,
    ...itemOverrides,
  };
}

export function makePack(items: readonly IncludedItem[], overrides: Partial<EvidencePack> = {}): EvidencePack {
  const zero = { retrieved: 0, used: 0, exclusions: [] };
  const disclosures = buildAxisDisclosures({
    counts: { reddit: zero, x: zero, substack: zero },
    windowFrom: '2026-08-01T00:00:00.000Z',
    windowTo: '2026-09-01T00:00:00.000Z',
    reddit: { subredditsPolled: [], treeComplete: null },
    x: { watchlistVersion: null, triggerEvent: null },
  });
  return {
    securityId: randomUUID(),
    asOf: '2026-09-01T00:00:00.000Z',
    retrievalWindow: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
    retrievalQuery: 'test',
    items,
    excluded: [],
    retrievedCount: items.length,
    usedCount: items.length,
    truncatedByScanWindow: false,
    disclosures,
    ...overrides,
  };
}

export function makeMetric(overrides: Partial<MetricFact> = {}): MetricFact {
  return {
    metricId: 'attention.rank_change',
    calculationId: randomUUID(),
    label: 'Rank change',
    display: '3',
    unit: '',
    n: 1,
    window: '24 h',
    observedAt: new Date('2026-08-31T00:00:00.000Z'),
    ...overrides,
  };
}

export function makeClaim(overrides: Partial<SynthesisClaim> = {}): SynthesisClaim {
  return {
    claimId: `c-${randomUUID()}`,
    text: 'Apple reported quarterly results in line with expectations.',
    kind: 'fact',
    evidenceIds: [],
    metricIds: [],
    relatedTickers: ['AAPL'],
    assertedDate: null,
    ...overrides,
  };
}

export function makeTheme(claims: readonly SynthesisClaim[], overrides: Partial<SynthesisTheme> = {}): SynthesisTheme {
  return { title: 'Recent results', claims: [...claims], singleSource: claims.length < 2, ...overrides };
}

export function makeSynthesisOutput(overrides: Partial<SynthesisOutput> = {}): SynthesisOutput {
  return {
    summary: 'Apple reported quarterly results in line with expectations.',
    statedFreshness: '2026-08-30',
    themes: [],
    bullishCase: [],
    bearishCase: [],
    whatChanged: [],
    whatToMonitor: [],
    ...overrides,
  };
}
