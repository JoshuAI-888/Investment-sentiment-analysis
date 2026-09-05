import { z } from 'zod';

import {
  RNI_PROMPT_HISTORY,
  type RniPromptDefinition,
  type RniPromptTask,
} from '../../../prompts/rni/registry';
import { RNI_CITED_SYNTHESIS_CODE_VERSION } from '@/rni/agents';
import { RNI_ANALYTICS_CODE_VERSION } from '@/rni/analytics';
import { RNI_ACTIVE_SOURCE_RIGHTS_POLICY_VERSION } from '@/rni/config';
import { rniUnitDecimal } from '@/rni/contracts';
import { RNI_CONVERGENCE_CODE_VERSION } from '@/rni/convergence';
import { rniAnalyticsProjectionPolicy } from '@/rni/repositories/analytics-input-projector';
import {
  RNI_WORKER_MANIFEST_TASKS,
  canonicalizeRniWorkerSnapshotValue,
  hashRniWorkerSnapshotValue,
  parseRniWorkerManifest,
  type RniCanonicalJsonValue,
  type RniWorkerManifest,
} from './worker-manifest';

const exactText = z
  .string()
  .min(1)
  .max(1_000)
  .refine((value) => value === value.trim(), 'Authority text must be exact trimmed text');
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const canonicalUuid = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), 'UUID must be canonical lowercase text');
const positiveDecimal = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u)
  .refine((value) => !/^0(?:\.0+)?$/u.test(value), 'Decimal must be positive');

const orderedUnique = <T extends z.ZodTypeAny>(schema: T, maximum: number) =>
  z
    .array(schema)
    .max(maximum)
    .superRefine((values, context) => {
      const canonical = values.map((value) => JSON.stringify(value));
      for (let index = 1; index < canonical.length; index += 1) {
        if (canonical[index - 1]! >= canonical[index]!) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: 'Set-like authority values must be unique and canonically ordered',
          });
        }
      }
    });

/** Immutable source behaviour consumed by the Reddit and X platform pipelines. */
export const rniSourceConfigurationAuthority = z
  .object({
    reddit: z
      .object({
        acquisitionMethod: z.literal('openai_web_search'),
        coverageMode: z.literal('REDDIT_SAMPLED_WEB_DISCOVERY'),
      })
      .strict(),
    x: z
      .object({
        acquisitionMethod: z.literal('x_adapter'),
        coverageMode: z.literal('X_CONFIGURED_SAMPLE'),
      })
      .strict(),
    retentionPolicyVersion: exactText,
  })
  .strict();

const redditCommunity = z.string().regex(/^r\/[A-Za-z0-9_]+$/u);
const redditDiscoveryModeAuthority = z
  .object({
    communities: orderedUnique(redditCommunity, 100).refine((values) => values.length > 0, {
      message: 'At least one Reddit community is required',
    }),
    maxCandidates: z.number().int().min(1).max(100),
  })
  .strict();

/** The two concrete request modes accepted by rniDiscoveryModelInput. */
export const rniRedditQueryAuthority = z
  .object({
    scheduledCommunity: redditDiscoveryModeAuthority,
    onDemandSecurity: redditDiscoveryModeAuthority,
  })
  .strict();

const xConfiguredQuery = z
  .object({
    queryId: canonicalUuid,
    query: z.string().trim().min(1).max(1_000),
    scope: z.string().trim().min(1).max(500),
    maxResults: z.number().int().min(10).max(100).optional(),
  })
  .strict();

/** Exact configured X queries consumed by runXSourceSlice. */
export const rniXQueryAuthority = z
  .object({
    queries: z
      .array(xConfiguredQuery)
      .min(1)
      .max(600)
      .superRefine((queries, context) => {
        const ids = queries.map(({ queryId }) => queryId);
        if (new Set(ids).size !== ids.length) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'X query IDs must be unique' });
        }
      }),
  })
  .strict();

/** P0 storage/publication rights currently implemented by source persistence and synthesis. */
export const rniRightsPolicyAuthority = z
  .object({
    policyVersion: z.literal(RNI_ACTIVE_SOURCE_RIGHTS_POLICY_VERSION),
    platforms: z.tuple([z.literal('reddit'), z.literal('x')]),
    captureModes: z.tuple([
      z.literal('excerpt_only'),
      z.literal('full_comment'),
      z.literal('full_post'),
    ]),
    maximumBoundedContentCharacters: z.literal(20_000),
    storeWholePageHtml: z.literal(false),
    requireOriginalUrl: z.literal(true),
    revalidateAtPublication: z.literal(true),
  })
  .strict();

