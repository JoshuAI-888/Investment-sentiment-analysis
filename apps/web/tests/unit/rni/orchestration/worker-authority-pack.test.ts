import { describe, expect, it, vi } from 'vitest';

import { RNI_CITED_SYNTHESIS_CODE_VERSION } from '@/rni/agents';
import {
  RNI_ANALYTICS_CODE_VERSION,
  RNI_CONFIDENCE_COMPONENT_KEYS,
} from '@/rni/analytics';
import { RNI_CONVERGENCE_CODE_VERSION } from '@/rni/convergence';
import {
  compiledRniPromptAuthority,
} from '@/rni/orchestration/worker-authority';
import {
  entriesForRniReviewedWorkerAuthorityPack,
  parseRniReviewedWorkerAuthorityPack,
  seedRniReviewedWorkerAuthorityPack,
} from '@/rni/orchestration/worker-authority-pack';
import {
  RNI_WORKER_MANIFEST_TASKS,
  hashRniWorkerSnapshotValue,
} from '@/rni/orchestration/worker-manifest';
import type { Queryable } from '@/repositories/client';

const components = Object.fromEntries(
  RNI_CONFIDENCE_COMPONENT_KEYS.map((key) => [key, key === 'provenanceIntegrity' ? '1' : '0']),
);
const values = {
  source_configuration: {
    reddit: {
      acquisitionMethod: 'openai_web_search',
      coverageMode: 'REDDIT_SAMPLED_WEB_DISCOVERY',
    },
    x: { acquisitionMethod: 'x_adapter', coverageMode: 'X_CONFIGURED_SAMPLE' },
    retentionPolicyVersion: 'retention-v1',
  },
  reddit_queries: {
    scheduledCommunity: { communities: ['r/stocks'], maxCandidates: 50 },
    onDemandSecurity: { communities: ['r/stocks'], maxCandidates: 20 },
  },
  x_queries: {
    queries: [
      {
        queryId: '00000000-0000-4000-8000-000000000001',
        query: 'NVDA lang:en',
        scope: 'nvda-watch',
        maxResults: 25,
      },
    ],
  },
  rights_policy: {
    policyVersion: 'rni-source-policy-v1',
    platforms: ['reddit', 'x'],
    captureModes: ['excerpt_only', 'full_comment', 'full_post'],
    maximumBoundedContentCharacters: 20_000,
    storeWholePageHtml: false,
    requireOriginalUrl: true,
    revalidateAtPublication: true,
  },
  ambiguity: { version: 'ambiguity-v1', bareTickerSymbols: ['AI'] },
  taxonomy: {
    version: 'taxonomy-v1',
    dimensions: [
      'company_fundamentals',
      'market_trading',
      'catalyst_event',
      'retail_narrative',
    ],
    categories: [
      {
        definitionId: '00000000-0000-4000-8000-000000000002',
        stableKey: 'ai_infrastructure',
        label: 'AI infrastructure',
        description: 'AI infrastructure demand and execution.',
        enabled: true,
        classificationThreshold: '0.7',
      },
    ],
  },
  classification: {
    version: 'classification-v1',
    schemaVersion: 'rni-classifier-output-v1',
    neutralMaxAbsoluteScore: '0.1',
    strongMinAbsoluteScore: '0.7',
    binaryLabelThreshold: '0.5',
  },
  analytics: {
    codeVersion: RNI_ANALYTICS_CODE_VERSION,
    timestampBasis: 'published_at_else_observed_at',
    memePenalty: '0.5',
    halfLifeHours: '24',
    lowBaseThreshold: '1',
    epsilon: '0.01',
    minimumEffectiveAttention: '0.1',
    minimumIndependentSources: '1',
    winsorLowerPercentile: '0.05',
    winsorUpperPercentile: '0.95',
    minimumBaselineWindows: '2',
    zScoreDecimalPlaces: '6',
    highNarrativeConcentrationThreshold: '0.8',
    staleAfterHours: '48',
    confidenceWeights: components,
    confidenceBands: { mediumMinimum: '40', highMinimum: '65', veryHighMinimum: '85' },
    confidenceCaps: {
      singleSourceOrCommunity: '50',
      highNarrativeConcentration: '60',
      partialCoverage: '70',
      staleEvidence: '40',
    },
    sourceWeights: { reddit: '1', x: '1' },
    communities: [
      { platform: 'reddit', scope: 'r/stocks', analyticalCluster: 'r/stocks', weight: '1' },
    ],
  },
  convergence: {
    version: 'convergence-v1',
    codeVersion: RNI_CONVERGENCE_CODE_VERSION,
    dimensionDivergenceMinimum: '0.4',
    scaleImbalanceRatioThreshold: '2',
    staleAfterHours: '48',
  },
  budget: { reservationMode: 'pre_dispatch', settlementMode: 'provider_usage' },
} as const;

