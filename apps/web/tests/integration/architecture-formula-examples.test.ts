import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { METHOD_REGISTRY } from '../../src/services/calculations';
import { ensureAllExampleArtifacts, ensureExampleArtifact } from '../../src/services/architecture/formula-examples';
import { loadArtifact } from '../../src/services/calculations';
import { loadArchitectureView } from '../../src/services/architecture/view';

const url = databaseUrl();

/**
 * F17 §5 integration case: "formula examples execute the production library and produce a
 * linkable artifact." Every registered method gets a real, persisted `CalculationArtifact`,
 * computed through `computeArtifact`/`persistArtifact` — the same functions every other product
 * surface calls — and readable back through `loadArtifact`, exactly as the Inspector route does.
 */
describe.skipIf(url === undefined)('F17 — formula examples execute the production library', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('every registered method (analytics/registry.ts) gets a real, persisted, linkable artifact', async () => {
    const artifacts = await ensureAllExampleArtifacts(pool);
    const registryEntries = METHOD_REGISTRY.all();

    expect(artifacts).toHaveLength(registryEntries.length);

    for (const artifact of artifacts) {
      // A real row: readable back exactly like any other artifact in the product.
      const reloaded = await loadArtifact(artifact.calculationId, pool);
      expect(reloaded).not.toBeNull();
      expect(reloaded?.calculationId).toBe(artifact.calculationId);
      expect(reloaded?.methodId).toBe(artifact.methodId);
      expect(reloaded?.methodVersion).toBe(artifact.methodVersion);
      // Permanently referenced by the catalogue — never subject to the 90-day standard expiry.
      expect(reloaded?.retentionClass).toBe('permanent');
    }

    const registryKeys = new Set(registryEntries.map((e) => `${e.id}@${e.version}`));
    const artifactKeys = new Set(artifacts.map((a) => `${a.methodId}@${a.methodVersion}`));
    expect(artifactKeys).toEqual(registryKeys);
  });

  it('is idempotent: a second call finds the first call\'s row rather than computing or inserting again', async () => {
    const entry = METHOD_REGISTRY.latest('attention.mention_delta');
    const first = await ensureExampleArtifact(entry, pool);
    const second = await ensureExampleArtifact(entry, pool);

    expect(second.calculationId).toBe(first.calculationId);
    expect(second.inputHash).toBe(first.inputHash);
    expect(second.resultHash).toBe(first.resultHash);

    const { rows } = await pool.query('select count(*)::int as n from calculation_snapshot where id = $1', [
      first.calculationId,
    ]);
    expect(rows[0]?.n).toBe(1);
  });

  it('attention.rank_change gets a distinct, real example per registered version (1.0.0 and 1.1.0)', async () => {
    const v1 = METHOD_REGISTRY.get('attention.rank_change', '1.0.0');
    const v11 = METHOD_REGISTRY.get('attention.rank_change', '1.1.0');
    const a1 = await ensureExampleArtifact(v1, pool);
    const a11 = await ensureExampleArtifact(v11, pool);

    expect(a1.calculationId).not.toBe(a11.calculationId);
    expect(a1.methodVersion).toBe('1.0.0');
    expect(a11.methodVersion).toBe('1.1.0');
  });

  it('the Architecture Explorer view resolves a working catalogue, one entry per registry entry, each linking to a real artifact', async () => {
    const view = await loadArchitectureView(pool);
    expect(view.databaseAvailable).toBe(true);
    expect(view.catalogue).toHaveLength(METHOD_REGISTRY.all().length);

    for (const entry of view.catalogue) {
      expect(entry.example.href).toBe(`/calculations/${entry.example.calculationId}`);
      const artifact = await loadArtifact(entry.example.calculationId, pool);
      expect(artifact).not.toBeNull();
    }
  });
});
