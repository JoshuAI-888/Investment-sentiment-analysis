import type { Queryable } from '../../../../src/repositories/client';
import { RNI_CITED_SYNTHESIS_CODE_VERSION } from '../../../../src/rni/agents';
import {
  RNI_ANALYTICS_CODE_VERSION,
  RNI_CONFIDENCE_COMPONENT_KEYS,
} from '../../../../src/rni/analytics';
import { RNI_CONVERGENCE_CODE_VERSION } from '../../../../src/rni/convergence';
import { parseRniWorkerAuthoritySnapshotSet } from '../../../../src/rni/orchestration/worker-authority';
import { hashRniWorkerSnapshotValue } from '../../../../src/rni/orchestration/worker-manifest';

const CONFIG_AUTHORITY_KINDS = [
  'source_configuration',
  'reddit_queries',
  'x_queries',
  'rights_policy',
  'ambiguity',
  'taxonomy',
  'classification',
  'analytics',
  'convergence',
  'budget',
] as const;

const confidenceComponents = Object.fromEntries(
  RNI_CONFIDENCE_COMPONENT_KEYS.map((key) => [key, key === 'provenanceIntegrity' ? '1' : '0']),
);

const TEST_VALUES = {
  source_configuration: {
    reddit: {
      acquisitionMethod: 'openai_web_search',
      coverageMode: 'REDDIT_SAMPLED_WEB_DISCOVERY',
    },
    x: { acquisitionMethod: 'x_adapter', coverageMode: 'X_CONFIGURED_SAMPLE' },
    retentionPolicyVersion: 'rni-test-retention-v1',
  },
  reddit_queries: {
    scheduledCommunity: { communities: ['r/stocks'], maxCandidates: 10 },
    onDemandSecurity: { communities: ['r/stocks'], maxCandidates: 10 },
  },
  x_queries: {
    queries: [
      {
        queryId: '00000000-0000-4000-8000-000000000001',
        query: 'test-only governed query',
        scope: 'test-only-scope',
        maxResults: 10,
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
  ambiguity: { version: 'rni-test-ambiguity-v1', bareTickerSymbols: ['A', 'AI', 'IT'] },
  taxonomy: {
    version: 'rni-test-taxonomy-v1',
    dimensions: [
      'company_fundamentals',
      'market_trading',
      'catalyst_event',
      'retail_narrative',
    ],
    categories: [],
  },
  classification: {
    version: 'rni-test-classification-v1',
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
    confidenceWeights: confidenceComponents,
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
      { platform: 'x', scope: 'test-only-scope', analyticalCluster: 'x-test', weight: '1' },
    ],
  },
  convergence: {
    version: 'rni-test-convergence-v1',
    codeVersion: RNI_CONVERGENCE_CODE_VERSION,
    dimensionDivergenceMinimum: '0.4',
    scaleImbalanceRatioThreshold: '2',
    staleAfterHours: '48',
  },
  budget: { reservationMode: 'pre_dispatch', settlementMode: 'provider_usage' },
} as const;

const TEST_VERSIONS = {
  source_configuration: 'rni-test-source-configuration-v1',
  reddit_queries: 'rni-test-reddit-queries-v1',
  x_queries: 'rni-test-x-queries-v1',
  rights_policy: 'rni-source-policy-v1',
  ambiguity: 'rni-test-ambiguity-v1',
  taxonomy: 'rni-test-taxonomy-v1',
  classification: 'rni-test-classification-v1',
  analytics: 'rni-test-analytics-v1',
  convergence: 'rni-test-convergence-v1',
  budget: 'rni-test-budget-v1',
} as const;

/** Test-only approved snapshots. Production authorities require named owner review. */
export async function seedTestWorkerAuthorities(
  db: Queryable,
  configVersion: string,
): Promise<void> {
  assertTestWorkerAuthoritiesAreStructurallyValid();
  for (const authorityKind of CONFIG_AUTHORITY_KINDS) {
    const value = TEST_VALUES[authorityKind];
    const version = TEST_VERSIONS[authorityKind];
    const snapshotHash = hashRniWorkerSnapshotValue(value);
    await db.query(
      `insert into rni_worker_manifest_authority
         (authority_kind,authority_key,version,snapshot_hash,value)
       values ($1,'default',$2,$3,$4)
       on conflict (authority_kind,authority_key,version) do nothing`,
      [authorityKind, version, snapshotHash, JSON.stringify(value)],
    );
    await db.query(
      `insert into rni_worker_config_authority
         (config_version,authority_kind,authority_key,version,snapshot_hash)
       values ($1,$2,'default',$3,$4)`,
      [configVersion, authorityKind, version, snapshotHash],
    );
  }
}

/** Test guard proving the activation helper cannot drift outside production parser shapes. */
export function assertTestWorkerAuthoritiesAreStructurallyValid(): void {
  const snapshot = (authorityKind: (typeof CONFIG_AUTHORITY_KINDS)[number]) => ({
    version: TEST_VERSIONS[authorityKind],
    value: TEST_VALUES[authorityKind],
    snapshotHash: hashRniWorkerSnapshotValue(TEST_VALUES[authorityKind]),
  });
  parseRniWorkerAuthoritySnapshotSet({
    source: {
      configuration: snapshot('source_configuration'),
      redditQueries: snapshot('reddit_queries'),
      xQueries: snapshot('x_queries'),
      rightsPolicy: snapshot('rights_policy'),
    },
    policies: {
      ambiguity: snapshot('ambiguity'),
      taxonomy: snapshot('taxonomy'),
      classification: snapshot('classification'),
      analytics: snapshot('analytics'),
      convergence: snapshot('convergence'),
      budget: snapshot('budget'),
    },
    build: {
      deploymentId: 'rni-test-deployment-v1',
      commitSha: 'f'.repeat(40),
      artifactHash: 'e'.repeat(64),
      sourceAdapterVersions: { reddit: 'rni-test-reddit-adapter-v1', x: 'rni-test-x-adapter-v1' },
      semanticCodeVersion: 'rni-test-semantic-v1',
      analyticsCodeVersion: RNI_ANALYTICS_CODE_VERSION,
      convergenceCodeVersion: RNI_CONVERGENCE_CODE_VERSION,
      citedSynthesisCodeVersion: RNI_CITED_SYNTHESIS_CODE_VERSION,
    },
  });
}
