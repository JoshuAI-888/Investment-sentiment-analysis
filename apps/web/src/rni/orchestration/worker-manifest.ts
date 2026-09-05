import Decimal from 'decimal.js';
import { z } from 'zod';

import { canonicalInstant, looksLikeInstant, sha256Hex } from '@/calc/canonical';
import { rniAiBudgetLimits, rniTaskEnvelope } from '@/rni/contracts';

/** Immutable, admission-time input for production RNI effects. */
export const RNI_WORKER_MANIFEST_VERSION = 'rni-worker-manifest-v2' as const;
export const RNI_WORKER_MEMBER_SET_VERSION = 'rni-worker-member-set-v1' as const;
export const RNI_WORKER_MANIFEST_TASKS = [
  'rni_discovery',
  'rni_relationship',
  'rni_classifier',
  'rni_verification',
  'rni_challenger',
] as const;

const RNI_BALANCED_MODEL_POLICY_VERSION = 'rni-balanced-model-policy-v1' as const;
const RNI_BALANCED_BUDGET_POLICY_VERSION = 'rni-ai-budget-policy-v1' as const;
const RNI_BALANCED_MODEL_BY_TASK = {
  rni_discovery: 'gpt-5.6-terra',
  rni_relationship: 'gpt-5.6-terra',
  rni_classifier: 'gpt-5.6-terra',
  rni_verification: 'gpt-5.6-sol',
  rni_challenger: 'gpt-5.6-sol',
} as const satisfies Record<(typeof RNI_WORKER_MANIFEST_TASKS)[number], string>;

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const exactText = z
  .string()
  .min(1)
  .max(1000)
  .refine((value) => value === value.trim(), 'Exact text must not have surrounding whitespace');
const canonicalUuid = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), 'UUIDs must use canonical lowercase text');
const instant = z
  .string()
  .datetime({ offset: true })
  .superRefine((value, context) => {
    try {
      canonicalInstant(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Instant must be canonicalizable at PostgreSQL microsecond precision',
      });
    }
  });
const amount = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/u);
const positiveAmount = amount.refine(
  (value) => new Decimal(value).gt(0),
  'Amount must be positive',
);
const safeInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const nonnegativeCount = z.number().int().nonnegative().max(100_000);
const normalizedMarketText = exactText.refine(
  (value) => value === value.toUpperCase(),
  'Ticker, exchange, provider symbol, and currency must be normalized uppercase text',
);

const canonicalInstantParts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{6})Z$/u;
const MICROSECONDS_PER_MILLISECOND = 1_000n;

/** Preserve the three sub-millisecond digits that JavaScript Date normally discards. */
const instantEpochMicroseconds = (value: string): bigint => {
  const canonical = canonicalInstant(value);
  const match = canonicalInstantParts.exec(canonical);
  if (match === null) throw new Error('Canonical RNI instant did not have fixed microsecond form');
  const fraction = match[2]!;
  const milliseconds = new Date(`${match[1]}.${fraction.slice(0, 3)}Z`).getTime();
  if (!Number.isFinite(milliseconds)) throw new Error('Canonical RNI instant was out of range');
  return BigInt(milliseconds) * MICROSECONDS_PER_MILLISECOND + BigInt(fraction.slice(3, 6));
};

export type RniCanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly RniCanonicalJsonValue[]
  | { readonly [key: string]: RniCanonicalJsonValue };

const canonicalJsonValue: z.ZodType<RniCanonicalJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.string(),
    safeInteger,
    z.array(canonicalJsonValue),
    z.record(canonicalJsonValue),
  ]),
);
const canonicalJsonObject = z
  .record(canonicalJsonValue)
  .refine((value) => Object.keys(value).length > 0, 'Snapshot value must not be empty');