export const rniAmbiguityAuthority = z
  .object({
    version: exactText,
    bareTickerSymbols: orderedUnique(z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/u), 600),
  })
  .strict();

const taxonomyCategory = z
  .object({
    definitionId: canonicalUuid,
    stableKey: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2_000),
    enabled: z.boolean(),
    classificationThreshold: rniUnitDecimal,
  })
  .strict();

export const rniTaxonomyAuthority = z
  .object({
    version: exactText,
    dimensions: z.tuple([
      z.literal('company_fundamentals'),
      z.literal('market_trading'),
      z.literal('catalyst_event'),
      z.literal('retail_narrative'),
    ]),
    categories: z
      .array(taxonomyCategory)
      .max(100)
      .superRefine((categories, context) => {
        const ids = categories.map(({ definitionId }) => definitionId);
        const keys = categories.map(({ stableKey }) => stableKey);
        if (new Set(ids).size !== ids.length || new Set(keys).size !== keys.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Taxonomy definition IDs and stable keys must be unique',
          });
        }
      }),
  })
  .strict();

export const rniClassificationAuthority = z
  .object({
    version: exactText,
    schemaVersion: exactText,
    neutralMaxAbsoluteScore: rniUnitDecimal,
    strongMinAbsoluteScore: rniUnitDecimal,
    binaryLabelThreshold: rniUnitDecimal,
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      Number(policy.neutralMaxAbsoluteScore) >= Number(policy.strongMinAbsoluteScore) ||
      Number(policy.strongMinAbsoluteScore) === 0 ||
      Number(policy.binaryLabelThreshold) === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Classification thresholds do not satisfy the production classifier policy',
      });
    }
  });

export const rniConvergenceAuthority = z
  .object({
    version: exactText,
    codeVersion: z.literal(RNI_CONVERGENCE_CODE_VERSION),
    dimensionDivergenceMinimum: positiveDecimal,
    scaleImbalanceRatioThreshold: positiveDecimal,
    staleAfterHours: positiveDecimal,
  })
  .strict()
  .superRefine((policy, context) => {
    if (Number(policy.scaleImbalanceRatioThreshold) <= 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scaleImbalanceRatioThreshold'],
        message: 'Scale-imbalance threshold must be greater than one',
      });
    }
  });

export const rniBudgetAuthority = z
  .object({
    reservationMode: z.literal('pre_dispatch'),
    settlementMode: z.literal('provider_usage'),
  })
  .strict();

export const rniBuildAuthority = z
  .object({
    deploymentId: exactText,
    commitSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
    artifactHash: digest,
    sourceAdapterVersions: z.object({ reddit: exactText, x: exactText }).strict(),
    semanticCodeVersion: exactText,
    analyticsCodeVersion: z.literal(RNI_ANALYTICS_CODE_VERSION),
    convergenceCodeVersion: z.literal(RNI_CONVERGENCE_CODE_VERSION),
    citedSynthesisCodeVersion: z.literal(RNI_CITED_SYNTHESIS_CODE_VERSION),
  })
  .strict();

export type RniSourceConfigurationAuthority = z.infer<typeof rniSourceConfigurationAuthority>;
export type RniRedditQueryAuthority = z.infer<typeof rniRedditQueryAuthority>;
export type RniXQueryAuthority = z.infer<typeof rniXQueryAuthority>;
export type RniRightsPolicyAuthority = z.infer<typeof rniRightsPolicyAuthority>;
export type RniAmbiguityAuthority = z.infer<typeof rniAmbiguityAuthority>;
export type RniTaxonomyAuthority = z.infer<typeof rniTaxonomyAuthority>;
export type RniClassificationAuthority = z.infer<typeof rniClassificationAuthority>;
export type RniConvergenceAuthority = z.infer<typeof rniConvergenceAuthority>;
export type RniBudgetAuthority = z.infer<typeof rniBudgetAuthority>;
export type RniBuildAuthority = z.infer<typeof rniBuildAuthority>;

export type RniParsedWorkerAuthorities = Readonly<{
  sourceConfiguration: RniSourceConfigurationAuthority;
  redditQueries: RniRedditQueryAuthority;
  xQueries: RniXQueryAuthority;
  rightsPolicy: RniRightsPolicyAuthority;
  ambiguity: RniAmbiguityAuthority;
  taxonomy: RniTaxonomyAuthority;
  classification: RniClassificationAuthority;
  analytics: z.infer<typeof rniAnalyticsProjectionPolicy>;
  convergence: RniConvergenceAuthority;
  budget: RniBudgetAuthority;
  build: RniBuildAuthority;
}>;