const build = {
  deploymentId: 'deployment-1',
  commitSha: 'f'.repeat(40),
  artifactHash: 'e'.repeat(64),
  sourceAdapterVersions: { reddit: 'reddit-web-search-v1', x: 'x-adapter-v1' },
  semanticCodeVersion: 'semantic-v1',
  analyticsCodeVersion: RNI_ANALYTICS_CODE_VERSION,
  convergenceCodeVersion: RNI_CONVERGENCE_CODE_VERSION,
  citedSynthesisCodeVersion: RNI_CITED_SYNTHESIS_CODE_VERSION,
};

const versions = {
  source_configuration: 'source-v1',
  reddit_queries: 'reddit-queries-v1',
  x_queries: 'x-queries-v1',
  rights_policy: 'rni-source-policy-v1',
  ambiguity: 'ambiguity-v1',
  taxonomy: 'taxonomy-v1',
  classification: 'classification-v1',
  analytics: 'analytics-v1',
  convergence: 'convergence-v1',
  budget: 'budget-v1',
} as const;

const snapshot = (version: string, value: Readonly<Record<string, unknown>>) => ({
  version,
  value,
  snapshotHash: hashRniWorkerSnapshotValue(value),
});

const promptVersions = {
  rni_discovery: 'rni-discovery-v2',
  rni_relationship: 'rni-relationship-v1',
  rni_classifier: 'rni-classifier-v1',
  rni_verification: 'rni-verification-v2',
  rni_challenger: 'rni-challenger-v2',
} as const;

const packInput = () => ({
  configVersion: '42',
  authorities: Object.fromEntries(
    Object.entries(values).map(([kind, value]) => [
      kind,
      snapshot(versions[kind as keyof typeof versions], value),
    ]),
  ),
  prompts: Object.fromEntries(
    RNI_WORKER_MANIFEST_TASKS.map((task) => {
      const value = compiledRniPromptAuthority(task, promptVersions[task]);
      return [task, snapshot(value.version, value)];
    }),
  ),
  build: snapshot(build.deploymentId, build),
});

const environment = {
  RNI_DEPLOYMENT_ID: build.deploymentId,
  RNI_COMMIT_SHA: build.commitSha,
  RNI_ARTIFACT_SHA256: build.artifactHash,
};
const db = { query: vi.fn() } as unknown as Queryable;

