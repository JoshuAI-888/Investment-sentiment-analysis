import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PostgresRniReadService,
  PostgresRniUniverseReadService,
  RniReadError,
} from '../../../../src/rni/read-model';
import {
  ReadDatabase,
  type ReadSnapshot,
} from '../../../../src/rni/read-model/repositories/snapshot';
import { calculatePlatformAnalytics } from '../../../../src/rni/analytics';
import { convergePlatformFacts } from '../../../../src/rni/convergence';
import { canonicalHash } from '../../../../src/calc/canonical';
import { methodology, platformInput } from '../analytics/fixtures';
import { convergenceRequest, platformInput as factInput } from '../convergence/fixtures';
import {
  rniDimensionKey,
  type RniCombinedSummary,
  type RniPlatformSlice,
} from '../../../../src/rni/contracts';

const at = '2026-09-05T12:00:00Z';
const runId = platformInput().runId;
const security = {
  id: platformInput().securityId,
  ticker: 'NVDA',
  companyName: 'NVIDIA Corporation',
  exchange: 'NASDAQ',
};
const cid = { reddit: randomUUID(), x: randomUUID() };
const options = {
  environment: 'test',
  rightsPolicyVersion: async () => 'rights-v1',
  now: () => new Date(at),
};

function fixture() {
  const slices: RniPlatformSlice[] = ['reddit', 'x'].map((platform) => ({
    id: platformInput(platform as 'reddit' | 'x').runSourceSliceId,
    runId,
    platform: platform as 'reddit' | 'x',
    status: 'complete',
    eligibleSourceCount: 999,
    coverageDisclosure: `${platform} is sampled`,
    lastAttemptAt: at,
    lastSuccessfulRefreshAt: at,
    dataThroughAt: '2026-09-05T11:00:00Z',
    computedAt: at,
    errorCode: null,
  }));
  const reddit = calculatePlatformAnalytics(platformInput(), methodology());
  const inputX = platformInput('x');
  const x = calculatePlatformAnalytics(
    {
      ...inputX,
      current: {
        ...inputX.current,
        observations: inputX.current.observations.map((o) => ({
          ...o,
          dimensions: o.dimensions.map((d) => ({ ...d, score: '-0.5' })),
        })),
      },
    },
    methodology(),
  );
  const fact = (key: 'reddit' | 'x') =>
    factInput(key, {
      runId,
      securityId: security.id,
      runSourceSliceId: platformInput(key).runSourceSliceId,
      methodologyVersion: reddit.methodologyVersion,
      stance: key === 'reddit' ? 'bullish' : 'bearish',
      stanceScore: key === 'reddit' ? '0.25' : '-0.5',
      effectiveAttention: '1',
      analyticsArtifactHash: canonicalHash(key === 'reddit' ? reddit : x),
      dimensions: (key === 'reddit' ? reddit : x).result.sentimentByDimension.map((d) => ({
        dimension: d.dimension,
        score: d.meanDirection,
        stance: key === 'reddit' ? 'bullish' : 'bearish',
      })),
    });
  const convergence = convergePlatformFacts(
    convergenceRequest({ reddit: fact('reddit'), x: fact('x') }),
  );
  const summary: RniCombinedSummary = {
    id: randomUUID(),
    runId,
    securityId: security.id,
    status: 'complete',
    createdAt: at,
    sections: [
      {
        heading: 'Reddit sentiment',
        status: 'complete',
        text: 'Reddit evidence is bullish.',
        citationIds: [cid.reddit],
      },
      {
        heading: 'X sentiment',
        status: 'complete',
        text: 'X evidence is bearish.',
        citationIds: [cid.x],
      },
      {
        heading: 'Combined summary',
        status: 'complete',
        text: 'The source conclusions diverge.',
        citationIds: [cid.reddit, cid.x],
      },
    ],
  };
  const store = {
    run: vi.fn(async () => ({
      id: runId,
      idempotencyKey: 'read-test',
      trigger: 'manual',
      status: 'complete',
      windowStart: reddit.inputSnapshot.current.windowStart,
      windowEnd: at,
      comparisonStart: null,
      comparisonEnd: null,
      universeVersion: '1',
      configVersion: '1',
      promptVersion: 'p1',
      aiRoute: 'openai_direct',
      requestedAt: at,
      completedAt: at,
    })),
    slices: vi.fn(async () => slices),
    securities: vi.fn(async () => [security]),
    requireResultVisibility: vi.fn(async () => null),
    publication: vi.fn(async (): Promise<RniCombinedSummary | null> => summary),
    artifacts: vi.fn(async () => ({ convergence, reddit, x })),
    citation: vi.fn(async (id: string) => ({
      id,
      sourceItemId: reddit.result.weightTrace[0]!.sourceItemId,
      platform: id === cid.reddit ? 'reddit' : 'x',
      url: 'https://www.reddit.com/r/stocks/comments/test/',
      evidenceText: 'Evidence',
    })),
    dimensionCitations: vi.fn(async (_id: string, key: 'reddit' | 'x') =>
      rniDimensionKey.options.flatMap((dimension) =>
        (key === 'reddit' ? reddit : x).result.weightTrace.map((t) => ({
          dimension,
          source_item_id: t.sourceItemId,
          citation_id: cid[key],
        })),
      ),
    ),
    sourceCount: vi.fn(async () => 0),
  };
  vi.spyOn(ReadDatabase.prototype, 'snapshot').mockImplementation(async (read) =>
    read(store as unknown as ReadSnapshot),
  );
  return { service: new PostgresRniReadService(options), store, slices, summary };
}
afterEach(() => vi.restoreAllMocks());

