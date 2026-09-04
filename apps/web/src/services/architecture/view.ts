/**
 * F17 — assembling what `/architecture` and `/architecture/calculations` render.
 *
 * Mirrors `services/admin/reads.ts`'s own role for its lane: the only place `app/` reaches for
 * this feature's data, so every page stays a thin Server Component. Built independently of that
 * module — see `projection.ts`'s own doc comment for why.
 *
 * **The manifest itself needs no database.** Topology, PoV/target, glossary, opportunities and
 * the no-backtest statement are code, not data — F17 §4.4's "static content reaches first
 * meaningful paint < 2s" is true of the whole page except the two sections that genuinely
 * require a live read: the active-configuration panel (public-safe projection) and the
 * catalogue's worked examples (real, persisted artifacts). `databaseAvailable` tells the page
 * which of those two to render as an honest "no database configured" state, exactly like F05's
 * `InspectorPage` — never a fabricated projection or a fabricated artifact.
 */
import { getPool, type Queryable } from '@/repositories/client';
import { METHOD_REGISTRY } from '@/services/calculations';
import type { CalculationArtifact } from '@/calc/artifact';
import { ARCHITECTURE_MANIFEST, type ArchitectureManifest } from './manifest';
import { getArchitectureProjection, type ArchitectureProjection } from './projection';
import { ensureAllExampleArtifacts } from './formula-examples';
import { buildCatalogue, catalogueKey, type CatalogueEntry } from './catalogue';

export type ArchitectureView = {
  readonly manifest: ArchitectureManifest;
  readonly databaseAvailable: boolean;
  readonly projection: ArchitectureProjection | null;
  readonly catalogue: readonly CatalogueEntry[];
};

function latestVersionsByMethodId(): ReadonlyMap<string, string> {
  const ids = new Set(METHOD_REGISTRY.all().map((entry) => entry.id));
  return new Map([...ids].map((id) => [id, METHOD_REGISTRY.latest(id).version]));
}

/**
 * `db` is optional, not defaulted to `getPool()` in the parameter list — a default expression
 * evaluates when the argument is omitted, before this function's own body runs, so a bare
 * `db: Queryable = getPool()` would throw on the very "no database configured" case the guard
 * below exists to handle gracefully. `getPool()` is called explicitly, only after that guard,
 * only when a database is actually configured.
 */
export async function loadArchitectureView(db?: Queryable): Promise<ArchitectureView> {
  if (!process.env['DATABASE_URL']) {
    return { manifest: ARCHITECTURE_MANIFEST, databaseAvailable: false, projection: null, catalogue: [] };
  }
  const resolvedDb = db ?? getPool();

  const [projection, artifacts] = await Promise.all([
    getArchitectureProjection(resolvedDb),
    ensureAllExampleArtifacts(resolvedDb),
  ]);

  const artifactsByKey = new Map<string, CalculationArtifact>(
    artifacts.map((artifact) => [catalogueKey(artifact.methodId, artifact.methodVersion), artifact]),
  );

  const catalogue = buildCatalogue(METHOD_REGISTRY.all(), latestVersionsByMethodId(), artifactsByKey);

  return { manifest: ARCHITECTURE_MANIFEST, databaseAvailable: true, projection, catalogue };
}
