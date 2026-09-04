import { describe, expect, it } from 'vitest';
import golden from '../../../src/analytics/goldens/market.divergence_state.json';
import { assertLean, buildLean } from './golden-helpers';
import { DIVERGENCE_DISCLOSURE_LINE, DIVERGENCE_STATE_BY_CODE } from '../../../src/calc/divergence';

describe('market.divergence_state — golden fixtures (source §8.6, all five rows plus the fallback)', () => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean('market.divergence_state', testCase as never);
    assertLean(artifact, testCase.expected as never);
  });

  it('covers every named state and the fallback exactly once', () => {
    const names = golden.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(6);
    for (const testCase of golden.cases) {
      const artifact = buildLean('market.divergence_state', testCase as never);
      const code = artifact.result?.exact as string;
      expect(DIVERGENCE_STATE_BY_CODE[code]).toBe(testCase.name);
    }
  });

  // F-17, binding: the disclosure line is part of the method's output on every outcome.
  it('every divergence artifact carries the §6.4 disclosure line, verbatim, in its warnings', () => {
    for (const testCase of golden.cases) {
      const artifact = buildLean('market.divergence_state', testCase as never);
      expect(artifact.warnings).toContain(DIVERGENCE_DISCLOSURE_LINE);
    }
  });
});
