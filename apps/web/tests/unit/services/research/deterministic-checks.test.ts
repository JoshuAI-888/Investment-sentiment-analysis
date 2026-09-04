import { describe, expect, it } from 'vitest';
import {
  checkNumericTokensMatchMetrics,
  checkCitationsResolve,
  checkCitationsWithinWindow,
  checkBannedVocabulary,
  checkNoThinSampleStance,
  checkNoTickerOutsideSubject,
  checkDateClaimsConsistent,
  checkStatedFreshnessMatchesOldestInput,
  runDeterministicChecks,
  withDeterministicSingleSourceLabels,
  type VerifyContext,
} from '@/services/research/deterministic-checks';
import { AAPL, makeClaim, makeIncludedItem, makeMetric, makePack, makeSynthesisOutput, makeTheme } from './fixtures';

function ctxOf(overrides: Partial<VerifyContext> = {}): VerifyContext {
  return {
    output: makeSynthesisOutput(),
    pack: makePack([]),
    metrics: [],
    subjectSymbol: AAPL.symbol,
    ...overrides,
  };
}

describe('checkNumericTokensMatchMetrics', () => {
  it('passes when a claim cites a decimal that string-matches a gathered metric', () => {
    const metric = makeMetric({ display: '3.500000' });
    const claim = makeClaim({ text: 'The rank change was 3.500000 over the last 24 hours.', metricIds: [metric.metricId] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), metrics: [metric] });
    expect(checkNumericTokensMatchMetrics(ctx).ok).toBe(true);
  });

  it('fails when a claim states a decimal figure with no matching stored metric (a fabricated/mis-rounded statistic)', () => {
    const metric = makeMetric({ display: '3.500000' });
    const claim = makeClaim({ text: 'The rank change was 9.999999 over the last 24 hours.', metricIds: [metric.metricId] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), metrics: [metric] });
    const result = checkNumericTokensMatchMetrics(ctx);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.check).toBe('numeric_tokens_match_metrics');
  });

  it('does not flag ordinary counting language (bare small integers) as an unbacked metric', () => {
    const claim = makeClaim({ text: 'There are 3 themes worth noting this week.' });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }) });
    expect(checkNumericTokensMatchMetrics(ctx).ok).toBe(true);
  });
});

describe('checkCitationsResolve — the deliberately-broken-citation test', () => {
  it('passes when every evidenceId/metricId cited actually exists in this run\'s pack/metrics', () => {
    const included = makeIncludedItem();
    const metric = makeMetric();
    const claim = makeClaim({ evidenceIds: [included.stableId], metricIds: [metric.metricId] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), pack: makePack([included]), metrics: [metric] });
    expect(checkCitationsResolve(ctx).ok).toBe(true);
  });

  it('rejects a claim whose evidenceId does not resolve to anything in the pack (fabricated citation)', () => {
    const included = makeIncludedItem();
    const claim = makeClaim({ evidenceIds: ['00000000-0000-4000-8000-000000000999'] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), pack: makePack([included]) });
    const result = checkCitationsResolve(ctx);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.detail).toContain('does not resolve');
  });

  it('rejects a claim whose metricId does not resolve to anything gathered for this run', () => {
    const claim = makeClaim({ metricIds: ['not.a.real.metric'] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), metrics: [makeMetric()] });
    const result = checkCitationsResolve(ctx);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.detail).toContain("metricId 'not.a.real.metric'");
  });

  it('the overall run-level runDeterministicChecks also fails on a single broken citation, end to end', () => {
    const claim = makeClaim({ evidenceIds: ['00000000-0000-4000-8000-000000000999'] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }) });
    expect(runDeterministicChecks(ctx).ok).toBe(false);
  });
});

