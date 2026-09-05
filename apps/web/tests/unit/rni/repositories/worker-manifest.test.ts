import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { Queryable } from '@/repositories/client';
import {
  RNI_WORKER_MANIFEST_TASKS,
  hashRniWorkerManifest,
  hashRniWorkerPriceBook,
  hashRniWorkerSnapshotValue,
  type RniCanonicalJsonValue,
  type RniWorkerManifest,
  type RniWorkerPriceBookValue,
} from '@/rni/orchestration/worker-manifest';
import {
  RniWorkerManifestRepositoryError,
  assembleRniWorkerManifest,
  assertDraftRniWorkerConfigAuthorityTarget,
  authorityReferencesForRniWorkerManifest,
  bindRniWorkerConfigAuthority,
  loadRniWorkerManifest,
  loadRniWorkerManifestAuthorities,
  persistRniWorkerManifestAuthority,
  persistRniWorkerManifest,
  readRniWorkerBuildEnvironment,
  type RniWorkerManifestAuthoritySet,
} from '@/rni/repositories/worker-manifest';

const HASH = 'a'.repeat(64);
const RUN_ID = '10000000-0000-4000-8000-000000000001';
const JOB_ID = '10000000-0000-4000-8000-000000000002';
const SECURITY_ID = '10000000-0000-4000-8000-000000000003';

const result = <Row extends pg.QueryResultRow>(
  rows: readonly Row[],
  rowCount: number | null = rows.length,
): pg.QueryResult<Row> =>
  ({ rows: [...rows], rowCount, command: '', oid: 0, fields: [] }) as pg.QueryResult<Row>;

const queryable = (
  implementation: (sql: string, values: readonly unknown[]) => pg.QueryResult,
): Queryable =>
  ({
    query: vi.fn(async (sql: string, values: readonly unknown[] = []) =>
      implementation(sql, values),
    ),
  }) as unknown as Queryable;

const snapshot = (version: string, value: Readonly<Record<string, RniCanonicalJsonValue>>) => ({
  version,
  value,
  snapshotHash: hashRniWorkerSnapshotValue(value),
});

const prompt = (ordinal: number) => ({
  version: `prompt-${String(ordinal)}`,
  contentHash: '1'.repeat(64),
  inputSchemaVersion: `input-${String(ordinal)}`,
  inputSchemaHash: '2'.repeat(64),
  outputSchemaVersion: `output-${String(ordinal)}`,
  outputSchemaHash: '3'.repeat(64),
  toolVersion: `tool-${String(ordinal)}`,
  toolHash: '4'.repeat(64),
});

const priceValue = (): RniWorkerPriceBookValue => ({
  version: 'prices-1',
  sourceUrl: 'https://example.test/prices',
  responseHash: '5'.repeat(64),
  observedAt: '2026-09-04T00:00:00Z',
  firstTierInputCeiling: 100_000,
  units: [
    {
      provider: 'openai',
      service: 'openai_responses',
      operationOrModel: 'gpt-5.6-sol',
      unitType: 'input_token',
      unitPrice: '0.1',
      currency: 'USD',
      effectiveFrom: '2026-09-01T00:00:00Z',
      effectiveUntil: null,
      sourceReference: 'approved-price-evidence',
    },
    {
      provider: 'openai',
      service: 'openai_responses',
      operationOrModel: 'gpt-5.6-sol',
      unitType: 'output_token',
      unitPrice: '0.2',
      currency: 'USD',
      effectiveFrom: '2026-09-01T00:00:00Z',
      effectiveUntil: null,
      sourceReference: 'approved-price-evidence',
    },
    {
      provider: 'openai',
      service: 'openai_responses',
      operationOrModel: 'gpt-5.6-terra',
      unitType: 'input_token',
      unitPrice: '0.1',
      currency: 'USD',
      effectiveFrom: '2026-09-01T00:00:00Z',
      effectiveUntil: null,
      sourceReference: 'approved-price-evidence',
    },
    {
      provider: 'openai',
      service: 'openai_responses',
      operationOrModel: 'gpt-5.6-terra',
      unitType: 'output_token',
      unitPrice: '0.2',
      currency: 'USD',
      effectiveFrom: '2026-09-01T00:00:00Z',
      effectiveUntil: null,
      sourceReference: 'approved-price-evidence',
    },
    {
      provider: 'openai',
      service: 'openai_web_search',
      operationOrModel: 'web_search',
      unitType: 'search',
      unitPrice: '0.01',
      currency: 'USD',
      effectiveFrom: '2026-09-01T00:00:00Z',
      effectiveUntil: null,
      sourceReference: 'approved-price-evidence',
    },
  ],
});

