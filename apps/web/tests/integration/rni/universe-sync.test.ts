import { describe, expect, it } from 'vitest';
import type { FmpSp500Constituent } from '../../../src/adapters/fmp-universe';
import type { ProviderMeta } from '../../../src/contracts/provider';
import type {
  StageFmpUniverseInput,
  StageFmpUniverseOutcome,
} from '../../../src/repositories/versions';
import { synchronizeFmpUniverse, type FmpUniverseSyncDeps } from '../../../src/rni/universe/sync';
import type { UniverseSecurity } from '../../../src/rni/universe/validate';

const META: ProviderMeta = {
  provider: 'fmp',
  endpoint: 'sp500_constituent',
  requestedAt: '2026-09-05T00:00:00.000Z',
  latencyMs: 25,
  cache: 'miss',
  quotaRemaining: null,
  costUsd: null,
  payloadRef: null,
};

function completeFixture(count = 501): {
  constituents: FmpSp500Constituent[];
  securities: UniverseSecurity[];
} {
  const constituents = Array.from({ length: count }, (_, index) => ({
    symbol: index === 0 ? 'NVDA' : `T${String(index).padStart(3, '0')}`,
    name: index === 0 ? 'NVIDIA Corporation' : `Company ${index}`,
    dateFirstAdded: '2020-01-01',
  }));
  return {
    constituents,
    securities: constituents.map((member, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      symbol: member.symbol,
      name: member.name,
      exchange: 'NASDAQ',
      active: true,
    })),
  };
}

function harness(count = 501) {
  const fixture = completeFixture(count);
  const stagedInputs: StageFmpUniverseInput[] = [];
  const staged: StageFmpUniverseOutcome = {
    version: {
      id: '1',
      environment: 'preview',
      configVersion: '1',
      status: 'staged',
      parentVersion: null,
      selectedCount: count,
      selectionQuery: { preset: 'sp500_fmp_current' },
      impactPreview: { addedSecurityIds: [], removedSecurityIds: [] },
      sourceProvider: 'fmp',
      sourceEndpoint: '/stable/sp500-constituent',
      sourceRetrievedAt: new Date(META.requestedAt),
      sourcePayloadHash: 'a'.repeat(64),
      providerCallId: '00000000-0000-4000-8000-999999999999',
      createdBy: 'owner',
      changeReason: 'fixture',
      createdAt: new Date(META.requestedAt),
      activatedAt: null,
      approvedBy: null,
    },
    memberCount: count,
    reused: false,
    impactPreview: { addedSecurityIds: [], removedSecurityIds: [] },
  };
  const deps: FmpUniverseSyncDeps = {
    fetchConstituents: async () => ({
      ok: true,
      data: { constituents: fixture.constituents, payloadSha256: 'a'.repeat(64) },
      meta: META,
      providerCallId: '00000000-0000-4000-8000-999999999999',
    }),
    listSecurities: async () => fixture.securities,
    stage: async (input) => {
      stagedInputs.push(input);
      return staged;
    },
  };
  return { deps, stagedInputs };
}

const REQUEST = {
  environment: 'preview',
  actorId: 'joshuai',
  idempotencyKey: 'universe-sync-2026-09-05',
  correlationId: 'corr-1',
};

describe('synchronizeFmpUniverse', () => {
  it('stages a complete validated response without activating it', async () => {
    const h = harness();
    const result = await synchronizeFmpUniverse(REQUEST, h.deps);

    expect(result.ok).toBe(true);
    expect(h.stagedInputs).toHaveLength(1);
    expect(h.stagedInputs[0]).toMatchObject({
      environment: 'preview',
      actorId: 'joshuai',
      requestId: REQUEST.idempotencyKey,
      providerCallId: '00000000-0000-4000-8000-999999999999',
    });
    expect(h.stagedInputs[0]?.members).toHaveLength(501);
    expect(result.ok && result.staged.version.status).toBe('staged');
  });

  it('does not call the staging repository for a partial provider response', async () => {
    const h = harness(499);
    const result = await synchronizeFmpUniverse(REQUEST, h.deps);
    expect(result).toMatchObject({ ok: false, kind: 'invalid_snapshot' });
    expect(h.stagedInputs).toHaveLength(0);
  });

  it('does not read or stage on a provider failure', async () => {
    let read = false;
    let staged = false;
    const deps: FmpUniverseSyncDeps = {
      fetchConstituents: async () => ({
        ok: false,
        error: { kind: 'entitlement', endpoint: 'sp500_constituent', status: 403 },
        meta: META,
        providerCallId: '00000000-0000-4000-8000-999999999999',
      }),
      listSecurities: async () => {
        read = true;
        return [];
      },
      stage: async () => {
        staged = true;
        throw new Error('must not stage');
      },
    };
    const result = await synchronizeFmpUniverse(REQUEST, deps);
    expect(result).toMatchObject({ ok: false, kind: 'provider' });
    expect(read).toBe(false);
    expect(staged).toBe(false);
  });
});
