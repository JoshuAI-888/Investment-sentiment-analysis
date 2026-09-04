import { describe, expect, it } from 'vitest';

import { calculatePlatformAnalytics, replayPlatformAnalytics } from '../../../../src/rni/analytics';
import { SECURITY_ID, methodology, platformInput } from './fixtures';

describe('RNI platform analytics', () => {
  it('matches the hand-calculated platform metric golden', () => {
    const artifact = calculatePlatformAnalytics(platformInput(), methodology());

    expect(artifact.result).toMatchObject({
      platform: 'reddit',
      securityId: SECURITY_ID,
      rawMentions: '3',
      attention: '2',
      effectiveAttention: '1',
      comparisonAttention: '1',
      comparisonEffectiveAttention: '0.5',
      absoluteAttentionChange: '1',
      percentAttentionChange: '1',
      currentAttentionRate: '2',
      comparisonAttentionRate: '0.5',
      velocity: '3',
      acceleration: '1.5',
      changeStatus: 'available',
      authorBreadth: '2',
      communityBreadth: '2',
      clusterAdjustedCommunityBreadth: '2',
      narrativeBreadth: '2',
      narrativeHhi: '0.5',
      confidenceStatus: 'available',
      confidence: {
        unitScore: '1',
        score100: '100',
        uncappedScore100: '100',
        band: 'VERY_HIGH',
        totalPenalty: '0',
        appliedCaps: [],
        meaning: 'evidence_defensibility_not_price_probability',
      },
    });
    expect(artifact.result.weightTrace).toEqual([
      expect.objectContaining({ weight: '0.5' }),
      expect.objectContaining({ weight: '0.5' }),
    ]);
    expect(artifact.result.sentimentByDimension).toHaveLength(4);
    expect(artifact.result.sentimentByDimension).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: 'company_fundamentals',
          sentimentIndex: '25.0',
          meanDirection: '0.25',
          status: 'available',
        }),
      ]),
    );
    expect(artifact.result.zScore).toMatchObject({
      value: '0',
      status: 'available',
      baselineWindowCount: '3',
    });
  });

  it('binds hashes and results to exactly one platform', () => {
    const reddit = calculatePlatformAnalytics(platformInput('reddit'), methodology());
    const x = calculatePlatformAnalytics(platformInput('x'), methodology());

    expect(reddit.result.platform).toBe('reddit');
    expect(x.result.platform).toBe('x');
    expect(reddit.result.effectiveAttention).toBe(x.result.effectiveAttention);
    expect(reddit.inputSetHash).not.toBe(x.inputSetHash);
    expect(reddit.resultHash).not.toBe(x.resultHash);

    const mixed = platformInput('reddit');
    const first = mixed.current.observations[0];
    expect(first).toBeDefined();
    expect(() =>
      calculatePlatformAnalytics(
        {
          ...mixed,
          current: {
            ...mixed.current,
            observations: [{ ...first!, platform: 'x' }, ...mixed.current.observations.slice(1)],
          },
        },
        methodology(),
      ),
    ).toThrow(/cross-platform/u);
  });

  it('uses distinct sources for attention and suppresses ratios emerging from zero', () => {
    const input = platformInput();
    const result = calculatePlatformAnalytics(
      {
        ...input,
        comparison: { ...input.comparison!, observations: [] },
      },
      methodology(),
    ).result;

    expect(result).toMatchObject({
      attention: '2',
      comparisonAttention: '0',
      absoluteAttentionChange: '2',
      percentAttentionChange: null,
      velocity: null,
      changeStatus: 'emerging_from_low_base',
    });
  });

  it('keeps frozen velocity available for positive low bases without epsilon distortion', () => {
    const result = calculatePlatformAnalytics(
      platformInput(),
      {
        ...methodology(),
        lowBaseThreshold: '2',
        epsilon: '1.5',
      },
    ).result;

    expect(result.changeStatus).toBe('emerging_from_low_base');
    expect(result.percentAttentionChange).toBeNull();
    expect(result.velocity).toBe('3');
    expect(() =>
      calculatePlatformAnalytics(platformInput(), {
        ...methodology(),
        lowBaseThreshold: '1',
        epsilon: '10',
      }),
    ).toThrow(/Epsilon/u);
  });

  it('abstains for a short or constant baseline and rejects non-comparable history', () => {
    const input = platformInput();
    expect(
      calculatePlatformAnalytics({ ...input, baseline: input.baseline.slice(0, 2) }, methodology())
        .result.zScore,
    ).toMatchObject({ value: null, status: 'insufficient_baseline' });

    const constant = input.baseline.map((window) => ({ ...window, effectiveAttention: '1' }));
    expect(calculatePlatformAnalytics({ ...input, baseline: constant }, methodology()).result.zScore)
      .toMatchObject({ value: null, status: 'zero_variance' });

    expect(() =>
      calculatePlatformAnalytics(
        {
          ...input,
          baseline: [{ ...input.baseline[0]!, methodologyVersion: 'another-version' }],
        },
        methodology(),
      ),
    ).toThrow(/non-comparable baseline/u);
  });

  it('gates confidence until semantic prerequisites are terminal and evidence is sufficient', () => {
    const input = platformInput();
    const awaitingNarrative = calculatePlatformAnalytics(
      {
        ...input,
        confidenceReadiness: { narrativeStageTerminal: false, catalystStageTerminal: false },
      },
      methodology(),
    ).result;
    expect(awaitingNarrative.confidence).toBeNull();
    expect(awaitingNarrative.confidenceStatus).toBe('awaiting_narrative_stage');

    const awaitingCatalyst = calculatePlatformAnalytics(
      {
        ...input,
        confidenceReadiness: { narrativeStageTerminal: true, catalystStageTerminal: false },
      },
      methodology(),
    ).result;
    expect(awaitingCatalyst.confidence).toBeNull();
    expect(awaitingCatalyst.confidenceStatus).toBe('awaiting_catalyst_stage');

    const oneSource = calculatePlatformAnalytics(
      {
        ...input,
        current: { ...input.current, observations: input.current.observations.slice(0, 1) },
      },
      methodology(),
    ).result;
    expect(oneSource.confidence).toBeNull();
    expect(oneSource.confidenceStatus).toBe('insufficient_evidence');
  });

  it('applies versioned confidence penalties and deterministic caps', () => {
    const input = platformInput();
    const concentrated = input.current.observations.map((observation) => ({
      ...observation,
      narrativeId: '00000000-0000-4000-8000-000000000699',
    }));
    const result = calculatePlatformAnalytics(
      {
        ...input,
        sliceStatus: 'partial',
        current: { ...input.current, observations: concentrated },
        confidencePenalties: { ...input.confidencePenalties, highNoise: '0.1' },
      },
      methodology(),
    ).result;

    expect(result.confidence).toMatchObject({
      unitScore: '0.69',
      score100: '69',
      uncappedScore100: '90',
      band: 'MEDIUM',
      totalPenalty: '0.1',
    });
    expect(result.confidence?.appliedCaps.map((cap) => cap.reason)).toEqual([
      'high_narrative_concentration',
      'partial_coverage',
    ]);
  });

  it('derives both confidence scales and its band from one rounded capped score', () => {
    const input = platformInput();
    const result = calculatePlatformAnalytics(
      { ...input, sliceStatus: 'partial' },
      {
        ...methodology(),
        confidenceCaps: { ...methodology().confidenceCaps, partialCoverage: '69.5' },
      },
    ).result;

    expect(result.confidence).toMatchObject({
      unitScore: '0.7',
      score100: '70',
      band: 'HIGH',
    });
  });

  it('does not let duplicate-group copies satisfy independent-source gates', () => {
    const input = platformInput();
    const observations = input.current.observations.map((observation) => ({
      ...observation,
      duplicateGroupKey: 'duplicate-thesis-one',
      duplicateGroupSize: '2',
    }));
    const result = calculatePlatformAnalytics(
      { ...input, current: { ...input.current, observations } },
      methodology(),
    ).result;

    expect(result.attention).toBe('2');
    expect(result.independentSourceBreadth).toBe('1');
    expect(
      result.sentimentByDimension.every(
        (metric) =>
          metric.independentSourceCount === '1' && metric.status === 'insufficient_evidence',
      ),
    ).toBe(true);
    expect(result.confidence).toBeNull();
    expect(result.confidenceStatus).toBe('insufficient_evidence');

    expect(() =>
      calculatePlatformAnalytics(
        {
          ...input,
          current: {
            ...input.current,
            observations: observations.map((observation, index) => ({
              ...observation,
              duplicateGroupSize: index === 0 ? '2' : '3',
            })),
          },
        },
        methodology(),
      ),
    ).toThrow(/disagree on group size/u);
    expect(() =>
      calculatePlatformAnalytics(
        {
          ...input,
          current: {
            ...input.current,
            observations: observations.map((observation) => ({
              ...observation,
              duplicateGroupSize: '1',
            })),
          },
        },
        methodology(),
      ),
    ).toThrow(/smaller than its window members/u);
  });

  it('normalizes set ordering and replays only frozen inputs and methodology', () => {
    const input = platformInput();
    const original = calculatePlatformAnalytics(input, methodology());
    const reordered = calculatePlatformAnalytics(
      {
        ...input,
        current: {
          ...input.current,
          observations: [...input.current.observations].reverse().map((observation) => ({
            ...observation,
            mentionIds: [...observation.mentionIds].reverse(),
            dimensions: [...observation.dimensions].reverse(),
          })),
        },
        baseline: [...input.baseline].reverse(),
      },
      methodology(),
    );
    expect(reordered.inputSetHash).toBe(original.inputSetHash);
    expect(reordered.resultHash).toBe(original.resultHash);
    expect(replayPlatformAnalytics(original)).toEqual(original);

    const revisedInput = {
      ...input,
      baseline: input.baseline.map((window) => ({
        ...window,
        methodologyVersion: 'methodology-v2',
      })),
    };
    expect(calculatePlatformAnalytics(revisedInput, methodology('methodology-v2')).inputSetHash)
      .not.toBe(original.inputSetHash);

    expect(() => replayPlatformAnalytics({ ...original, resultHash: 'f'.repeat(64) })).toThrow(
      /result mismatch/u,
    );
    expect(() =>
      replayPlatformAnalytics({
        ...original,
        inputSnapshot: { ...original.inputSnapshot, sliceStatus: 'partial' },
      }),
    ).toThrow(/input hash mismatch/u);
    expect(() =>
      replayPlatformAnalytics({
        ...original,
        methodologySnapshot: {
          ...original.methodologySnapshot,
          memePenalty: '0.8',
        },
      }),
    ).toThrow(/input hash mismatch/u);
  });

  it('enforces half-open windows and strictly historical unique baselines', () => {
    const input = platformInput();
    const first = input.current.observations[0]!;
    expect(() =>
      calculatePlatformAnalytics(
        {
          ...input,
          current: {
            ...input.current,
            observations: [{ ...first, publishedAt: input.current.windowEnd }],
          },
        },
        methodology(),
      ),
    ).toThrow(/half-open window/u);

    expect(() =>
      calculatePlatformAnalytics(
        { ...input, baseline: [input.baseline[0]!, input.baseline[0]!] },
        methodology(),
      ),
    ).toThrow(/duplicate baseline/u);

    expect(() =>
      calculatePlatformAnalytics(
        {
          ...input,
          baseline: [{ ...input.baseline[0]!, windowEnd: '2026-09-05T00:00:00Z' }],
        },
        methodology(),
      ),
    ).toThrow(/strictly historical/u);

    expect(() =>
      calculatePlatformAnalytics(
        {
          ...input,
          baseline: [
            input.baseline[0]!,
            { ...input.baseline[1]!, windowEnd: '2026-08-31T12:00:00Z' },
          ],
        },
        methodology(),
      ),
    ).toThrow(/gap-free/u);
  });

  it('keeps opposing securities independent', () => {
    const nvda = calculatePlatformAnalytics(platformInput(), methodology());
    const amdId = '00000000-0000-4000-8000-000000000605';
    const input = platformInput();
    const amd = calculatePlatformAnalytics(
      {
        ...input,
        securityId: amdId,
        current: {
          ...input.current,
          observations: input.current.observations.map((observation) => ({
            ...observation,
            securityId: amdId,
            dimensions: observation.dimensions.map((dimension) => ({
              ...dimension,
              score: dimension.score === null ? null : `-${dimension.score}`.replace('--', ''),
            })),
          })),
        },
        comparison: {
          ...input.comparison!,
          observations: input.comparison!.observations.map((observation) => ({
            ...observation,
            securityId: amdId,
          })),
        },
        baseline: input.baseline.map((window) => ({ ...window, securityId: amdId })),
      },
      methodology(),
    );

    expect(nvda.result.sentimentByDimension[0]?.sentimentIndex).toBe('25.0');
    expect(amd.result.sentimentByDimension[0]?.sentimentIndex).toBe('-25.0');
    expect(amd.resultHash).not.toBe(nvda.resultHash);
  });

  it('fails closed on excluded evidence, false duration lineage, and tampered outer lineage', () => {
    const input = platformInput();
    const first = input.current.observations[0]!;
    expect(() =>
      calculatePlatformAnalytics(
        {
          ...input,
          current: {
            ...input.current,
            observations: [{ ...first, exclusionReason: 'spam' }],
          },
        },
        methodology(),
      ),
    ).toThrow(/explicitly excluded/u);
    expect(() =>
      calculatePlatformAnalytics(
        { ...input, current: { ...input.current, durationDays: '2' } },
        methodology(),
      ),
    ).toThrow(/durationDays/u);

    const artifact = calculatePlatformAnalytics(input, methodology());
    expect(() => replayPlatformAnalytics({ ...artifact, runId: SECURITY_ID })).toThrow(
      /lineage mismatch/u,
    );
  });

  it('pins quality, noise, duplicate, and freshness weight arithmetic without floats', () => {
    const input = platformInput();
    const first = input.current.observations[0]!;
    const result = calculatePlatformAnalytics(
      {
        ...input,
        current: {
          ...input.current,
          observations: [
            {
              ...first,
              mentionIds: [first.mentionIds[0]!],
              informationValue: '0.8',
              evidenceQuality: '0.5',
              assertionStrength: '0.5',
              sarcasmProbability: '0.5',
              memeProbability: '0.5',
              duplicateGroupSize: '4',
            },
          ],
        },
      },
      methodology(),
    ).result;
    expect(result.weightTrace[0]).toMatchObject({
      baseQuality: '0.2',
      noise: '0.275',
      independence: '0.5',
      freshness: '0.5',
      weight: '0.01375',
    });

    const zeroWeight = calculatePlatformAnalytics(
      {
        ...input,
        current: {
          ...input.current,
          observations: input.current.observations.map((observation) => ({
            ...observation,
            sourceWeight: '0',
          })),
        },
      },
      methodology(),
    ).result;
    expect(zeroWeight.attention).toBe('2');
    expect(zeroWeight.effectiveAttention).toBe('0');
    expect(zeroWeight.sentimentByDimension.every((metric) => metric.status === 'insufficient_evidence'))
      .toBe(true);
    expect(zeroWeight.confidenceStatus).toBe('insufficient_evidence');
    expect(() =>
      calculatePlatformAnalytics(input, {
        ...methodology(),
        minimumEffectiveAttention: '0',
        minimumIndependentSources: '1',
      }),
    ).toThrow();
  });
});
