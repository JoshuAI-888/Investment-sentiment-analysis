import { describe, it } from 'vitest';
import golden from '../../../src/analytics/goldens/attention.mention_delta.json';
import { assertLean, buildLean } from './golden-helpers';

describe('attention.mention_delta — golden fixtures', () => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean('attention.mention_delta', testCase as never);
    assertLean(artifact, testCase.expected as never);
  });
});
