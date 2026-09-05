import { z } from 'zod';

import type { Queryable } from '@/repositories/client';
import {
  bindRniWorkerConfigAuthority,
  persistRniWorkerManifestAuthority,
  readRniWorkerBuildEnvironment,
  type BindRniWorkerConfigAuthorityInput,
  type PersistRniWorkerManifestAuthorityInput,
  type RniWorkerBuildEnvironment,
} from '@/rni/repositories/worker-manifest';
import {
  assertRniCompiledBuildAuthority,
  assertRniCompiledPromptAuthority,
  parseRniWorkerAuthoritySnapshotSet,
  rniBuildAuthority,
} from './worker-authority';
import {
  RNI_WORKER_MANIFEST_TASKS,
  hashRniWorkerSnapshotValue,
  type RniCanonicalJsonValue,
} from './worker-manifest';

export const RNI_WORKER_CONFIG_AUTHORITY_KINDS = [
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

type ConfigAuthorityKind = (typeof RNI_WORKER_CONFIG_AUTHORITY_KINDS)[number];
type PromptTask = (typeof RNI_WORKER_MANIFEST_TASKS)[number];

const exactText = z
  .string()
  .min(1)
  .max(1_000)
  .refine((value) => value === value.trim(), 'Authority text must be exact trimmed text');
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const positiveBigintText = z.string().regex(/^[1-9][0-9]*$/u);
const unmodifiedObject = z.custom<Record<string, unknown>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  'Authority value must be a JSON object',
);

const reviewedSnapshot = z
  .object({
    version: exactText,
    snapshotHash: digest,
    value: unmodifiedObject,
  })
  .strict()
  .superRefine((snapshot, context) => {
    try {
      if (hashRniWorkerSnapshotValue(snapshot.value) !== snapshot.snapshotHash) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['snapshotHash'],
          message: 'Reviewed authority hash does not match its complete canonical value',
        });
      }
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Reviewed authority value must be canonical JSON',
      });
    }
  });

const reviewedWorkerAuthorityPack = z
  .object({
    configVersion: positiveBigintText,
    authorities: z
      .object({
        source_configuration: reviewedSnapshot,
        reddit_queries: reviewedSnapshot,
        x_queries: reviewedSnapshot,
        rights_policy: reviewedSnapshot,
        ambiguity: reviewedSnapshot,
        taxonomy: reviewedSnapshot,
        classification: reviewedSnapshot,
        analytics: reviewedSnapshot,
        convergence: reviewedSnapshot,
        budget: reviewedSnapshot,
      })
      .strict(),
    prompts: z
      .object({
        rni_discovery: reviewedSnapshot,
        rni_relationship: reviewedSnapshot,
        rni_classifier: reviewedSnapshot,
        rni_verification: reviewedSnapshot,
        rni_challenger: reviewedSnapshot,
      })
      .strict(),
    build: reviewedSnapshot,
  })
  .strict();

export type RniReviewedWorkerAuthorityPack = z.infer<typeof reviewedWorkerAuthorityPack>;

export type RniReviewedWorkerAuthorityPackEntry = Readonly<{
  authorityKind: ConfigAuthorityKind | 'prompt' | 'build';
  authorityKey: string;
  version: string;
  snapshotHash: string;
  value: Readonly<Record<string, RniCanonicalJsonValue>>;
}>;

export type RniWorkerAuthorityPackSeedResult = Readonly<{
  configVersion: string;
  authorities: readonly Readonly<{
    authorityKind: ConfigAuthorityKind | 'prompt' | 'build';
    authorityKey: string;
    version: string;
    snapshotHash: string;
    persistence: 'inserted' | 'duplicate';
    binding: 'inserted' | 'duplicate' | 'not_config_bound';
  }>[];
}>;

const canonicalObject = (
  value: Record<string, unknown>,
): Readonly<Record<string, RniCanonicalJsonValue>> =>
  value as Readonly<Record<string, RniCanonicalJsonValue>>;

const configSnapshotSet = (pack: RniReviewedWorkerAuthorityPack) => ({
  source: {
    configuration: pack.authorities.source_configuration,
    redditQueries: pack.authorities.reddit_queries,
    xQueries: pack.authorities.x_queries,
    rightsPolicy: pack.authorities.rights_policy,
  },
  policies: {
    ambiguity: pack.authorities.ambiguity,
    taxonomy: pack.authorities.taxonomy,
    classification: pack.authorities.classification,
    analytics: pack.authorities.analytics,
    convergence: pack.authorities.convergence,
    budget: pack.authorities.budget,
  },
  build: pack.build.value,
});