const authoritySet = (): RniWorkerManifestAuthoritySet => {
  const prompts = Object.fromEntries(
    RNI_WORKER_MANIFEST_TASKS.map((task, index) => [task, prompt(index + 1)]),
  ) as RniWorkerManifestAuthoritySet['prompts'];
  return {
    source: {
      configuration: snapshot('source-1', { communities: ['approved'] }),
      redditQueries: snapshot('reddit-queries-1', { queries: ['approved'] }),
      xQueries: snapshot('x-queries-1', { queries: ['approved'] }),
      rightsPolicy: snapshot('rights-1', { capture: ['excerpt_only'] }),
    },
    policies: {
      ambiguity: snapshot('ambiguity-1', { mode: 'abstain' }),
      taxonomy: snapshot('taxonomy-1', {
        dimensions: [
          'company_fundamentals',
          'market_trading',
          'catalyst_event',
          'retail_narrative',
        ],
      }),
      classification: snapshot('classification-1', { insufficient: true }),
      analytics: snapshot('analytics-1', { minimumEvidence: 3 }),
      convergence: snapshot('convergence-1', { preserveDivergence: true }),
      budget: snapshot('budget-1', { reservation: 'pre_dispatch' }),
    },
    prompts,
    build: {
      deploymentId: 'deployment-1',
      commitSha: 'f'.repeat(40),
      artifactHash: 'e'.repeat(64),
      sourceAdapterVersions: { reddit: 'reddit-1', x: 'x-1' },
      semanticCodeVersion: 'semantic-1',
      analyticsCodeVersion: 'analytics-1',
      convergenceCodeVersion: 'convergence-1',
      citedSynthesisCodeVersion: 'synthesis-1',
    },
    references: [],
  };
};