describe('checkCitationsWithinWindow', () => {
  it('passes when a cited item\'s availableAt falls inside the pack\'s retrieval window', () => {
    const included = makeIncludedItem({ availableAt: new Date('2026-08-15T00:00:00.000Z') });
    const claim = makeClaim({ evidenceIds: [included.stableId] });
    const pack = makePack([included], { retrievalWindow: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' } });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), pack });
    expect(checkCitationsWithinWindow(ctx).ok).toBe(true);
  });

  it('fails when a cited item\'s availableAt falls outside the declared window', () => {
    const included = makeIncludedItem({ availableAt: new Date('2020-01-01T00:00:00.000Z') });
    const claim = makeClaim({ evidenceIds: [included.stableId] });
    const pack = makePack([included], { retrievalWindow: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' } });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), pack });
    const result = checkCitationsWithinWindow(ctx);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.check).toBe('citations_within_window');
  });
});

describe('checkBannedVocabulary', () => {
  it('passes on ordinary explanatory prose', () => {
    const claim = makeClaim({ text: 'Attention rank improved by three positions this week.' });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }) });
    expect(checkBannedVocabulary(ctx).ok).toBe(true);
  });

  it('fails on a banned word ("consensus")', () => {
    const claim = makeClaim({ text: 'There is broad consensus that this is a good sign.' });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }) });
    const result = checkBannedVocabulary(ctx);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.detail).toContain("'consensus'");
  });

  it('fails on predictive vocabulary ("price target") even outside a claim, in the summary', () => {
    const ctx = ctxOf({ output: makeSynthesisOutput({ summary: 'Our price target for AAPL is $250.' }) });
    const result = checkBannedVocabulary(ctx);
    expect(result.ok).toBe(false);
  });
});

describe('checkNoThinSampleStance', () => {
  it('passes when a cited stance metric has n >= 5', () => {
    const metric = makeMetric({ metricId: 'social.stance_x', n: 12 });
    const claim = makeClaim({ metricIds: [metric.metricId] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), metrics: [metric] });
    expect(checkNoThinSampleStance(ctx).ok).toBe(true);
  });

  it('fails when a claim cites a stance metric whose n < 5 (the product\'s own abstention floor)', () => {
    const metric = makeMetric({ metricId: 'social.stance_x', n: 3 });
    const claim = makeClaim({ metricIds: [metric.metricId] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), metrics: [metric] });
    const result = checkNoThinSampleStance(ctx);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.check).toBe('no_thin_sample_stance');
  });

  it('ignores non-stance metrics entirely, however small their n', () => {
    const metric = makeMetric({ metricId: 'attention.rank_change', n: 1 });
    const claim = makeClaim({ metricIds: [metric.metricId] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), metrics: [metric] });
    expect(checkNoThinSampleStance(ctx).ok).toBe(true);
  });
});

describe('checkNoTickerOutsideSubject', () => {
  it('passes when every claim\'s relatedTickers is exactly the run\'s subject', () => {
    const claim = makeClaim({ relatedTickers: ['AAPL'] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), subjectSymbol: 'AAPL' });
    expect(checkNoTickerOutsideSubject(ctx).ok).toBe(true);
  });

  it('fails when a claim references a ticker outside the run\'s subject set', () => {
    const claim = makeClaim({ relatedTickers: ['AAPL', 'MSFT'] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), subjectSymbol: 'AAPL' });
    const result = checkNoTickerOutsideSubject(ctx);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.detail).toContain('MSFT');
  });
});

describe('checkDateClaimsConsistent', () => {
  it('passes when a claim\'s assertedDate is close to its cited evidence\'s publishedAt', () => {
    const included = makeIncludedItem({ publishedAt: new Date('2026-08-15T00:00:00.000Z') });
    const claim = makeClaim({ assertedDate: '2026-08-16', evidenceIds: [included.stableId] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), pack: makePack([included]) });
    expect(checkDateClaimsConsistent(ctx).ok).toBe(true);
  });

  it('fails when a claim\'s assertedDate is far from every citation it names', () => {
    const included = makeIncludedItem({ publishedAt: new Date('2020-01-01T00:00:00.000Z') });
    const claim = makeClaim({ assertedDate: '2026-08-16', evidenceIds: [included.stableId] });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }), pack: makePack([included]) });
    const result = checkDateClaimsConsistent(ctx);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.check).toBe('date_claims_consistent');
  });

  it('passes trivially when the claim carries no assertedDate', () => {
    const claim = makeClaim({ assertedDate: null });
    const ctx = ctxOf({ output: makeSynthesisOutput({ whatChanged: [claim] }) });
    expect(checkDateClaimsConsistent(ctx).ok).toBe(true);
  });
});

