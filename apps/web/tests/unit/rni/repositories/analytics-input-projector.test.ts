import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '@/calc/canonical';
import type { Queryable } from '@/repositories/client';
import { calculatePlatformAnalytics, RNI_ANALYTICS_CODE_VERSION } from '@/rni/analytics';
import {
  hashRniWorkerSnapshotValue,
  type RniWorkerManifest,
} from '@/rni/orchestration/worker-manifest';
import {
  projectRniPlatformAnalyticsInput,
  type RniAnalyticsProjectionPolicy,
} from '@/rni/repositories/analytics-input-projector';

const RUN_ID = '10000000-0000-4000-8000-000000000001';
const SECURITY_ID = '10000000-0000-4000-8000-000000000002';
const SLICE_ID = '10000000-0000-4000-8000-000000000003';
const MANIFEST_HASH = 'a'.repeat(64);

const result = <Row extends pg.QueryResultRow>(rows: readonly Row[]): pg.QueryResult<Row> =>
  ({
    rows: [...rows],
    rowCount: rows.length,
    command: '',
    oid: 0,
    fields: [],
  }) as pg.QueryResult<Row>;

const policy = (): RniAnalyticsProjectionPolicy => ({
  codeVersion: RNI_ANALYTICS_CODE_VERSION,
  timestampBasis: 'published_at_else_observed_at',
  memePenalty: '0.9',
  halfLifeHours: '24',
  lowBaseThreshold: '1',
  epsilon: '0.000001',
  minimumEffectiveAttention: '0.1',
  minimumIndependentSources: '1',
  winsorLowerPercentile: '0',
  winsorUpperPercentile: '1',
  minimumBaselineWindows: '3',
  zScoreDecimalPlaces: '6',
  highNarrativeConcentrationThreshold: '0.9',
  staleAfterHours: '24',
  confidenceWeights: {
    provenanceIntegrity: '0.20',
    evidenceQuality: '0.20',
    securityResolution: '0.15',
    breadthIndependence: '0.15',
    modelCalibration: '0.15',
    coverageRecency: '0.10',
    contradictionHandling: '0.05',
  },
  confidenceBands: { mediumMinimum: '40', highMinimum: '70', veryHighMinimum: '85' },
  confidenceCaps: {
    singleSourceOrCommunity: '69',
    highNarrativeConcentration: '69',
    partialCoverage: '69',
    staleEvidence: '39',
  },
  sourceWeights: { reddit: '0.8', x: '0.7' },
  communities: [
    {
      platform: 'reddit',
      scope: 'stocks',
      analyticalCluster: 'broad-equities',
      weight: '0.9',
    },
    { platform: 'x', scope: 'x-watch', analyticalCluster: 'x-watch', weight: '0.8' },
  ],
});

const manifest = (analyticsValue: RniAnalyticsProjectionPolicy = policy()): RniWorkerManifest => {
  const taxonomyValue = { dimensions: ['approved'] };
  const rightsPolicyValue = { captureModes: ['full_post'] };
  return {
    runId: RUN_ID,
    configuration: {
      version: '7',
      promptSetVersion: 'prompts-7',
      aiRoute: 'openai_direct',
    },
    universe: { version: '9' },
    source: {
      rightsPolicy: {
        version: 'rni-source-policy-v1',
        snapshotHash: hashRniWorkerSnapshotValue(rightsPolicyValue),
        value: rightsPolicyValue,
      },
    },
    windows: {
      windowStart: '2026-09-04T12:00:00Z',
      windowEnd: '2026-09-05T12:00:00Z',
      comparisonStart: '2026-09-03T12:00:00Z',
      comparisonEnd: '2026-09-04T12:00:00Z',
    },
    policies: {
      analytics: {
        version: 'analytics-7',
        snapshotHash: hashRniWorkerSnapshotValue(analyticsValue),
        value: analyticsValue,
      },
      taxonomy: {
        version: 'taxonomy-7',
        snapshotHash: hashRniWorkerSnapshotValue(taxonomyValue),
        value: taxonomyValue,
      },
    },
    build: { analyticsCodeVersion: RNI_ANALYTICS_CODE_VERSION },
    members: [{ securityId: SECURITY_ID }],
  } as unknown as RniWorkerManifest;
};

