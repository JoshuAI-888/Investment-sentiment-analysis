import { z } from 'zod';

import { canonicalInstant } from '@/calc/canonical';
import type { Queryable } from '@/repositories/client';
import type { RniImmutableModelRunConfig } from '@/rni/agents';
import { hashRniModelInput } from '@/rni/agents/model-input';
import {
  buildRniFullUniversePublication,
  rniFullUniversePublication,
  type RniFullUniversePublication,
  type RniFullUniversePublicationAuthority,
  type RniFullUniversePublicationInput,
} from '@/rni/orchestration/full-universe-publication';
import {
  finalizeRniFullUniversePublication,
  stageRniFullUniversePublicationMember,
} from '@/rni/repositories/full-universe-publication';
import { queryableForRniOrchestrationTransaction } from '@/rni/repositories/orchestration';
import type { RniWorkerManifest } from './worker-manifest';
import { hashRniWorkerManifest, parseRniWorkerManifest } from './worker-manifest';
import type { RniPlatformOutcome } from './execution';
import { platformOutcome, type RniExecutionLease } from './execution';
import {
  combinedArtifact,
  type RniCombinedArtifact,
  type RniCombinedFence,
  type RniExecutionRecord,
  type RniOrchestrationTransaction,
} from './types';
import type { RniCombinedLease } from './combined';
import type { RniWorkerExecutor } from './worker';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);

export interface RniExactWorkerManifestReader {
  load(runId: string, runManifestHash: string): Promise<RniWorkerManifest>;
}

/**
 * Verifies that the compiled prompt/schema/tool implementation exactly matches the immutable
 * hashes admitted in the manifest. This is deliberately mandatory: a version string alone is
 * not enough authority to dispatch a provider effect.
 */
export interface RniCompiledWorkerAuthorityVerifier {
  verify(manifest: RniWorkerManifest): void | Promise<void>;
}

export interface RniFullUniversePublicationCommitValidator {
  validate(
    publication: RniFullUniversePublication,
    authority: RniFullUniversePublicationAuthority,
    db: Queryable,
  ): Promise<void>;
}

export type RniPlatformPipelineInput = Readonly<{
  manifest: RniWorkerManifest;
  runConfig: RniImmutableModelRunConfig;
  lease: RniExecutionLease;
  executionAuthority: {
    readonly stage: 'reddit' | 'x';
    readonly attempt: number;
    readonly token: string;
  };
  heartbeat(): Promise<void>;
}>;

export interface RniProductionPlatformPipeline {
  /** Provider I/O happens here, outside every orchestration transaction. */
  execute(input: RniPlatformPipelineInput): Promise<RniPlatformOutcome>;
}

type ManualPublication = Readonly<{
  kind: 'manual_ticker';
  artifact: RniCombinedArtifact;
  publish(
    tx: RniOrchestrationTransaction,
    fence: RniCombinedFence,
    artifact: RniCombinedArtifact,
  ): Promise<RniCombinedArtifact>;
  /** Must re-read the accepted durable artifact after the commit transaction. */
  readAccepted(fence: RniCombinedFence): Promise<RniCombinedArtifact>;
}>;

type FullUniversePublication = Readonly<{
  kind: 'full_universe';
  publication: RniFullUniversePublicationInput | RniFullUniversePublication;
}>;

export type RniPreparedCombinedPublication = ManualPublication | FullUniversePublication;

export interface RniProductionCombinedPipeline {
  /**
   * Provider/model work happens here, outside every orchestration transaction. The supplied
   * effect fence was read immediately before this call and is not publication authority.
   */
  prepare(input: Readonly<{
    manifest: RniWorkerManifest;
    runConfig: RniImmutableModelRunConfig;
    lease: RniCombinedLease;
    effectFence: RniCombinedFence;
    /** Exact terminal slices from the claimed execution; never a mutable/latest lookup. */
    platformSlices: RniCombinedPlatformSliceAuthority;
  }>): Promise<RniPreparedCombinedPublication>;
}

const terminalPlatformSliceAuthority = z
  .object({
    runId: z.string().uuid(),
    platform: z.enum(['reddit', 'x']),
    sliceId: z.string().uuid(),
    status: z.enum(['complete', 'partial', 'failed', 'unavailable']),
    outcomeHash: digest,
  })
  .strict();

export type RniCombinedPlatformSliceAuthority = Readonly<{
  reddit: Readonly<z.output<typeof terminalPlatformSliceAuthority> & { platform: 'reddit' }>;
  x: Readonly<z.output<typeof terminalPlatformSliceAuthority> & { platform: 'x' }>;
}>;

