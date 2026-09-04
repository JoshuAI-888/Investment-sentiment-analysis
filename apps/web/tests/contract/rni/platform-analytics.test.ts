import { describe, expect, it } from 'vitest';

import * as analytics from '../../../src/rni/analytics';
import { rniDimensionAssignment, rniDimensionKey, rniUnitDecimal } from '../../../src/rni/contracts';
import { methodology, platformInput } from '../../unit/rni/analytics/fixtures';

describe('RNI platform analytics contract', () => {
  it('exposes only deterministic calculate/replay functions and platform-bound artifacts', () => {
    expect(Object.keys(analytics).sort()).toEqual([
      'RNI_ANALYTICS_CODE_VERSION',
      'RNI_CONFIDENCE_COMPONENT_KEYS',
      'RNI_CONFIDENCE_PENALTY_KEYS',
      'calculatePlatformAnalytics',
      'replayPlatformAnalytics',
    ]);

    const artifact = analytics.calculatePlatformAnalytics(platformInput(), methodology());
    expect(artifact.calculationCodeVersion).toBe(analytics.RNI_ANALYTICS_CODE_VERSION);
    expect(artifact.inputSnapshot.platform).toBe('reddit');
    expect(artifact.result.platform).toBe('reddit');
    expect(artifact.result.confidence).not.toBeNull();
    expect(rniUnitDecimal.parse(artifact.result.confidence?.unitScore)).toBe('1');
    expect(artifact.result.sentimentByDimension.map((metric) => metric.dimension)).toEqual(
      rniDimensionKey.options,
    );
    for (const metric of artifact.result.sentimentByDimension) {
      expect(
        rniDimensionAssignment.parse({
          dimension: metric.dimension,
          stance: metric.sentimentIndex === null ? 'insufficient' : 'bullish',
          score: metric.meanDirection,
          rationale: 'Deterministic aggregate over persisted platform evidence.',
        }),
      ).toBeDefined();
    }
  });

  it('contains no combined-source output or model/provider boundary', () => {
    const artifact = analytics.calculatePlatformAnalytics(platformInput(), methodology());
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain('combined');
    expect(serialized).not.toContain('modelId');
    expect(serialized).not.toContain('prompt');
  });
});

