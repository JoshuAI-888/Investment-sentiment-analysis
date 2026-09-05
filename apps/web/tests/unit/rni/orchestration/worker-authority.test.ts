import { describe, expect, it } from 'vitest';

import {
  RNI_CITED_SYNTHESIS_CODE_VERSION,
} from '@/rni/agents';
import {
  RNI_ANALYTICS_CODE_VERSION,
  RNI_CONFIDENCE_COMPONENT_KEYS,
} from '@/rni/analytics';
import { RNI_CONVERGENCE_CODE_VERSION } from '@/rni/convergence';
import {
  RNI_COMPILED_PROMPT_INPUT_SCHEMAS,
  assertRniCompiledBuildAuthority,
  assertRniCompiledPromptAuthority,
  compiledRniPromptAuthority,
  parseRniWorkerAuthoritySnapshotSet,
  rniAmbiguityAuthority,
  rniBudgetAuthority,
  rniBuildAuthority,
  rniClassificationAuthority,
  rniConvergenceAuthority,
  rniRedditQueryAuthority,
  rniRightsPolicyAuthority,
  rniSourceConfigurationAuthority,
  rniTaxonomyAuthority,
  rniXQueryAuthority,
} from '@/rni/orchestration/worker-authority';
import {
  RNI_WORKER_MANIFEST_TASKS,
  hashRniWorkerSnapshotValue,
} from '@/rni/orchestration/worker-manifest';

const components = Object.fromEntries(
  RNI_CONFIDENCE_COMPONENT_KEYS.map((key) => [key, key === 'provenanceIntegrity' ? '1' : '0']),
);
const values = {
  sourceConfiguration: {
    reddit: {
      acquisitionMethod: 'openai_web_search',
      coverageMode: 'REDDIT_SAMPLED_WEB_DISCOVERY',
    },
    x: { acquisitionMethod: 'x_adapter', coverageMode: 'X_CONFIGURED_SAMPLE' },
    retentionPolicyVersion: 'retention-v1',
  },
  redditQueries: {
    scheduledCommunity: { communities: ['r/NVDA_Stock', 'r/stocks'], maxCandidates: 50 },
    onDemandSecurity: { communities: ['r/NVDA_Stock'], maxCandidates: 20 },
  },
  xQueries: {
    queries: [
      {
        queryId: '00000000-0000-4000-8000-000000000001',
        query: 'NVDA lang:en',
        scope: 'nvda-watch',
        maxResults: 25,
      },
    ],
  },
  rightsPolicy: {
    policyVersion: 'rni-source-policy-v1',
    platforms: ['reddit', 'x'],
    captureModes: ['excerpt_only', 'full_comment', 'full_post'],
    maximumBoundedContentCharacters: 20_000,
    storeWholePageHtml: false,
    requireOriginalUrl: true,
    revalidateAtPublication: true,
  },
  ambiguity: { version: 'ambiguity-v1', bareTickerSymbols: ['A', 'AI', 'IT'] },
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
      { platform: 'x', scope: 'nvda-watch', analyticalCluster: 'x-nvda', weight: '1' },
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
  build: {
    deploymentId: 'deployment-1',
    commitSha: 'f'.repeat(40),
    artifactHash: 'e'.repeat(64),
    sourceAdapterVersions: { reddit: 'reddit-web-search-v1', x: 'x-adapter-v1' },
    semanticCodeVersion: 'semantic-v1',
    analyticsCodeVersion: RNI_ANALYTICS_CODE_VERSION,
    convergenceCodeVersion: RNI_CONVERGENCE_CODE_VERSION,
    citedSynthesisCodeVersion: RNI_CITED_SYNTHESIS_CODE_VERSION,
  },
} as const;

const snapshot = (version: string, value: Readonly<Record<string, unknown>>) => ({
  version,
  value,
  snapshotHash: hashRniWorkerSnapshotValue(value),
});

const snapshotSet = () => ({
  source: {
    configuration: snapshot('source-v1', values.sourceConfiguration),
    redditQueries: snapshot('reddit-queries-v1', values.redditQueries),
    xQueries: snapshot('x-queries-v1', values.xQueries),
    rightsPolicy: snapshot('rni-source-policy-v1', values.rightsPolicy),
  },
  policies: {
    ambiguity: snapshot('ambiguity-v1', values.ambiguity),
    taxonomy: snapshot('taxonomy-v1', values.taxonomy),
    classification: snapshot('classification-v1', values.classification),
    analytics: snapshot('analytics-v1', values.analytics),
    convergence: snapshot('convergence-v1', values.convergence),
    budget: snapshot('budget-v1', values.budget),
  },
  build: values.build,
});