describe('reviewed RNI worker authority pack operator', () => {
  it('accepts exactly ten strict config snapshots, five compiled prompts, and the deployed build', () => {
    const parsed = parseRniReviewedWorkerAuthorityPack(packInput(), environment);
    const entries = entriesForRniReviewedWorkerAuthorityPack(parsed);
    expect(entries).toHaveLength(16);
    expect(entries.filter(({ authorityKind }) => authorityKind === 'prompt')).toHaveLength(5);
    expect(entries.at(-1)).toMatchObject({
      authorityKind: 'build',
      authorityKey: 'default',
      version: 'deployment-1',
    });
  });

  it('fails before persistence on unknown fields, drifted hashes, prompt drift, or build drift', () => {
    expect(() =>
      parseRniReviewedWorkerAuthorityPack({ ...packInput(), unexpected: true }, environment),
    ).toThrow();

    const badHash = packInput();
    badHash.authorities['analytics']!.snapshotHash = '0'.repeat(64);
    expect(() => parseRniReviewedWorkerAuthorityPack(badHash, environment)).toThrow(/hash/u);

    const badPrompt = packInput();
    const originalPrompt = badPrompt.prompts['rni_classifier']!;
    const changedPrompt = { ...originalPrompt.value, contentHash: '0'.repeat(64) };
    badPrompt.prompts['rni_classifier'] = {
      ...originalPrompt,
      value: changedPrompt,
      snapshotHash: hashRniWorkerSnapshotValue(changedPrompt),
    };
    expect(() => parseRniReviewedWorkerAuthorityPack(badPrompt, environment)).toThrow(/compiled/u);

    expect(() =>
      parseRniReviewedWorkerAuthorityPack(packInput(), {
        ...environment,
        RNI_ARTIFACT_SHA256: '0'.repeat(64),
      }),
    ).toThrow(/compiled deployment/u);
  });

  it('writes and binds the complete pack through one transaction without emitting values', async () => {
    const pack = parseRniReviewedWorkerAuthorityPack(packInput(), environment);
    const assertDraftConfig = vi.fn(async () => undefined);
    const persistAuthority = vi.fn(async () => 'inserted' as const);
    const bindConfigAuthority = vi.fn(async () => 'inserted' as const);
    let transactionCalls = 0;
    const transaction = async <T>(work: (queryable: Queryable) => Promise<T>): Promise<T> => {
      transactionCalls += 1;
      return work(db);
    };

    const result = await seedRniReviewedWorkerAuthorityPack(pack, {
      transaction,
      assertDraftConfig,
      persistAuthority,
      bindConfigAuthority,
    });

    expect(transactionCalls).toBe(1);
    expect(assertDraftConfig).toHaveBeenCalledWith('42', db);
    expect(persistAuthority).toHaveBeenCalledTimes(16);
    expect(bindConfigAuthority).toHaveBeenCalledTimes(10);
    expect(result.authorities).toHaveLength(16);
    expect(JSON.stringify(result)).not.toContain('NVDA lang:en');
    expect(JSON.stringify(result)).not.toContain('value');
  });

  it('fails closed on a non-draft target before any authority write', async () => {
    const pack = parseRniReviewedWorkerAuthorityPack(packInput(), environment);
    const persistAuthority = vi.fn();
    await expect(
      seedRniReviewedWorkerAuthorityPack(pack, {
        transaction: async (work) => work(db),
        assertDraftConfig: async () => {
          throw new Error('CONFIG_NOT_DRAFT');
        },
        persistAuthority,
        bindConfigAuthority: vi.fn(),
      }),
    ).rejects.toThrow('CONFIG_NOT_DRAFT');
    expect(persistAuthority).not.toHaveBeenCalled();
  });

  it('propagates crossed append-only replay failures from inside the sole transaction', async () => {
    const pack = parseRniReviewedWorkerAuthorityPack(packInput(), environment);
    let transactionCalls = 0;
    const transaction = async <T>(work: (queryable: Queryable) => Promise<T>): Promise<T> => {
      transactionCalls += 1;
      return work(db);
    };
    await expect(
      seedRniReviewedWorkerAuthorityPack(pack, {
        transaction,
        assertDraftConfig: async () => undefined,
        persistAuthority: async (entry) => {
          if (entry.authorityKind === 'analytics') throw new Error('CONFLICT');
          return 'duplicate';
        },
        bindConfigAuthority: async () => 'duplicate',
      }),
    ).rejects.toThrow('CONFLICT');
    expect(transactionCalls).toBe(1);
  });
});