const authoritySnapshot = z
  .object({ version: exactText, snapshotHash: digest, value: z.record(z.unknown()) })
  .strict()
  .superRefine((snapshot, context) => {
    try {
      if (hashRniWorkerSnapshotValue(snapshot.value) !== snapshot.snapshotHash) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['snapshotHash'],
          message: 'Authority snapshot hash must match the complete canonical value',
        });
      }
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Authority snapshot must be non-empty canonical JSON',
      });
    }
  });

const authoritySnapshotSet = z
  .object({
    source: z
      .object({
        configuration: authoritySnapshot,
        redditQueries: authoritySnapshot,
        xQueries: authoritySnapshot,
        rightsPolicy: authoritySnapshot,
      })
      .strict(),
    policies: z
      .object({
        ambiguity: authoritySnapshot,
        taxonomy: authoritySnapshot,
        classification: authoritySnapshot,
        analytics: authoritySnapshot,
        convergence: authoritySnapshot,
        budget: authoritySnapshot,
      })
      .strict(),
    build: rniBuildAuthority,
  })
  .strict();

const parseSnapshot = <T>(
  snapshot: { readonly version: string; readonly value: unknown },
  schema: z.ZodType<T>,
  embeddedVersion?: (value: T) => string,
): T => {
  const value = schema.parse(snapshot.value);
  if (embeddedVersion !== undefined && embeddedVersion(value) !== snapshot.version) {
    throw new Error('RNI worker authority snapshot version does not match its typed value');
  }
  return value;
};

/** Parse every model/source/measurement authority before any provider or persistence effect. */
export function parseRniWorkerAuthorities(input: unknown): RniParsedWorkerAuthorities {
  const manifest = parseRniWorkerManifest(input);
  return parseRniWorkerAuthoritySnapshotSet({
    source: manifest.source,
    policies: manifest.policies,
    build: manifest.build,
  });
}

/** Standalone parser used by admission and tests before a complete manifest is assembled. */
export function parseRniWorkerAuthoritySnapshotSet(input: unknown): RniParsedWorkerAuthorities {
  const snapshotSet = authoritySnapshotSet.parse(input);
  return {
    sourceConfiguration: parseSnapshot(
      snapshotSet.source.configuration,
      rniSourceConfigurationAuthority,
    ),
    redditQueries: parseSnapshot(snapshotSet.source.redditQueries, rniRedditQueryAuthority),
    xQueries: parseSnapshot(snapshotSet.source.xQueries, rniXQueryAuthority),
    rightsPolicy: parseSnapshot(
      snapshotSet.source.rightsPolicy,
      rniRightsPolicyAuthority,
      (value) => value.policyVersion,
    ),
    ambiguity: parseSnapshot(
      snapshotSet.policies.ambiguity,
      rniAmbiguityAuthority,
      (value) => value.version,
    ),
    taxonomy: parseSnapshot(
      snapshotSet.policies.taxonomy,
      rniTaxonomyAuthority,
      (value) => value.version,
    ),
    classification: parseSnapshot(
      snapshotSet.policies.classification,
      rniClassificationAuthority,
      (value) => value.version,
    ),
    analytics: parseSnapshot(snapshotSet.policies.analytics, rniAnalyticsProjectionPolicy),
    convergence: parseSnapshot(
      snapshotSet.policies.convergence,
      rniConvergenceAuthority,
      (value) => value.version,
    ),
    budget: parseSnapshot(snapshotSet.policies.budget, rniBudgetAuthority),
    build: snapshotSet.build,
  };
}

const inputSchemas: Record<string, RniCanonicalJsonValue> = {};
for (const definition of RNI_PROMPT_HISTORY) {
  const authority = definition.inputSchemaAuthority as Readonly<
    Record<string, RniCanonicalJsonValue>
  >;
  const existing = inputSchemas[definition.inputSchemaVersion];
  if (
    existing !== undefined &&
    canonicalizeRniWorkerSnapshotValue({ schema: existing }) !==
      canonicalizeRniWorkerSnapshotValue({ schema: authority })
  ) {
    throw new Error('One RNI input-schema version resolves to multiple compiled parsers');
  }
  inputSchemas[definition.inputSchemaVersion] = authority;
}

