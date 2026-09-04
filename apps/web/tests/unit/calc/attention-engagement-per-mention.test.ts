import { describe, expect, it } from 'vitest';
import golden from '../../../src/analytics/goldens/attention.engagement_per_mention.json';
import { assertLean, buildLean } from './golden-helpers';

describe('attention.engagement_per_mention — golden fixtures', () => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean('attention.engagement_per_mention', testCase as never);
    assertLean(artifact, testCase.expected as never);
  });

  it('always resolves to ok — there is no sample floor, only the divide guard', () => {
    for (const testCase of golden.cases) {
      expect(testCase.expected.eligibility).toBe('ok');
    }
  });
});
