import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import type { RniPlatformSlice, RniRun } from '../../../src/rni/contracts';
import type { RniPersistedClassificationResult } from '../../../src/rni/observations';
import { persistRniThemeDefinition } from '../../../src/rni/repositories/claims-narratives';
import { persistRniSecurityMention } from '../../../src/rni/repositories/observations';
import { persistRniRunWithSlices } from '../../../src/rni/repositories/runs';
import { PostgresRniSemanticPersistence } from '../../../src/rni/repositories/semantic-persistence';
import { persistRniSource } from '../../../src/rni/repositories/source-items';
import {
  comparativeMentions,
  comparativeObservations,
  comparativeSource,
  rniFixtureIds,
} from '../../../src/rni/testing/reference-fixtures';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';
import { seedRniVersionLineage } from './version-fixtures';

const url = databaseUrl();
const executionTheme = '30000000-0000-4000-8000-000000000001';
const competitionTheme = '30000000-0000-4000-8000-000000000002';

describe.skipIf(url === undefined)('RNI D10 atomic semantic persistence', () => {
  let pool: pg.Pool;
  let adapter: PostgresRniSemanticPersistence;

  beforeAll(async () => {
    pool = makePool();
    adapter = new PostgresRniSemanticPersistence(pool);
    await resetSchema(pool);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const versions = await seedRniVersionLineage(pool, 'd10');
    await pool.query(
      `insert into security (id, symbol, name, exchange, asset_type, currency) values
       ($1, 'NVDA', 'NVIDIA Corporation', 'NASDAQ', 'equity', 'USD'),
       ($2, 'AMD', 'Advanced Micro Devices, Inc.', 'NASDAQ', 'equity', 'USD')`,
      [rniFixtureIds.nvda, rniFixtureIds.amd],
    );
    await persistRniSource(comparativeSource, pool);
    for (const mention of comparativeMentions) await persistRniSecurityMention(mention, pool);
    await persistRniRunWithSlices(run(versions), slices(), pool);
    await persistRniThemeDefinition(
      {
        id: executionTheme,
        taxonomyVersion: 'rni-themes-v1',
        stableKey: 'execution',
        name: 'Execution',
        description: 'Execution quality.',
        parentStableKey: null,
        enabled: true,
        createdAt: '2026-09-05T00:06:00.000Z',
      },
      pool,
    );
    await persistRniThemeDefinition(
      {
        id: competitionTheme,
        taxonomyVersion: 'rni-themes-v1',
        stableKey: 'competition',
        name: 'Competition',
        description: 'Competitive position.',
        parentStableKey: null,
        enabled: true,
        createdAt: '2026-09-05T00:06:00.000Z',
      },
      pool,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  function run(versions: { configVersion: string; universeVersion: string }): RniRun {
    return {
      id: rniFixtureIds.run,
      idempotencyKey: 'rni-d10-run',
      trigger: 'manual',
      status: 'running',
      windowStart: '2026-09-04T00:00:00.000Z',
      windowEnd: '2026-09-05T00:00:00.000Z',
      comparisonStart: null,
      comparisonEnd: null,
      universeVersion: versions.universeVersion,
      configVersion: versions.configVersion,
      promptVersion: 'rni-prompts-v1',
      aiRoute: 'openai_direct',
      requestedAt: '2026-09-05T00:00:01.000Z',
      completedAt: null,
    };
  }

  function slices(): readonly [RniPlatformSlice, RniPlatformSlice] {
    return ['reddit', 'x'].map((platform) => ({
      id: randomUUID(),
      runId: rniFixtureIds.run,
      platform,
      status: platform === 'reddit' ? ('complete' as const) : ('unavailable' as const),
      eligibleSourceCount: platform === 'reddit' ? 1 : 0,
      coverageDisclosure: `${platform} D10 fixture`,
      lastAttemptAt: null,
      lastSuccessfulRefreshAt: null,
      dataThroughAt: null,
      computedAt: null,
      errorCode: platform === 'x' ? 'X_UNAVAILABLE' : null,
    })) as unknown as readonly [RniPlatformSlice, RniPlatformSlice];
  }

  function classification(): RniPersistedClassificationResult {
    const observations = comparativeObservations.map((observation) => ({
      ...observation,
      dimensions: [
        observation.dimensions[0]!,
        {
          dimension: 'market_trading' as const,
          stance: 'insufficient' as const,
          score: null,
          rationale: 'No market-trading support.',
        },
        {
          dimension: 'catalyst_event' as const,
          stance: 'insufficient' as const,
          score: null,
          rationale: 'No catalyst support.',
        },
        {
          dimension: 'retail_narrative' as const,
          stance: 'insufficient' as const,
          score: null,
          rationale: 'No retail-narrative support.',
        },
      ],
    }));
    const claims = [
      {
        sourceItemId: comparativeSource.id,
        securityId: rniFixtureIds.nvda,
        dimension: 'company_fundamentals' as const,
        claimText: 'NVDA has execution momentum.',
        claimType: 'opinion' as const,
        epistemicStatus: 'source_claim' as const,
        evidenceText: 'NVDA has execution momentum',
        startOffset: 0,
        endOffset: 27,
      },
      {
        sourceItemId: comparativeSource.id,
        securityId: rniFixtureIds.nvda,
        dimension: 'retail_narrative' as const,
        claimText: 'Retail prefers NVDA execution.',
        claimType: 'opinion' as const,
        epistemicStatus: 'unverified' as const,
        evidenceText: 'NVDA has execution momentum',
        startOffset: 0,
        endOffset: 27,
      },
      {
        sourceItemId: comparativeSource.id,
        securityId: rniFixtureIds.amd,
        dimension: 'company_fundamentals' as const,
        claimText: 'AMD is still catching up.',
        claimType: 'opinion' as const,
        epistemicStatus: 'source_claim' as const,
        evidenceText: 'AMD is still catching up',
        startOffset: 29,
        endOffset: 53,
      },
    ];
    return {
      observations,
      claims,
      citationProposals: claims.map((claim) => ({
        ...claim,
        platform: 'reddit' as const,
        url: comparativeSource.originalUrl,
      })),
      themes: [
        {
          sourceItemId: comparativeSource.id,
          securityId: rniFixtureIds.nvda,
          taxonomyVersion: 'rni-themes-v1',
          themeDefinitionId: executionTheme,
          stableKey: 'execution',
          stance: 'bullish',
          score: '0.65',
          classificationConfidence: '0.9',
          evidenceText: 'NVDA has execution momentum',
          startOffset: 0,
          endOffset: 27,
        },
        {
          sourceItemId: comparativeSource.id,
          securityId: rniFixtureIds.amd,
          taxonomyVersion: 'rni-themes-v1',
          themeDefinitionId: competitionTheme,
          stableKey: 'competition',
          stance: 'bearish',
          score: '-0.45',
          classificationConfidence: '0.88',
          evidenceText: 'AMD is still catching up',
          startOffset: 29,
          endOffset: 53,
        },
      ],
      noise: observations.map((observation, index) => ({
        sourceItemId: comparativeSource.id,
        securityId: observation.securityId,
        evidenceText: index === 0 ? 'NVDA has execution momentum' : 'AMD is still catching up',
        startOffset: index === 0 ? 0 : 29,
        endOffset: index === 0 ? 27 : 53,
        isSarcastic: false,
        sarcasmProbability: '0.1',
        isMeme: false,
        memeProbability: '0.05',
        isSpam: false,
        spamProbability: '0.02',
        informationValue: '0.9',
        assertionStrength: '0.8',
        evidenceQuality: '0.85',
        uncertainty: '0.15',
        exclusionReason: null,
      })),
      inputHashesBySecurity: Object.fromEntries(
        observations.map((observation) => [observation.securityId, observation.inputHash]),
      ),
    };
  }

  async function commit(value = classification()) {
    return adapter.commitClassification({
      runId: rniFixtureIds.run,
      sourceItemId: comparativeSource.id,
      classification: value,
    });
  }

  it('commits opposing two-security output, multiple claims, run membership and noise independently', async () => {
    const result = await commit();
    expect(result.disposition).toBe('inserted');
    expect(result.observationIds).toHaveLength(2);
    expect(result.claimIds).toHaveLength(3);
    expect(result.citationIds).toHaveLength(3);

    const { rows } = await pool.query<{
      memberships: string;
      quality: string;
      claims: string;
      distinct_hashes: string;
      dimensions: string[];
    }>(
      `select
         (select count(*)::text from rni_run_observation) memberships,
         (select count(*)::text from rni_observation_semantic_quality) quality,
         (select count(*)::text from rni_evidence_claim) claims,
         (select count(distinct input_hash)::text from rni_evidence_claim) distinct_hashes,
         (select array_agg(distinct dimension order by dimension) from rni_evidence_claim) dimensions`,
    );
    expect(rows[0]).toEqual({
      memberships: '2',
      quality: '2',
      claims: '3',
      distinct_hashes: '3',
      dimensions: ['company_fundamentals', 'retail_narrative'],
    });
  });

  it('returns the original durable IDs in deterministic order on exact replay', async () => {
    const first = await commit();
    const replay = await commit();
    expect(replay).toEqual({ ...first, disposition: 'duplicate' });
    expect(replay.observationIds).toEqual([...replay.observationIds].sort());
  });

  it('rejects changed, added, or removed semantic children through the public adapter', async () => {
    const original = classification();
    await commit(original);
    const changedClaim = {
      ...original.claims[0]!,
      claimText: 'Changed claim content under the same observation.',
    };
    await expect(
      commit({
        ...original,
        claims: [changedClaim, ...original.claims.slice(1)],
        citationProposals: [
          { ...original.citationProposals[0]!, claimText: changedClaim.claimText },
          ...original.citationProposals.slice(1),
        ],
      }),
    ).rejects.toThrow('durable observation set differs');
    const changedEvidence = {
      ...original.claims[0]!,
      evidenceText: 'Changed citation evidence',
    };
    await expect(
      commit({
        ...original,
        claims: [changedEvidence, ...original.claims.slice(1)],
        citationProposals: [
          { ...original.citationProposals[0]!, evidenceText: changedEvidence.evidenceText },
          ...original.citationProposals.slice(1),
        ],
      }),
    ).rejects.toThrow('durable observation set differs');
    await expect(
      commit({
        ...original,
        claims: original.claims.slice(1),
        citationProposals: original.citationProposals.slice(1),
      }),
    ).rejects.toThrow('durable observation set differs');
    const addedClaim = {
      ...original.claims[0]!,
      dimension: 'market_trading' as const,
      claimText: 'An added replay claim.',
    };
    await expect(
      commit({
        ...original,
        claims: [...original.claims, addedClaim],
        citationProposals: [
          ...original.citationProposals,
          { ...original.citationProposals[0]!, ...addedClaim, platform: 'reddit' },
        ],
      }),
    ).rejects.toThrow('durable observation set differs');
    await expect(
      commit({
        ...original,
        themes: original.themes.map((theme, index) =>
          index === 0 ? { ...theme, endOffset: theme.endOffset - 1 } : theme,
        ),
      }),
    ).rejects.toThrow('durable observation set differs');
  });

  it('replays valid higher-precision decimals through storage canonicalization', async () => {
    const original = classification();
    const precise: RniPersistedClassificationResult = {
      ...original,
      observations: original.observations.map((observation) => ({
        ...observation,
        stanceScore: observation.stance === 'bullish' ? '0.650001' : '-0.450001',
        relevance: '0.987654',
        dimensions: observation.dimensions.map((dimension) => ({
          ...dimension,
          score:
            dimension.score === null
              ? null
              : observation.stance === 'bullish'
                ? '0.650001'
                : '-0.450001',
        })),
      })),
      themes: original.themes.map((theme) => ({
        ...theme,
        classificationConfidence: '0.912345',
      })),
      noise: original.noise.map((noise) => ({
        ...noise,
        sarcasmProbability: '0.123456',
        evidenceQuality: '0.876543',
      })),
    };
    const first = await commit(precise);
    expect(await commit(precise)).toEqual({ ...first, disposition: 'duplicate' });
    const crossedRoundedNumeric: RniPersistedClassificationResult = {
      ...precise,
      observations: precise.observations.map((observation, index) =>
        index === 0 ? { ...observation, stanceScore: '0.650002' } : observation,
      ),
    };
    await expect(commit(crossedRoundedNumeric)).rejects.toThrow(
      'durable observation set differs',
    );
  });

  it('serializes concurrent crossed classifications and commits only one complete set', async () => {
    const original = classification();
    const crossedClaim = {
      ...original.claims[0]!,
      claimText: 'Concurrent crossed claim content.',
    };
    const crossed: RniPersistedClassificationResult = {
      ...original,
      claims: [crossedClaim, ...original.claims.slice(1)],
      citationProposals: [
        { ...original.citationProposals[0]!, claimText: crossedClaim.claimText },
        ...original.citationProposals.slice(1),
      ],
    };
    const results = await Promise.allSettled([commit(original), commit(crossed)]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect((await pool.query('select id from rni_evidence_claim')).rowCount).toBe(3);
    expect((await pool.query('select id from rni_claim_citation')).rowCount).toBe(3);
  });

  it('rejects crossed JSONB dimension scores even when numeric rounding would match', async () => {
    const original = classification();
    const precise: RniPersistedClassificationResult = {
      ...original,
      observations: original.observations.map((observation, index) =>
        index === 0
          ? {
              ...observation,
              dimensions: observation.dimensions.map((dimension) => ({
                ...dimension,
                score: dimension.score === null ? null : '0.650001',
              })),
            }
          : observation,
      ),
    };
    await commit(precise);
    const crossed: RniPersistedClassificationResult = {
      ...precise,
      observations: precise.observations.map((observation, index) =>
        index === 0
          ? {
              ...observation,
              dimensions: observation.dimensions.map((dimension) => ({
                ...dimension,
                score: dimension.score === null ? null : '0.650002',
              })),
            }
          : observation,
      ),
    };
    await expect(commit(crossed)).rejects.toThrow('durable observation set differs');
  });

  it('requires exactly four frozen dimensions and exact input-hash security keys', async () => {
    const original = classification();
    await expect(
      commit({
        ...original,
        observations: original.observations.map((observation, index) =>
          index === 0
            ? { ...observation, dimensions: observation.dimensions.slice(0, 3) }
            : observation,
        ),
      }),
    ).rejects.toThrow('each frozen dimension exactly once');
    await expect(
      commit({
        ...original,
        observations: original.observations.map((observation, index) =>
          index === 0
            ? {
                ...observation,
                dimensions: [
                  ...observation.dimensions.slice(0, 3),
                  observation.dimensions[0]!,
                ],
              }
            : observation,
        ),
      }),
    ).rejects.toThrow('each frozen dimension exactly once');
    await expect(
      commit({
        ...original,
        inputHashesBySecurity: {
          ...original.inputHashesBySecurity,
          [randomUUID()]: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        },
      }),
    ).rejects.toThrow('input-hash security keys differ');
  });

  it('fails closed when an observation identity contains crossed content', async () => {
    const original = classification();
    await commit(original);
    const crossedObservation = {
      ...original,
      observations: original.observations.map((value, index) =>
        index === 0 ? { ...value, claimSummary: 'crossed observation content' } : value,
      ),
    };
    await expect(commit(crossedObservation)).rejects.toThrow('durable observation set differs');
  });

  it('rolls every semantic child back when one child write fails', async () => {
    await pool.query(`create function fail_d10_quality() returns trigger language plpgsql as $$
      begin raise exception 'forced D10 child failure'; end $$`);
    await pool.query(`create trigger fail_d10_quality before insert on rni_observation_semantic_quality
      for each row execute function fail_d10_quality()`);
    try {
      await expect(commit()).rejects.toThrow('forced D10 child failure');
      const { rows } = await pool.query<{ total: string }>(
        `select (
          (select count(*) from rni_security_observation) +
          (select count(*) from rni_run_observation) +
          (select count(*) from rni_observation_semantic_quality) +
          (select count(*) from rni_evidence_claim) +
          (select count(*) from rni_claim_citation) +
          (select count(*) from rni_observation_theme)
        )::text total`,
      );
      expect(rows[0]?.total).toBe('0');
    } finally {
      await pool.query('drop trigger if exists fail_d10_quality on rni_observation_semantic_quality');
      await pool.query('drop function if exists fail_d10_quality()');
    }
  });

  it('rejects missing run, source, and observation lineage without partial writes', async () => {
    const value = classification();
    await expect(
      adapter.commitClassification({ ...{ runId: randomUUID(), sourceItemId: comparativeSource.id }, classification: value }),
    ).rejects.toThrow('missing run lineage');
    const missingSourceId = randomUUID();
    const missingSourceValue: RniPersistedClassificationResult = {
      ...value,
      observations: value.observations.map((entry) => ({ ...entry, sourceItemId: missingSourceId })),
      claims: value.claims.map((entry) => ({ ...entry, sourceItemId: missingSourceId })),
      citationProposals: value.citationProposals.map((entry) => ({
        ...entry,
        sourceItemId: missingSourceId,
      })),
      themes: value.themes.map((entry) => ({ ...entry, sourceItemId: missingSourceId })),
      noise: value.noise.map((entry) => ({ ...entry, sourceItemId: missingSourceId })),
    };
    await expect(
      adapter.commitClassification({
        runId: rniFixtureIds.run,
        sourceItemId: missingSourceId,
        classification: missingSourceValue,
      }),
    ).rejects.toThrow('missing source lineage');
    await pool.query('truncate table rni_security_mention cascade');
    await expect(commit(value)).rejects.toMatchObject({ constraint: 'rni_security_observation_mention_fk' });
    expect((await pool.query(`select * from rni_security_observation`)).rowCount).toBe(0);
  });
});
