import { describe, expect, it } from 'vitest';
import golden from '../../../src/analytics/goldens/attention.mention_growth.json';
import { buildArtifact } from '../../../src/calc/artifact';
import { METHOD_REGISTRY } from '../../../src/services/calculations';
import { assertLean, buildLean, decimalInput } from './golden-helpers';

describe('attention.mention_growth — golden fixtures', () => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean('attention.mention_growth', testCase as never);
    assertLean(artifact, testCase.expected as never);
  });

  it('has a golden for both the happy path and the abstention', () => {
    const outcomes = new Set(golden.cases.map((c) => c.expected.eligibility));
    expect(outcomes).toContain('ok');
    expect(outcomes).toContain('insufficient_data');
  });
});

describe('attention.mention_growth — the divide-by-zero guard', () => {
  // Unreachable through the registered threshold (prior < 5 always abstains first), but the
  // formula names `max(mentions_prior, 1)` and an executable specification does not get to drop
  // a term it happens not to need under today's threshold — so it is tested directly, with the
  // threshold assumption overridden down to zero.
  it('floors mentions_prior at one rather than dividing by zero', () => {
    const entry = METHOD_REGISTRY.latest('attention.mention_growth');
    const artifact = buildArtifact({
      method: {
        methodId: entry.id,
        version: entry.version,
        unit: entry.unit,
        roundingRule: entry.roundingRule,
        workingPrecision: entry.workingPrecision,
        compute: entry.compute,
      },
      subject: { kind: 'security', id: 'sec-guard', label: 'GUARD' },
      asOf: '2026-08-30T12:00:00.000Z',
      inputs: [decimalInput('mentions_now', '10'), decimalInput('mentions_prior', '0')],
      assumptions: [
        {
          key: 'min_mentions',
          value: '0',
          unit: 'mentions',
          source: 'account_default',
          officialValue: '5',
          min: null,
          max: null,
          editable: true,
        },
      ],
      configVersion: '1',
      scenario: { kind: 'official' },
      calculationId: '00000000-0000-4000-8000-000000000002',
      computedAt: '2026-08-30T12:00:01.000Z',
    });
    expect(artifact.eligibility).toBe('ok');
    expect(artifact.result?.exact).toBe('10');
    expect(artifact.steps.find((s) => s.key === 'guarded_prior')?.status).toBe('clamped');
  });
});