describe('RNI production worker authority', () => {
  it('strictly parses every concrete source, policy, measurement, and build snapshot', () => {
    const parsed = parseRniWorkerAuthoritySnapshotSet(snapshotSet());
    expect(parsed).toMatchObject({
      sourceConfiguration: values.sourceConfiguration,
      redditQueries: values.redditQueries,
      xQueries: values.xQueries,
      rightsPolicy: values.rightsPolicy,
      ambiguity: values.ambiguity,
      taxonomy: values.taxonomy,
      classification: values.classification,
      analytics: values.analytics,
      convergence: values.convergence,
      budget: values.budget,
      build: values.build,
    });
  });

  it.each([
    ['source configuration', rniSourceConfigurationAuthority, values.sourceConfiguration],
    ['Reddit queries', rniRedditQueryAuthority, values.redditQueries],
    ['X queries', rniXQueryAuthority, values.xQueries],
    ['rights policy', rniRightsPolicyAuthority, values.rightsPolicy],
    ['ambiguity policy', rniAmbiguityAuthority, values.ambiguity],
    ['taxonomy', rniTaxonomyAuthority, values.taxonomy],
    ['classification', rniClassificationAuthority, values.classification],
    ['convergence', rniConvergenceAuthority, values.convergence],
    ['budget', rniBudgetAuthority, values.budget],
    ['build', rniBuildAuthority, values.build],
  ] as const)('rejects undeclared fields in %s authority', (_name, schema, value) => {
    expect(() => schema.parse({ ...value, undeclared: true })).toThrow();
  });

  it('rejects crossed embedded versions, drifted snapshot hashes, and incomplete analytics', () => {
    const crossed = snapshotSet();
    expect(() =>
      parseRniWorkerAuthoritySnapshotSet({
        ...crossed,
        policies: {
          ...crossed.policies,
          classification: snapshot('classification-v2', values.classification),
        },
      }),
    ).toThrow(/version/u);

    expect(() =>
      parseRniWorkerAuthoritySnapshotSet({
        ...crossed,
        source: {
          ...crossed.source,
          redditQueries: { ...crossed.source.redditQueries, snapshotHash: '0'.repeat(64) },
        },
      }),
    ).toThrow(/hash/u);

    const { confidenceWeights: _missing, ...incompleteAnalytics } = values.analytics;
    expect(() =>
      parseRniWorkerAuthoritySnapshotSet({
        ...crossed,
        policies: {
          ...crossed.policies,
          analytics: snapshot('analytics-v1', incompleteAnalytics),
        },
      }),
    ).toThrow();
  });

  it('derives exact current prompt, input-schema, output-schema, and tool hashes for all tasks', () => {
    const compiled = RNI_WORKER_MANIFEST_TASKS.map((task) =>
      compiledRniPromptAuthority(task, {
        rni_discovery: 'rni-discovery-v2',
        rni_relationship: 'rni-relationship-v1',
        rni_classifier: 'rni-classifier-v1',
        rni_verification: 'rni-verification-v2',
        rni_challenger: 'rni-challenger-v2',
      }[task]),
    );
    expect(new Set(compiled.map(({ contentHash }) => contentHash))).toHaveLength(5);
    expect(Object.keys(RNI_COMPILED_PROMPT_INPUT_SCHEMAS)).toEqual([
      'rni-discovery-input-v1',
      'rni-relationship-input-v1',
      'rni-classifier-input-v1',
      'rni-verification-input-v1',
      'rni-challenger-input-v1',
    ]);
    for (const [index, task] of RNI_WORKER_MANIFEST_TASKS.entries()) {
      expect(() => assertRniCompiledPromptAuthority(task, compiled[index])).not.toThrow();
      for (const field of [
        'contentHash',
        'inputSchemaHash',
        'outputSchemaHash',
        'toolHash',
      ] as const) {
        expect(() =>
          assertRniCompiledPromptAuthority(task, {
            ...compiled[index],
            [field]: '0'.repeat(64),
          }),
        ).toThrow(/compiled/u);
      }
    }
    expect(compiled[0]!.inputSchemaHash).not.toBe(
      hashRniWorkerSnapshotValue({ version: compiled[0]!.inputSchemaVersion }),
    );
    expect(() => compiledRniPromptAuthority('rni_discovery', 'unknown-version')).toThrow(
      /Unknown or duplicate/u,
    );
  });

  it('accepts only the exact composition-root build identity', () => {
    expect(assertRniCompiledBuildAuthority(values.build, values.build)).toEqual(values.build);
    expect(() =>
      assertRniCompiledBuildAuthority(values.build, {
        ...values.build,
        artifactHash: '0'.repeat(64),
      }),
    ).toThrow(/compiled deployment/u);
    expect(() =>
      assertRniCompiledBuildAuthority(values.build, {
        ...values.build,
        analyticsCodeVersion: 'analytics-v0',
      }),
    ).toThrow();
  });
});