/**
 * Projects only the immutable terminal slice identities recorded on the claimed execution. The
 * caller must already have loaded that record through the fenced combined claim; this helper does
 * not read a current/latest slice and grants no publication authority.
 */
export function rniCombinedPlatformSlicesFromExecution(
  record: RniExecutionRecord,
  manifest: RniWorkerManifest,
): RniCombinedPlatformSliceAuthority {
  if (
    record.version !== 'rni-execution-v2' ||
    record.run.id !== manifest.runId ||
    record.planHash !== manifest.planHash ||
    record.runManifestHash !== hashRniWorkerManifest(manifest)
  ) {
    throw new Error('RNI combined pipeline received crossed execution or manifest authority');
  }

  const project = <TPlatform extends 'reddit' | 'x'>(platform: TPlatform) => {
    const state = record.platforms[platform];
    if (
      state.slice.runId !== record.run.id ||
      state.slice.platform !== platform ||
      state.outcomeHash === null
    ) {
      throw new Error(`RNI combined pipeline received crossed ${platform} platform-slice authority`);
    }
    return terminalPlatformSliceAuthority.parse({
      runId: state.slice.runId,
      platform: state.slice.platform,
      sliceId: state.slice.id,
      status: state.slice.status,
      outcomeHash: state.outcomeHash,
    }) as z.output<typeof terminalPlatformSliceAuthority> & { platform: TPlatform };
  };

  const platformSlices = { reddit: project('reddit'), x: project('x') };
  if (platformSlices.reddit.sliceId === platformSlices.x.sliceId) {
    throw new Error('RNI combined pipeline requires distinct Reddit and X platform slices');
  }
  return platformSlices;
}

/**
 * Builds the exact read-selection authority for a full-universe release. Member artifacts still
 * need to be selected on a caller-owned transaction, and the later combined commit fence remains
 * the only publication authority.
 */
export function rniFullUniversePublicationAuthorityFromExecution(
  record: RniExecutionRecord,
  manifest: RniWorkerManifest,
): RniFullUniversePublicationAuthority {
  if (manifest.scope.kind !== 'full_universe') {
    throw new Error('Full-universe publication authority requires a full-universe manifest');
  }
  const platformSlices = rniCombinedPlatformSlicesFromExecution(record, manifest);
  const runManifestHash = hashRniWorkerManifest(manifest);
  const identity = {
    runId: manifest.runId,
    planHash: manifest.planHash,
    runManifestHash,
    universeVersion: manifest.universe.version,
    assessmentCutoffAt: canonicalInstant(manifest.windows.assessmentCutoffAt),
    memberSetHash: manifest.memberSetHash,
  } as const;
  return {
    manifest: {
      ...identity,
      members: manifest.members.map(({ ordinal, securityId }) => ({ ordinal, securityId })),
    },
    platforms: {
      reddit: { ...identity, ...platformSlices.reddit },
      x: { ...identity, ...platformSlices.x },
    },
  };
}

const canonicalPlanBinding = (record: RniExecutionRecord, manifest: RniWorkerManifest) => ({
  record: {
    partition: record.partition,
    jobRunId: record.jobRunId,
    planHash: record.planHash,
    trigger: record.run.trigger,
    acceptedAt: record.run.requestedAt,
    deadline: record.deadline,
    scope:
      record.plan.scopePreview.kind === 'ticker'
        ? { kind: 'manual_ticker', selectedSecurityId: record.plan.scopePreview.securityId }
        : { kind: 'full_universe' },
    windows: {
      timezone: record.plan.timezone,
      windowStart: record.plan.windowStart,
      windowEnd: record.plan.windowEnd,
      comparisonStart: record.plan.comparisonStart,
      comparisonEnd: record.plan.comparisonEnd,
      assessmentCutoffAt: record.plan.windowEnd,
    },
    configuration: {
      version: record.plan.configVersion,
      aiRoute: record.plan.aiRoute,
      aggregateBudgets: record.plan.budgets,
    },
    universeVersion: record.plan.universeVersion,
    orchestration: {
      maxAttempts: record.plan.maxAttempts,
      maxRuntimeMs: record.plan.maxRuntimeMs,
      leaseMs: record.plan.leaseMs,
      baseBackoffMs: record.plan.baseBackoffMs,
      maxBackoffMs: record.plan.maxBackoffMs,
      coalesceMs: record.plan.coalesceMs,
      calls: record.plan.calls,
      maxCostUsd: record.plan.maxCostUsd,
    },
    coverage: record.plan.coverage,
  },
  manifest: {
    partition: manifest.partition,
    jobRunId: manifest.jobRunId,
    planHash: manifest.planHash,
    trigger: manifest.trigger,
    acceptedAt: manifest.acceptedAt,
    deadline: manifest.deadline,
    scope: manifest.scope,
    windows: manifest.windows,
    configuration: {
      version: manifest.configuration.version,
      aiRoute: manifest.configuration.aiRoute,
      aggregateBudgets: manifest.configuration.aggregateBudgets,
    },
    universeVersion: manifest.universe.version,
    orchestration: manifest.orchestration,
    coverage: manifest.coverage,
  },
});