/** Object order is incidental. Array order is meaning and is never sorted. */
const canonicalizeManifestValue = (value: unknown, path = '$'): string => {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'b:true' : 'b:false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`RNI worker manifest contains a non-safe integer at ${path}`);
    }
    return `i:${String(value)}`;
  }
  if (typeof value === 'string') {
    return looksLikeInstant(value) ? `t:${canonicalInstant(value)}` : `s:${JSON.stringify(value)}`;
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((child, index) => canonicalizeManifestValue(child, `${path}[${String(index)}]`))
      .join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(
        ([key, child]) =>
          `${JSON.stringify(key)}:${canonicalizeManifestValue(child, `${path}.${key}`)}`,
      )
      .join(',')}}`;
  }
  throw new Error(`RNI worker manifest contains non-JSON ${typeof value} at ${path}`);
};

export const canonicalizeRniWorkerSnapshotValue = (input: unknown): string =>
  canonicalizeManifestValue(canonicalJsonObject.parse(input));

export const hashRniWorkerSnapshotValue = (input: unknown): string =>
  sha256Hex(canonicalizeRniWorkerSnapshotValue(input));

const exactSnapshot = z
  .object({
    version: exactText,
    snapshotHash: digest,
    value: canonicalJsonObject,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.snapshotHash !== hashRniWorkerSnapshotValue(snapshot.value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['snapshotHash'],
        message: 'Snapshot hash must match its complete canonical JSON value',
      });
    }
  });

const aliasKey = (value: string): string => value.normalize('NFKC').trim().toUpperCase();
const aliases = z
  .array(exactText)
  .max(500)
  .superRefine((values, context) => {
    const keys = new Set<string>();
    for (const [index, value] of values.entries()) {
      const key = aliasKey(value);
      if (keys.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'Security aliases must be unique after canonical normalization',
        });
      }
      if (index > 0 && aliasKey(values[index - 1]!) >= key) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'Security aliases must be in canonical normalized order',
        });
      }
      keys.add(key);
    }
  });

export const rniWorkerManifestMember = z
  .object({
    ordinal: z.number().int().min(1).max(600),
    securityId: canonicalUuid,
    ticker: normalizedMarketText,
    companyName: exactText,
    exchange: normalizedMarketText,
    assetType: exactText,
    currency: normalizedMarketText,
    aliases,
    selectionSource: exactText,
    providerSymbol: normalizedMarketText,
    providerCompanyName: exactText,
    constituentFirstAddedAt: instant.nullable(),
  })
  .strict();
export type RniWorkerManifestMember = z.infer<typeof rniWorkerManifestMember>;

const compareMember = (left: RniWorkerManifestMember, right: RniWorkerManifestMember): number => {
  const leftKey = [left.ticker, left.exchange, left.securityId];
  const rightKey = [right.ticker, right.exchange, right.securityId];
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index]! < rightKey[index]!) return -1;
    if (leftKey[index]! > rightKey[index]!) return 1;
  }
  return 0;
};

const memberSet = z
  .array(rniWorkerManifestMember)
  .min(1)
  .max(600)
  .superRefine((members, context) => {
    const securityIds = new Set<string>();
    const ordinals = new Set<number>();
    for (const [index, member] of members.entries()) {
      if (securityIds.has(member.securityId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'securityId'],
          message: 'Worker-manifest security identities must be unique',
        });
      }
      if (ordinals.has(member.ordinal)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'ordinal'],
          message: 'Worker-manifest ordinals must be unique',
        });
      }
      if (member.ordinal !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'ordinal'],
          message: 'Worker-manifest ordinals must be contiguous and one-based',
        });
      }
      if (index > 0 && compareMember(members[index - 1]!, member) >= 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'Members must be ordered by normalized ticker, exchange, then security UUID',
        });
      }
      securityIds.add(member.securityId);
      ordinals.add(member.ordinal);
    }
  });

export const canonicalizeRniWorkerManifestMembers = (members: unknown): string =>
  canonicalizeManifestValue({
    version: RNI_WORKER_MEMBER_SET_VERSION,
    members: memberSet.parse(members),
  });

export const hashRniWorkerManifestMembers = (members: unknown): string =>
  sha256Hex(canonicalizeRniWorkerManifestMembers(members));

const canonicalStringSet = (minimum = 0) =>
  z
    .array(exactText)
    .min(minimum)
    .max(100)
    .superRefine((values, context) => {
      for (const [index, value] of values.entries()) {
        if (index > 0 && values[index - 1]! >= value) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: 'Set-like values must be unique and in canonical code-unit order',
          });
        }
      }
    });

const orderedUniqueStrings = z
  .array(exactText)
  .max(100)
  .refine((values) => new Set(values).size === values.length, 'Ordered values must be unique');

const priceUnit = z.discriminatedUnion('service', [
  z
    .object({
      provider: z.literal('openai'),
      service: z.literal('openai_responses'),
      operationOrModel: exactText,
      unitType: z.enum(['input_token', 'output_token']),
      unitPrice: positiveAmount,
      currency: z.literal('USD'),
      effectiveFrom: instant,
      effectiveUntil: instant.nullable(),
      sourceReference: exactText,
    })
    .strict(),
  z
    .object({
      provider: z.literal('openai'),
      service: z.literal('openai_web_search'),
      operationOrModel: z.literal('web_search'),
      unitType: z.literal('search'),
      unitPrice: positiveAmount,
      currency: z.literal('USD'),
      effectiveFrom: instant,
      effectiveUntil: instant.nullable(),
      sourceReference: exactText,
    })
    .strict(),
]);
type PriceUnit = z.infer<typeof priceUnit>;

const priceUnitKey = (unit: PriceUnit): string =>
  [unit.provider, unit.service, unit.operationOrModel, unit.unitType].join('\u0000');

const priceUnits = z
  .array(priceUnit)
  .min(1)
  .max(100)
  .superRefine((units, context) => {
    for (const [index, unit] of units.entries()) {
      if (index > 0 && priceUnitKey(units[index - 1]!) >= priceUnitKey(unit)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'Price rows must be unique and in canonical identity order',
        });
      }
    }
  });

const priceBookValue = z
  .object({
    version: exactText,
    sourceUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith('https://')),
    responseHash: digest,
    observedAt: instant,
    firstTierInputCeiling: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    units: priceUnits,
  })
  .strict();
export type RniWorkerPriceBookValue = z.infer<typeof priceBookValue>;

export const hashRniWorkerPriceBook = (input: unknown): string =>
  sha256Hex(canonicalizeManifestValue(priceBookValue.parse(input)));

const priceBook = priceBookValue
  .extend({ snapshotHash: digest })
  .strict()
  .superRefine((book, context) => {
    const { snapshotHash, ...value } = book;
    if (snapshotHash !== hashRniWorkerPriceBook(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['snapshotHash'],
        message: 'Price-book hash must match its exact evidence and ordered unit rows',
      });
    }
  });

const modelRoute = z
  .object({
    task: z.enum(RNI_WORKER_MANIFEST_TASKS),
    aiRoute: z.enum(['openai_direct', 'vercel_ai_gateway']),
    transport: exactText,
    provider: exactText,
    configuredModelId: exactText,
    canonicalProviderModelId: exactText,
    modelRevision: exactText,
    reasoningEffort: exactText,
    policyVersion: exactText,
    calibrationVersion: exactText,
    capability: z
      .object({
        snapshotId: exactText,
        responseHash: digest,
        observedAt: instant,
        expiresAt: instant,
        available: z.boolean(),
        supportsResponses: z.boolean(),
        supportsStructuredOutputs: z.boolean(),
        supportsWebSearch: z.boolean(),
        reasoningEfforts: canonicalStringSet(1),
        requiresResponses: z.boolean(),
        requiresStructuredOutputs: z.boolean(),
        requiresWebSearch: z.boolean(),
      })
      .strict(),
    prompt: z
      .object({
        version: exactText,
        contentHash: digest,
        inputSchemaVersion: exactText,
        inputSchemaHash: digest,
        outputSchemaVersion: exactText,
        outputSchemaHash: digest,
        toolVersion: exactText,
        toolHash: digest,
      })
      .strict(),
    temperature: amount,
    fallbackChain: orderedUniqueStrings,
    allowedDataClasses: canonicalStringSet(),
    envelope: rniTaskEnvelope,
    priceBook,
  })
  .strict();

const taskCounts = z
  .object({
    rni_discovery: nonnegativeCount,
    rni_relationship: nonnegativeCount,
    rni_classifier: nonnegativeCount,
    rni_verification: nonnegativeCount,
    rni_challenger: nonnegativeCount,
  })
  .strict();

const manifestScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual_ticker'), selectedSecurityId: canonicalUuid }).strict(),
  z.object({ kind: z.literal('full_universe') }).strict(),
]);

const forbiddenKeyFragments = [
  'apikey',
  'authorization',
  'clientsecret',
  'cookie',
  'credential',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'signingkey',
  'accesstoken',
] as const;

const forbiddenKeyPath = (value: unknown): readonly (string | number)[] | null => {
  const ancestors = new WeakSet<object>();
  const scan = (
    child: unknown,
    path: readonly (string | number)[],
  ): readonly (string | number)[] | null => {
    if (child === null || typeof child !== 'object') return null;
    if (ancestors.has(child)) return path;
    ancestors.add(child);
    if (Array.isArray(child)) {
      for (const [index, item] of child.entries()) {
        const found = scan(item, [...path, index]);
        if (found !== null) return found;
      }
      ancestors.delete(child);
      return null;
    }
    for (const [key, item] of Object.entries(child as Record<string, unknown>)) {
      const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
      if (
        forbiddenKeyFragments.some((fragment) => normalized.includes(fragment)) ||
        normalized === 'token' ||
        normalized.endsWith('token')
      )
        return [...path, key];
      const found = scan(item, [...path, key]);
      if (found !== null) return found;
    }
    ancestors.delete(child);
    return null;
  };
  return scan(value, []);
};

const buildIdentity = z
  .object({
    deploymentId: exactText,
    commitSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
    artifactHash: digest,
    sourceAdapterVersions: z.object({ reddit: exactText, x: exactText }).strict(),
    semanticCodeVersion: exactText,
    analyticsCodeVersion: exactText,
    convergenceCodeVersion: exactText,
    citedSynthesisCodeVersion: exactText,
  })
  .strict();

const workerManifestShape = z
  .object({
    version: z.literal(RNI_WORKER_MANIFEST_VERSION),
    environment: exactText,
    partition: exactText,
    runId: canonicalUuid,
    jobRunId: canonicalUuid,
    planHash: digest,
    trigger: z.enum(['schedule', 'manual', 'api']),
    acceptedAt: instant,
    deadline: instant,
    scope: manifestScope,
    windows: z
      .object({
        timezone: exactText,
        windowStart: instant,
        windowEnd: instant,
        comparisonStart: instant.nullable(),
        comparisonEnd: instant.nullable(),
        assessmentCutoffAt: instant,
      })
      .strict(),
    configuration: z
      .object({
        version: exactText,
        checksum: exactText,
        aiRoute: z.enum(['openai_direct', 'vercel_ai_gateway']),
        modelPolicyVersion: exactText,
        budgetPolicyVersion: exactText,
        promptSetVersion: exactText,
        aggregateBudgets: rniAiBudgetLimits,
      })
      .strict(),
    universe: z.object({ version: exactText, snapshotHash: digest }).strict(),
    source: z
      .object({
        configuration: exactSnapshot,
        redditQueries: exactSnapshot,
        xQueries: exactSnapshot,
        rightsPolicy: exactSnapshot,
      })
      .strict(),
    policies: z
      .object({
        ambiguity: exactSnapshot,
        taxonomy: exactSnapshot,
        classification: exactSnapshot,
        analytics: exactSnapshot,
        convergence: exactSnapshot,
        budget: exactSnapshot,
      })
      .strict(),
    modelRoutes: z.array(modelRoute).length(RNI_WORKER_MANIFEST_TASKS.length),
    orchestration: z
      .object({
        maxAttempts: z.number().int().min(1).max(3),
        maxRuntimeMs: z.number().int().min(1000).max(900_000),
        leaseMs: z.number().int().min(1000).max(120_000),
        baseBackoffMs: z.number().int().min(1).max(60_000),
        maxBackoffMs: z.number().int().min(1).max(120_000),
        coalesceMs: z.number().int().min(0).max(300_000),
        calls: z.object({ reddit: taskCounts, x: taskCounts }).strict(),
        maxCostUsd: positiveAmount,
      })
      .strict(),
    coverage: z.object({ reddit: exactText, x: exactText }).strict(),
    build: buildIdentity,
    memberCount: z.number().int().min(1).max(600),
    memberSetHash: digest,
    members: memberSet,
  })
  .strict()
  .superRefine((manifest, context) => {
    const acceptedAt = instantEpochMicroseconds(manifest.acceptedAt);
    const deadline = instantEpochMicroseconds(manifest.deadline);
    const windowStart = instantEpochMicroseconds(manifest.windows.windowStart);
    const windowEnd = instantEpochMicroseconds(manifest.windows.windowEnd);
    const comparisonStart =
      manifest.windows.comparisonStart === null
        ? null
        : instantEpochMicroseconds(manifest.windows.comparisonStart);
    const comparisonEnd =
      manifest.windows.comparisonEnd === null
        ? null
        : instantEpochMicroseconds(manifest.windows.comparisonEnd);

    if (
      manifest.configuration.modelPolicyVersion !== RNI_BALANCED_MODEL_POLICY_VERSION ||
      manifest.configuration.budgetPolicyVersion !== RNI_BALANCED_BUDGET_POLICY_VERSION
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['configuration'],
        message: 'Worker manifest must pin the approved balanced model and budget policies',
      });
    }

    if (
      deadline !==
      acceptedAt + BigInt(manifest.orchestration.maxRuntimeMs) * MICROSECONDS_PER_MILLISECOND
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deadline'],
        message: 'Worker deadline must equal admission plus the exact maximum runtime',
      });
    }
    if (windowStart >= windowEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windows'],
        message: 'Worker window must be a non-empty half-open interval',
      });
    }
    if (
      canonicalInstant(manifest.windows.assessmentCutoffAt) !==
      canonicalInstant(manifest.windows.windowEnd)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windows', 'assessmentCutoffAt'],
        message: 'Assessment cutoff must equal the accepted window end',
      });
    }
    if (
      (comparisonStart === null) !== (comparisonEnd === null) ||
      (comparisonStart !== null &&
        comparisonEnd !== null &&
        (comparisonStart >= comparisonEnd || comparisonEnd > windowStart))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windows'],
        message: 'Comparison window must be complete, ordered, and end before the primary window',
      });
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: manifest.windows.timezone });
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windows', 'timezone'],
        message: 'Worker-manifest timezone must be a valid IANA timezone',
      });
    }

    const firstPriceBook = manifest.modelRoutes[0]!.priceBook;
    const firstPriceCanonical = canonicalizeManifestValue(firstPriceBook);
    for (const [index, task] of RNI_WORKER_MANIFEST_TASKS.entries()) {
      const route = manifest.modelRoutes[index]!;
      const expectedModel = RNI_BALANCED_MODEL_BY_TASK[task];
      if (route.task !== task || route.envelope.task !== task) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelRoutes', index],
          message: `Model route ${String(index + 1)} must be ${task}`,
        });
      }
      if (route.aiRoute !== manifest.configuration.aiRoute) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelRoutes', index, 'aiRoute'],
          message: 'Every model route must use the manifest configuration route',
        });
      }
      if (
        route.transport !== 'openai_responses' ||
        route.provider !== 'openai' ||
        route.canonicalProviderModelId !== expectedModel ||
        route.reasoningEffort !== 'low' ||
        route.policyVersion !== RNI_BALANCED_MODEL_POLICY_VERSION ||
        route.policyVersion !== manifest.configuration.modelPolicyVersion ||
        route.temperature !== '0' ||
        route.fallbackChain.length !== 0 ||
        (route.aiRoute === 'openai_direct' &&
          route.configuredModelId !== route.canonicalProviderModelId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelRoutes', index],
          message: `Model route ${task} must use the exact D-RNI-21 balanced Responses policy`,
        });
      }
      if (
        !route.capability.available ||
        !route.capability.requiresResponses ||
        !route.capability.requiresStructuredOutputs ||
        route.capability.requiresWebSearch !== (task === 'rni_discovery') ||
        (route.capability.requiresResponses && !route.capability.supportsResponses) ||
        (route.capability.requiresStructuredOutputs &&
          !route.capability.supportsStructuredOutputs) ||
        (route.capability.requiresWebSearch && !route.capability.supportsWebSearch) ||
        !route.capability.reasoningEfforts.includes(route.reasoningEffort)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelRoutes', index, 'capability'],
          message: 'Model route capability availability or required flags are not satisfied',
        });
      }
      if (
        instantEpochMicroseconds(route.capability.observedAt) > acceptedAt ||
        instantEpochMicroseconds(route.capability.expiresAt) <= acceptedAt
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelRoutes', index, 'capability'],
          message: 'Capability evidence must be observed and fresh at admission',
        });
      }
      if (instantEpochMicroseconds(route.priceBook.observedAt) > acceptedAt) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelRoutes', index, 'priceBook'],
          message: 'Price evidence cannot postdate admission',
        });
      }
      if (route.envelope.maxInputTokensReserved >= route.priceBook.firstTierInputCeiling) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelRoutes', index, 'priceBook', 'firstTierInputCeiling'],
          message: 'First-tier price ceiling must cover the complete task input envelope',
        });
      }
      for (const [unitIndex, unit] of route.priceBook.units.entries()) {
        const effectiveFrom = instantEpochMicroseconds(unit.effectiveFrom);
        const effectiveUntil =
          unit.effectiveUntil === null ? null : instantEpochMicroseconds(unit.effectiveUntil);
        if (
          effectiveFrom > acceptedAt ||
          (effectiveUntil !== null &&
            (effectiveUntil <= effectiveFrom || acceptedAt >= effectiveUntil))
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['modelRoutes', index, 'priceBook', 'units', unitIndex],
            message: 'Every price row must be effective at manifest admission',
          });
        }
      }
      if (canonicalizeManifestValue(route.priceBook) !== firstPriceCanonical) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelRoutes', index, 'priceBook'],
          message: 'All model routes must carry the same exact admitted price book',
        });
      }

      const routeUnits = route.priceBook.units;
      const hasInput = routeUnits.some(
        (unit) =>
          unit.provider === route.provider &&
          unit.service === 'openai_responses' &&
          unit.operationOrModel === route.canonicalProviderModelId &&
          unit.unitType === 'input_token',
      );
      const hasOutput = routeUnits.some(
        (unit) =>
          unit.provider === route.provider &&
          unit.service === 'openai_responses' &&
          unit.operationOrModel === route.canonicalProviderModelId &&
          unit.unitType === 'output_token',
      );
      const hasSearch = routeUnits.some(
        (unit) =>
          unit.provider === route.provider &&
          unit.service === 'openai_web_search' &&
          unit.operationOrModel === 'web_search' &&
          unit.unitType === 'search',
      );
      if (!hasInput || !hasOutput || (task === 'rni_discovery' && !hasSearch)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelRoutes', index, 'priceBook', 'units'],
          message: 'Exact price book lacks a required model or Web Search unit row',
        });
      }
    }

    const scopeHardCap =
      manifest.scope.kind === 'manual_ticker'
        ? manifest.configuration.aggregateBudgets.manualRunHardUsd
        : manifest.configuration.aggregateBudgets.fullUniverseHardUsd;
    if (new Decimal(manifest.orchestration.maxCostUsd).gt(scopeHardCap)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['orchestration', 'maxCostUsd'],
        message: 'Worker maximum cost cannot exceed the matching aggregate run hard cap',
      });
    }

    if (manifest.memberCount !== manifest.members.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['memberCount'],
        message: 'Member count must equal the immutable ordered member set',
      });
    }
    if (manifest.memberSetHash !== hashRniWorkerManifestMembers(manifest.members)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['memberSetHash'],
        message: 'Member-set hash does not match the immutable ordered member set',
      });
    }
    if (
      manifest.scope.kind === 'manual_ticker' &&
      (manifest.members.length !== 1 ||
        manifest.members[0]?.securityId !== manifest.scope.selectedSecurityId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope'],
        message: 'Manual scope must contain exactly the selected security',
      });
    }
    if (manifest.trigger === 'schedule' && manifest.scope.kind !== 'full_universe') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope'],
        message: 'Scheduled worker manifests must use the full-universe scope',
      });
    }
    if (manifest.orchestration.maxBackoffMs < manifest.orchestration.baseBackoffMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['orchestration', 'maxBackoffMs'],
        message: 'Maximum backoff cannot be lower than base backoff',
      });
    }
    if (manifest.orchestration.calls.x.rni_discovery !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['orchestration', 'calls', 'x', 'rni_discovery'],
        message: 'X cannot consume Reddit Web Search discovery slots',
      });
    }
  });

/** Reject possible credential fields before shape parsing or future extension passthrough. */
export const rniWorkerManifest = z
  .unknown()
  .superRefine((input, context) => {
    const path = forbiddenKeyPath(input);
    if (path !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path],
        message: 'Secret-like keys are forbidden in an RNI worker manifest',
      });
    }
  })
  .pipe(workerManifestShape);

export type RniWorkerManifest = z.infer<typeof rniWorkerManifest>;

export const parseRniWorkerManifest = (input: unknown): RniWorkerManifest =>
  rniWorkerManifest.parse(input);

export const canonicalizeRniWorkerManifest = (input: unknown): string =>
  canonicalizeManifestValue(parseRniWorkerManifest(input));

export const hashRniWorkerManifest = (input: unknown): string =>
  sha256Hex(canonicalizeRniWorkerManifest(input));
