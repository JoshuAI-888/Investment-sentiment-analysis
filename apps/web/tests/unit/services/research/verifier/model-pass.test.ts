import { describe, expect, it } from 'vitest';
import { runModelVerificationPass } from '../../../../../src/services/research/verifier/model-pass';
import { createFixtureModelClient } from '../../../../../src/services/research/model-client';
import { createFakeClock } from '../../../../../src/services/research/testing';
import type { FlatClaim } from '../../../../../src/services/research/synthesis';

const CLAIM: FlatClaim = {
  section: 'summary',
  text: 'Mentions rose.',
  kind: 'fact',
  evidenceIds: ['11111111-1111-1111-1111-111111111111'],
  metricIds: [],
  assertsStanceForAxis: null,
};

describe('runModelVerificationPass', () => {
  it('returns ok with an empty verdict list for zero claims, without calling the model', async () => {
    const clock = createFakeClock(new Date());
    let called = false;
    const model = createFixtureModelClient(() => {
      called = true;
      return { verdicts: [] };
    });
    const result = await runModelVerificationPass(model, [], 'evidence', clock, 4_000);
    expect(result).toEqual({ outcome: 'ok', verdict: { verdicts: [] } });
    expect(called).toBe(false);
  });

  it('returns ok with the parsed verdict on a well-formed response', async () => {
    const clock = createFakeClock(new Date());
    const model = createFixtureModelClient(() => ({
      verdicts: [{ claimIndex: 0, supported: true, rationale: 'matches the cited item' }],
    }));
    const result = await runModelVerificationPass(model, [CLAIM], 'evidence', clock, 4_000);
    expect(result.outcome).toBe('ok');
    if (result.outcome === 'ok') {
      expect(result.verdict.verdicts[0]?.supported).toBe(true);
    }
  });

  it('returns timeout when the model never responds within budget', async () => {
    const clock = createFakeClock(new Date());
    const model = {
      classify: () => new Promise<never>(() => undefined),
      synthesize: () => new Promise<never>(() => undefined),
      verify: () => new Promise<never>(() => undefined),
    };
    const result = await runModelVerificationPass(model, [CLAIM], 'evidence', clock, 4_000);
    expect(result.outcome).toBe('timeout');
  });

  it('returns error when the model throws', async () => {
    const clock = createFakeClock(new Date());
    const model = {
      classify: () => Promise.reject(new Error('boom')),
      synthesize: () => Promise.reject(new Error('boom')),
      verify: () => Promise.reject(new Error('boom')),
    };
    const result = await runModelVerificationPass(model, [CLAIM], 'evidence', clock, 4_000);
    expect(result.outcome).toBe('error');
  });
});
