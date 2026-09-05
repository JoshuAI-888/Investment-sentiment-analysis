import type { Queryable } from '@/repositories/client';
import { loadRniWorkerManifest } from '@/rni/repositories/worker-manifest';
import { validateRniFullUniversePublicationAtCommit } from '@/rni/repositories/full-universe-artifact-selector';
import {
  type RniCompiledWorkerAuthority,
  type RniParsedWorkerAuthorities,
  verifyRniCompiledWorkerAuthority,
} from './worker-authority';
import {
  createManifestBoundRniWorkerExecutor,
  type RniExactWorkerManifestReader,
  type RniPlatformPipelineInput,
  type RniProductionCombinedPipeline,
  type RniProductionPlatformPipeline,
} from './production-executor';
import type { RniWorkerManifest } from './worker-manifest';
import type { RniWorkerExecutor } from './worker';

type CombinedPipelineInput = Parameters<RniProductionCombinedPipeline['prepare']>[0];
type CombinedPipelineOutput = Awaited<ReturnType<RniProductionCombinedPipeline['prepare']>>;

export type RniVerifiedPlatformPipelineInput = RniPlatformPipelineInput &
  Readonly<{ authorities: RniParsedWorkerAuthorities }>;

export type RniVerifiedCombinedPipelineInput = CombinedPipelineInput &
  Readonly<{ authorities: RniParsedWorkerAuthorities }>;

export interface RniVerifiedProductionPlatformPipeline {
  execute(
    input: RniVerifiedPlatformPipelineInput,
  ): ReturnType<RniProductionPlatformPipeline['execute']>;
}

export interface RniVerifiedProductionCombinedPipeline {
  prepare(input: RniVerifiedCombinedPipelineInput): Promise<CombinedPipelineOutput>;
}

export type RniVerifiedProductionExecutorDependencies = Readonly<{
  manifests: RniExactWorkerManifestReader;
  compiledAuthority: RniCompiledWorkerAuthority;
  platform: RniVerifiedProductionPlatformPipeline;
  combined: RniVerifiedProductionCombinedPipeline;
}>;

/**
 * Exact database adapter for the lifecycle shell. Both identifiers originate in the queue
 * delivery; the repository validates them and verifies the stored manifest header, members and
 * authority links before returning anything to a worker.
 */
export function createPostgresRniExactWorkerManifestReader(
  db: Queryable,
): RniExactWorkerManifestReader {
  return {
    load: (runId, runManifestHash) => loadRniWorkerManifest(runId, runManifestHash, db),
  };
}

/**
 * Build the dependency graph without activating it. A parsed authority set becomes available to
 * a provider pipeline only after the complete compiled prompt/schema/tool/build verification has
 * succeeded for that exact manifest object.
 */
export function createVerifiedRniProductionExecutorDependencies(
  input: RniVerifiedProductionExecutorDependencies,
): Omit<Parameters<typeof createManifestBoundRniWorkerExecutor>[0], 'fullUniversePublication'> {
  const verified = new WeakMap<RniWorkerManifest, RniParsedWorkerAuthorities>();

  const requireVerified = (manifest: RniWorkerManifest): RniParsedWorkerAuthorities => {
    const authorities = verified.get(manifest);
    if (authorities === undefined) {
      throw new Error('RNI production pipeline refuses an unverified worker manifest');
    }
    return authorities;
  };

  return {
    manifests: input.manifests,
    compiledAuthority: {
      verify(manifest) {
        const authorities = verifyRniCompiledWorkerAuthority(manifest, input.compiledAuthority);
        verified.set(manifest, authorities);
      },
    },
    platform: {
      execute(request) {
        return input.platform.execute({
          ...request,
          authorities: requireVerified(request.manifest),
        });
      },
    },
    combined: {
      prepare(request) {
        return input.combined.prepare({
          ...request,
          authorities: requireVerified(request.manifest),
        });
      },
    },
  };
}

/**
 * Concrete PostgreSQL composition boundary. This factory performs no environment lookup and does
 * not install itself as the production worker; the caller must supply reviewed provider pipelines
 * and an exact deployment build authority.
 */
export function createPostgresManifestBoundRniWorkerExecutor(
  input: Omit<RniVerifiedProductionExecutorDependencies, 'manifests'> & Readonly<{ db: Queryable }>,
): RniWorkerExecutor {
  return createManifestBoundRniWorkerExecutor(
    {
      ...createVerifiedRniProductionExecutorDependencies({
        manifests: createPostgresRniExactWorkerManifestReader(input.db),
        compiledAuthority: input.compiledAuthority,
        platform: input.platform,
        combined: input.combined,
      }),
      fullUniversePublication: { validate: validateRniFullUniversePublicationAtCommit },
    },
  );
}