/** Reject a manifest that is valid in isolation but belongs to another execution record. */
export function assertRniWorkerManifestExecutionBinding(
  record: RniExecutionRecord,
  manifestInput: unknown,
): RniWorkerManifest {
  if (record.version !== 'rni-execution-v2') {
    throw new Error('Production RNI execution requires an exact v2 worker manifest');
  }
  const manifest = parseRniWorkerManifest(manifestInput);
  if (
    manifest.runId !== record.run.id ||
    hashRniWorkerManifest(manifest) !== record.runManifestHash
  ) {
    throw new Error('RNI worker manifest does not match the claimed execution identity');
  }
  const binding = canonicalPlanBinding(record, manifest);
  if (hashRniModelInput(binding.record) !== hashRniModelInput(binding.manifest)) {
    throw new Error('RNI worker manifest does not match the immutable execution plan');
  }
  return manifest;
}

/** Construct the governed router input from the exact manifest, never current configuration. */
export function rniImmutableModelRunConfigFromManifest(
  manifestInput: unknown,
): RniImmutableModelRunConfig {
  const manifest = parseRniWorkerManifest(manifestInput);
  return {
    runId: manifest.runId,
    configVersion: manifest.configuration.version,
    aiRoute: manifest.configuration.aiRoute,
    resolvedAt: manifest.acceptedAt,
    resolvedModels: manifest.modelRoutes.map((route) => ({
      task: route.task,
      provider: route.provider,
      modelId: route.configuredModelId,
      canonicalProviderModelId: route.canonicalProviderModelId,
      modelRevision: route.modelRevision,
      promptVersion: route.prompt.version,
      reasoningEffort: 'low',
      capabilitySnapshotId: route.capability.snapshotId,
      capabilityResponseHash: route.capability.responseHash,
      capabilityObservedAt: route.capability.observedAt,
      capabilityExpiresAt: route.capability.expiresAt,
      supportsResponses: true,
      supportsStructuredOutputs: true,
      supportsWebSearch: route.capability.supportsWebSearch,
      policyVersion: 'rni-balanced-model-policy-v1',
      envelope: route.envelope,
    })),
  };
}

function assertDeliveryManifest(
  record: RniExecutionRecord,
  delivery: RniExecutionLease['delivery'] | RniCombinedLease['delivery'],
): string {
  if (
    record.version !== 'rni-execution-v2' ||
    !('runManifestHash' in delivery) ||
    delivery.runManifestHash !== record.runManifestHash
  ) {
    throw new Error('Production RNI worker refuses a delivery without exact v2 manifest authority');
  }
  return digest.parse(delivery.runManifestHash);
}

function fullUniverseArtifact(publication: RniFullUniversePublication): RniCombinedArtifact {
  return combinedArtifact.parse({
    runId: publication.runId,
    planHash: publication.planHash,
    artifactHash: publication.aggregateHash,
    status: publication.status,
  });
}

function assertFullUniversePublicationExecutionAuthority(
  publication: RniFullUniversePublication,
  record: RniExecutionRecord,
  manifest: RniWorkerManifest,
): void {
  const expected = rniFullUniversePublicationAuthorityFromExecution(record, manifest);
  const identity = {
    runId: publication.runId,
    planHash: publication.planHash,
    runManifestHash: publication.runManifestHash,
    universeVersion: publication.universeVersion,
    assessmentCutoffAt: publication.assessmentCutoffAt,
    memberSetHash: publication.memberSetHash,
  } as const;
  const actual: RniFullUniversePublicationAuthority = {
    manifest: {
      ...identity,
      members: publication.members.map(({ ordinal, securityId }) => ({ ordinal, securityId })),
    },
    platforms: {
      reddit: { ...identity, ...publication.platforms.reddit },
      x: { ...identity, ...publication.platforms.x },
    },
  };

  if (hashRniModelInput(actual) !== hashRniModelInput(expected)) {
    throw new Error(
      'Full-universe publication does not match the exact worker manifest and terminal platform slices',
    );
  }
}

