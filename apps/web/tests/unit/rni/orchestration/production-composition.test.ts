import { describe, expect, it, vi } from 'vitest';

import type { Queryable } from '@/repositories/client';
import {
  createPostgresManifestBoundRniWorkerExecutor,
  createPostgresRniExactWorkerManifestReader,
  createVerifiedRniProductionExecutorDependencies,
} from '@/rni/orchestration/production-composition';
import type { RniExecutionRecord } from '@/rni/orchestration/types';
import type { RniWorkerServices } from '@/rni/orchestration/worker';
import type { RniWorkerManifest } from '@/rni/orchestration/worker-manifest';
import type { RniParsedWorkerAuthorities } from '@/rni/orchestration/worker-authority';
import type * as WorkerAuthorityModule from '@/rni/orchestration/worker-authority';
import { loadRniWorkerManifest } from '@/rni/repositories/worker-manifest';
import type * as WorkerManifestRepositoryModule from '@/rni/repositories/worker-manifest';
import { verifyRniCompiledWorkerAuthority } from '@/rni/orchestration/worker-authority';

vi.mock('@/rni/repositories/worker-manifest', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerManifestRepositoryModule>()),
  loadRniWorkerManifest: vi.fn(),
}));

vi.mock('@/rni/orchestration/worker-authority', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerAuthorityModule>()),
  verifyRniCompiledWorkerAuthority: vi.fn(),
}));

const digest = (character: string): string => character.repeat(64);
const manifest = { runId: '10000000-0000-4000-8000-000000000001' } as RniWorkerManifest;
const otherManifest = { runId: '10000000-0000-4000-8000-000000000002' } as RniWorkerManifest;
const authorities = { sourceConfiguration: {} } as RniParsedWorkerAuthorities;
const compiledAuthority = { build: {} } as never;

describe('production worker composition', () => {
  it('adapts only the exact run and manifest hash into the database reader', async () => {
    const db = { query: vi.fn() } as unknown as Queryable;
    vi.mocked(loadRniWorkerManifest).mockResolvedValueOnce(manifest);

    const loaded = await createPostgresRniExactWorkerManifestReader(db).load(
      manifest.runId,
      digest('a'),
    );

    expect(loaded).toBe(manifest);
    expect(loadRniWorkerManifest).toHaveBeenCalledWith(manifest.runId, digest('a'), db);
  });

  it('exposes typed authority only after compiled verification of the exact manifest', async () => {
    const platform = {
      execute: vi.fn(async () => ({
        status: 'unavailable' as const,
        errorCode: 'PROVIDER_UNAVAILABLE' as const,
      })),
    };
    const combined = { prepare: vi.fn() };
    const dependencies = createVerifiedRniProductionExecutorDependencies({
      manifests: { load: vi.fn() },
      compiledAuthority,
      platform,
      combined,
    });
    const platformRequest = { manifest } as never;

    expect(() => dependencies.platform.execute(platformRequest)).toThrow(
      'unverified worker manifest',
    );
    expect(platform.execute).not.toHaveBeenCalled();

    vi.mocked(verifyRniCompiledWorkerAuthority).mockReturnValueOnce(authorities);
    await dependencies.compiledAuthority.verify(manifest);
    await dependencies.platform.execute(platformRequest);

    expect(verifyRniCompiledWorkerAuthority).toHaveBeenCalledWith(manifest, compiledAuthority);
    expect(platform.execute).toHaveBeenCalledWith({ manifest, authorities });
    expect(() => dependencies.platform.execute({ manifest: otherManifest } as never)).toThrow(
      'unverified worker manifest',
    );
  });

  it('does not cache authority when compiled verification fails', async () => {
    const combined = { prepare: vi.fn() };
    const dependencies = createVerifiedRniProductionExecutorDependencies({
      manifests: { load: vi.fn() },
      compiledAuthority,
      platform: { execute: vi.fn() },
      combined,
    });
    vi.mocked(verifyRniCompiledWorkerAuthority).mockImplementationOnce(() => {
      throw new Error('crossed compiled build');
    });

    expect(() => dependencies.compiledAuthority.verify(manifest)).toThrow('crossed compiled build');
    expect(() => dependencies.combined.prepare({ manifest } as never)).toThrow(
      'unverified worker manifest',
    );
    expect(combined.prepare).not.toHaveBeenCalled();
  });

  it('keeps the concrete PostgreSQL executor fail-closed on legacy delivery', async () => {
    const db = { query: vi.fn() } as unknown as Queryable;
    const platform = { execute: vi.fn() };
    const executor = createPostgresManifestBoundRniWorkerExecutor({
      db,
      compiledAuthority,
      platform,
      combined: { prepare: vi.fn() },
    });
    const record = {
      version: 'rni-execution-v2',
      runManifestHash: digest('a'),
    } as RniExecutionRecord;
    const lease = {
      delivery: {
        version: 'rni-platform-v1',
        runId: manifest.runId,
        platform: 'reddit',
        planHash: digest('b'),
        deliveryKey: 'legacy-delivery',
        attempt: 1,
      },
      token: '20000000-0000-4000-8000-000000000001',
    } as const;

    await expect(
      executor.platform({ lease, record, services: {} as RniWorkerServices }),
    ).rejects.toThrow('exact v2 manifest authority');
    expect(db.query).not.toHaveBeenCalled();
    expect(platform.execute).not.toHaveBeenCalled();
  });
});