describe('checkStatedFreshnessMatchesOldestInput', () => {
  it('passes when statedFreshness matches the true oldest input, computed by code', () => {
    const included = makeIncludedItem({ availableAt: new Date('2026-08-10T00:00:00.000Z') });
    const metric = makeMetric({ observedAt: new Date('2026-08-20T00:00:00.000Z') });
    const output = makeSynthesisOutput({ statedFreshness: '2026-08-10' });
    const ctx = ctxOf({ output, pack: makePack([included]), metrics: [metric] });
    expect(checkStatedFreshnessMatchesOldestInput(ctx).ok).toBe(true);
  });

  it('fails when the model states a freshness newer than the true oldest input (hides staleness)', () => {
    const included = makeIncludedItem({ availableAt: new Date('2026-08-10T00:00:00.000Z') });
    const output = makeSynthesisOutput({ statedFreshness: '2026-08-30' });
    const ctx = ctxOf({ output, pack: makePack([included]), metrics: [] });
    const result = checkStatedFreshnessMatchesOldestInput(ctx);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.check).toBe('stated_freshness_matches_oldest_input');
  });

  it('passes trivially when there is no evidence and no metric to compare against', () => {
    const ctx = ctxOf({ pack: makePack([]), metrics: [] });
    expect(checkStatedFreshnessMatchesOldestInput(ctx).ok).toBe(true);
  });
});

describe('runDeterministicChecks — a genuinely clean answer passes all eight', () => {
  it('passes when every field is internally consistent', () => {
    const included = makeIncludedItem({ availableAt: new Date('2026-08-30T00:00:00.000Z'), publishedAt: new Date('2026-08-30T00:00:00.000Z') });
    const metric = makeMetric({ display: '3', observedAt: new Date('2026-08-31T00:00:00.000Z') });
    const claim = makeClaim({
      text: 'Apple attention rank moved by 3 positions.',
      evidenceIds: [included.stableId],
      metricIds: [metric.metricId],
      assertedDate: '2026-08-30',
    });
    const output = makeSynthesisOutput({
      statedFreshness: '2026-08-30',
      themes: [makeTheme([claim])],
    });
    const pack = makePack([included], { retrievalWindow: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' } });
    const ctx = ctxOf({ output, pack, metrics: [metric] });
    const result = runDeterministicChecks(ctx);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe('withDeterministicSingleSourceLabels', () => {
  it('overrides a model-claimed singleSource: false to true when the theme really cites only one distinct evidenceId', () => {
    const claim = makeClaim({ evidenceIds: ['e1'] });
    const output = makeSynthesisOutput({ themes: [makeTheme([claim], { singleSource: false })] });
    const result = withDeterministicSingleSourceLabels(output);
    expect(result.themes[0]?.singleSource).toBe(true);
  });

  it('overrides a model-claimed singleSource: true to false when two distinct evidenceIds are actually cited across the theme\'s claims', () => {
    const claimA = makeClaim({ evidenceIds: ['e1'] });
    const claimB = makeClaim({ evidenceIds: ['e2'] });
    const output = makeSynthesisOutput({ themes: [makeTheme([claimA, claimB], { singleSource: true })] });
    const result = withDeterministicSingleSourceLabels(output);
    expect(result.themes[0]?.singleSource).toBe(false);
  });

  it('a theme with zero evidenceIds (metric-only) is still labelled single-source, not left as the model said', () => {
    const claim = makeClaim({ evidenceIds: [], metricIds: ['attention.rank_change'] });
    const output = makeSynthesisOutput({ themes: [makeTheme([claim], { singleSource: false })] });
    const result = withDeterministicSingleSourceLabels(output);
    expect(result.themes[0]?.singleSource).toBe(true);
  });
});
