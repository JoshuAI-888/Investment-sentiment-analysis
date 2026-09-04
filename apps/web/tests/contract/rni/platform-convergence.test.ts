import { describe, expect, it } from 'vitest';

import * as convergence from '../../../src/rni/convergence';
import { rniRadarCombinedCell } from '../../../src/rni/contracts';
import { convergenceRequest } from '../../unit/rni/convergence/fixtures';

function keysIn(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) keysIn(entry, result);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      result.add(key);
      keysIn(entry, result);
    }
  }
  return result;
}

describe('RNI convergence contract', () => {
  it('exposes only the deterministic fact calculation and replay boundary', () => {
    expect(Object.keys(convergence).sort()).toEqual([
      'RNI_CONVERGENCE_CODE_VERSION',
      'convergePlatformFacts',
      'replayPlatformFacts',
    ]);
  });

  it('maps to the frozen combined state while preserving both platform records exactly', () => {
    const request = convergenceRequest();
    const artifact = convergence.convergePlatformFacts(request);

    expect(
      rniRadarCombinedCell.parse({
        state: artifact.result.radarState,
        summary: 'Deterministic cross-source facts await cited synthesis.',
        citationIds: [],
      }).state,
    ).toBe('aligned');
    expect(artifact.result.platforms).toEqual({ reddit: request.reddit, x: request.x });
  });

  it('contains no pooled or masquerading platform metric and no model/prompt boundary', () => {
    const artifact = convergence.convergePlatformFacts(convergenceRequest());
    const keys = keysIn(artifact.result);
    for (const forbidden of [
      'combinedSentiment',
      'combinedAttention',
      'combinedSourceCount',
      'sourceCount',
      'metric',
      'confidence',
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(JSON.stringify(artifact)).not.toMatch(/modelId|prompt|citationIds/u);
  });
});
