import { describe, it } from 'vitest';
import golden from '../../../src/analytics/goldens/market.sector_breadth.json';
import { assertLean, buildLean } from './golden-helpers';

describe('market.sector_breadth — golden fixtures', () => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean('market.sector_breadth', testCase as never);
    assertLean(artifact, testCase.expected as never);
  });
});
