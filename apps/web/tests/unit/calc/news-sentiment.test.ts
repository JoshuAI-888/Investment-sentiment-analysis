import { describe, expect, it } from 'vitest';
import golden from '../../../src/analytics/goldens/news.sentiment.json';
import { assertLean, buildLean } from './golden-helpers';
import { METHOD_REGISTRY } from '../../../src/services/calculations';

describe('news.sentiment — golden fixtures', () => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean('news.sentiment', testCase as never);
    assertLean(artifact, testCase.expected as never);
  });

  it('publisher-quality weighting is a fixed constant, not an editable assumption (F-08)', () => {
    const entry = METHOD_REGISTRY.latest('news.sentiment');
    expect(entry.editableAssumptions).toHaveLength(0);
    expect(entry.limitations.some((l) => /source_weight/.test(l))).toBe(true);
  });
});

describe('news.sentiment — the ugliest input: no articles at all', () => {
  // 05-TEST-STRATEGY §3's "empty input" case — zero declared items, not merely "below floor".
  it('abstains on a wholly empty series the same way as a merely-thin one', () => {
    const artifact = buildLean('news.sentiment', {
      name: 'empty',
      seriesInputs: { entity_sentiment: [], relevance: [], age_hours: [] },
      expected: { eligibility: 'insufficient_data', exact: null, display: null, abstention: null, warnings: [] },
    } as never);
    expect(artifact.eligibility).toBe('insufficient_data');
    expect(artifact.abstention?.message).toContain('0 entity-tagged article(s)');
  });
});
