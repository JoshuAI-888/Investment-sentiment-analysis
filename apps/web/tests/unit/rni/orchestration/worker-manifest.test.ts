import { describe, expect, it, vi } from 'vitest';

const orchestrationRepositoryMocks = vi.hoisted(() => ({
  queryableForTransaction: vi.fn(),
}));

vi.mock('@/rni/repositories/orchestration', () => ({
  queryableForRniOrchestrationTransaction:
    orchestrationRepositoryMocks.queryableForTransaction,
}));

import {
  RNI_WORKER_MANIFEST_TASKS,
  RNI_WORKER_MANIFEST_VERSION,
  canonicalizeRniWorkerManifest,
  hashRniWorkerManifest,
  hashRniWorkerManifestMembers,
  hashRniWorkerPriceBook,
  hashRniWorkerSnapshotValue,
  parseRniWorkerManifest,
  type RniCanonicalJsonValue,
  type RniWorkerManifestMember,
  type RniWorkerPriceBookValue,
} from '@/rni/orchestration/worker-manifest';
import { buildRniFullUniversePublication } from '@/rni/orchestration/full-universe-publication';
import {
  assertRniWorkerManifestExecutionBinding,
  createManifestBoundRniWorkerExecutor,
  rniCombinedPlatformSlicesFromExecution,
  rniFullUniversePublicationAuthorityFromExecution,
  rniImmutableModelRunConfigFromManifest,
} from '@/rni/orchestration/production-executor';
import type {
  RniExecutionRecord,
  RniOrchestrationTransaction,
} from '@/rni/orchestration/types';
import type { RniWorkerServices } from '@/rni/orchestration/worker';

