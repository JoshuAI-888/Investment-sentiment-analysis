import { describe, expect, it } from 'vitest';

import { calculatePlatformAnalytics, replayPlatformAnalytics } from '../../../src/rni/analytics';
import { methodology, platformInput } from '../../unit/rni/analytics/fixtures';

describe('RNI platform analytics deterministic eval', () => {
  it('reproduces the frozen golden exactly across calculation and replay', () => {
    const artifact = calculatePlatformAnalytics(platformInput(), methodology());
    const replayed = replayPlatformAnalytics(artifact);

    expect(replayed.inputSetHash).toBe(artifact.inputSetHash);
    expect(replayed.resultHash).toBe(artifact.resultHash);
    expect(replayed.result).toEqual(artifact.result);
    expect(replayed.result.sentimentByDimension.map((metric) => metric.sentimentIndex)).toEqual([
      '25.0',
      '25.0',
      '25.0',
      '25.0',
    ]);
    expect(replayed.result.zScore).toMatchObject({ value: '0', status: 'available' });
    expect(replayed.result.confidence).toMatchObject({
      unitScore: '1',
      score100: '100',
      meaning: 'evidence_defensibility_not_price_probability',
    });
  });
});

