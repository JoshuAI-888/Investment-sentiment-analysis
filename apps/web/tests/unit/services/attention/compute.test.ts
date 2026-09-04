import { describe, expect, it, vi } from 'vitest';
import type { CalculationArtifact } from '@/calc/artifact';
import type { AttentionSnapshot } from '@/contracts/security';
import type * as CalculationsModule from '@/services/calculations';
import type * as DashboardInputsModule from '@/services/dashboard/inputs';

/**
 * `compute.ts#computeAndStore`'s divergence-detection branch (lane-review round 2 finding 3):
 * a `calculationId` collision whose existing row does NOT hold the same content as what was just
 * recomputed must raise a loud, specific error rather than being silently swallowed as
 * "already exists". This cannot be reproduced against a real Postgres — the integration suite
 * (`tests/integration/attention-pipeline.test.ts`) confirms `calculation_snapshot`'s own
 * append-only trigger rejects the `update` that would be needed to corrupt an existing row's
 * `input_hash` out from under its `id` — so `persistArtifact`/`loadArtifact` are mocked here to
 * exercise the branch directly.
 */
const persistArtifact = vi.fn<(artifact: CalculationArtifact) => Promise<string>>();
const loadArtifact = vi.fn<(calculationId: string) => Promise<CalculationArtifact | null>>();

vi.mock('@/services/calculations', async (importOriginal) => {
  const actual = await importOriginal<typeof CalculationsModule>();
  return {
    ...actual,
    persistArtifact: (artifact: CalculationArtifact) => persistArtifact(artifact),
    loadArtifact: (calculationId: string) => loadArtifact(calculationId),
  };
});

// Controls exactly what `officialAssumptions('attention.rank_change')` returns, so the test below
// can assert `deterministicCalculationId` actually changes when assumption *values* change with
// everything else (inputs, methodId, methodVersion, subjectId, configVersion) held fixed —
// lane-review round 2 finding 3's other half, alongside the divergence-detection tests below.
let mockAssumptionValue = '25';
vi.mock('@/services/dashboard/inputs', async (importOriginal) => {
  const actual = await importOriginal<typeof DashboardInputsModule>();
  return {
    ...actual,
    officialAssumptions: (methodId: string) =>
      methodId === 'attention.rank_change'
        ? [
            {
              key: 'min_mentions',
              value: mockAssumptionValue,
              unit: 'mentions',
              source: 'official_default' as const,
              officialValue: mockAssumptionValue,
              min: '1',
              max: '1000',
              editable: true,
            },
            {
              key: 'board_size',
              value: '100',
              unit: '',
              source: 'official_default' as const,
              officialValue: '100',
              min: null,
              max: null,
              editable: false,
            },
          ]
        : actual.officialAssumptions(methodId),
  };
});

const NOW = new Date('2026-08-30T18:00:00.000Z');

function snapshot(overrides: Partial<AttentionSnapshot> = {}): AttentionSnapshot {
  return {
    securityId: '11111111-1111-1111-1111-111111111111',
    source: 'apewisdom',
    rank: 10,
    rankPrior: 20,
    mentions: 140,
    mentionsPrior: 100,
    engagement: 500,
    windowHours: 24,
    coverageClass: 'pov_index',
    providerMethodologyVersion: 'apewisdom-2026-09',
    observedAt: NOW,
    ingestedAt: NOW,
    rawHash: 'hash-1',
    ...overrides,
  };
}

vi.mock('@/repositories/attention', () => ({
  attentionSnapshotHistory: vi.fn(async (query: { limit?: number }) => {
    // `limit: 2` is the current+prior lookup; the unlimited call is the z-score history window.
    if (query.limit === 2) return [snapshot()];
    return [snapshot()];
  }),
}));

const { computeAttentionMetrics } = await import('@/services/attention/compute');

describe('deterministicCalculationId includes assumptions (lane-review round 2 finding 3)', () => {
  it('produces a different calculationId when assumption values differ, all else held fixed', async () => {
    persistArtifact.mockImplementation(async () => 'ok');

    mockAssumptionValue = '25';
    const first = await computeAttentionMetrics({
      securityId: snapshot().securityId,
      symbol: 'GME',
      configVersion: 'cfg-1',
      now: NOW,
    });

    mockAssumptionValue = '999';
    const second = await computeAttentionMetrics({
      securityId: snapshot().securityId,
      symbol: 'GME',
      configVersion: 'cfg-1',
      now: NOW,
    });
    mockAssumptionValue = '25';

    expect(first?.rankChange.calculationId).toBeTruthy();
    expect(second?.rankChange.calculationId).toBeTruthy();
    expect(second?.rankChange.calculationId).not.toBe(first?.rankChange.calculationId);
  });
});

describe('computeAndStore — collision handling (lane-review round 2 finding 3)', () => {
  it('swallows a unique-violation only when the existing row genuinely holds the same content', async () => {
    persistArtifact.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));
    loadArtifact.mockImplementation(async () => null);

    // `loadArtifact` returning `null` (a row briefly invisible under this transaction's own
    // isolation, not a genuine divergence) must not be treated as a silent "already exists" —
    // there is nothing to compare against, so this must fail loudly too, not swallow blindly.
    await expect(
      computeAttentionMetrics({ securityId: snapshot().securityId, symbol: 'GME', configVersion: 'cfg-1', now: NOW }),
    ).rejects.toThrow(/collided with an existing calculation_snapshot row/);
  });

  it('swallows the collision when the existing row\'s inputHash matches what was just computed', async () => {
    let capturedArtifact: CalculationArtifact | undefined;
    persistArtifact.mockImplementationOnce(async (artifact) => {
      capturedArtifact = artifact;
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    });
    loadArtifact.mockImplementation(async () => {
      if (capturedArtifact === undefined) throw new Error('test setup: persistArtifact was not called first');
      // The row "already on disk" reports the identical inputHash — the genuinely safe case.
      return { ...capturedArtifact };
    });

    const metrics = await computeAttentionMetrics({
      securityId: snapshot().securityId,
      symbol: 'GME',
      configVersion: 'cfg-1',
      now: NOW,
    });
    expect(metrics).not.toBeNull();
    expect(metrics?.rankChange.calculationId).toBeTruthy();
  });

  it('raises a loud, specific error when the existing row\'s inputHash differs from what was just computed', async () => {
    let capturedArtifact: CalculationArtifact | undefined;
    persistArtifact.mockImplementationOnce(async (artifact) => {
      capturedArtifact = artifact;
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    });
    loadArtifact.mockImplementation(async () => {
      if (capturedArtifact === undefined) throw new Error('test setup: persistArtifact was not called first');
      // The row "already on disk" reports a DIFFERENT inputHash under the same id — exactly what
      // `officialAssumptions` changing without a method-version bump would produce.
      return { ...capturedArtifact, inputHash: `not-${capturedArtifact.inputHash}` };
    });

    await expect(
      computeAttentionMetrics({ securityId: snapshot().securityId, symbol: 'GME', configVersion: 'cfg-1', now: NOW }),
    ).rejects.toThrow(/collided with an existing calculation_snapshot row whose content does not match/);
  });

  it('never claims byte-for-byte equivalence without actually reading the existing row back first', async () => {
    persistArtifact.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));
    loadArtifact.mockClear();
    loadArtifact.mockImplementation(async () => null);

    await expect(
      computeAttentionMetrics({ securityId: snapshot().securityId, symbol: 'GME', configVersion: 'cfg-1', now: NOW }),
    ).rejects.toThrow();
    expect(loadArtifact).toHaveBeenCalledTimes(1);
  });
});
