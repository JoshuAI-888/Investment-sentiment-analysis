import { describe, expect, it } from 'vitest';
import redditGolden from '../../../src/analytics/goldens/social.stance_reddit.json';
import xGolden from '../../../src/analytics/goldens/social.stance_x.json';
import substackGolden from '../../../src/analytics/goldens/social.stance_substack.json';
import { assertLean, buildLean } from './golden-helpers';
import { METHOD_REGISTRY } from '../../../src/services/calculations';

const AXES = [
  { methodId: 'social.stance_reddit', golden: redditGolden },
  { methodId: 'social.stance_x', golden: xGolden },
  { methodId: 'social.stance_substack', golden: substackGolden },
];

describe.each(AXES)('$methodId — golden fixtures (D-14: one method per axis)', ({ methodId, golden }) => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean(methodId, testCase as never);
    assertLean(artifact, testCase.expected as never);
  });

  it('has a golden for insufficient_data, the stored-but-flagged band, full display and all-zero weights', () => {
    const names = new Set(golden.cases.map((c) => c.name));
    expect(names).toContain('insufficient_data');
    expect(names).toContain('low_adequacy_stored');
    expect(names).toContain('fully_displayable');
    expect(names).toContain('all_zero_weights');
  });

  it('warns on the low-adequacy case and not on the fully-displayable one', () => {
    const low = golden.cases.find((c) => c.name === 'low_adequacy_stored');
    const full = golden.cases.find((c) => c.name === 'fully_displayable');
    expect(buildLean(methodId, low as never).warnings.some((w) => /low adequacy/i.test(w))).toBe(true);
    expect(buildLean(methodId, full as never).warnings).toHaveLength(0);
  });

  it('every stance artifact carries the selection-bias / sampling-frame disclosure (F-03)', () => {
    const entry = METHOD_REGISTRY.latest(methodId);
    expect(entry.limitations.some((line) => /sample adequacy|adequacy measures/i.test(line))).toBe(true);
    expect(entry.title).toMatch(/stance of sampled snippets/i);
  });
});

describe('social stance — the display floor compares against n_eff, not the raw item count (lane-review)', () => {
  it('flags low adequacy at n = 8 (>= display_floor by raw count) when partial weights pull n_eff below it', () => {
    // 8 items meets Reddit's display_floor of 8 by raw count. Four at full weight and four at
    // half weight (confidence 0.5) pull n_eff to 7.2 — still below the floor. Before this fix,
    // comparing against raw n would have shown this as fully displayable.
    const artifact = buildLean('social.stance_reddit', {
      name: 'n_eff_below_floor_at_n_above_it',
      inputs: {},
      seriesInputs: {
        signed: ['1', '1', '1', '1', '1', '1', '1', '1'],
        relevance: ['1', '1', '1', '1', '1', '1', '1', '1'],
        confidence: ['1', '1', '1', '1', '0.5', '0.5', '0.5', '0.5'],
        age_hours: ['0', '0', '0', '0', '0', '0', '0', '0'],
      },
      expected: { eligibility: 'ok', exact: null, display: null, abstention: null, warnings: [] },
    } as never);

    expect(artifact.eligibility).toBe('ok');
    expect(artifact.warnings.some((w) => /low adequacy/i.test(w))).toBe(true);
    expect(artifact.warnings.some((w) => /effective sample size 7\.2/.test(w))).toBe(true);
  });
});

describe('social stance — F-03: unclear/sarcasm items contribute zero direction but count toward n', () => {
  it('a signed-0 item is included in the item count and in the weight sum, contributing nothing to direction', () => {
    // 5 items, 3 directional (sum 1) and 2 "unclear" (signed = 0). n = 5 clears Reddit's floor.
    const artifact = buildLean('social.stance_reddit', {
      name: 'unclear_items_present',
      inputs: {},
      seriesInputs: {
        signed: ['1', '1', '-1', '0', '0'],
        relevance: ['1', '1', '1', '1', '1'],
        confidence: ['1', '1', '1', '1', '1'],
        age_hours: ['0', '0', '0', '0', '0'],
      },
      expected: { eligibility: 'ok', exact: null, display: null, abstention: null, warnings: [] },
    } as never);
    // raw_social = (1+1-1+0+0)/5 = 0.2; n_eff = 5 (all weights 1); shrunk = 0.2 · 5/13 = 1/13.
    expect(artifact.eligibility).toBe('ok');
    expect(artifact.result?.exact).not.toBe('0');
  });
});
