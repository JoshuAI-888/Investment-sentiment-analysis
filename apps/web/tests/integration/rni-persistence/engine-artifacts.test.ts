import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { canonicalHash } from '../../../src/calc/canonical';
import { D, exact } from '../../../src/calc/decimal';
import {
  calculatePlatformAnalytics,
  type RniPlatformAnalyticsArtifact,
} from '../../../src/rni/analytics';
import type { RniPlatformSlice, RniRun, RniStance } from '../../../src/rni/contracts';
import { convergePlatformFacts } from '../../../src/rni/convergence';
import { PostgresRniAnalyticsArtifactPersistence } from '../../../src/rni/repositories/engine-artifacts';
import { persistRniRunWithSlices } from '../../../src/rni/repositories/runs';
import { methodology, platformInput as analyticsInput } from '../../unit/rni/analytics/fixtures';
import {
  convergenceRequest,
  platformInput as convergencePlatformInput,
} from '../../unit/rni/convergence/fixtures';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';
import { seedRniVersionLineage } from './version-fixtures';

const url = databaseUrl();

describe.skipIf(url === undefined)('RNI D12 ENGINE artifact persistence', () => {
  let pool: pg.Pool;
  let adapter: PostgresRniAnalyticsArtifactPersistence;
  let runId: string;
  let securityId: string;
  let redditSliceId: string;
  let xSliceId: string;
  let sourceIds: Record<'reddit' | 'x', readonly [string, string, string, string]>;
  let e05Scores: Map<string, string | null>;

  beforeAll(async () => {
    pool = makePool();
    adapter = new PostgresRniAnalyticsArtifactPersistence(pool);
    await resetSchema(pool);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const versions = await seedRniVersionLineage(pool, 'd12');
    runId = randomUUID();
    securityId = randomUUID();
    redditSliceId = randomUUID();
    xSliceId = randomUUID();
    e05Scores = new Map();
    sourceIds = {
      reddit: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
      x: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    };
    await pool.query(
      `insert into security (id, symbol, name, exchange, asset_type, currency)
       values ($1, 'NVDA', 'NVIDIA Corporation', 'NASDAQ', 'equity', 'USD')`,
      [securityId],
    );
    const run: RniRun = {
      id: runId,
      idempotencyKey: `d12-${runId}`,
      trigger: 'manual',
      status: 'running',
      windowStart: '2026-09-04T00:00:00.000Z',
      windowEnd: '2026-09-05T12:00:00.000Z',
      comparisonStart: null,
      comparisonEnd: null,
      universeVersion: versions.universeVersion,
      configVersion: versions.configVersion,
      promptVersion: 'p1',
      aiRoute: 'openai_direct',
      requestedAt: '2026-09-05T00:00:00.000Z',
      completedAt: null,
    };
    const slices: readonly [RniPlatformSlice, RniPlatformSlice] = [
      slice('reddit', redditSliceId),
      slice('x', xSliceId),
    ];
    await persistRniRunWithSlices(run, slices, pool);
    await seedObservationLineage('reddit');
    await seedObservationLineage('x');
  });

  afterAll(async () => pool?.end());

  function slice(platform: 'reddit' | 'x', id: string): RniPlatformSlice {
    return {
      id,
      runId,
      platform,
      status: 'complete',
      eligibleSourceCount: 2,
      coverageDisclosure: `${platform} fixture`,
      lastAttemptAt: null,
      lastSuccessfulRefreshAt: null,
      dataThroughAt: null,
      computedAt: null,
      errorCode: null,
    };
  }

  async function seedObservationLineage(platform: 'reddit' | 'x'): Promise<void> {
    for (const [index, sourceItemId] of sourceIds[platform].entries()) {
      const mentionId = randomUUID();
      const observationId = randomUUID();
      const stanceScore = ['0.8', '-0.8', null, '0.5'][index] ?? null;
      e05Scores.set(sourceItemId, stanceScore);
      const suffix = `${runId}-${index}`;
      const canonicalUrl =
        platform === 'reddit'
          ? `https://www.reddit.com/r/stocks/comments/${suffix}/fixture/`
          : `https://x.com/rni_fixture/status/${1000 + index}`;
      await pool.query(
        `insert into rni_source_item (
           id, platform, source_kind, external_id, canonical_url, original_url,
           subreddit_or_scope, author_handle_hash, title, bounded_content, content_sha256,
           capture_mode, published_at, discovered_at, observed_at, metadata_json,
           rights_policy_version
         ) values ($1, $2, $3, $4, $5, $5, $6, $7, null, $8, $9, 'excerpt_only',
                   '2026-09-05T11:00:00Z', '2026-09-05T10:00:00Z',
                   '2026-09-05T11:00:00Z', '{}'::jsonb, 'rights-v1')`,
        [
          sourceItemId,
          platform,
          platform === 'reddit' ? 'post' : 'x_post',
          `${platform}-${suffix}`,
          canonicalUrl,
          platform === 'reddit' ? 'stocks' : 'x-query',
          String(index + 1).repeat(64),
          `${platform} persisted fixture ${index}`,
          String(index + 4).repeat(64),
        ],
      );
      await pool.query(
        `insert into rni_security_mention (
           id, source_item_id, security_id, mention_text, resolution_method,
           resolution_confidence
         ) values ($1, $2, $3, 'NVDA', 'exact_ticker', 1)`,
        [mentionId, sourceItemId, securityId],
      );
      await pool.query(
        `insert into rni_security_observation (
           id, source_item_id, security_id, stance, stance_score, relevance, claim_summary,
           dimension_assignments, classifier_run_id, prompt_version, model_id, input_hash,
           created_at
         ) values ($1, $2, $3, $4, $5, 1, 'Persisted D12 observation', $6::jsonb,
                   $7, 'p1', 'fixture-model', $8, '2026-09-05T11:00:00Z')`,
        [
          observationId,
          sourceItemId,
          securityId,
          stanceScore === null ? 'insufficient' : stance(stanceScore),
          stanceScore,
          JSON.stringify(
            ['company_fundamentals', 'market_trading', 'catalyst_event', 'retail_narrative'].map(
              (dimension) => ({ dimension, stance: 'bullish', score: '0.5', rationale: 'fixture' }),
            ),
          ),
          randomUUID(),
          ['7', '8', '9', 'a'][index]?.repeat(64),
        ],
      );
      await pool.query(
        `insert into rni_run_observation (
           run_id, observation_id, source_item_id, security_id, semantic_output_hash
         ) values ($1, $2, $3, $4, $5)`,
        [runId, observationId, sourceItemId, securityId, String(index + 1).repeat(64)],
      );
    }
  }

  function analytics(
    platform: 'reddit' | 'x',
    sliceId: string,
    version = 'methodology-v1',
    identity: {
      readonly runId?: string;
      readonly securityId?: string;
      readonly sourceIds?: readonly [string, string, string, string];
      readonly minimumIndependentSources?: string;
      readonly minimumEffectiveAttention?: string;
      readonly memePenalty?: string;
      readonly equalCurrentWeights?: boolean;
      readonly includeEligibilityEdges?: boolean;
      readonly collapseDuplicateGroups?: boolean;
    } = {},
  ) {
    const input = analyticsInput(platform);
    const artifactRunId = identity.runId ?? runId;
    const artifactSecurityId = identity.securityId ?? securityId;
    const artifactSourceIds = identity.sourceIds ?? sourceIds[platform];
    const baseMethodology = methodology(version);
    const analyticsMethodology = {
      ...baseMethodology,
      minimumIndependentSources:
        identity.minimumIndependentSources ?? baseMethodology.minimumIndependentSources,
      minimumEffectiveAttention:
        identity.minimumEffectiveAttention ?? baseMethodology.minimumEffectiveAttention,
      memePenalty: identity.memePenalty ?? baseMethodology.memePenalty,
    };
    const baseCurrent = input.current.observations.map((observation, index) => ({
      ...observation,
      sourceItemId: artifactSourceIds[index] ?? observation.sourceItemId,
      platform,
      securityId: artifactSecurityId,
      duplicateGroupKey: identity.collapseDuplicateGroups
        ? 'collapsed-current-group'
        : observation.duplicateGroupKey,
      duplicateGroupSize: identity.collapseDuplicateGroups ? '2' : observation.duplicateGroupSize,
      publishedAt:
        index === 1 && !identity.equalCurrentWeights
          ? '2026-09-05T10:00:00Z'
          : observation.publishedAt,
      observedAt:
        index === 1 && !identity.equalCurrentWeights
          ? '2026-09-05T10:00:00Z'
          : observation.observedAt,
    }));
    const edgeTemplate = input.comparison?.observations[0];
    const edgeCurrent =
      identity.includeEligibilityEdges && edgeTemplate !== undefined
        ? [
            {
              ...edgeTemplate,
              sourceItemId: artifactSourceIds[2],
              mentionIds: [artifactSourceIds[2]],
              platform,
              securityId: artifactSecurityId,
              duplicateGroupKey: artifactSourceIds[2],
              publishedAt: '2026-09-05T11:00:00Z',
              observedAt: '2026-09-05T11:00:00Z',
            },
            {
              ...edgeTemplate,
              sourceItemId: artifactSourceIds[3],
              mentionIds: [artifactSourceIds[3]],
              platform,
              securityId: artifactSecurityId,
              duplicateGroupKey: artifactSourceIds[3],
              sourceWeight: '0',
              publishedAt: '2026-09-05T11:00:00Z',
              observedAt: '2026-09-05T11:00:00Z',
            },
          ]
        : [];
    return calculatePlatformAnalytics(
      {
        ...input,
        runId: artifactRunId,
        runSourceSliceId: sliceId,
        securityId: artifactSecurityId,
        current: {
          ...input.current,
          observations: [...baseCurrent, ...edgeCurrent],
        },
        comparison:
          input.comparison === null || identity.includeEligibilityEdges
            ? null
            : {
                ...input.comparison,
                observations: input.comparison.observations.map((observation, index) => ({
                  ...observation,
                  sourceItemId: artifactSourceIds[index + 2] ?? observation.sourceItemId,
                  platform,
                  securityId: artifactSecurityId,
                })),
              },
        baseline: input.baseline.map((entry) => ({
          ...entry,
          platform,
          securityId: artifactSecurityId,
          methodologyVersion: version,
        })),
      },
      analyticsMethodology,
    );
  }

  function terminalAbsentAnalytics(
    platform: 'reddit' | 'x',
    sliceId: string,
    sliceStatus: 'failed' | 'unavailable',
  ) {
    const input = analyticsInput(platform);
    return calculatePlatformAnalytics(
      {
        ...input,
        runId,
        runSourceSliceId: sliceId,
        securityId,
        sliceStatus,
        current: { ...input.current, observations: [] },
        comparison: null,
        baseline: [],
        confidenceComponents: Object.fromEntries(
          Object.keys(input.confidenceComponents).map((key) => [key, '0']),
        ) as typeof input.confidenceComponents,
        confidencePenalties: Object.fromEntries(
          Object.keys(input.confidencePenalties).map((key) => [key, '0']),
        ) as typeof input.confidencePenalties,
        confidenceReadiness: { narrativeStageTerminal: true, catalystStageTerminal: true },
      },
      methodology(),
    );
  }

  function stance(score: string | null) {
    if (score === null) return 'insufficient' as const;
    if (/^-?0(?:\.0+)?$/u.test(score)) return 'neutral' as const;
    return score.startsWith('-') ? ('bearish' as const) : ('bullish' as const);
  }

  function expectedOverallScore(artifact: RniPlatformAnalyticsArtifact): string | null {
    const duplicateGroupBySource = new Map(
      artifact.inputSnapshot.current.observations.map((observation) => [
        observation.sourceItemId,
        observation.duplicateGroupKey,
      ]),
    );
    const eligible = artifact.result.weightTrace.flatMap((trace) => {
      const score = e05Scores.get(trace.sourceItemId);
      return score === null || score === undefined || new D(trace.weight).lessThanOrEqualTo('0')
        ? []
        : [{ sourceItemId: trace.sourceItemId, score: new D(score), weight: new D(trace.weight) }];
    });
    const weight = eligible.reduce((sum, item) => sum.plus(item.weight), new D('0'));
    const independentSources = new Set(
      eligible.map((item) => duplicateGroupBySource.get(item.sourceItemId)),
    ).size;
    if (
      weight.lessThan(artifact.methodologySnapshot.minimumEffectiveAttention) ||
      new D(String(independentSources)).lessThan(
        artifact.methodologySnapshot.minimumIndependentSources,
      ) ||
      weight.equals('0')
    ) {
      return null;
    }
    return exact(
      eligible
        .reduce((sum, item) => sum.plus(item.weight.times(item.score)), new D('0'))
        .div(weight),
    );
  }

  function convergencePlatform(
    artifact: RniPlatformAnalyticsArtifact,
    overrides: {
      readonly methodologyVersion?: string;
      readonly dataThroughAt?: string | null;
      readonly dimensionScore?: string;
      readonly effectiveAttention?: string;
      readonly overallScore?: string | null;
      readonly overallStance?: RniStance;
    } = {},
  ) {
    const primaryMetric = artifact.result.sentimentByDimension[0];
    if (primaryMetric === undefined) throw new Error('D12 fixture requires analytics dimensions');
    const projectedOverallScore =
      overrides.overallScore === undefined
        ? expectedOverallScore(artifact)
        : overrides.overallScore;
    return convergencePlatformInput(artifact.result.platform, {
      runId,
      runSourceSliceId: artifact.runSourceSliceId,
      securityId,
      methodologyVersion: overrides.methodologyVersion ?? artifact.methodologyVersion,
      windowStart: artifact.inputSnapshot.current.windowStart,
      windowEnd: artifact.inputSnapshot.current.windowEnd,
      status: artifact.inputSnapshot.sliceStatus,
      stance: overrides.overallStance ?? stance(projectedOverallScore),
      stanceScore: projectedOverallScore,
      dimensions: artifact.result.sentimentByDimension.map((metric) => ({
        dimension: metric.dimension,
        stance: stance(overrides.dimensionScore ?? metric.meanDirection),
        score: overrides.dimensionScore ?? metric.meanDirection,
      })),
      effectiveAttention: overrides.effectiveAttention ?? artifact.result.effectiveAttention,
      dataThroughAt: overrides.dataThroughAt ?? null,
      analyticsArtifactHash: canonicalHash(artifact),
    });
  }

  function convergence(
    reddit: RniPlatformAnalyticsArtifact,
    x: RniPlatformAnalyticsArtifact,
    policyVersion = 'rni-convergence-policy-v1',
    projectionOverrides: {
      readonly methodologyVersion?: string;
      readonly dataThroughAt?: string | null;
      readonly xAnalyticsArtifactHash?: string;
      readonly dimensionScore?: string;
      readonly effectiveAttention?: string;
      readonly overallScore?: string | null;
      readonly overallStance?: RniStance;
    } = {},
  ) {
    const xPlatform = convergencePlatform(x, projectionOverrides);
    const request = convergenceRequest({
      reddit: convergencePlatform(reddit, projectionOverrides),
      x: {
        ...xPlatform,
        analyticsArtifactHash:
          projectionOverrides.xAnalyticsArtifactHash ?? xPlatform.analyticsArtifactHash,
      },
    });
    return convergePlatformFacts({
      ...request,
      policy: { ...request.policy, version: policyVersion },
    });
  }

  it('persists Reddit and X independently, then binds exact convergence components', async () => {
    const reddit = analytics('reddit', redditSliceId);
    const x = analytics('x', xSliceId);
    const redditCommit = await adapter.commitPlatformAnalytics(reddit);
    const xCommit = await adapter.commitPlatformAnalytics(x);
    expect(redditCommit.artifactHash).toBe(canonicalHash(reddit));
    expect(xCommit.artifactHash).toBe(canonicalHash(x));
    const artifact = convergence(reddit, x);
    const convergenceCommits = await Promise.all([
      adapter.commitConvergence(artifact),
      adapter.commitConvergence(artifact),
    ]);
    expect(convergenceCommits.map(({ disposition }) => disposition).sort()).toEqual([
      'duplicate',
      'inserted',
    ]);
    expect(convergenceCommits[0]?.artifactHash).toBe(canonicalHash(artifact));
    const platformRows = await pool.query<{
      id: string;
      platform: 'reddit' | 'x';
      artifact_hash: string;
      input_hash: string;
      result_hash: string;
      input_snapshot: unknown;
      result_snapshot: unknown;
    }>('select * from rni_platform_analytics_artifact order by platform');
    expect(platformRows.rows).toHaveLength(2);
    const redditRow = platformRows.rows.find(({ platform }) => platform === 'reddit');
    const xRow = platformRows.rows.find(({ platform }) => platform === 'x');
    expect(redditRow).toMatchObject({
      artifact_hash: canonicalHash(reddit),
      input_hash: reddit.inputSetHash,
      result_hash: reddit.resultHash,
      input_snapshot: { input: reddit.inputSnapshot, methodology: reddit.methodologySnapshot },
      result_snapshot: reddit.result,
    });
    expect(xRow).toMatchObject({
      artifact_hash: canonicalHash(x),
      input_hash: x.inputSetHash,
      result_hash: x.resultHash,
      input_snapshot: { input: x.inputSnapshot, methodology: x.methodologySnapshot },
      result_snapshot: x.result,
    });
    const convergenceRows = await pool.query<{
      reddit_analytics_id: string;
      reddit_artifact_hash: string;
      x_analytics_id: string;
      x_artifact_hash: string;
    }>('select * from rni_convergence_artifact');
    expect(convergenceRows.rows).toEqual([
      expect.objectContaining({
        reddit_analytics_id: redditRow?.id,
        reddit_artifact_hash: redditCommit.artifactHash,
        x_analytics_id: xRow?.id,
        x_artifact_hash: xCommit.artifactHash,
      }),
    ]);
    await expect(
      adapter.commitConvergence(convergence(reddit, x, 'rni-convergence-policy-v2')),
    ).rejects.toThrow('convergence identity reused');
  });

  it('persists a truthful unavailable component through the public E06/E07/D12 path', async () => {
    const reddit = analytics('reddit', redditSliceId);
    const x = terminalAbsentAnalytics('x', xSliceId, 'unavailable');
    await pool.query(
      `update rni_platform_slice
          set status = 'unavailable', eligible_source_count = 0,
              error_code = 'PROVIDER_UNAVAILABLE'
        where id = $1`,
      [xSliceId],
    );
    await pool.query(
      `update rni_platform_slice set data_through_at = '2026-09-05T11:30:00Z' where id = $1`,
      [redditSliceId],
    );

    await adapter.commitPlatformAnalytics(reddit);
    await adapter.commitPlatformAnalytics(x);
    const request = convergenceRequest({
      reddit: convergencePlatform(reddit, { dataThroughAt: '2026-09-05T11:30:00Z' }),
      x: convergencePlatform(x),
    });
    const artifact = convergePlatformFacts(request);
    expect(artifact.result.status).toBe('PARTIAL_CROSS_SOURCE');
    expect(artifact.result.platforms.x).toMatchObject({
      status: 'unavailable',
      stance: 'insufficient',
      stanceScore: null,
      effectiveAttention: '0',
      analyticsArtifactHash: canonicalHash(x),
    });
    expect(await adapter.commitConvergence(artifact)).toEqual({
      disposition: 'inserted',
      artifactHash: canonicalHash(artifact),
    });

    const stored = await pool.query<{
      x_artifact_hash: string;
      x_input: { input: { sliceStatus: string } };
    }>(
      `select convergence.x_artifact_hash,
              analytics.input_snapshot as x_input
         from rni_convergence_artifact convergence
         join rni_platform_analytics_artifact analytics
           on analytics.id = convergence.x_analytics_id`,
    );
    expect(stored.rows).toEqual([
      {
        x_artifact_hash: canonicalHash(x),
        x_input: expect.objectContaining({
          input: expect.objectContaining({ sliceStatus: 'unavailable' }),
        }),
      },
    ]);
  });

  it('rejects crossed platform bytes and slice ownership', async () => {
    await adapter.commitPlatformAnalytics(analytics('reddit', redditSliceId));
    await expect(
      adapter.commitPlatformAnalytics(analytics('reddit', redditSliceId, 'methodology-v2')),
    ).rejects.toThrow('platform identity reused');
    await expect(
      adapter.commitPlatformAnalytics(analytics('x', redditSliceId)),
    ).rejects.toMatchObject({
      constraint: 'rni_platform_analytics_slice_fk',
    });
    await expect(
      adapter.commitPlatformAnalytics(
        analytics('reddit', redditSliceId, 'methodology-v1', { runId: randomUUID() }),
      ),
    ).rejects.toThrow('without exact durable run/source/security/platform observations');
    await expect(
      adapter.commitPlatformAnalytics(
        analytics('reddit', redditSliceId, 'methodology-v1', { securityId: randomUUID() }),
      ),
    ).rejects.toThrow('without exact durable run/source/security/platform observations');
  });

  it('rejects missing or cross-platform durable observation membership atomically', async () => {
    const missingSourceIds: readonly [string, string, string, string] = [
      randomUUID(),
      sourceIds.reddit[1],
      sourceIds.reddit[2],
      sourceIds.reddit[3],
    ];
    await expect(
      adapter.commitPlatformAnalytics(
        analytics('reddit', redditSliceId, 'methodology-v1', { sourceIds: missingSourceIds }),
      ),
    ).rejects.toThrow('without exact durable run/source/security/platform observations');
    const crossedSourceIds: readonly [string, string, string, string] = [
      sourceIds.x[0],
      sourceIds.reddit[1],
      sourceIds.reddit[2],
      sourceIds.reddit[3],
    ];
    await expect(
      adapter.commitPlatformAnalytics(
        analytics('reddit', redditSliceId, 'methodology-v1', { sourceIds: crossedSourceIds }),
      ),
    ).rejects.toThrow('without exact durable run/source/security/platform observations');
    expect((await pool.query('select id from rni_platform_analytics_artifact')).rowCount).toBe(0);
  });

  it('rejects convergence with wrong component hashes', async () => {
    const reddit = analytics('reddit', redditSliceId);
    const x = analytics('x', xSliceId);
    await adapter.commitPlatformAnalytics(reddit);
    await adapter.commitPlatformAnalytics(x);
    await expect(
      adapter.commitConvergence(
        convergence(reddit, x, 'rni-convergence-policy-v1', {
          xAnalyticsArtifactHash: 'c'.repeat(64),
        }),
      ),
    ).rejects.toThrow('missing exact x analytics component');
    expect((await pool.query('select id from rni_convergence_artifact')).rowCount).toBe(0);
  });

  it('rejects crossed analytics and durable-slice convergence projections atomically', async () => {
    const reddit = analytics('reddit', redditSliceId);
    const x = analytics('x', xSliceId);
    await adapter.commitPlatformAnalytics(reddit);
    await adapter.commitPlatformAnalytics(x);
    await expect(
      adapter.commitConvergence(
        convergence(reddit, x, 'rni-convergence-policy-v1', {
          methodologyVersion: 'crossed-methodology',
        }),
      ),
    ).rejects.toThrow('crossed reddit convergence/component projection');
    await expect(
      adapter.commitConvergence(
        convergence(reddit, x, 'rni-convergence-policy-v1', {
          dataThroughAt: '2026-09-05T11:30:00Z',
        }),
      ),
    ).rejects.toThrow('crossed reddit convergence/component projection');
    await expect(
      adapter.commitConvergence(
        convergence(reddit, x, 'rni-convergence-policy-v1', {
          dimensionScore: '0.9',
          effectiveAttention: '99',
        }),
      ),
    ).rejects.toThrow('crossed reddit convergence/component projection');
    await pool.query("update rni_platform_slice set status = 'partial' where id = $1", [
      redditSliceId,
    ]);
    await expect(adapter.commitConvergence(convergence(reddit, x))).rejects.toThrow(
      'crossed reddit convergence/component projection',
    );
    expect((await pool.query('select id from rni_convergence_artifact')).rowCount).toBe(0);
  });

  it('rejects same-version Reddit/X artifacts with different methodology snapshots', async () => {
    const reddit = analytics('reddit', redditSliceId);
    const x = analytics('x', xSliceId, 'methodology-v1', { memePenalty: '0.8' });
    await adapter.commitPlatformAnalytics(reddit);
    await adapter.commitPlatformAnalytics(x);
    await expect(adapter.commitConvergence(convergence(reddit, x))).rejects.toThrow(
      'crossed Reddit/X analytics methodology snapshots',
    );
    expect((await pool.query('select id from rni_convergence_artifact')).rowCount).toBe(0);
  });

  it('derives overall stance from durable E05 scores and the exact E06 weight trace', async () => {
    const reddit = analytics('reddit', redditSliceId);
    const x = analytics('x', xSliceId);
    const expectedReddit = expectedOverallScore(reddit);
    expect(expectedReddit).not.toBeNull();
    expect(expectedReddit).not.toBe('0.8');
    expect(expectedReddit).not.toBe('0');
    await adapter.commitPlatformAnalytics(reddit);
    await adapter.commitPlatformAnalytics(x);
    await expect(
      adapter.commitConvergence(
        convergence(reddit, x, 'rni-convergence-policy-v1', { overallScore: '0.9' }),
      ),
    ).rejects.toThrow('crossed reddit overall stance projection');
    await expect(
      adapter.commitConvergence(
        convergence(reddit, x, 'rni-convergence-policy-v1', {
          overallScore: expectedReddit,
          overallStance: 'strong_bullish',
        }),
      ),
    ).rejects.toThrow('crossed reddit overall stance projection');
    expect((await adapter.commitConvergence(convergence(reddit, x))).disposition).toBe('inserted');
  });

  it('excludes null-score and zero-weight traces from the durable overall mean', async () => {
    const reddit = analytics('reddit', redditSliceId, 'methodology-v1', {
      includeEligibilityEdges: true,
      minimumIndependentSources: '3',
    });
    const x = analytics('x', xSliceId, 'methodology-v1', {
      includeEligibilityEdges: true,
      minimumIndependentSources: '3',
    });
    expect(reddit.result.weightTrace.some(({ weight }) => weight === '0')).toBe(true);
    expect(
      reddit.result.weightTrace.some(
        ({ sourceItemId, weight }) =>
          new D(weight).greaterThan('0') && e05Scores.get(sourceItemId) === null,
      ),
    ).toBe(true);
    await adapter.commitPlatformAnalytics(reddit);
    await adapter.commitPlatformAnalytics(x);
    const artifact = convergence(reddit, x);
    expect(artifact.inputSnapshot.reddit).toMatchObject({
      stance: 'insufficient',
      stanceScore: null,
    });
    expect((await adapter.commitConvergence(artifact)).disposition).toBe('inserted');
  });

  it('requires insufficient overall stance when duplicate groups fail the independence floor', async () => {
    const reddit = analytics('reddit', redditSliceId, 'methodology-v1', {
      collapseDuplicateGroups: true,
    });
    const x = analytics('x', xSliceId, 'methodology-v1', { collapseDuplicateGroups: true });
    await adapter.commitPlatformAnalytics(reddit);
    await adapter.commitPlatformAnalytics(x);
    const artifact = convergence(reddit, x);
    expect(artifact.inputSnapshot.reddit).toMatchObject({
      stance: 'insufficient',
      stanceScore: null,
    });
    expect((await adapter.commitConvergence(artifact)).disposition).toBe('inserted');
  });

  it('accepts the effective-attention floor boundary and maps exact cancellation to neutral', async () => {
    const initialReddit = analytics('reddit', redditSliceId, 'methodology-v1', {
      equalCurrentWeights: true,
    });
    const initialX = analytics('x', xSliceId, 'methodology-v1', { equalCurrentWeights: true });
    const reddit = analytics('reddit', redditSliceId, 'methodology-v1', {
      equalCurrentWeights: true,
      minimumEffectiveAttention: initialReddit.result.effectiveAttention,
    });
    const x = analytics('x', xSliceId, 'methodology-v1', {
      equalCurrentWeights: true,
      minimumEffectiveAttention: initialX.result.effectiveAttention,
    });
    expect(expectedOverallScore(reddit)).toBe('0');
    await adapter.commitPlatformAnalytics(reddit);
    await adapter.commitPlatformAnalytics(x);
    const artifact = convergence(reddit, x);
    expect(artifact.inputSnapshot.reddit).toMatchObject({ stance: 'neutral', stanceScore: '0' });
    expect((await adapter.commitConvergence(artifact)).disposition).toBe('inserted');
  });

  it('rejects a schema-valid convergence replay with crossed durable component binding', async () => {
    const reddit = analytics('reddit', redditSliceId);
    const x = analytics('x', xSliceId);
    const redditCommit = await adapter.commitPlatformAnalytics(reddit);
    const xCommit = await adapter.commitPlatformAnalytics(x);
    const alternateRedditId = randomUUID();
    const alternateRedditHash = 'd'.repeat(64);
    await pool.query(
      `insert into rni_platform_analytics_artifact (
         id, run_id, platform_slice_id, platform, security_id, methodology_version,
         calculation_code_version, input_hash, result_hash, artifact_hash, input_snapshot,
         result_snapshot, created_at
       ) select $1, run_id, platform_slice_id, platform, security_id, methodology_version,
                calculation_code_version, input_hash, result_hash, $2, input_snapshot,
                result_snapshot, created_at
           from rni_platform_analytics_artifact where artifact_hash = $3`,
      [alternateRedditId, alternateRedditHash, redditCommit.artifactHash],
    );
    const { rows: xRows } = await pool.query<{ id: string }>(
      'select id from rni_platform_analytics_artifact where artifact_hash = $1',
      [xCommit.artifactHash],
    );
    const artifact = convergence(reddit, x);
    await pool.query(
      `insert into rni_convergence_artifact (
         id, run_id, security_id, reddit_analytics_id, reddit_artifact_hash,
         x_analytics_id, x_artifact_hash, policy_version, calculation_code_version,
         input_hash, result_hash, input_snapshot, result_snapshot, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14)`,
      [
        randomUUID(),
        runId,
        securityId,
        alternateRedditId,
        alternateRedditHash,
        xRows[0]?.id,
        xCommit.artifactHash,
        artifact.policyVersion,
        artifact.calculationCodeVersion,
        artifact.inputHash,
        artifact.resultHash,
        JSON.stringify(artifact.inputSnapshot),
        JSON.stringify(artifact.result),
        artifact.inputSnapshot.asOf,
      ],
    );
    await expect(adapter.commitConvergence(artifact)).rejects.toThrow(
      'convergence identity reused with different canonical artifact',
    );
  });

  it('serializes concurrent exact replay to one durable platform artifact', async () => {
    const artifact = analytics('reddit', redditSliceId);
    const results = await Promise.all([
      adapter.commitPlatformAnalytics(artifact),
      adapter.commitPlatformAnalytics(artifact),
    ]);
    expect(results.map(({ disposition }) => disposition).sort()).toEqual(['duplicate', 'inserted']);
    expect((await pool.query('select id from rni_platform_analytics_artifact')).rowCount).toBe(1);
  });

  it('holds durable slice lifecycle locks through convergence commit', async () => {
    const reddit = analytics('reddit', redditSliceId);
    const x = analytics('x', xSliceId);
    await adapter.commitPlatformAnalytics(reddit);
    await adapter.commitPlatformAnalytics(x);
    const artifact = convergence(reddit, x);
    const blocker = await pool.connect();
    const lockKey = 918_273;
    await pool.query(`create function wait_d12_convergence() returns trigger language plpgsql as $$
      begin perform pg_advisory_xact_lock(${lockKey}); return new; end $$`);
    await pool.query(`create trigger wait_d12_convergence before insert on rni_convergence_artifact
      for each row execute function wait_d12_convergence()`);
    await blocker.query('select pg_advisory_lock($1)', [lockKey]);
    const waitForLock = async (queryFragment: string) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await pool.query(
          `select 1 from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'
              and query like $1 limit 1`,
          [`%${queryFragment}%`],
        );
        if (waiting.rowCount === 1) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for blocked query: ${queryFragment}`);
    };
    try {
      const convergenceCommit = adapter.commitConvergence(artifact);
      await waitForLock('insert into rni_convergence_artifact');
      const sliceUpdate = pool.query(
        "update rni_platform_slice set status = 'partial' where id = $1",
        [redditSliceId],
      );
      await waitForLock('update rni_platform_slice');
      await blocker.query('select pg_advisory_unlock($1)', [lockKey]);
      expect((await convergenceCommit).disposition).toBe('inserted');
      await sliceUpdate;
      expect(
        (
          await pool.query<{ status: string }>(
            'select status from rni_platform_slice where id = $1',
            [redditSliceId],
          )
        ).rows[0]?.status,
      ).toBe('partial');
    } finally {
      await blocker.query('select pg_advisory_unlock($1)', [lockKey]);
      blocker.release();
      await pool.query('drop trigger wait_d12_convergence on rni_convergence_artifact');
      await pool.query('drop function wait_d12_convergence()');
    }
  });

  it('rejects replay when durable creation time differs only below millisecond precision', async () => {
    const artifact = analytics('reddit', redditSliceId);
    const artifactHash = canonicalHash(artifact);
    await pool.query(
      `insert into rni_platform_analytics_artifact (
         id, run_id, platform_slice_id, platform, security_id, methodology_version,
         calculation_code_version, input_hash, result_hash, artifact_hash, input_snapshot,
         result_snapshot, created_at
       ) values ($1, $2, $3, 'reddit', $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
                 '2026-09-05T12:00:00.000123Z')`,
      [
        randomUUID(),
        runId,
        redditSliceId,
        securityId,
        artifact.methodologyVersion,
        artifact.calculationCodeVersion,
        artifact.inputSetHash,
        artifact.resultHash,
        artifactHash,
        JSON.stringify({
          input: artifact.inputSnapshot,
          methodology: artifact.methodologySnapshot,
        }),
        JSON.stringify(artifact.result),
      ],
    );
    await expect(adapter.commitPlatformAnalytics(artifact)).rejects.toThrow(
      'platform artifact hash reused with different bytes',
    );
  });

  it('rolls back a platform artifact when a child write fails', async () => {
    await pool.query(`create function fail_d12_artifact() returns trigger language plpgsql as $$
      begin raise exception 'forced D12 failure'; end $$`);
    await pool.query(`create trigger fail_d12_artifact before insert on rni_platform_analytics_artifact
      for each row execute function fail_d12_artifact()`);
    try {
      await expect(
        adapter.commitPlatformAnalytics(analytics('reddit', redditSliceId)),
      ).rejects.toThrow('forced D12 failure');
      expect((await pool.query('select id from rni_platform_analytics_artifact')).rowCount).toBe(0);
    } finally {
      await pool.query('drop trigger fail_d12_artifact on rni_platform_analytics_artifact');
      await pool.query('drop function fail_d12_artifact()');
    }
  });
});
