import { describe, expect, it } from 'vitest';

import { convergePlatformFacts, replayPlatformFacts } from '@/rni/convergence';
import { convergenceRequest, dimensions, platformInput } from '../../unit/rni/convergence/fixtures';

const cases = [
  {
    name: 'aligned',
    request: convergenceRequest(),
    expectedStatus: 'COMPLETE_CROSS_SOURCE',
    expectedState: 'aligned',
  },
  {
    name: 'divergent',
    request: convergenceRequest({
      x: platformInput('x', {
        stance: 'strong_bearish',
        stanceScore: '-0.9',
        dimensions: dimensions('strong_bearish', '-0.9'),
      }),
    }),
    expectedStatus: 'DIVERGENT_CROSS_SOURCE',
    expectedState: 'divergent',
  },
] as const;

describe('RNI deterministic convergence synthetic eval', () => {
  it.each(cases)('$name case is exact and replayable', ({ request, expectedStatus, expectedState }) => {
    const artifact = convergePlatformFacts(request);
    expect(artifact.result.status).toBe(expectedStatus);
    expect(artifact.result.radarState).toBe(expectedState);
    expect(replayPlatformFacts(artifact)).toEqual(artifact);
  });
});