describe('I08 source-separated read projections', () => {
  it('keeps operational reads available while result reads enforce the visibility gate', async () => {
    const { service, store } = fixture();
    store.requireResultVisibility.mockRejectedValue(new RniReadError('CONFLICT'));
    await expect(service.getRun(runId)).resolves.toMatchObject({ id: runId });
    expect(store.requireResultVisibility).not.toHaveBeenCalled();
    await expect(service.getRadarPage({ runId })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.getSecurityDetail(runId, security.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(service.getSecuritySummary(runId, security.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('uses security-specific analytics, full cited explanations and four independent dimensions', async () => {
    const { service } = fixture();
    const page = await service.getRadarPage({ runId });
    expect(page.rows[0]?.reddit).toMatchObject({
      stance: 'bullish',
      eligibleSourceCount: 2,
      citationIds: [cid.reddit],
    });
    expect(page.rows[0]?.x).toMatchObject({
      stance: 'bearish',
      eligibleSourceCount: 2,
      citationIds: [cid.x],
    });
    expect(page.rows[0]?.combined).toMatchObject({
      state: 'divergent',
      citationIds: [cid.reddit, cid.x],
    });
    const detail = await service.getSecurityDetail(runId, security.id);
    expect(
      detail.reddit.dimensions.every((d) => d.stance === 'bullish' && d.citationIds.length),
    ).toBe(true);
    expect(detail.x.dimensions.every((d) => d.stance === 'bearish' && d.citationIds.length)).toBe(
      true,
    );
    expect(detail.reddit.dimensions).toHaveLength(4);
  });

  it.each(['reddit', 'x'] as const)(
    'keeps %s failure explicit and preserves the other source',
    async (key) => {
      const { service, slices, summary } = fixture();
      slices.find((s) => s.platform === key)!.status = 'unavailable';
      summary.sections.find(
        (s) => s.heading === (key === 'reddit' ? 'Reddit sentiment' : 'X sentiment'),
      )!.status = 'insufficient';
      const row = (await service.getRadarPage({ runId })).rows[0]!;
      expect(row[key]).toMatchObject({
        status: 'unavailable',
        stance: 'insufficient',
        citationIds: [],
      });
      expect(row[key === 'reddit' ? 'x' : 'reddit'].stance).not.toBe('insufficient');
      expect(row.combined.state).toBe('partial');
      expect(row.combined.summary).not.toContain('diverge');
    },
  );

  it('withholds synthesis during refresh, then represents empty results without neutral sentiment', async () => {
    const { service, slices, store } = fixture();
    slices[0]!.status = 'running';
    expect((await service.getRadarPage({ runId })).rows[0]?.combined.state).toBe('pending');
    expect(store.publication).not.toHaveBeenCalled();
    await expect(service.getSecuritySummary(runId, security.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    slices[0]!.status = 'complete';
    store.publication.mockResolvedValue(null);
    const row = (await service.getRadarPage({ runId })).rows[0]!;
    expect(row.reddit.stance).toBe('insufficient');
    expect(row.combined.state).toBe('insufficient');
  });

  it('marks stale evidence partial and does not reuse old agreement prose', async () => {
    const { service, slices } = fixture();
    slices[0]!.dataThroughAt = '2026-09-01T11:00:00Z';
    const row = (await service.getRadarPage({ runId })).rows[0]!;
    expect(row.reddit).toMatchObject({
      status: 'partial',
      stance: 'insufficient',
      confidence: null,
    });
    expect(row.reddit.summary).toContain('stale');
    expect(row.combined.state).toBe('partial');
    expect(row.combined.citationIds).toEqual([]);
  });

  it('fails closed after a rights restriction and withholds dimensions missing contributor citations', async () => {
    const { service, store } = fixture();
    store.dimensionCitations.mockResolvedValue([]);
    expect(
      (await service.getSecurityDetail(runId, security.id)).reddit.dimensions.every(
        (d) => d.score === null,
      ),
    ).toBe(true);
    store.publication.mockRejectedValue(new RniReadError('FORBIDDEN'));
    expect((await service.getRadarPage({ runId })).rows[0]?.reddit.summary).toContain('withheld');
  });

  it('paginates immutably, rejects malformed/cross-run cursors and invalid bounds', async () => {
    const { service, store } = fixture();
    const second = { ...security, id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', ticker: 'AMD' };
    store.securities.mockResolvedValue([security, second]);
    const first = await service.getRadarPage({ runId, limit: 1 });
    expect(first.rows).toHaveLength(1);
    const next = await service.getRadarPage({ runId, limit: 1, cursor: first.nextCursor });
    expect(next.rows[0]?.security.id).toBe(second.id);
    expect(next.nextCursor).toBeNull();
    await expect(
      service.getRadarPage({ runId: randomUUID(), cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(service.getRadarPage({ runId, cursor: 'bad!' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(service.getRadarPage({ runId, limit: 101 })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('bounds universe search even before opening a database connection', async () => {
    const service = new PostgresRniUniverseReadService(options);
    expect(() => service.searchActiveUniverse({ query: 'a'.repeat(101) })).toThrow(
      'INVALID_REQUEST',
    );
    expect(() => service.searchActiveUniverse({ limit: 51 })).toThrow('INVALID_REQUEST');
  });
});