const fixture = (): RniWorkerManifest => {
  const priceBookValue = priceValue();
  const priceBook = {
    ...priceBookValue,
    snapshotHash: hashRniWorkerPriceBook(priceBookValue),
  };
  const modelRoutes = RNI_WORKER_MANIFEST_TASKS.map((task) => {
    const model = ['rni_verification', 'rni_challenger'].includes(task)
      ? 'gpt-5.6-sol'
      : 'gpt-5.6-terra';
    return {
      task,
      aiRoute: 'openai_direct' as const,
      transport: 'openai_responses',
      provider: 'openai',
      configuredModelId: model,
      canonicalProviderModelId: model,
      modelRevision: `${model}-revision`,
      reasoningEffort: 'low',
      policyVersion: 'rni-balanced-model-policy-v1',
      calibrationVersion: 'calibration-1',
      capability: {
        snapshotId: `${model}-capability`,
        responseHash: HASH,
        observedAt: '2026-09-05T00:00:00Z',
        expiresAt: '2026-09-06T00:00:00Z',
        available: true,
        supportsResponses: true,
        supportsStructuredOutputs: true,
        supportsWebSearch: model === 'gpt-5.6-terra',
        reasoningEfforts: ['low'],
        requiresResponses: true,
        requiresStructuredOutputs: true,
        requiresWebSearch: task === 'rni_discovery',
      },
      temperature: '0',
      fallbackChain: [],
      allowedDataClasses: ['public_social'],
      envelope: {
        task,
        maxInputBytes: 16_000,
        maxInputTokensReserved: 16_000,
        maxOutputTokens: 2_000,
        maxToolCalls: task === 'rni_discovery' ? 3 : 0,
        timeoutMs: 30_000,
        maxCostUsd: '0.1',
      },
      priceBook,
    };
  });
  const member = {
    ordinal: 1,
    securityId: SECURITY_ID,
    ticker: 'NVDA',
    companyName: 'NVIDIA Corporation',
    exchange: 'NASDAQ',
    assetType: 'equity',
    currency: 'USD',
    aliases: ['NVDA', 'NVIDIA'],
    selectionSource: 'fmp_sp500',
    providerSymbol: 'NVDA',
    providerCompanyName: 'NVIDIA Corporation',
    constituentFirstAddedAt: null,
  };
  return assembleRniWorkerManifest(
    {
      version: 'rni-worker-manifest-v2',
      environment: 'test',
      partition: 'test',
      runId: RUN_ID,
      jobRunId: JOB_ID,
      planHash: '9'.repeat(64),
      trigger: 'manual',
      acceptedAt: '2026-09-05T01:00:00.123456Z',
      deadline: '2026-09-05T01:15:00.123456Z',
      scope: { kind: 'manual_ticker', selectedSecurityId: SECURITY_ID },
      windows: {
        timezone: 'UTC',
        windowStart: '2026-09-04T01:00:00Z',
        windowEnd: '2026-09-05T01:00:00Z',
        comparisonStart: '2026-09-03T01:00:00Z',
        comparisonEnd: '2026-09-04T01:00:00Z',
        assessmentCutoffAt: '2026-09-05T01:00:00Z',
      },
      configuration: {
        version: '17',
        checksum: 'config-checksum',
        aiRoute: 'openai_direct',
        modelPolicyVersion: 'rni-balanced-model-policy-v1',
        budgetPolicyVersion: 'rni-ai-budget-policy-v1',
        promptSetVersion: 'prompt-set-1',
        aggregateBudgets: {
          manualRunHardUsd: '2',
          fullUniverseHardUsd: '25',
          rolling24hHardUsd: '50',
          monthlyWarningUsd: '300',
          monthlyHardUsd: '500',
          currency: 'USD',
        },
      },
      universe: { version: '9', snapshotHash: '8'.repeat(64) },
      modelRoutes,
      orchestration: {
        maxAttempts: 3,
        maxRuntimeMs: 900_000,
        leaseMs: 60_000,
        baseBackoffMs: 1_000,
        maxBackoffMs: 30_000,
        coalesceMs: 60_000,
        calls: {
          reddit: {
            rni_discovery: 1,
            rni_relationship: 3,
            rni_classifier: 3,
            rni_verification: 1,
            rni_challenger: 1,
          },
          x: {
            rni_discovery: 0,
            rni_relationship: 2,
            rni_classifier: 2,
            rni_verification: 0,
            rni_challenger: 0,
          },
        },
        maxCostUsd: '2',
      },
      coverage: { reddit: 'Sampled Reddit.', x: 'Configured X sample.' },
      members: [member],
    },
    authoritySet(),
  ).manifest;
};

const authorityRows = (manifest: RniWorkerManifest) =>
  authorityReferencesForRniWorkerManifest(manifest).map((reference) => ({
    authority_kind: reference.authorityKind,
    authority_key: reference.authorityKey,
    version: reference.version,
    snapshot_hash: reference.snapshotHash,
    value: reference.value,
    config_bound: reference.configBound,
  }));

const headerRow = (manifest: RniWorkerManifest) => ({
  run_id: manifest.runId,
  manifest_version: manifest.version,
  environment: manifest.environment,
  partition: manifest.partition,
  job_run_id: manifest.jobRunId,
  plan_hash: manifest.planHash,
  run_manifest_hash: hashRniWorkerManifest(manifest),
  member_set_version: 'rni-worker-member-set-v1',
  member_set_hash: manifest.memberSetHash,
  member_count: manifest.memberCount,
  config_version: manifest.configuration.version,
  universe_version: manifest.universe.version,
  scope_kind: manifest.scope.kind,
  selected_security_id:
    manifest.scope.kind === 'manual_ticker' ? manifest.scope.selectedSecurityId : null,
  accepted_at: manifest.acceptedAt,
  deadline: manifest.deadline,
  manifest,
});

const memberRows = (manifest: RniWorkerManifest) =>
  manifest.members.map((member) => ({
    ordinal: member.ordinal,
    security_id: member.securityId,
    ticker: member.ticker,
    company_name: member.companyName,
    exchange: member.exchange,
    asset_type: member.assetType,
    currency: member.currency,
    aliases: member.aliases,
    selection_source: member.selectionSource,
    provider_symbol: member.providerSymbol,
    provider_company_name: member.providerCompanyName,
    constituent_first_added_at: member.constituentFirstAddedAt,
  }));