const hash = (character: string): string => character.repeat(64);
const securityId = (ordinal: number): string =>
  `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;

const member = (ordinal: number, ticker: string, companyName: string): RniWorkerManifestMember => ({
  ordinal,
  securityId: securityId(ordinal),
  ticker,
  companyName,
  exchange: 'NASDAQ',
  assetType: 'equity',
  currency: 'USD',
  aliases:
    ticker === 'AMD'
      ? ['Advanced Micro Devices', 'AMD']
      : ticker === 'NVDA'
        ? ['NVDA', 'NVIDIA']
        : [],
  selectionSource: 'fmp_sp500',
  providerSymbol: ticker,
  providerCompanyName: companyName,
  constituentFirstAddedAt: null,
});

const manualMembers = [member(1, 'NVDA', 'NVIDIA Corporation')] as const;
const fullMembers = [
  member(1, 'AMD', 'Advanced Micro Devices, Inc.'),
  member(2, 'NVDA', 'NVIDIA Corporation'),
] as const;

const snapshot = (version: string, value: Readonly<Record<string, RniCanonicalJsonValue>>) => ({
  version,
  value,
  snapshotHash: hashRniWorkerSnapshotValue(value),
});

const priceBookValue = (): RniWorkerPriceBookValue => ({
  version: 'rni-prices-2026-09-05',
  sourceUrl: 'https://example.test/rni-prices',
  responseHash: hash('e'),
  observedAt: '2026-09-04T00:00:00Z',
  firstTierInputCeiling: 272_000,
  units: [
    {
      provider: 'openai',
      service: 'openai_responses',
      operationOrModel: 'gpt-5.6-sol',
      unitType: 'input_token',
      unitPrice: '0.00078125',
      currency: 'USD',
      effectiveFrom: '2026-09-01T00:00:00Z',
      effectiveUntil: null,
      sourceReference: 'OpenAI price evidence 2026-09-05',
    },
    {
      provider: 'openai',
      service: 'openai_responses',
      operationOrModel: 'gpt-5.6-sol',
      unitType: 'output_token',
      unitPrice: '0.00078125',
      currency: 'USD',
      effectiveFrom: '2026-09-01T00:00:00Z',
      effectiveUntil: null,
      sourceReference: 'OpenAI price evidence 2026-09-05',
    },
    {
      provider: 'openai',
      service: 'openai_responses',
      operationOrModel: 'gpt-5.6-terra',
      unitType: 'input_token',
      unitPrice: '0.00078125',
      currency: 'USD',
      effectiveFrom: '2026-09-01T00:00:00Z',
      effectiveUntil: null,
      sourceReference: 'OpenAI price evidence 2026-09-05',
    },
    {
      provider: 'openai',
      service: 'openai_responses',
      operationOrModel: 'gpt-5.6-terra',
      unitType: 'output_token',
      unitPrice: '0.00078125',
      currency: 'USD',
      effectiveFrom: '2026-09-01T00:00:00Z',
      effectiveUntil: null,
      sourceReference: 'OpenAI price evidence 2026-09-05',
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
      sourceReference: 'OpenAI price evidence 2026-09-05',
    },
  ],
});

const exactPriceBook = () => {
  const value = priceBookValue();
  return { ...value, snapshotHash: hashRniWorkerPriceBook(value) };
};

const envelopeFor = (task: (typeof RNI_WORKER_MANIFEST_TASKS)[number]) => ({
  task,
  maxInputBytes: task === 'rni_verification' || task === 'rni_challenger' ? 64_000 : 16_000,
  maxInputTokensReserved:
    task === 'rni_verification' || task === 'rni_challenger' ? 64_000 : 16_000,
  maxOutputTokens: task === 'rni_challenger' ? 1_000 : 2_000,
  maxToolCalls: task === 'rni_discovery' ? 3 : 0,
  timeoutMs: 30_000,
  maxCostUsd: task === 'rni_verification' || task === 'rni_challenger' ? '0.20' : '0.10',
});

const modelRoutes = () =>
  RNI_WORKER_MANIFEST_TASKS.map((task, index) => {
    const terra = !['rni_verification', 'rni_challenger'].includes(task);
    const model = terra ? 'gpt-5.6-terra' : 'gpt-5.6-sol';
    return {
      task,
      aiRoute: 'openai_direct' as const,
      transport: 'openai_responses',
      provider: 'openai',
      configuredModelId: model,
      canonicalProviderModelId: model,
      modelRevision: terra ? 'terra-2026-07-09' : 'sol-2026-07-09',
      reasoningEffort: 'low',
      policyVersion: 'rni-balanced-model-policy-v1',
      calibrationVersion: 'rni-eval-calibration-2026-09-05',
      capability: {
        snapshotId: terra ? 'capability-terra' : 'capability-sol',
        responseHash: terra ? hash('1') : hash('2'),
        observedAt: '2026-09-05T00:00:00Z',
        expiresAt: '2026-09-06T00:00:00Z',
        available: true,
        supportsResponses: true,
        supportsStructuredOutputs: true,
        supportsWebSearch: terra,
        reasoningEfforts: ['low'],
        requiresResponses: true,
        requiresStructuredOutputs: true,
        requiresWebSearch: task === 'rni_discovery',
      },
      prompt: {
        version: `prompt-${String(index + 1)}`,
        contentHash: hash('a'),
        inputSchemaVersion: `input-schema-${String(index + 1)}`,
        inputSchemaHash: hash('b'),
        outputSchemaVersion: `output-schema-${String(index + 1)}`,
        outputSchemaHash: hash('c'),
        toolVersion: task === 'rni_discovery' ? 'rni-openai-web-search-v1' : 'rni-no-tools-v1',
        toolHash: hash('d'),
      },
      temperature: '0',
      fallbackChain: [],
      allowedDataClasses: ['public_social'],
      envelope: envelopeFor(task),
      priceBook: exactPriceBook(),
    };
  });

const manifest = (
  scope:
    | { readonly kind: 'manual_ticker'; readonly selectedSecurityId: string }
    | { readonly kind: 'full_universe' },
  members: readonly RniWorkerManifestMember[],
) => ({
  version: RNI_WORKER_MANIFEST_VERSION,
  environment: 'production',
  partition: 'rni-production',
  runId: '10000000-0000-4000-8000-000000000001',
  jobRunId: '10000000-0000-4000-8000-000000000002',
  planHash: hash('9'),
  trigger: scope.kind === 'manual_ticker' ? ('manual' as const) : ('schedule' as const),
  acceptedAt: '2026-09-05T01:00:00Z',
  deadline: '2026-09-05T01:15:00Z',
  scope,
  windows: {
    timezone: 'Pacific/Auckland',
    windowStart: '2026-09-04T01:00:00Z',
    windowEnd: '2026-09-05T01:00:00Z',
    comparisonStart: '2026-09-03T01:00:00Z',
    comparisonEnd: '2026-09-04T01:00:00Z',
    assessmentCutoffAt: '2026-09-05T01:00:00Z',
  },
  configuration: {
    version: 'config-17',
    checksum: 'ccba11e6-4574-43a3-94f9-58de73c44e2b',
    aiRoute: 'openai_direct' as const,
    modelPolicyVersion: 'rni-balanced-model-policy-v1',
    budgetPolicyVersion: 'rni-ai-budget-policy-v1',
    promptSetVersion: 'rni-prompts-2026-09-05',
    aggregateBudgets: {
      manualRunHardUsd: '2',
      fullUniverseHardUsd: '25',
      rolling24hHardUsd: '50',
      monthlyWarningUsd: '300',
      monthlyHardUsd: '500',
      currency: 'USD' as const,
    },
  },
  universe: { version: 'universe-9', snapshotHash: hash('2') },
  source: {
    configuration: snapshot('source-config-4', {
      redditCommunitySetVersion: 'reddit-communities-v1',
      xWatchSetVersion: 'x-watch-v1',
      retentionPolicyVersion: 'retention-v1',
    }),
    redditQueries: snapshot('reddit-query-set-7', {
      domainAllowlist: ['reddit.com'],
      queryFamilies: ['community-first', 'ticker-on-demand'],
    }),
    xQueries: snapshot('x-query-set-8', {
      queryFamilies: ['configured-watch', 'ticker-on-demand'],
      samplingDisclosure: 'Configured bounded X queries.',
    }),
    rightsPolicy: snapshot('rni-source-policy-v1', {
      captureModes: ['excerpt_only', 'full_comment', 'full_post'],
      policyVersion: 'rni-source-policy-v1',
    }),
  },
  policies: {
    ambiguity: snapshot('ambiguity-v2', {
      bareTickerMode: 'abstain_on_ambiguity',
      exchangeContextRequired: true,
    }),
    taxonomy: snapshot('taxonomy-v3', {
      dimensions: ['company_fundamentals', 'market_trading', 'catalyst_event', 'retail_narrative'],
    }),
    classification: snapshot('classification-v4', {
      comparativeObservationsRequired: true,
      insufficientLabel: 'insufficient',
    }),
    analytics: snapshot('analytics-v5', {
      formulaVersion: 'rni-deterministic-analytics-v5',
      minimumEvidence: 3,
    }),
    convergence: snapshot('convergence-v6', {
      preservePlatformDivergence: true,
      statusVersion: 'rni-convergence-v6',
    }),
    budget: snapshot('budget-v1', {
      reservationMode: 'pre_dispatch',
      settlementMode: 'provider_usage',
    }),
  },
  modelRoutes: modelRoutes(),
  orchestration: {
    maxAttempts: 3,
    maxRuntimeMs: 900_000,
    leaseMs: 120_000,
    baseBackoffMs: 1_000,
    maxBackoffMs: 60_000,
    coalesceMs: 300_000,
    calls: {
      reddit: {
        rni_discovery: 3,
        rni_relationship: 20,
        rni_classifier: 20,
        rni_verification: 20,
        rni_challenger: 20,
      },
      x: {
        rni_discovery: 0,
        rni_relationship: 20,
        rni_classifier: 20,
        rni_verification: 20,
        rni_challenger: 20,
      },
    },
    maxCostUsd: scope.kind === 'manual_ticker' ? '2' : '25',
  },
  coverage: {
    reddit: 'Sampled Reddit Web Search discovery; not exhaustive platform coverage.',
    x: 'Configured X query sample; independent from Reddit and not platform-wide coverage.',
  },
  build: {
    deploymentId: 'deployment-2026-09-05-1',
    commitSha: 'f'.repeat(40),
    artifactHash: hash('f'),
    sourceAdapterVersions: { reddit: 'reddit-web-search-v1', x: 'x-adapter-v1' },
    semanticCodeVersion: 'rni-semantic-v1',
    analyticsCodeVersion: 'rni-analytics-v1',
    convergenceCodeVersion: 'rni-convergence-v1',
    citedSynthesisCodeVersion: 'rni-cited-synthesis-v1',
  },
  memberCount: members.length,
  memberSetHash: hashRniWorkerManifestMembers(members),
  members,
});

const manualManifest = () =>
  manifest(
    { kind: 'manual_ticker', selectedSecurityId: manualMembers[0].securityId },
    manualMembers,
  );
const fullManifest = () => manifest({ kind: 'full_universe' }, fullMembers);

describe('D-RNI-32 immutable worker-run manifest', () => {
  it('accepts complete manual and full-universe manifests without defaults or mutable rereads', () => {
    expect(parseRniWorkerManifest(manualManifest())).toMatchObject({
      version: 'rni-worker-manifest-v2',
      planHash: hash('9'),
      scope: { kind: 'manual_ticker', selectedSecurityId: manualMembers[0].securityId },
      memberCount: 1,
    });
    expect(parseRniWorkerManifest(fullManifest())).toMatchObject({
      scope: { kind: 'full_universe' },
      memberCount: 2,
      configuration: { modelPolicyVersion: 'rni-balanced-model-policy-v1' },
    });
    expect(() =>
      parseRniWorkerManifest({ ...fullManifest(), version: 'rni-worker-manifest-v1' }),
    ).toThrow();
  });

  it('accepts the full 600-member ceiling and rejects a 601st member', () => {
    const sixHundred = Array.from({ length: 600 }, (_, index) =>
      member(
        index + 1,
        `SEC${String(index + 1).padStart(3, '0')}`,
        `Security ${String(index + 1)}`,
      ),
    );
    expect(
      parseRniWorkerManifest(manifest({ kind: 'full_universe' }, sixHundred)).memberCount,
    ).toBe(600);
    const tooMany = [
      ...sixHundred,
      { ...member(600, 'ZZZZ', 'Security 601'), ordinal: 601, securityId: securityId(601) },
    ];
    expect(() =>
      parseRniWorkerManifest({
        ...fullManifest(),
        memberCount: tooMany.length,
        memberSetHash: hash('0'),
        members: tooMany,
      }),
    ).toThrow();
  });

  it('hashes object-key insertion order and equivalent instants deterministically', () => {
    const original = fullManifest();
    const reversedRootKeys = Object.fromEntries(Object.entries(original).reverse());
    const equivalentOffsetInstants = {
      ...original,
      acceptedAt: '2026-09-05T13:00:00+12:00',
      deadline: '2026-09-05T13:15:00+12:00',
      windows: {
        ...original.windows,
        windowEnd: '2026-09-05T13:00:00+12:00',
        assessmentCutoffAt: '2026-09-05T13:00:00+12:00',
      },
    };
    expect(hashRniWorkerManifest(reversedRootKeys)).toBe(hashRniWorkerManifest(original));
    expect(hashRniWorkerManifest(equivalentOffsetInstants)).toBe(hashRniWorkerManifest(original));
    expect(canonicalizeRniWorkerManifest(reversedRootKeys)).toBe(
      canonicalizeRniWorkerManifest(original),
    );
  });

  it('enforces deadline and capability boundaries at exact microsecond precision', () => {
    const original = fullManifest();
    const exactDeadline = {
      ...original,
      acceptedAt: '2026-09-05T01:00:00.000001Z',
      deadline: '2026-09-05T01:15:00.000001Z',
    };
    expect(parseRniWorkerManifest(exactDeadline).deadline).toBe('2026-09-05T01:15:00.000001Z');
    expect(() =>
      parseRniWorkerManifest({ ...exactDeadline, deadline: '2026-09-05T01:15:00Z' }),
    ).toThrow('deadline');
    expect(() =>
      parseRniWorkerManifest({
        ...exactDeadline,
        deadline: '2026-09-05T01:15:00.000002Z',
      }),
    ).toThrow('deadline');

    const observedOneMicrosecondBeforeAdmission = {
      ...exactDeadline,
      modelRoutes: exactDeadline.modelRoutes.map((route, index) =>
        index === 0
          ? {
              ...route,
              capability: { ...route.capability, observedAt: '2026-09-05T01:00:00Z' },
            }
          : route,
      ),
    };
    expect(
      parseRniWorkerManifest(observedOneMicrosecondBeforeAdmission).modelRoutes[0]!.capability,
    ).toMatchObject({ observedAt: '2026-09-05T01:00:00Z' });
    expect(() =>
      parseRniWorkerManifest({
        ...exactDeadline,
        modelRoutes: exactDeadline.modelRoutes.map((route, index) =>
          index === 0
            ? {
                ...route,
                capability: {
                  ...route.capability,
                  observedAt: '2026-09-05T01:00:00.000002Z',
                },
              }
            : route,
        ),
      }),
    ).toThrow('fresh at admission');
    expect(() =>
      parseRniWorkerManifest({
        ...exactDeadline,
        modelRoutes: exactDeadline.modelRoutes.map((route, index) =>
          index === 0
            ? {
                ...route,
                capability: { ...route.capability, expiresAt: '2026-09-05T01:00:00Z' },
              }
            : route,
        ),
      }),
    ).toThrow('fresh at admission');
    const expiresOneMicrosecondAfterAdmission = {
      ...exactDeadline,
      modelRoutes: exactDeadline.modelRoutes.map((route, index) =>
        index === 0
          ? {
              ...route,
              capability: {
                ...route.capability,
                expiresAt: '2026-09-05T01:00:00.000002Z',
              },
            }
          : route,
      ),
    };
    expect(
      parseRniWorkerManifest(expiresOneMicrosecondAfterAdmission).modelRoutes[0]!.capability,
    ).toMatchObject({ expiresAt: '2026-09-05T01:00:00.000002Z' });
  });

  it('rejects source and policy value mutation without matching canonical hashes', () => {
    const original = fullManifest();
    expect(() =>
      parseRniWorkerManifest({
        ...original,
        source: {
          ...original.source,
          xQueries: {
            ...original.source.xQueries,
            value: { ...original.source.xQueries.value, queryFamilies: ['mutated-later'] },
          },
        },
      }),
    ).toThrow('Snapshot hash');
    expect(() =>
      parseRniWorkerManifest({
        ...original,
        policies: {
          ...original.policies,
          analytics: {
            ...original.policies.analytics,
            value: { ...original.policies.analytics.value, minimumEvidence: 99 },
          },
        },
      }),
    ).toThrow('Snapshot hash');
  });

  it('changes the manifest identity when a snapshot value and its hash change together', () => {
    const original = fullManifest();
    const changedValue = { ...original.policies.analytics.value, minimumEvidence: 4 };
    const changed = {
      ...original,
      policies: {
        ...original.policies,
        analytics: {
          ...original.policies.analytics,
          value: changedValue,
          snapshotHash: hashRniWorkerSnapshotValue(changedValue),
        },
      },
    };
    expect(hashRniWorkerManifest(changed)).not.toBe(hashRniWorkerManifest(original));
  });

  it('requires the execution plan hash and commits it to the manifest identity', () => {
    const original = fullManifest();
    const { planHash: _planHash, ...missingPlanHash } = original;

    expect(() => parseRniWorkerManifest(missingPlanHash)).toThrow();
    expect(() => parseRniWorkerManifest({ ...original, planHash: 'not-a-digest' })).toThrow();
    expect(hashRniWorkerManifest({ ...original, planHash: hash('8') })).not.toBe(
      hashRniWorkerManifest(original),
    );
  });

  it('rejects missing exact member, route, and build fields', () => {
    const original = fullManifest();
    const { assetType: _assetType, ...incompleteMember } = original.members[0]!;
    const { transport: _transport, ...incompleteRoute } = original.modelRoutes[0]!;
    const { semanticCodeVersion: _semanticVersion, ...incompleteBuild } = original.build;
    expect(() =>
      parseRniWorkerManifest({ ...original, members: [incompleteMember, original.members[1]!] }),
    ).toThrow();
    expect(() =>
      parseRniWorkerManifest({
        ...original,
        modelRoutes: [incompleteRoute, ...original.modelRoutes.slice(1)],
      }),
    ).toThrow();
    expect(() => parseRniWorkerManifest({ ...original, build: incompleteBuild })).toThrow();
  });

  it('rejects duplicate aliases and duplicate or unordered price rows', () => {
    const original = fullManifest();
    const duplicateAliases = [
      { ...original.members[0]!, aliases: ['AMD', 'amd'] },
      original.members[1]!,
    ];
    const route = original.modelRoutes[0]!;
    const duplicateRows = [...route.priceBook.units, route.priceBook.units.at(-1)!];
    expect(() => parseRniWorkerManifest({ ...original, members: duplicateAliases })).toThrow(
      'aliases',
    );
    expect(() =>
      parseRniWorkerManifest({
        ...original,
        modelRoutes: [
          { ...route, priceBook: { ...route.priceBook, units: duplicateRows } },
          ...original.modelRoutes.slice(1),
        ],
      }),
    ).toThrow('Price rows');
  });

  it('rejects crossed price books even when both books hash correctly', () => {
    const original = fullManifest();
    const route = original.modelRoutes[2]!;
    const changedValue = {
      ...route.priceBook,
      units: route.priceBook.units.map((unit) =>
        unit.operationOrModel === 'gpt-5.6-terra' && unit.unitType === 'input_token'
          ? { ...unit, unitPrice: '0.0009' }
          : unit,
      ),
    };
    const { snapshotHash: _snapshotHash, ...value } = changedValue;
    const changedBook = { ...value, snapshotHash: hashRniWorkerPriceBook(value) };
    expect(() =>
      parseRniWorkerManifest({
        ...original,
        modelRoutes: original.modelRoutes.map((entry, index) =>
          index === 2 ? { ...entry, priceBook: changedBook } : entry,
        ),
      }),
    ).toThrow('same exact admitted price book');
  });

  it('rejects every drift from the exact D-RNI-21 balanced Responses routes', () => {
    const original = fullManifest();
    const route = original.modelRoutes[0]!;
    const invalidRoutes = [
      { ...route, transport: 'chat_completions' },
      { ...route, provider: 'other-provider' },
      { ...route, canonicalProviderModelId: 'gpt-5.6-sol' },
      { ...route, reasoningEffort: 'medium' },
      { ...route, policyVersion: 'unapproved-policy-v2' },
      { ...route, temperature: '0.1' },
      { ...route, fallbackChain: ['gpt-5.6-sol'] },
      { ...route, configuredModelId: 'gateway-style-alias' },
    ];
    for (const invalidRoute of invalidRoutes) {
      expect(() =>
        parseRniWorkerManifest({
          ...original,
          modelRoutes: [invalidRoute, ...original.modelRoutes.slice(1)],
        }),
      ).toThrow('D-RNI-21 balanced Responses policy');
    }

    expect(() =>
      parseRniWorkerManifest({
        ...original,
        configuration: {
          ...original.configuration,
          modelPolicyVersion: 'unapproved-policy-v2',
        },
        modelRoutes: original.modelRoutes.map((entry) => ({
          ...entry,
          policyVersion: 'unapproved-policy-v2',
        })),
      }),
    ).toThrow('approved balanced model and budget policies');
  });

  it('rejects invalid price identity, value, admission window, tier, and scope budget bounds', () => {
    const original = fullManifest();
    const firstRoute = original.modelRoutes[0]!;
    const firstUnit = firstRoute.priceBook.units[0]!;
    const replaceAllBooks = (book: unknown) => ({
      ...original,
      modelRoutes: original.modelRoutes.map((route) => ({ ...route, priceBook: book })),
    });
    const hashedBook = (value: RniWorkerPriceBookValue) => ({
      ...value,
      snapshotHash: hashRniWorkerPriceBook(value),
    });

    expect(() =>
      parseRniWorkerManifest(
        replaceAllBooks({
          ...firstRoute.priceBook,
          units: [{ ...firstUnit, unitPrice: '0' }, ...firstRoute.priceBook.units.slice(1)],
        }),
      ),
    ).toThrow('positive');
    expect(() =>
      parseRniWorkerManifest(
        replaceAllBooks({
          ...firstRoute.priceBook,
          units: [{ ...firstUnit, currency: 'EUR' }, ...firstRoute.priceBook.units.slice(1)],
        }),
      ),
    ).toThrow();
    expect(() =>
      parseRniWorkerManifest(
        replaceAllBooks({
          ...firstRoute.priceBook,
          units: [
            { ...firstUnit, service: 'other_service' },
            ...firstRoute.priceBook.units.slice(1),
          ],
        }),
      ),
    ).toThrow();
    const { effectiveUntil: _effectiveUntil, ...missingValidityEnd } = firstUnit;
    expect(() =>
      parseRniWorkerManifest(
        replaceAllBooks({
          ...firstRoute.priceBook,
          units: [missingValidityEnd, ...firstRoute.priceBook.units.slice(1)],
        }),
      ),
    ).toThrow();

    const futureValue = priceBookValue();
    futureValue.units = futureValue.units.map((unit) => ({
      ...unit,
      effectiveFrom: '2026-09-05T01:00:00.000001Z',
    }));
    expect(() => parseRniWorkerManifest(replaceAllBooks(hashedBook(futureValue)))).toThrow(
      'effective at manifest admission',
    );

    const futureObservedValue = {
      ...priceBookValue(),
      observedAt: '2026-09-05T01:00:00.000001Z',
    };
    expect(() => parseRniWorkerManifest(replaceAllBooks(hashedBook(futureObservedValue)))).toThrow(
      'cannot postdate admission',
    );

    const expiredValue = priceBookValue();
    expiredValue.units = expiredValue.units.map((unit) => ({
      ...unit,
      effectiveUntil: '2026-09-05T01:00:00Z',
    }));
    expect(() => parseRniWorkerManifest(replaceAllBooks(hashedBook(expiredValue)))).toThrow(
      'effective at manifest admission',
    );

    const shallowTierValue = { ...priceBookValue(), firstTierInputCeiling: 64_000 };
    expect(() => parseRniWorkerManifest(replaceAllBooks(hashedBook(shallowTierValue)))).toThrow(
      'First-tier price ceiling',
    );
    expect(() =>
      parseRniWorkerManifest({
        ...original,
        orchestration: { ...original.orchestration, maxCostUsd: '25.01' },
      }),
    ).toThrow('aggregate run hard cap');
    const manual = manualManifest();
    expect(() =>
      parseRniWorkerManifest({
        ...manual,
        orchestration: { ...manual.orchestration, maxCostUsd: '2.01' },
      }),
    ).toThrow('aggregate run hard cap');
  });

  it('rejects invalid scope, count, member order, duplicates, and cutoff', () => {
    const original = fullManifest();
    const reversed = [...original.members].reverse().map((entry, index) => ({
      ...entry,
      ordinal: index + 1,
    }));
    const duplicateSecurity = [
      original.members[0]!,
      { ...original.members[1]!, securityId: original.members[0]!.securityId },
    ];
    expect(() =>
      parseRniWorkerManifest({
        ...original,
        scope: { kind: 'manual_ticker', selectedSecurityId: original.members[0]!.securityId },
      }),
    ).toThrow('Manual scope');
    expect(() => parseRniWorkerManifest({ ...original, memberCount: 1 })).toThrow('Member count');
    expect(() => parseRniWorkerManifest({ ...original, members: reversed })).toThrow('ordered');
    expect(() => parseRniWorkerManifest({ ...original, members: duplicateSecurity })).toThrow(
      'security identities',
    );
    expect(() =>
      parseRniWorkerManifest({
        ...original,
        windows: { ...original.windows, assessmentCutoffAt: '2026-09-05T00:59:59Z' },
      }),
    ).toThrow('Assessment cutoff');
  });

  it('rejects missing policy data, model-route reordering, and secret-like nested keys', () => {
    const original = fullManifest();
    const { analytics: _analytics, ...incompletePolicies } = original.policies;
    expect(() => parseRniWorkerManifest({ ...original, policies: incompletePolicies })).toThrow();
    expect(() =>
      parseRniWorkerManifest({
        ...original,
        modelRoutes: [
          original.modelRoutes[1]!,
          original.modelRoutes[0]!,
          ...original.modelRoutes.slice(2),
        ],
      }),
    ).toThrow('must be rni_discovery');
    expect(() =>
      parseRniWorkerManifest({
        ...original,
        source: {
          ...original.source,
          xQueries: {
            ...original.source.xQueries,
            value: { ...original.source.xQueries.value, openaiApiKey: 'must-not-persist' },
          },
        },
      }),
    ).toThrow('Secret-like keys');
  });
});

const executionFor = (input: ReturnType<typeof parseRniWorkerManifest>): RniExecutionRecord =>
  ({
    version: 'rni-execution-v2',
    partition: input.partition,
    jobRunId: input.jobRunId,
    runManifestHash: hashRniWorkerManifest(input),
    planHash: input.planHash,
    deadline: input.deadline,
    run: {
      id: input.runId,
      trigger: input.trigger,
      requestedAt: input.acceptedAt,
    },
    plan: {
      configVersion: input.configuration.version,
      universeVersion: input.universe.version,
      aiRoute: input.configuration.aiRoute,
      scopePreview:
        input.scope.kind === 'manual_ticker'
          ? {
              kind: 'ticker',
              securityId: input.scope.selectedSecurityId,
              ticker: input.members[0]!.ticker,
              companyName: input.members[0]!.companyName,
              exchange: input.members[0]!.exchange,
              universeVersion: input.universe.version,
            }
          : {
              kind: 'full_universe',
              universeVersion: input.universe.version,
              securityCount: input.memberCount,
            },
      timezone: input.windows.timezone,
      windowStart: input.windows.windowStart,
      windowEnd: input.windows.windowEnd,
      comparisonStart: input.windows.comparisonStart,
      comparisonEnd: input.windows.comparisonEnd,
      budgets: input.configuration.aggregateBudgets,
      maxAttempts: input.orchestration.maxAttempts,
      maxRuntimeMs: input.orchestration.maxRuntimeMs,
      leaseMs: input.orchestration.leaseMs,
      baseBackoffMs: input.orchestration.baseBackoffMs,
      maxBackoffMs: input.orchestration.maxBackoffMs,
      coalesceMs: input.orchestration.coalesceMs,
      calls: input.orchestration.calls,
      maxCostUsd: input.orchestration.maxCostUsd,
      coverage: input.coverage,
    },
  }) as unknown as RniExecutionRecord;

const fullUniverseLifecycleFixture = () => {
  const original = fullManifest();
  const manifest = parseRniWorkerManifest({
    ...original,
    universe: { ...original.universe, version: '9' },
  });
  const base = executionFor(manifest);
  const record = {
    ...base,
    platforms: {
      reddit: {
        slice: {
          id: '30000000-0000-4000-8000-000000000001',
          runId: manifest.runId,
          platform: 'reddit',
          status: 'complete',
        },
        outcomeHash: hash('a'),
      },
      x: {
        slice: {
          id: '30000000-0000-4000-8000-000000000002',
          runId: manifest.runId,
          platform: 'x',
          status: 'complete',
        },
        outcomeHash: hash('b'),
      },
    },
  } as unknown as RniExecutionRecord;
  if (record.version !== 'rni-execution-v2') throw new Error('expected v2 fixture');
  const lease = {
    delivery: {
      version: 'rni-combined-v2' as const,
      runId: manifest.runId,
      planHash: manifest.planHash,
      runManifestHash: record.runManifestHash,
      deliveryKey: 'combined-attempt-1',
      attempt: 1,
    },
    token: '20000000-0000-4000-8000-000000000002',
  };
  const effectFence = {
    stage: 'combined' as const,
    runId: manifest.runId,
    planHash: manifest.planHash,
    attempt: 1,
    token: lease.token,
    acquiredAt: manifest.acceptedAt,
    expiresAt: manifest.deadline,
    deadline: manifest.deadline,
  };
  const authority = rniFullUniversePublicationAuthorityFromExecution(record, manifest);
  const { members, ...identity } = authority.manifest;
  const items = members.map(({ ordinal, securityId: memberSecurityId }) => ({
    ...identity,
    ordinal,
    securityId: memberSecurityId,
    citedSynthesisId: securityId(100 + ordinal),
    citedSynthesisResultHash: hash('c'),
    convergenceArtifactId: securityId(200 + ordinal),
    convergenceArtifactHash: hash('d'),
    status: 'complete' as const,
  }));
  return { manifest, record, lease, effectFence, authority, items };
};

describe('manifest-bound production worker lifecycle shell', () => {
  it('binds the exact execution and derives governed routes only from its manifest', () => {
    const exact = parseRniWorkerManifest(manualManifest());
    const record = executionFor(exact);
    expect(assertRniWorkerManifestExecutionBinding(record, exact)).toEqual(exact);
    const runConfig = rniImmutableModelRunConfigFromManifest(exact);
    expect(runConfig).toMatchObject({
      runId: exact.runId,
      configVersion: exact.configuration.version,
      aiRoute: 'openai_direct',
    });
    expect(runConfig.resolvedModels).toHaveLength(5);
    expect(runConfig.resolvedModels[0]).toMatchObject({
      task: 'rni_discovery',
      modelId: 'gpt-5.6-terra',
      promptVersion: 'prompt-1',
    });
    expect(() =>
      assertRniWorkerManifestExecutionBinding(
        { ...record, planHash: '0'.repeat(64) },
        exact,
      ),
    ).toThrow('immutable execution plan');
  });

  it('verifies compiled authority before provider work, heartbeats, and durably finishes', async () => {
    const exact = parseRniWorkerManifest(manualManifest());
    const record = executionFor(exact);
    if (record.version !== 'rni-execution-v2') throw new Error('expected v2 fixture');
    const delivery = {
      version: 'rni-platform-v2' as const,
      runId: exact.runId,
      platform: 'reddit' as const,
      planHash: exact.planHash,
      runManifestHash: record.runManifestHash,
      deliveryKey: 'reddit-attempt-1',
      attempt: 1,
    };
    const lease = { delivery, token: '20000000-0000-4000-8000-000000000001' };
    const authority = vi.fn();
    const heartbeat = vi.fn(async () => undefined);
    const finish = vi.fn(async () => 'complete' as const);
    const provider = vi.fn(async () => ({
      status: 'complete' as const,
      eligibleSourceCount: 2,
      dataThroughAt: exact.windows.windowEnd,
      computedAt: exact.windows.windowEnd,
    }));
    const executor = createManifestBoundRniWorkerExecutor({
      manifests: { load: vi.fn(async () => exact) },
      compiledAuthority: { verify: authority },
      fullUniversePublication: { validate: vi.fn(async () => undefined) },
      platform: { execute: provider },
      combined: { prepare: vi.fn() },
    });
    const services = {
      platform: { heartbeat, finish },
    } as unknown as RniWorkerServices;

    await executor.platform({ lease, record, services });

    expect(authority).toHaveBeenCalledWith(exact);
    expect(heartbeat).toHaveBeenCalledWith(lease);
    expect(provider).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: exact,
        executionAuthority: { stage: 'reddit', attempt: 1, token: lease.token },
      }),
    );
    expect(finish).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({ status: 'complete', eligibleSourceCount: 2 }),
    );
    expect(authority.mock.invocationCallOrder[0]).toBeLessThan(
      provider.mock.invocationCallOrder[0]!,
    );
  });

  it('fails closed before provider I/O when a delivery omits v2 manifest authority', async () => {
    const exact = parseRniWorkerManifest(manualManifest());
    const record = executionFor(exact);
    const provider = vi.fn();
    const executor = createManifestBoundRniWorkerExecutor({
      manifests: { load: vi.fn(async () => exact) },
      compiledAuthority: { verify: vi.fn() },
      fullUniversePublication: { validate: vi.fn(async () => undefined) },
      platform: { execute: provider },
      combined: { prepare: vi.fn() },
    });
    const lease = {
      delivery: {
        version: 'rni-platform-v1' as const,
        runId: exact.runId,
        platform: 'reddit' as const,
        planHash: exact.planHash,
        deliveryKey: 'legacy',
        attempt: 1,
      },
      token: '20000000-0000-4000-8000-000000000001',
    };

    await expect(
      executor.platform({ lease, record, services: {} as RniWorkerServices }),
    ).rejects.toThrow('exact v2 manifest authority');
    expect(provider).not.toHaveBeenCalled();
  });

  it('passes only the claimed execution terminal slice identities into combined preparation', async () => {
    const exact = parseRniWorkerManifest(fullManifest());
    const base = executionFor(exact);
    const record = {
      ...base,
      run: { ...base.run, id: exact.runId },
      platforms: {
        reddit: {
          slice: {
            id: '30000000-0000-4000-8000-000000000001',
            runId: exact.runId,
            platform: 'reddit',
            status: 'complete',
          },
          outcomeHash: hash('a'),
        },
        x: {
          slice: {
            id: '30000000-0000-4000-8000-000000000002',
            runId: exact.runId,
            platform: 'x',
            status: 'partial',
          },
          outcomeHash: hash('b'),
        },
      },
    } as unknown as RniExecutionRecord;
    if (record.version !== 'rni-execution-v2') throw new Error('expected v2 fixture');
    const lease = {
      delivery: {
        version: 'rni-combined-v2' as const,
        runId: exact.runId,
        planHash: exact.planHash,
        runManifestHash: record.runManifestHash,
        deliveryKey: 'combined-attempt-1',
        attempt: 1,
      },
      token: '20000000-0000-4000-8000-000000000002',
    };
    const effectFence = {
      stage: 'combined' as const,
      runId: exact.runId,
      planHash: exact.planHash,
      attempt: 1,
      token: lease.token,
      acquiredAt: exact.acceptedAt,
      expiresAt: exact.deadline,
      deadline: exact.deadline,
    };
    const prepare = vi.fn(async () => {
      throw new Error('stop after preparation input');
    });
    const executor = createManifestBoundRniWorkerExecutor({
      manifests: { load: vi.fn(async () => exact) },
      compiledAuthority: { verify: vi.fn() },
      fullUniversePublication: { validate: vi.fn(async () => undefined) },
      platform: { execute: vi.fn() },
      combined: { prepare },
    });
    const services = {
      combined: { effectFence: vi.fn(async () => effectFence) },
    } as unknown as RniWorkerServices;

    await expect(executor.combined({ lease, record, services })).rejects.toThrow(
      'stop after preparation input',
    );
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        platformSlices: {
          reddit: {
            runId: exact.runId,
            platform: 'reddit',
            sliceId: record.platforms.reddit.slice.id,
            status: 'complete',
            outcomeHash: hash('a'),
          },
          x: {
            runId: exact.runId,
            platform: 'x',
            sliceId: record.platforms.x.slice.id,
            status: 'partial',
            outcomeHash: hash('b'),
          },
        },
      }),
    );

    const authority = rniFullUniversePublicationAuthorityFromExecution(record, exact);
    expect(authority.platforms.reddit.sliceId).toBe(record.platforms.reddit.slice.id);
    expect(authority.platforms.x.sliceId).toBe(record.platforms.x.slice.id);
    expect(authority.manifest.members).toEqual(
      exact.members.map(({ ordinal, securityId }) => ({ ordinal, securityId })),
    );
  });

  it('commits a full-universe publication whose platform authority exactly matches the execution', async () => {
    const { manifest, record, lease, effectFence, authority, items } =
      fullUniverseLifecycleFixture();
    const builtPublication = buildRniFullUniversePublication({
      manifest: authority.manifest,
      platforms: authority.platforms,
      items,
    });
    const publicationIdentity = {
      runId: builtPublication.runId,
      planHash: builtPublication.planHash,
      runManifestHash: builtPublication.runManifestHash,
      universeVersion: builtPublication.universeVersion,
      assessmentCutoffAt: builtPublication.assessmentCutoffAt,
      memberSetHash: builtPublication.memberSetHash,
    };
    expect({
      manifest: {
        ...publicationIdentity,
        members: builtPublication.members.map(({ ordinal, securityId: id }) => ({
          ordinal,
          securityId: id,
        })),
      },
      platforms: {
        reddit: { ...publicationIdentity, ...builtPublication.platforms.reddit },
        x: { ...publicationIdentity, ...builtPublication.platforms.x },
      },
    }).toEqual(authority);
    const commitFullUniversePublication = vi.fn(async () => 'complete' as const);
    const executor = createManifestBoundRniWorkerExecutor({
      manifests: { load: vi.fn(async () => manifest) },
      compiledAuthority: { verify: vi.fn() },
      fullUniversePublication: { validate: vi.fn(async () => undefined) },
      platform: { execute: vi.fn() },
      combined: {
        prepare: vi.fn(async () => ({
          kind: 'full_universe' as const,
          publication: builtPublication,
        })),
      },
    });
    const services = {
      combined: {
        effectFence: vi.fn(async () => effectFence),
        commitFullUniversePublication,
      },
    } as unknown as RniWorkerServices;

    await executor.combined({ lease, record, services });

    expect(commitFullUniversePublication).toHaveBeenCalledOnce();
    expect(commitFullUniversePublication).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({ runId: manifest.runId, planHash: manifest.planHash }),
      expect.any(Function),
    );
  });

  it('runs exact persisted-member validation inside the final publication callback before writes', async () => {
    const { manifest, record, lease, effectFence, authority, items } =
      fullUniverseLifecycleFixture();
    const builtPublication = buildRniFullUniversePublication({
      manifest: authority.manifest,
      platforms: authority.platforms,
      items,
    });
    const validationFailure = new Error('commit-time persisted member changed');
    const validate = vi.fn(async () => {
      throw validationFailure;
    });
    let publish:
      | Parameters<
          RniWorkerServices['combined']['commitFullUniversePublication']
        >[2]
      | undefined;
    const commitFullUniversePublication = vi.fn(
      async (
        _input: Parameters<
          RniWorkerServices['combined']['commitFullUniversePublication']
        >[0],
        _expected: Parameters<
          RniWorkerServices['combined']['commitFullUniversePublication']
        >[1],
        callback: Parameters<
          RniWorkerServices['combined']['commitFullUniversePublication']
        >[2],
      ) => {
        publish = callback;
        return 'committed' as const;
      },
    );
    const executor = createManifestBoundRniWorkerExecutor({
      manifests: { load: vi.fn(async () => manifest) },
      compiledAuthority: { verify: vi.fn() },
      fullUniversePublication: { validate },
      platform: { execute: vi.fn() },
      combined: {
        prepare: vi.fn(async () => ({
          kind: 'full_universe' as const,
          publication: builtPublication,
        })),
      },
    });
    const services = {
      combined: {
        effectFence: vi.fn(async () => effectFence),
        commitFullUniversePublication,
      },
    } as unknown as RniWorkerServices;

    await executor.combined({ lease, record, services });

    expect(publish).toBeTypeOf('function');
    const query = vi.fn();
    const db = { query };
    orchestrationRepositoryMocks.queryableForTransaction.mockReturnValue(db);
    await expect(
      publish!(
        {} as RniOrchestrationTransaction,
        effectFence,
        expect.objectContaining({ runId: manifest.runId }),
        '2026-09-05T01:10:00.000Z',
      ),
    ).rejects.toBe(validationFailure);
    expect(validate).toHaveBeenCalledWith(builtPublication, authority, db);
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['sliceId', 'status', 'outcomeHash'] as const)(
    'rejects a full-universe publication with crossed Reddit %s authority before commit',
    async (field) => {
      const { manifest, record, lease, effectFence, authority, items } =
        fullUniverseLifecycleFixture();
      const crossedReddit =
        field === 'sliceId'
          ? {
              ...authority.platforms.reddit,
              sliceId: '30000000-0000-4000-8000-000000000099',
            }
          : field === 'status'
            ? { ...authority.platforms.reddit, status: 'failed' as const }
            : { ...authority.platforms.reddit, outcomeHash: hash('f') };
      const commitFullUniversePublication = vi.fn();
      const executor = createManifestBoundRniWorkerExecutor({
        manifests: { load: vi.fn(async () => manifest) },
        compiledAuthority: { verify: vi.fn() },
        fullUniversePublication: { validate: vi.fn(async () => undefined) },
        platform: { execute: vi.fn() },
        combined: {
          prepare: vi.fn(async () => ({
            kind: 'full_universe' as const,
            publication: {
              manifest: authority.manifest,
              platforms: { reddit: crossedReddit, x: authority.platforms.x },
              items,
            },
          })),
        },
      });
      const services = {
        combined: {
          effectFence: vi.fn(async () => effectFence),
          commitFullUniversePublication,
        },
      } as unknown as RniWorkerServices;

      await expect(executor.combined({ lease, record, services })).rejects.toThrow(
        'exact worker manifest and terminal platform slices',
      );
      expect(commitFullUniversePublication).not.toHaveBeenCalled();
    },
  );

  it('rejects crossed, nonterminal, missing-outcome, and duplicate slice authority', () => {
    const exact = parseRniWorkerManifest(fullManifest());
    const base = executionFor(exact);
    const valid = {
      ...base,
      run: { ...base.run, id: exact.runId },
      platforms: {
        reddit: {
          slice: {
            id: '30000000-0000-4000-8000-000000000001',
            runId: exact.runId,
            platform: 'reddit',
            status: 'complete',
          },
          outcomeHash: hash('a'),
        },
        x: {
          slice: {
            id: '30000000-0000-4000-8000-000000000002',
            runId: exact.runId,
            platform: 'x',
            status: 'unavailable',
          },
          outcomeHash: hash('b'),
        },
      },
    } as unknown as RniExecutionRecord;

    expect(rniCombinedPlatformSlicesFromExecution(valid, exact)).toMatchObject({
      reddit: { platform: 'reddit', status: 'complete' },
      x: { platform: 'x', status: 'unavailable' },
    });
    const crossed = structuredClone(valid);
    crossed.platforms.x.slice.runId = '30000000-0000-4000-8000-000000000099';
    expect(() => rniCombinedPlatformSlicesFromExecution(crossed, exact)).toThrow(
      'crossed x platform-slice authority',
    );
    const running = structuredClone(valid);
    running.platforms.reddit.slice.status = 'running';
    expect(() => rniCombinedPlatformSlicesFromExecution(running, exact)).toThrow();
    const missingOutcome = structuredClone(valid);
    missingOutcome.platforms.reddit.outcomeHash = null;
    expect(() => rniCombinedPlatformSlicesFromExecution(missingOutcome, exact)).toThrow(
      'crossed reddit platform-slice authority',
    );
    const duplicate = structuredClone(valid);
    duplicate.platforms.x.slice.id = duplicate.platforms.reddit.slice.id;
    expect(() => rniCombinedPlatformSlicesFromExecution(duplicate, exact)).toThrow(
      'distinct Reddit and X platform slices',
    );
  });
});
