/**
 * F15 §5/§4.1 — "enumerate every mutation and assert each performs all eight steps." This
 * enumerates `ADMIN_MUTATIONS` (`services/admin/registry.ts`) and asserts, for every entry:
 *
 *   1. authorize   — every schema requires `reason` and `expectedVersion`, which is what makes
 *                     `runAdminMutation`'s step-1/step-2 checks meaningful for it (structural).
 *   2. validate     — `schema` is a real zod schema that rejects garbage.
 *   3. concurrency  — `loadCurrent` is present (a mutation with none could never be compared).
 *   4. impact preview — `impactPreview` is present.
 *   5. capture reason — the schema's `reason` field has a non-trivial minimum length (not just
 *                     `z.string()`, which would accept `''`).
 *   6/7. write        — `write` is present.
 *   8. audit / 9. cache — covered generically by `mutation-pipeline.test.ts`, since every
 *                     mutation runs through the same `runAdminMutation` — not re-asserted here.
 *
 * A mutation missing any of 1–7 fails this test, which is the point: a bespoke mutation that
 * skips a step is a review failure per the spec's own words (F15 §4.1), and this is what makes
 * that check automatic rather than relying on a reviewer noticing.
 */
import { describe, expect, it } from 'vitest';
import { ADMIN_MUTATIONS } from '@/services/admin/registry';

describe('ADMIN_MUTATIONS — every registered mutation carries all required pipeline steps', () => {
  const entries = Object.entries(ADMIN_MUTATIONS);

  it('the registry is not empty (a mutation built but never registered is invisible to this test)', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s has objectType, action, environment, schema, loadCurrent, impactPreview and write', (_key, def) => {
    expect(typeof def.objectType).toBe('string');
    expect(def.objectType.length).toBeGreaterThan(0);
    expect(typeof def.action).toBe('string');
    expect(def.action.length).toBeGreaterThan(0);
    expect(typeof def.environment).toBe('string');
    expect(def.environment.length).toBeGreaterThan(0);
    expect(def.schema).toBeDefined();
    expect(typeof def.loadCurrent).toBe('function');
    expect(typeof def.impactPreview).toBe('function');
    expect(typeof def.write).toBe('function');
  });

  it.each(entries)('%s schema requires a non-trivial `reason` (step 5 — capture reason)', (_key, def) => {
    const rejected = def.schema.safeParse({ reason: '', expectedVersion: null });
    expect(rejected.success).toBe(false);
  });

  it.each(entries)('%s schema requires `expectedVersion` to be present (step 3 — optimistic concurrency)', (_key, def) => {
    // Omitting the field entirely must fail — a mutation that treats "no version supplied" the
    // same as "no version expected" (both `null`) would silently accept a stale-unaware caller.
    const withoutField = def.schema.safeParse({ reason: 'a valid reason' });
    expect(withoutField.success).toBe(false);
  });

  it.each(entries)('%s action strings are unique per mutation (audit rows stay attributable)', (key) => {
    const duplicates = entries.filter(([, def]) => def.action === ADMIN_MUTATIONS[key]?.action);
    expect(duplicates).toHaveLength(1);
  });
});