describe('D-RNI-32 worker manifest repository', () => {
  it('requires exact deployment-owned build identity and has no development fallback', () => {
    expect(
      readRniWorkerBuildEnvironment({
        RNI_DEPLOYMENT_ID: 'deployment-1',
        RNI_COMMIT_SHA: 'f'.repeat(40),
        RNI_ARTIFACT_SHA256: 'e'.repeat(64),
      }),
    ).toEqual({
      deploymentId: 'deployment-1',
      commitSha: 'f'.repeat(40),
      artifactHash: 'e'.repeat(64),
    });
    expect(() => readRniWorkerBuildEnvironment({})).toThrowError(
      new RniWorkerManifestRepositoryError('BUILD_ENV_MISSING'),
    );
  });

  it('assembles deterministic manifest bytes and all sixteen normalized authority links', () => {
    const manifest = fixture();
    const references = authorityReferencesForRniWorkerManifest(manifest);
    expect(references).toHaveLength(16);
    expect(
      new Set(
        references.map(({ authorityKind, authorityKey }) => `${authorityKind}:${authorityKey}`),
      ).size,
    ).toBe(16);
    expect(manifest.memberSetHash).toHaveLength(64);
    expect(hashRniWorkerManifest(manifest)).toHaveLength(64);
    expect(manifest.modelRoutes.map(({ prompt }) => prompt.version)).toEqual([
      'prompt-1',
      'prompt-2',
      'prompt-3',
      'prompt-4',
      'prompt-5',
    ]);
  });

  it('persists reviewed authorities and draft bindings idempotently without overwriting crossings', async () => {
    const value = { mode: 'approved' } as const;
    const snapshotHash = hashRniWorkerSnapshotValue(value);
    const insertedDb = queryable(() => result([], 1));
    await expect(
      persistRniWorkerManifestAuthority(
        {
          authorityKind: 'ambiguity',
          authorityKey: 'default',
          version: 'ambiguity-1',
          snapshotHash,
          value,
        },
        insertedDb,
      ),
    ).resolves.toBe('inserted');
    await expect(
      bindRniWorkerConfigAuthority(
        {
          configVersion: '17',
          authorityKind: 'ambiguity',
          version: 'ambiguity-1',
          snapshotHash,
        },
        insertedDb,
      ),
    ).resolves.toBe('inserted');

    let call = 0;
    const duplicateDb = queryable(() => {
      call += 1;
      if (call === 1) return result([], 0);
      return result([
        {
          authority_kind: 'ambiguity',
          authority_key: 'default',
          version: 'ambiguity-1',
          snapshot_hash: snapshotHash,
          value,
          config_bound: false,
        },
      ]);
    });
    await expect(
      persistRniWorkerManifestAuthority(
        {
          authorityKind: 'ambiguity',
          authorityKey: 'default',
          version: 'ambiguity-1',
          snapshotHash,
          value,
        },
        duplicateDb,
      ),
    ).resolves.toBe('duplicate');
    await expect(
      persistRniWorkerManifestAuthority(
        {
          authorityKind: 'ambiguity',
          authorityKey: 'default',
          version: 'ambiguity-1',
          snapshotHash: 'b'.repeat(64),
          value,
        },
        duplicateDb,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('locks and accepts only the exact draft config before operator authority writes', async () => {
    const draft = queryable((sql, values) => {
      expect(sql).toContain('for update');
      expect(values).toEqual(['17']);
      return result([{ id: '17', status: 'draft' }]);
    });
    await expect(assertDraftRniWorkerConfigAuthorityTarget('17', draft)).resolves.toBeUndefined();

    for (const rows of [[], [{ id: '17', status: 'active' }], [{ id: '18', status: 'draft' }]]) {
      await expect(
        assertDraftRniWorkerConfigAuthorityTarget('17', queryable(() => result(rows))),
      ).rejects.toThrowError(new RniWorkerManifestRepositoryError('CONFLICT'));
    }
  });

  it('loads only the complete config-bound, prompt and build authority set', async () => {
    const manifest = fixture();
    const rows = authorityRows(manifest);
    let queryIndex = 0;
    const db = queryable(() => {
      queryIndex += 1;
      if (queryIndex === 1) return result(rows.filter(({ config_bound }) => config_bound));
      if (queryIndex === 2)
        return result(rows.filter(({ authority_kind }) => authority_kind === 'prompt'));
      return result(rows.filter(({ authority_kind }) => authority_kind === 'build'));
    });
    const loaded = await loadRniWorkerManifestAuthorities(
      {
        configVersion: '17',
        promptVersions: Object.fromEntries(
          manifest.modelRoutes.map(({ task, prompt: value }) => [task, value.version]),
        ) as Record<(typeof RNI_WORKER_MANIFEST_TASKS)[number], string>,
        buildEnvironment: {
          deploymentId: manifest.build.deploymentId,
          commitSha: manifest.build.commitSha,
          artifactHash: manifest.build.artifactHash,
        },
      },
      db,
    );
    expect(loaded.source).toEqual(manifest.source);
    expect(loaded.policies).toEqual(manifest.policies);
    expect(loaded.build).toEqual(manifest.build);
    expect(loaded.references).toHaveLength(16);
  });

  it('fails before manifest persistence when one approved authority is absent', async () => {
    const manifest = fixture();
    const db = queryable(() => result(authorityRows(manifest).slice(1)));
    await expect(persistRniWorkerManifest(manifest, db)).rejects.toMatchObject({
      code: 'AUTHORITY_MISSING',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('persists header, links and normalized members without seeding authority rows', async () => {
    const manifest = fixture();
    const sql: string[] = [];
    const db = queryable((statement) => {
      sql.push(statement);
      if (statement.includes('from jsonb_to_recordset($1::jsonb) as requested')) {
        return result(authorityRows(manifest));
      }
      if (statement.includes('insert into rni_worker_run_manifest (')) {
        return result([{ run_id: manifest.runId }]);
      }
      return result([]);
    });
    await expect(persistRniWorkerManifest(manifest, db)).resolves.toEqual({
      disposition: 'inserted',
      runId: manifest.runId,
      runManifestHash: hashRniWorkerManifest(manifest),
    });
    expect(sql).toHaveLength(4);
    expect(
      sql.filter((statement) => statement.includes('insert into rni_worker_manifest_authority')),
    ).toHaveLength(0);
    expect(sql.some((statement) => statement.includes('rni_worker_run_manifest_authority'))).toBe(
      true,
    );
    expect(sql.some((statement) => statement.includes('rni_worker_run_manifest_member'))).toBe(
      true,
    );
  });

  it('loads exact bytes by run and hash and rejects a crossed or relationally corrupt read', async () => {
    const manifest = fixture();
    const manifestHash = hashRniWorkerManifest(manifest);
    const exactDb = queryable((statement) => {
      if (statement.includes('from rni_worker_run_manifest\n'))
        return result([headerRow(manifest)]);
      if (statement.includes('from rni_worker_run_manifest_member'))
        return result(memberRows(manifest));
      if (statement.includes('from rni_worker_run_manifest_authority'))
        return result(authorityRows(manifest));
      throw new Error('Unexpected query');
    });
    await expect(loadRniWorkerManifest(RUN_ID, manifestHash, exactDb)).resolves.toEqual(manifest);

    const missingDb = queryable(() => result([]));
    await expect(loadRniWorkerManifest(RUN_ID, 'b'.repeat(64), missingDb)).rejects.toMatchObject({
      code: 'MANIFEST_NOT_FOUND',
    });

    const corruptDb = queryable((statement) => {
      if (statement.includes('from rni_worker_run_manifest\n'))
        return result([headerRow(manifest)]);
      if (statement.includes('from rni_worker_run_manifest_member')) {
        return result(memberRows(manifest).map((row) => ({ ...row, ticker: 'AMD' })));
      }
      return result(authorityRows(manifest));
    });
    await expect(loadRniWorkerManifest(RUN_ID, manifestHash, corruptDb)).rejects.toMatchObject({
      code: 'MANIFEST_CORRUPT',
    });
  });
});
