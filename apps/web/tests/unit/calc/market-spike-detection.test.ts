import { describe, expect, it } from 'vitest';
import { buildArtifact, type CalculationInputValue, type ResolvedAssumption } from '../../../src/calc/artifact';
import {
  computeMarketSpikeDetection,
  DEFAULT_SPIKE_THRESHOLD_PCT,
  MARKET_SPIKE_DETECTION_ID,
  MARKET_SPIKE_DETECTION_VERSION,
} from '../../../src/calc/methods/market-spike-detection';

const THRESHOLD_ASSUMPTION: ResolvedAssumption = {
  key: 'spike_threshold_pct',
  value: DEFAULT_SPIKE_THRESHOLD_PCT,
  unit: 'ratio',
  source: 'code_invariant',
  officialValue: DEFAULT_SPIKE_THRESHOLD_PCT,
  min: null,
  max: null,
  editable: false,
};

function priceInput(key: 'close_now' | 'close_prior', value: string): CalculationInputValue {
  return {
    key,
    value,
    unit: 'usd',
    dataType: 'decimal',
    source: 'market',
    quality: 'ok',
    freshness: 'fresh',
    provenance: {
      provider: 'fmp',
      providerField: 'market_snapshot.price',
      sourceUrl: null,
      observedAt: '2026-09-01T00:00:00.000Z',
      availableAt: '2026-09-01T00:00:00.000Z',
      ingestedAt: '2026-09-01T00:05:00.000Z',
      rawPayloadId: null,
      licenseClass: 'provider_terms',
      redactionClass: 'public',
    },
  };
}

function build(inputs: readonly CalculationInputValue[], assumptions: readonly ResolvedAssumption[] = [THRESHOLD_ASSUMPTION]) {
  return buildArtifact({
    method: {
      methodId: MARKET_SPIKE_DETECTION_ID,
      version: MARKET_SPIKE_DETECTION_VERSION,
      unit: 'flag',
      roundingRule: 'int_0dp_half_even',
      workingPrecision: 34,
      compute: computeMarketSpikeDetection,
    },
    subject: { kind: 'security', id: 'sec-1', label: 'TEST' },
    asOf: '2026-09-01T00:00:00.000Z',
    inputs,
    assumptions,
    configVersion: '1',
    scenario: { kind: 'official' },
    calculationId: '00000000-0000-4000-8000-000000000001',
    computedAt: '2026-09-01T00:05:00.000Z',
  });
}

describe('market.spike_detection', () => {
  it('fires when the move crosses the threshold, and the percent change is inspectable', () => {
    const artifact = build([priceInput('close_now', '106'), priceInput('close_prior', '100')]);
    expect(artifact.abstention).toBeNull();
    expect(artifact.result?.exact).toBe('1');
    expect(artifact.steps.find((s) => s.key === 'percent_change')?.exactValue).toBe('0.06');
    expect(artifact.steps.find((s) => s.key === 'threshold_crossed')?.status).toBe('applied');
  });

  it('does not fire, but still writes a full, inspectable artifact, when the move is under the band', () => {
    const artifact = build([priceInput('close_now', '101'), priceInput('close_prior', '100')]);
    expect(artifact.abstention).toBeNull();
    expect(artifact.result?.exact).toBe('0');
    expect(artifact.steps.find((s) => s.key === 'threshold_crossed')?.status).toBe('excluded');
    expect(artifact.steps.find((s) => s.key === 'percent_change')?.exactValue).toBe('0.01');
  });

  it('fires on a downward move of equal magnitude — direction is discarded, not signed', () => {
    const artifact = build([priceInput('close_now', '94'), priceInput('close_prior', '100')]);
    expect(artifact.result?.exact).toBe('1');
    expect(artifact.steps.find((s) => s.key === 'percent_change')?.exactValue).toBe('-0.06');
    expect(artifact.steps.find((s) => s.key === 'abs_percent_change')?.exactValue).toBe('0.06');
  });

  it('fires exactly at the boundary (>=, not >)', () => {
    const artifact = build([priceInput('close_now', '105'), priceInput('close_prior', '100')]);
    expect(artifact.result?.exact).toBe('1');
  });

  it('abstains, and still writes an artifact, when there is no prior close', () => {
    const artifact = build([priceInput('close_now', '100')]);
    expect(artifact.result).toBeNull();
    expect(artifact.abstention?.reason).toBe('below_sample_threshold');
    expect(artifact.eligibility).toBe('insufficient_data');
    // Abstention is still a hashed, recorded outcome (product invariant §6.3) — not a thrown error.
    expect(artifact.resultHash).toBeTruthy();
  });

  it('abstains when there is no current close', () => {
    const artifact = build([priceInput('close_prior', '100')]);
    expect(artifact.abstention?.reason).toBe('below_sample_threshold');
  });

  it('abstains rather than divide by a zero or negative prior close', () => {
    const artifact = build([priceInput('close_now', '10'), priceInput('close_prior', '0')]);
    expect(artifact.abstention?.reason).toBe('not_applicable');
    expect(artifact.eligibility).toBe('not_applicable');
  });

  it('abstains on a negative current close', () => {
    const artifact = build([priceInput('close_now', '-5'), priceInput('close_prior', '100')]);
    expect(artifact.abstention?.reason).toBe('not_applicable');
  });

  it('never produces a raw JS number anywhere in its trace — every operand and result is a decimal string', () => {
    const artifact = build([priceInput('close_now', '106'), priceInput('close_prior', '100')]);
    for (const step of artifact.steps) {
      expect(typeof step.exactValue).toBe('string');
      expect(typeof step.displayValue).toBe('string');
      for (const value of Object.values(step.operands)) {
        expect(typeof value).toBe('string');
      }
    }
    expect(typeof artifact.result?.exact).toBe('string');
  });
});