const contextRow = (workerManifest: RniWorkerManifest, status = 'complete') => ({
  run_id: RUN_ID,
  run_manifest_hash: MANIFEST_HASH,
  config_version: '7',
  universe_version: '9',
  prompt_version: 'prompts-7',
  ai_route: 'openai_direct',
  window_start: '2026-09-04T12:00:00Z',
  window_end: '2026-09-05T12:00:00Z',
  comparison_start: '2026-09-03T12:00:00Z',
  comparison_end: '2026-09-04T12:00:00Z',
  current_duration_days: '1',
  comparison_duration_days: '1',
  slice_id: SLICE_ID,
  slice_status: status,
  analytics_version: workerManifest.policies.analytics.version,
  analytics_snapshot_hash: workerManifest.policies.analytics.snapshotHash,
  analytics_value: workerManifest.policies.analytics.value,
  taxonomy_version: workerManifest.policies.taxonomy.version,
  taxonomy_snapshot_hash: workerManifest.policies.taxonomy.snapshotHash,
  rights_policy_version: workerManifest.source.rightsPolicy.version,
  rights_policy_snapshot_hash: workerManifest.source.rightsPolicy.snapshotHash,
  rights_policy_value: workerManifest.source.rightsPolicy.value,
});

const observationRow = (input: {
  readonly sourceId: string;
  readonly mentionId: string;
  readonly observationId: string;
  readonly eligibleAt: string;
  readonly content?: string;
  readonly scope?: string;
  readonly narratives?: unknown;
}) => {
  const content = input.content ?? 'Same independently persisted bounded evidence.';
  return {
    run_id: RUN_ID,
    security_id: SECURITY_ID,
    platform: 'reddit',
    source_item_id: input.sourceId,
    bounded_content: content,
    content_sha256: sha256Hex(content),
    source_status: 'active',
    rights_policy_version: 'rni-source-policy-v1',
    subreddit_or_scope: input.scope ?? 'stocks',
    author_handle_hash: 'b'.repeat(64),
    published_at: input.eligibleAt,
    observed_at: input.eligibleAt,
    mention_id: input.mentionId,
    mention_security_id: SECURITY_ID,
    resolution_confidence: '0.9500',
    observation_id: input.observationId,
    observation_security_id: SECURITY_ID,
    dimension_assignments: [
      { dimension: 'company_fundamentals', stance: 'bullish', score: '0.5', rationale: 'a' },
      { dimension: 'market_trading', stance: 'bullish', score: '0.4', rationale: 'b' },
      { dimension: 'catalyst_event', stance: 'neutral', score: '0', rationale: 'c' },
      { dimension: 'retail_narrative', stance: 'bullish', score: '0.6', rationale: 'd' },
    ],
    information_value: '0.8000',
    evidence_quality: '0.7000',
    assertion_strength: '0.9000',
    sarcasm_probability: '0.1000',
    spam_probability: '0.0000',
    meme_probability: '0.1000',
    exclusion_reason: null,
    content_version_id: '10000000-0000-4000-8000-000000000090',
    retrieval_id: '10000000-0000-4000-8000-000000000091',
    retrieval_source_item_id: input.sourceId,
    workflow_run_manifest_hash: MANIFEST_HASH,
    workflow_platform: 'reddit',
    membership_semantic_output_hash: 'c'.repeat(64),
    workflow_semantic_output_hash: 'c'.repeat(64),
    theme_versions: ['taxonomy-7'],
    narratives: input.narratives ?? [
      { id: '10000000-0000-4000-8000-000000000092', independent: true },
    ],
  };
};

const queryable = (
  workerManifest: RniWorkerManifest,
  rows: readonly Record<string, unknown>[],
  status = 'complete',
  contextPatch: Readonly<Record<string, unknown>> = {},
): Queryable =>
  ({
    query: vi.fn(async (sql: string) =>
      sql.includes('from rni_run run')
        ? result([{ ...contextRow(workerManifest, status), ...contextPatch }])
        : result(rows),
    ),
  }) as unknown as Queryable;