/**
 * Validate the complete reviewed file before opening a transaction. Nothing is defaulted or
 * derived: the deployment environment only proves the three build identities already present.
 */
export function parseRniReviewedWorkerAuthorityPack(
  input: unknown,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RniReviewedWorkerAuthorityPack {
  const pack = reviewedWorkerAuthorityPack.parse(input);
  parseRniWorkerAuthoritySnapshotSet(configSnapshotSet(pack));

  for (const task of RNI_WORKER_MANIFEST_TASKS) {
    const prompt = pack.prompts[task];
    if (prompt.version !== prompt.value['version']) {
      throw new Error(`Reviewed ${task} prompt version does not match its value`);
    }
    assertRniCompiledPromptAuthority(task, prompt.value);
  }

  const build = rniBuildAuthority.parse(pack.build.value);
  if (pack.build.version !== build.deploymentId) {
    throw new Error('Reviewed build authority version must equal its deployment ID');
  }
  const deployed: RniWorkerBuildEnvironment = readRniWorkerBuildEnvironment(environment);
  assertRniCompiledBuildAuthority(build, {
    ...build,
    deploymentId: deployed.deploymentId,
    commitSha: deployed.commitSha,
    artifactHash: deployed.artifactHash,
  });
  return pack;
}

export function entriesForRniReviewedWorkerAuthorityPack(
  pack: RniReviewedWorkerAuthorityPack,
): readonly RniReviewedWorkerAuthorityPackEntry[] {
  const configEntries = RNI_WORKER_CONFIG_AUTHORITY_KINDS.map((authorityKind) => {
    const snapshot = pack.authorities[authorityKind];
    return {
      authorityKind,
      authorityKey: 'default',
      version: snapshot.version,
      snapshotHash: snapshot.snapshotHash,
      value: canonicalObject(snapshot.value),
    };
  });
  const promptEntries = RNI_WORKER_MANIFEST_TASKS.map((task: PromptTask) => {
    const snapshot = pack.prompts[task];
    return {
      authorityKind: 'prompt' as const,
      authorityKey: task,
      version: snapshot.version,
      snapshotHash: snapshot.snapshotHash,
      value: canonicalObject(snapshot.value),
    };
  });
  return [
    ...configEntries,
    ...promptEntries,
    {
      authorityKind: 'build',
      authorityKey: 'default',
      version: pack.build.version,
      snapshotHash: pack.build.snapshotHash,
      value: canonicalObject(pack.build.value),
    },
  ];
}

export type RniWorkerAuthorityPackSeedDependencies = Readonly<{
  transaction<T>(work: (db: Queryable) => Promise<T>): Promise<T>;
  assertDraftConfig(configVersion: string, db: Queryable): Promise<void>;
  persistAuthority(
    input: PersistRniWorkerManifestAuthorityInput,
    db: Queryable,
  ): Promise<'inserted' | 'duplicate'>;
  bindConfigAuthority(
    input: BindRniWorkerConfigAuthorityInput,
    db: Queryable,
  ): Promise<'inserted' | 'duplicate'>;
}>;

/** Persist all sixteen append-only definitions and the ten config bindings atomically. */
export async function seedRniReviewedWorkerAuthorityPack(
  pack: RniReviewedWorkerAuthorityPack,
  dependencies: RniWorkerAuthorityPackSeedDependencies,
): Promise<RniWorkerAuthorityPackSeedResult> {
  const entries = entriesForRniReviewedWorkerAuthorityPack(pack);
  return dependencies.transaction(async (db) => {
    await dependencies.assertDraftConfig(pack.configVersion, db);
    const results: RniWorkerAuthorityPackSeedResult['authorities'][number][] = [];
    for (const entry of entries) {
      const persistence = await dependencies.persistAuthority(entry, db);
      let binding: 'inserted' | 'duplicate' | 'not_config_bound' = 'not_config_bound';
      if (entry.authorityKind !== 'prompt' && entry.authorityKind !== 'build') {
        binding = await dependencies.bindConfigAuthority(
          {
            configVersion: pack.configVersion,
            authorityKind: entry.authorityKind,
            version: entry.version,
            snapshotHash: entry.snapshotHash,
          },
          db,
        );
      }
      results.push({
        authorityKind: entry.authorityKind,
        authorityKey: entry.authorityKey,
        version: entry.version,
        snapshotHash: entry.snapshotHash,
        persistence,
        binding,
      });
    }
    return { configVersion: pack.configVersion, authorities: results };
  });
}

export const defaultRniWorkerAuthorityPackPersistence = {
  persistAuthority: persistRniWorkerManifestAuthority,
  bindConfigAuthority: bindRniWorkerConfigAuthority,
};