export const RNI_COMPILED_PROMPT_INPUT_SCHEMAS = Object.freeze(inputSchemas);

const canonicalObject = (
  value: Readonly<Record<string, RniCanonicalJsonValue>>,
): Readonly<Record<string, RniCanonicalJsonValue>> => value;

export type RniCompiledPromptAuthority = RniWorkerManifest['modelRoutes'][number]['prompt'];

/** Derive all four hashes from actual compiled content, input contract, output schema and tools. */
export function compiledRniPromptAuthority(
  task: RniPromptTask,
  promptVersion: string,
): RniCompiledPromptAuthority {
  const matches = RNI_PROMPT_HISTORY.filter(
    (definition) => definition.task === task && definition.promptVersion === promptVersion,
  );
  if (matches.length !== 1) throw new Error('Unknown or duplicate compiled RNI prompt authority');
  const definition: RniPromptDefinition = matches[0]!;
  const inputSchema = inputSchemas[definition.inputSchemaVersion];
  if (inputSchema === undefined)
    throw new Error('Missing compiled RNI input-schema representation');
  return {
    version: definition.promptVersion,
    contentHash: hashRniWorkerSnapshotValue(
      canonicalObject({
        systemPolicy: definition.systemPolicy,
        finalInstruction: definition.finalInstruction,
      }),
    ),
    inputSchemaVersion: definition.inputSchemaVersion,
    inputSchemaHash: hashRniWorkerSnapshotValue(
      canonicalObject({
        schema: definition.inputSchemaAuthority as Readonly<Record<string, RniCanonicalJsonValue>>,
      }),
    ),
    outputSchemaVersion: definition.outputSchemaVersion,
    outputSchemaHash: hashRniWorkerSnapshotValue(
      canonicalObject({
        schema: definition.outputSchema as Readonly<Record<string, RniCanonicalJsonValue>>,
      }),
    ),
    toolVersion: definition.toolVersion,
    toolHash: hashRniWorkerSnapshotValue(
      canonicalObject({
        tools: definition.tools as readonly RniCanonicalJsonValue[],
      }),
    ),
  };
}

const exactCanonical = (left: unknown, right: unknown): boolean =>
  canonicalizeRniWorkerSnapshotValue({ value: left } as Record<string, RniCanonicalJsonValue>) ===
  canonicalizeRniWorkerSnapshotValue({ value: right } as Record<string, RniCanonicalJsonValue>);

export type RniCompiledWorkerAuthority = Readonly<{
  build: RniBuildAuthority;
}>;

export function assertRniCompiledPromptAuthority(task: RniPromptTask, promptInput: unknown): void {
  const prompt = z
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
    .strict()
    .parse(promptInput);
  const expected = compiledRniPromptAuthority(task, prompt.version);
  if (!exactCanonical(prompt, expected)) {
    throw new Error(`RNI worker prompt authority does not match compiled ${task}`);
  }
}

export function assertRniCompiledBuildAuthority(
  buildInput: unknown,
  compiledBuildInput: unknown,
): RniBuildAuthority {
  const build = rniBuildAuthority.parse(buildInput);
  const compiledBuild = rniBuildAuthority.parse(compiledBuildInput);
  if (!exactCanonical(build, compiledBuild)) {
    throw new Error('RNI worker build authority does not match the compiled deployment');
  }
  return build;
}

/**
 * Fail-closed production verifier. The expected build is supplied by the composition root from
 * its deployment artifact authority; no development/default build identity exists here.
 */
export function verifyRniCompiledWorkerAuthority(
  manifestInput: unknown,
  compiled: RniCompiledWorkerAuthority,
): RniParsedWorkerAuthorities {
  const manifest = parseRniWorkerManifest(manifestInput);
  const authorities = parseRniWorkerAuthorities(manifest);
  assertRniCompiledBuildAuthority(manifest.build, compiled.build);
  for (const task of RNI_WORKER_MANIFEST_TASKS) {
    const route = manifest.modelRoutes.find((candidate) => candidate.task === task);
    if (route === undefined) throw new Error('RNI worker prompt authority is incomplete');
    assertRniCompiledPromptAuthority(task, route.prompt);
  }
  return authorities;
}

export function createRniCompiledWorkerAuthorityVerifier(compiled: RniCompiledWorkerAuthority): {
  verify(manifest: RniWorkerManifest): void;
} {
  const build = rniBuildAuthority.parse(compiled.build);
  return { verify: (manifest) => void verifyRniCompiledWorkerAuthority(manifest, { build }) };
}
