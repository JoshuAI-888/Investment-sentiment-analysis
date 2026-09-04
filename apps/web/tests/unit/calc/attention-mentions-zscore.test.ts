import { describe, expect, it } from 'vitest';
import golden from '../../../src/analytics/goldens/attention.mentions_zscore.json';
import { assertLean, buildLean } from './golden-helpers';

describe('attention.mentions_zscore — golden fixtures', () => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean('attention.mentions_zscore', testCase as never);
    assertLean(artifact, testCase.expected as never);
  });

  it('has a golden for the sample floor, the epsilon clamp, and a genuine anomaly', () => {
    const names = new Set(golden.cases.map((c) => c.name));
    expect(names).toContain('insufficient_history');
    expect(names).toContain('flat_history_zero_z');
    expect(names).toContain('detects_a_rise');
  });

  it('the epsilon-floor case actually clamped, not merely landed on zero by coincidence', () => {
    const flat = golden.cases.find((c) => c.name === 'flat_history_zero_z');
    const artifact = buildLean('attention.mentions_zscore', flat as never);
    expect(artifact.steps.find((s) => s.key === 'scaled_mad')?.status).toBe('clamped');
    expect(artifact.steps.find((s) => s.key === 'history_log_mad')?.exactValue).toBe('0');
  });

  it('a rise above the history cluster reports a positive z-score', () => {
    const rise = golden.cases.find((c) => c.name === 'detects_a_rise');
    const artifact = buildLean('attention.mentions_zscore', rise as never);
    expect(artifact.result?.exact.startsWith('-')).toBe(false);
    expect(artifact.result?.exact).not.toBe('0');
  });
});
