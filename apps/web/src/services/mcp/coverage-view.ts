/**
 * Projects `repositories/coverage.ts#coverageWindowFor` + `calc/coverage.ts`'s pure arithmetic
 * into `McpCoverageEntry` — the compact, inline-in-every-envelope shape (`contract.ts`). Mirrors
 * `services/ticker/coverage.ts` (F09), which binds the same two modules for the ticker page; this
 * is F21's equivalent binding, not a re-derivation of either.
 */
import { floorDisclosure } from '@/calc/coverage';
import type { CoverageAxis } from '@/contracts/coverage';
import { coverageWindowFor } from '@/repositories/coverage';
import type { Queryable } from '@/repositories/client';
import type { McpCoverageEntry } from './contract';

export async function coverageEntryFor(
  axis: CoverageAxis,
  db?: Queryable,
): Promise<McpCoverageEntry> {
  const window = await coverageWindowFor(axis, db);
  if (window === null) {
    return {
      axis,
      startedAt: null,
      gapCount: 0,
      disclosure: `no coverage floor is recorded yet for ${axis} — the collector has not reported a start`,
    };
  }
  return {
    axis,
    startedAt: window.startedAt.toISOString(),
    gapCount: window.gaps.length,
    disclosure: floorDisclosure(axis, window.startedAt),
  };
}

export async function coverageEntriesFor(
  axes: readonly CoverageAxis[],
  db?: Queryable,
): Promise<readonly McpCoverageEntry[]> {
  return Promise.all(axes.map((axis) => coverageEntryFor(axis, db)));
}