describe('production RNI analytics input projector', () => {
  it('projects exact committed lineage, uses published-at windows, and groups duplicate hashes', async () => {
    const workerManifest = manifest();
    const current = observationRow({
      sourceId: '10000000-0000-4000-8000-000000000010',
      mentionId: '10000000-0000-4000-8000-000000000020',
      observationId: '10000000-0000-4000-8000-000000000030',
      eligibleAt: '2026-09-05T11:00:00Z',
    });
    const comparison = observationRow({
      sourceId: '10000000-0000-4000-8000-000000000011',
      mentionId: '10000000-0000-4000-8000-000000000021',
      observationId: '10000000-0000-4000-8000-000000000031',
      eligibleAt: '2026-09-04T11:00:00Z',
    });
    const projection = await projectRniPlatformAnalyticsInput(
      {
        manifest: workerManifest,
        runManifestHash: MANIFEST_HASH,
        platform: 'reddit',
        securityId: SECURITY_ID,
      },
      queryable(workerManifest, [current, comparison]),
    );

    expect(projection.input.current.observations).toHaveLength(1);
    expect(projection.input.comparison?.observations).toHaveLength(1);
    expect(projection.input.current.observations[0]).toMatchObject({
      duplicateGroupKey: current.content_sha256,
      duplicateGroupSize: '2',
      sourceWeight: '0.8',
      communityWeight: '0.9',
      analyticalCluster: 'broad-equities',
    });
    expect(projection.methodology).toMatchObject({
      version: 'analytics-7',
      codeVersion: RNI_ANALYTICS_CODE_VERSION,
      confidenceWeights: policy().confidenceWeights,
    });
    expect(projection.input.baseline).toEqual([]);
    expect(projection.input.confidenceComponents).toEqual({
      provenanceIntegrity: '0',
      evidenceQuality: '0',
      securityResolution: '0',
      breadthIndependence: '0',
      modelCalibration: '0',
      coverageRecency: '0',
      contradictionHandling: '0',
    });
    expect(projection.input.confidencePenalties).toEqual({
      unresolvedMaterialClaim: '0',
      highNoise: '0',
      suspectedCoordination: '0',
      routeCapabilityDegradation: '0',
    });
    expect(projection.input.confidenceReadiness).toEqual({
      narrativeStageTerminal: false,
      catalystStageTerminal: false,
    });
    const analytics = calculatePlatformAnalytics(projection.input, projection.methodology).result;
    expect(analytics.zScore).toMatchObject({
      value: null,
      status: 'insufficient_baseline',
      baselineWindowCount: '0',
    });
    expect(analytics).toMatchObject({
      confidence: null,
      confidenceStatus: 'awaiting_narrative_stage',
    });
  });

  it('falls back to observedAt only when publishedAt is absent', async () => {
    const workerManifest = manifest();
    const row = {
      ...observationRow({
        sourceId: '10000000-0000-4000-8000-000000000012',
        mentionId: '10000000-0000-4000-8000-000000000022',
        observationId: '10000000-0000-4000-8000-000000000032',
        eligibleAt: '2026-09-05T10:00:00Z',
      }),
      published_at: null,
    };
    const projection = await projectRniPlatformAnalyticsInput(
      {
        manifest: workerManifest,
        runManifestHash: MANIFEST_HASH,
        platform: 'reddit',
        securityId: SECURITY_ID,
      },
      queryable(workerManifest, [row]),
    );
    expect(projection.input.current.observations[0]?.publishedAt).toBeNull();
    expect(projection.input.current.observations[0]?.observedAt).toBe(
      '2026-09-05T10:00:00.000000Z',
    );
  });

  it('fails closed for incomplete manifest methodology instead of inventing defaults', async () => {
    const incomplete = { formulaVersion: 'unapproved' } as unknown as RniAnalyticsProjectionPolicy;
    const workerManifest = manifest(incomplete);
    await expect(
      projectRniPlatformAnalyticsInput(
        {
          manifest: workerManifest,
          runManifestHash: MANIFEST_HASH,
          platform: 'reddit',
          securityId: SECURITY_ID,
        },
        queryable(workerManifest, []),
      ),
    ).rejects.toThrow('incomplete immutable analytics authority');
  });

  it('rejects empirical confidence values embedded in static analytics authority', async () => {
    const crossed = {
      ...policy(),
      confidenceComponents: { provenanceIntegrity: '1' },
    } as unknown as RniAnalyticsProjectionPolicy;
    const workerManifest = manifest(crossed);
    await expect(
      projectRniPlatformAnalyticsInput(
        {
          manifest: workerManifest,
          runManifestHash: MANIFEST_HASH,
          platform: 'reddit',
          securityId: SECURITY_ID,
        },
        queryable(workerManifest, []),
      ),
    ).rejects.toThrow('incomplete immutable analytics authority');
  });

  it('rejects out-of-window evidence and ambiguous many-narrative projection', async () => {
    const workerManifest = manifest();
    const outside = observationRow({
      sourceId: '10000000-0000-4000-8000-000000000013',
      mentionId: '10000000-0000-4000-8000-000000000023',
      observationId: '10000000-0000-4000-8000-000000000033',
      eligibleAt: '2026-09-02T11:00:00Z',
    });
    await expect(
      projectRniPlatformAnalyticsInput(
        {
          manifest: workerManifest,
          runManifestHash: MANIFEST_HASH,
          platform: 'reddit',
          securityId: SECURITY_ID,
        },
        queryable(workerManifest, [outside]),
      ),
    ).rejects.toThrow('outside the admitted current/comparison windows');

    const manyNarratives = observationRow({
      sourceId: '10000000-0000-4000-8000-000000000014',
      mentionId: '10000000-0000-4000-8000-000000000024',
      observationId: '10000000-0000-4000-8000-000000000034',
      eligibleAt: '2026-09-05T11:00:00Z',
      narratives: [
        { id: '10000000-0000-4000-8000-000000000092', independent: true },
        { id: '10000000-0000-4000-8000-000000000093', independent: false },
      ],
    });
    await expect(
      projectRniPlatformAnalyticsInput(
        {
          manifest: workerManifest,
          runManifestHash: MANIFEST_HASH,
          platform: 'reddit',
          securityId: SECURITY_ID,
        },
        queryable(workerManifest, [manyNarratives]),
      ),
    ).rejects.toThrow('multiple analytics narrative identities');
  });

  it('rejects durable evidence for a failed platform slice', async () => {
    const workerManifest = manifest();
    const row = observationRow({
      sourceId: '10000000-0000-4000-8000-000000000015',
      mentionId: '10000000-0000-4000-8000-000000000025',
      observationId: '10000000-0000-4000-8000-000000000035',
      eligibleAt: '2026-09-05T11:00:00Z',
    });
    await expect(
      projectRniPlatformAnalyticsInput(
        {
          manifest: workerManifest,
          runManifestHash: MANIFEST_HASH,
          platform: 'reddit',
          securityId: SECURITY_ID,
        },
        queryable(workerManifest, [row], 'failed'),
      ),
    ).rejects.toThrow('failed or unavailable slice with durable analytics evidence');
  });

  it('keeps a zero-evidence failed slice canonical and confidence unavailable', async () => {
    const workerManifest = manifest();
    const projection = await projectRniPlatformAnalyticsInput(
      {
        manifest: workerManifest,
        runManifestHash: MANIFEST_HASH,
        platform: 'reddit',
        securityId: SECURITY_ID,
      },
      queryable(workerManifest, [], 'failed'),
    );

    expect(projection.input.confidenceReadiness).toEqual({
      narrativeStageTerminal: true,
      catalystStageTerminal: true,
    });
    expect(calculatePlatformAnalytics(projection.input, projection.methodology).result).toMatchObject(
      {
        confidence: null,
        confidenceStatus: 'insufficient_evidence',
      },
    );
  });

  it('selects and revalidates the exact manifest rights-policy version', async () => {
    const workerManifest = manifest();
    const row = observationRow({
      sourceId: '10000000-0000-4000-8000-000000000016',
      mentionId: '10000000-0000-4000-8000-000000000026',
      observationId: '10000000-0000-4000-8000-000000000036',
      eligibleAt: '2026-09-05T11:00:00Z',
    });
    const db = queryable(workerManifest, [row]);
    await projectRniPlatformAnalyticsInput(
      {
        manifest: workerManifest,
        runManifestHash: MANIFEST_HASH,
        platform: 'reddit',
        securityId: SECURITY_ID,
      },
      db,
    );
    expect(vi.mocked(db.query).mock.calls[1]?.[1]).toEqual([
      RUN_ID,
      SECURITY_ID,
      'reddit',
      MANIFEST_HASH,
      'rni-source-policy-v1',
    ]);

    await expect(
      projectRniPlatformAnalyticsInput(
        {
          manifest: workerManifest,
          runManifestHash: MANIFEST_HASH,
          platform: 'reddit',
          securityId: SECURITY_ID,
        },
        queryable(workerManifest, [{ ...row, rights_policy_version: 'retired-rights-v0' }]),
      ),
    ).rejects.toThrow('crossed or content-drifted observation lineage');

    await expect(
      projectRniPlatformAnalyticsInput(
        {
          manifest: workerManifest,
          runManifestHash: MANIFEST_HASH,
          platform: 'reddit',
          securityId: SECURITY_ID,
        },
        queryable(workerManifest, [], 'complete', {
          rights_policy_version: 'retired-rights-v0',
        }),
      ),
    ).rejects.toThrow('crossed run, manifest, configuration, window, or policy authority');
  });
});
