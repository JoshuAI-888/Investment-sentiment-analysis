import { describe, expect, it } from 'vitest';
import golden from '../../../src/analytics/goldens/market.composite.json';
import { assertLean, buildLean } from './golden-helpers';

describe('market.composite — golden fixtures', () => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean('market.composite', testCase as never);
    assertLean(artifact, testCase.expected as never);
  });
});

describe('market.composite — F06 §4.5: omits and renormalizes, records who participated', () => {
  it('a component with inadequate coverage is omitted from the input set, never supplied as zero', () => {
    const twoMissing = golden.cases.find((c) => c.name === 'two_missing_renormalized');
    const artifact = buildLean('market.composite', twoMissing as never);

    // Exactly the two supplied components have a contribution step; the other two do not exist
    // at all in the trace — "omitted", not "set to zero and then multiplied through".
    const contributionKeys = artifact.steps.map((s) => s.key);
    expect(contributionKeys).toContain('contribution_news_sentiment');
    expect(contributionKeys).toContain('contribution_price_regime');
    expect(contributionKeys).not.toContain('contribution_sector_breadth_score');
    expect(contributionKeys).not.toContain('contribution_sampled_retail_stance');
  });

  it('every contributing step records which components participated and which were omitted', () => {
    const twoMissing = golden.cases.find((c) => c.name === 'two_missing_renormalized');
    const artifact = buildLean('market.composite', twoMissing as never);
    const step = artifact.steps.find((s) => s.key === 'contribution_news_sentiment');
    expect(step?.notes.join(' ')).toMatch(/News sentiment/);
    expect(step?.notes.join(' ')).toMatch(/Price regime/);
    expect(step?.notes.join(' ')).toMatch(/Omitted for inadequate coverage/);
    expect(step?.notes.join(' ')).toMatch(/Sector breadth/);
    expect(step?.notes.join(' ')).toMatch(/Sampled retail stance/);
  });

  it('force two components to insufficient_data by omission and check the renormalization by hand', () => {
    // PR review step 4, verbatim: force two composite components missing, check by hand.
    // news=0.5, price=0.5, both weight-equal after renormalization ⇒ composite = 0.5.
    const artifact = buildLean('market.composite', {
      name: 'hand_check',
      inputs: { news_sentiment: '0.5', price_regime: '0.5' },
      expected: { eligibility: 'ok', exact: null, display: null, abstention: null, warnings: [] },
    } as never);
    expect(artifact.result?.exact).toBe('0.5');
  });
});
