import { describe, expect, it } from 'vitest';

import { convergePlatformFacts, replayPlatformFacts } from '../../../../src/rni/convergence';
import { rniDimensionKey } from '../../../../src/rni/contracts';
import {
  convergenceRequest,
  dimensions,
  nonPublishablePlatform,
  platformInput,
} from './fixtures';

describe('RNI cross-source convergence facts', () => {
  it('emits aligned facts while preserving the independent platform inputs', () => {
    const request = convergenceRequest();
    const artifact = convergePlatformFacts(request);

    expect(artifact.result).toMatchObject({
      status: 'COMPLETE_CROSS_SOURCE',
      radarState: 'aligned',
      platforms: { reddit: request.reddit, x: request.x },
      facts: {
        overall: {
          redditDirection: 'bullish',
          xDirection: 'bullish',
          scoreDelta: '0.1',
          agreement: 'aligned',
        },
        scaleImbalance: {
          state: 'balanced',
          dominantPlatform: null,
          ratio: '2',
          redditEffectiveAttention: '4',
          xEffectiveAttention: '2',
        },
      },
      interpretation: 'cross_source_facts_only_no_pooled_metric',
    });
    expect(artifact.result.facts.dimensions.map(({ dimension }) => dimension)).toEqual(
      rniDimensionKey.options,
    );
  });

  it('marks opposing directional platform sentiment as divergent', () => {
    const artifact = convergePlatformFacts(
      convergenceRequest({
        x: platformInput('x', {
          stance: 'bearish',
          stanceScore: '-0.5',
          dimensions: dimensions('bearish', '-0.5'),
        }),
      }),
    );

    expect(artifact.result.status).toBe('DIVERGENT_CROSS_SOURCE');
    expect(artifact.result.radarState).toBe('divergent');
    expect(artifact.result.facts.overall).toMatchObject({
      redditDirection: 'bullish',
      xDirection: 'bearish',
      scoreDelta: '1.1',
      agreement: 'divergent',
    });
  });

  it('treats a policy-material same-direction magnitude difference as divergence', () => {
    const result = convergePlatformFacts(
      convergenceRequest({
        x: platformInput('x', {
          stanceScore: '0.1',
          dimensions: dimensions('bullish', '0.1'),
        }),
      }),
    ).result;

    expect(result.status).toBe('DIVERGENT_CROSS_SOURCE');
    expect(result.radarState).toBe('divergent');
    expect(result.facts.overall).toMatchObject({ scoreDelta: '0.5', agreement: 'mixed' });
  });

  it('promotes a dimension-level disagreement without blending overall scores', () => {
    const xDimensions = dimensions('bullish', '0.5').map((assignment) =>
      assignment.dimension === 'catalyst_event'
        ? { ...assignment, stance: 'bearish' as const, score: '-0.6' }
        : assignment,
    );
    const result = convergePlatformFacts(
      convergenceRequest({ x: platformInput('x', { dimensions: xDimensions }) }),
    ).result;

    expect(result.status).toBe('DIVERGENT_CROSS_SOURCE');
    expect(result.facts.overall.agreement).toBe('aligned');
    expect(result.facts.dimensions.find(({ dimension }) => dimension === 'catalyst_event')).toMatchObject(
      { redditScore: '0.6', xScore: '-0.6', scoreDelta: '1.2', agreement: 'divergent' },
    );
  });

  it('reports scale imbalance with separate platform magnitudes and no pooled value', () => {
    const redditHigher = convergePlatformFacts(
      convergenceRequest({
        reddit: platformInput('reddit', { effectiveAttention: '10' }),
        x: platformInput('x', { effectiveAttention: '2' }),
      }),
    ).result.facts.scaleImbalance;
    expect(redditHigher).toEqual({
      state: 'reddit_higher',
      dominantPlatform: 'reddit',
      ratio: '5',
      redditEffectiveAttention: '10',
      xEffectiveAttention: '2',
    });

    const unboundedResult = convergePlatformFacts(
      convergenceRequest({
        x: platformInput('x', {
          stance: 'insufficient',
          stanceScore: null,
          dimensions: dimensions('insufficient', null),
          effectiveAttention: '0',
        }),
      }),
    ).result;
    const unbounded = unboundedResult.facts.scaleImbalance;
    expect(unbounded).toMatchObject({ state: 'unbounded', dominantPlatform: 'reddit', ratio: null });
    expect(unboundedResult.status).toBe('PARTIAL_CROSS_SOURCE');
    expect(unboundedResult.facts.overall.agreement).toBe('insufficient');
    expect(Object.keys(redditHigher).sort()).toEqual([
      'dominantPlatform',
      'ratio',
      'redditEffectiveAttention',
      'state',
      'xEffectiveAttention',
    ]);
  });

  it('keeps one unavailable platform explicit and publishes only a partial cross-source state', () => {
    const request = convergenceRequest({ x: nonPublishablePlatform('x', 'unavailable') });
    const result = convergePlatformFacts(request).result;

    expect(result.status).toBe('PARTIAL_CROSS_SOURCE');
    expect(result.radarState).toBe('partial');
    expect(result.platforms.reddit).toEqual(request.reddit);
    expect(result.platforms.x).toEqual(request.x);
    expect(result.facts.overall.agreement).toBe('insufficient');
    expect(result.facts.coverage.missingPlatforms).toEqual(['x']);
    expect(result.facts.scaleImbalance.state).toBe('unavailable');
  });

  it('keeps a disclosed coverage gap partial even when both platform directions align', () => {
    const result = convergePlatformFacts(
      convergenceRequest({ reddit: platformInput('reddit', { status: 'partial' }) }),
    ).result;

    expect(result.status).toBe('PARTIAL_CROSS_SOURCE');
    expect(result.radarState).toBe('partial');
    expect(result.facts.overall.agreement).toBe('aligned');
  });

  it.each(['pending', 'running'] as const)(
    'keeps a %s platform non-terminal instead of inferring agreement',
    (status) => {
      const result = convergePlatformFacts(
        convergenceRequest({ x: nonPublishablePlatform('x', status) }),
      ).result;
      expect(result.status).toBe('PENDING_CROSS_SOURCE');
      expect(result.radarState).toBe('pending');
      expect(result.facts.coverage.nonTerminalPlatforms).toEqual(['x']);
      expect(result.facts.overall.agreement).toBe('insufficient');
    },
  );

  it('is insufficient when neither platform is publishable', () => {
    const result = convergePlatformFacts(
      convergenceRequest({
        reddit: nonPublishablePlatform('reddit', 'failed'),
        x: nonPublishablePlatform('x', 'unavailable'),
      }),
    ).result;

    expect(result.status).toBe('INSUFFICIENT_CROSS_SOURCE');
    expect(result.radarState).toBe('insufficient');
    expect(result.facts.coverage.missingPlatforms).toEqual(['reddit', 'x']);
  });

  it('makes stale evidence unavailable for comparison with deterministic boundary handling', () => {
    const exactlyFresh = convergePlatformFacts(
      convergenceRequest({
        reddit: platformInput('reddit', { dataThroughAt: '2026-09-04T12:00:00Z' }),
      }),
    ).result;
    expect(exactlyFresh.status).toBe('COMPLETE_CROSS_SOURCE');
    expect(exactlyFresh.facts.freshness.reddit).toBe('fresh');

    const oneStale = convergePlatformFacts(
      convergenceRequest({
        reddit: platformInput('reddit', { dataThroughAt: '2026-09-04T11:59:59Z' }),
      }),
    ).result;
    expect(oneStale.status).toBe('PARTIAL_CROSS_SOURCE');
    expect(oneStale.facts.coverage.stalePlatforms).toEqual(['reddit']);
    expect(oneStale.facts.overall.agreement).toBe('insufficient');

    const bothStale = convergePlatformFacts(
      convergenceRequest({
        reddit: platformInput('reddit', { dataThroughAt: '2026-09-04T11:59:59Z' }),
        x: platformInput('x', { dataThroughAt: '2026-09-04T11:59:59Z' }),
      }),
    ).result;
    expect(bothStale.status).toBe('INSUFFICIENT_CROSS_SOURCE');
    expect(bothStale.facts.coverage.stalePlatforms).toEqual(['reddit', 'x']);
  });

  it('fails closed when freshness is unknown on one or both platforms', () => {
    const oneUnknown = convergePlatformFacts(
      convergenceRequest({ x: platformInput('x', { dataThroughAt: null }) }),
    ).result;
    expect(oneUnknown.status).toBe('PARTIAL_CROSS_SOURCE');
    expect(oneUnknown.facts.freshness.x).toBe('unknown');
    expect(oneUnknown.facts.overall.agreement).toBe('insufficient');
    expect(oneUnknown.facts.coverage.insufficientPlatforms).toEqual(['x']);

    const bothUnknown = convergePlatformFacts(
      convergenceRequest({
        reddit: platformInput('reddit', { dataThroughAt: null }),
        x: platformInput('x', { dataThroughAt: null }),
      }),
    ).result;
    expect(bothUnknown.status).toBe('INSUFFICIENT_CROSS_SOURCE');
    expect(bothUnknown.facts.coverage.insufficientPlatforms).toEqual(['reddit', 'x']);
  });

  it('compares available dimensions independently of an insufficient overall stance', () => {
    const redditDimensions = dimensions('bullish', '0.6').map((assignment) =>
      assignment.dimension === 'catalyst_event'
        ? { ...assignment, stance: 'bearish' as const, score: '-0.4' }
        : assignment,
    );
    const result = convergePlatformFacts(
      convergenceRequest({
        reddit: platformInput('reddit', {
          stance: 'insufficient',
          stanceScore: null,
          dimensions: redditDimensions,
        }),
      }),
    ).result;

    expect(result.status).toBe('PARTIAL_CROSS_SOURCE');
    expect(result.facts.overall.agreement).toBe('insufficient');
    expect(result.facts.dimensions.find(({ dimension }) => dimension === 'catalyst_event')).toMatchObject(
      { redditScore: '-0.4', xScore: '0.5', scoreDelta: '-0.9', agreement: 'divergent' },
    );
  });

  it('normalizes dimension ordering and replays byte-equivalent facts', () => {
    const request = convergenceRequest({
      reddit: platformInput('reddit', { dimensions: [...dimensions('bullish', '0.6')].reverse() }),
      x: platformInput('x', {
        dimensions: [
          ...dimensions('bullish', '0.5').slice(2),
          ...dimensions('bullish', '0.5').slice(0, 2),
        ],
      }),
    });
    const first = convergePlatformFacts(request);
    const canonicalOrder = convergePlatformFacts(convergenceRequest());

    expect(first.inputHash).toBe(canonicalOrder.inputHash);
    expect(first.resultHash).toBe(canonicalOrder.resultHash);
    expect(replayPlatformFacts(first)).toEqual(first);
  });

  it('fails replay when either the frozen input snapshot or result is mutated', () => {
    const artifact = convergePlatformFacts(convergenceRequest());
    expect(() =>
      replayPlatformFacts({
        ...artifact,
        inputSnapshot: { ...artifact.inputSnapshot, asOf: '2026-09-05T13:00:00Z' },
      }),
    ).toThrow(/input hash/u);
    expect(() =>
      replayPlatformFacts({
        ...artifact,
        result: { ...artifact.result, status: 'DIVERGENT_CROSS_SOURCE' },
      }),
    ).toThrow(/result/u);
  });

  it('rejects non-comparable, mislabeled, future-dated, and semantically invalid slices', () => {
    expect(() =>
      convergePlatformFacts(
        convergenceRequest({ x: platformInput('x', { securityId: crypto.randomUUID() }) }),
      ),
    ).toThrow(/non-comparable/u);
    expect(() =>
      convergePlatformFacts(
        convergenceRequest({ reddit: platformInput('reddit', { platform: 'x' }) }),
      ),
    ).toThrow(/explicitly labelled/u);
    expect(() =>
      convergePlatformFacts(
        convergenceRequest({ x: platformInput('x', { dataThroughAt: '2026-09-05T12:00:01Z' }) }),
      ),
    ).toThrow(/future/u);
    expect(() =>
      convergePlatformFacts(
        convergenceRequest({
          x: platformInput('x', { status: 'unavailable', stance: 'bullish', stanceScore: '0.5' }),
        }),
      ),
    ).toThrow(/non-publishable/u);
    expect(() =>
      convergePlatformFacts(
        convergenceRequest({ x: platformInput('x', { stance: 'insufficient', stanceScore: '0.5' }) }),
      ),
    ).toThrow(/null stance score/u);
    expect(() =>
      convergePlatformFacts(
        convergenceRequest({ x: platformInput('x', { stance: 'bullish', stanceScore: '-0.5' }) }),
      ),
    ).toThrow(/score sign/u);
    expect(() =>
      convergePlatformFacts(
        convergenceRequest({
          x: platformInput('x', {
            dimensions: dimensions('bullish', '0.5').map((assignment) =>
              assignment.dimension === 'market_trading'
                ? { ...assignment, stance: 'bearish' as const, score: '0.2' }
                : assignment,
            ),
          }),
        }),
      ),
    ).toThrow(/score sign/u);
    expect(() =>
      convergePlatformFacts(
        convergenceRequest({ x: platformInput('x', { effectiveAttention: '0' }) }),
      ),
    ).toThrow(/positive effective attention/u);
  });
});