async function persistFullUniverse(
  publication: RniFullUniversePublication,
  authority: RniFullUniversePublicationAuthority,
  validator: RniFullUniversePublicationCommitValidator,
  fence: RniCombinedFence,
  committedAt: string,
  tx: RniOrchestrationTransaction,
): Promise<RniCombinedArtifact> {
  const db: Queryable = queryableForRniOrchestrationTransaction(tx);
  await validator.validate(publication, authority, db);
  for (const member of publication.members) {
    await stageRniFullUniversePublicationMember(publication, member.securityId, fence, db);
  }
  return (await finalizeRniFullUniversePublication(publication, fence, committedAt, db)).artifact;
}

/**
 * Manifest-bound lifecycle shell for injected, separately reviewed pipelines. This is not a
 * production composition root and intentionally cannot resolve dependencies from environment.
 * It loads exact immutable authority before provider work, keeps provider work outside DB
 * transactions, and makes full-universe release atomic with the receipt and terminal projection.
 */
export function createManifestBoundRniWorkerExecutor(deps: Readonly<{
  manifests: RniExactWorkerManifestReader;
  compiledAuthority: RniCompiledWorkerAuthorityVerifier;
  fullUniversePublication: RniFullUniversePublicationCommitValidator;
  platform: RniProductionPlatformPipeline;
  combined: RniProductionCombinedPipeline;
}>): RniWorkerExecutor {
  const load = async (
    record: RniExecutionRecord,
    delivery: RniExecutionLease['delivery'] | RniCombinedLease['delivery'],
  ): Promise<{ manifest: RniWorkerManifest; runConfig: RniImmutableModelRunConfig }> => {
    const runManifestHash = assertDeliveryManifest(record, delivery);
    const manifest = assertRniWorkerManifestExecutionBinding(
      record,
      await deps.manifests.load(record.run.id, runManifestHash),
    );
    await deps.compiledAuthority.verify(manifest);
    return { manifest, runConfig: rniImmutableModelRunConfigFromManifest(manifest) };
  };

  return {
    platform: async ({ lease, record, services }) => {
      const { manifest, runConfig } = await load(record, lease.delivery);
      await services.platform.heartbeat(lease);
      const outcome = platformOutcome.parse(
        await deps.platform.execute({
          manifest,
          runConfig,
          lease,
          executionAuthority: {
            stage: lease.delivery.platform,
            attempt: lease.delivery.attempt,
            token: lease.token,
          },
          heartbeat: () => services.platform.heartbeat(lease),
        }),
      );
      await services.platform.finish(lease, outcome);
    },
    combined: async ({ lease, record, services }) => {
      const { manifest, runConfig } = await load(record, lease.delivery);
      const effectFence = await services.combined.effectFence(lease);
      const platformSlices = rniCombinedPlatformSlicesFromExecution(record, manifest);
      const prepared = await deps.combined.prepare({
        manifest,
        runConfig,
        lease,
        effectFence,
        platformSlices,
      });
      if (prepared.kind === 'full_universe') {
        if (manifest.scope.kind !== 'full_universe') {
          throw new Error('Full-universe publication cannot close a ticker execution');
        }
        const publication =
          'version' in prepared.publication
            ? rniFullUniversePublication.parse(prepared.publication)
            : buildRniFullUniversePublication(prepared.publication);
        assertFullUniversePublicationExecutionAuthority(publication, record, manifest);
        const publicationAuthority = rniFullUniversePublicationAuthorityFromExecution(
          record,
          manifest,
        );
        const expected = fullUniverseArtifact(publication);
        await services.combined.commitFullUniversePublication(
          lease,
          expected,
          async (tx, fence, _artifact, committedAt) =>
            persistFullUniverse(
              publication,
              publicationAuthority,
              deps.fullUniversePublication,
              fence,
              committedAt,
              tx,
            ),
        );
        return;
      }
      if (manifest.scope.kind !== 'manual_ticker') {
        throw new Error('Ticker publication cannot close a full-universe execution');
      }
      const artifact = combinedArtifact.parse(prepared.artifact);
      await services.combined.commitPublication(lease, artifact, prepared.publish);
      await services.combined.finish(lease, artifact.artifactHash, prepared.readAccepted);
    },
  };
}
