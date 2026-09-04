import { describe, expect, it } from 'vitest';
import { MethodRegistry, type MethodRegistryEntry } from '../../../../src/calc/registry';
import { METHOD_REGISTRY } from '../../../../src/services/calculations';
import { buildMetricCatalogue, CatalogueBuildError } from '../../../../src/services/mcp/catalogue';

/**
 * F21 §4.3's own DoD test: "Add a throwaway registry entry; confirm a tool appears with no code
 * change. Remove its `whenToUse`; confirm the build fails." §7 PR review step 5, verbatim.
 *
 * This codebase's real registry has no `inputSchema`/`whenToUse` field (`catalogue.ts`'s own
 * header explains why) — `whenToUse` is derived from `eligibilityRules`, so "remove its
 * whenToUse" is exercised here as "give it an empty `eligibilityRules` array", the literal
 * equivalent in this registry's real shape.
 */

function throwawayEntry(overrides: Partial<MethodRegistryEntry> = {}): MethodRegistryEntry {
  const base = METHOD_REGISTRY.latest('price.regime');
  return {
    ...base,
    id: 'throwaway.test_metric',
    version: '1.0.0',
    title: 'Throwaway test metric',
    eligibilityRules: ['Always computable, for this test only.'],
    limitations: ['This entry exists only to prove the catalogue is registry-driven.'],
    ...overrides,
  };
}

describe('F21 §4.3 — catalogue generation is registry-driven', () => {
  it('produces one generated tool per unique registered methodId, at its latest version', () => {
    const catalogue = buildMetricCatalogue(METHOD_REGISTRY);
    const uniqueMethodIds = new Set(METHOD_REGISTRY.all().map((entry) => entry.id));
    expect(catalogue).toHaveLength(uniqueMethodIds.size);

    // attention.rank_change has two registered versions (1.0.0, 1.1.0) — the generated tool must
    // bind to the latest, exactly as `METHOD_REGISTRY.latest()` would for a fresh computation.
    const rankChangeTool = catalogue.find((tool) => tool.methodId === 'attention.rank_change');
    expect(rankChangeTool?.methodVersion).toBe(METHOD_REGISTRY.latest('attention.rank_change').version);
  });

  it('adding a throwaway registry entry adds one tool, with no change to buildMetricCatalogue itself', () => {
    const before = buildMetricCatalogue(METHOD_REGISTRY).length;

    const widened = new MethodRegistry([...METHOD_REGISTRY.all(), throwawayEntry()]);
    const after = buildMetricCatalogue(widened);

    expect(after.length).toBe(before + 1);
    const added = after.find((tool) => tool.methodId === 'throwaway.test_metric');
    expect(added).toBeDefined();
    expect(added?.name).toBe('metric.throwaway_test_metric');
    expect(added?.whenToUse).toBe('Always computable, for this test only.');
  });

  it('a registry entry with no eligibilityRules (no whenToUse derivation) fails the build', () => {
    const widened = new MethodRegistry([...METHOD_REGISTRY.all(), throwawayEntry({ eligibilityRules: [] })]);
    expect(() => buildMetricCatalogue(widened)).toThrow(CatalogueBuildError);
    expect(() => buildMetricCatalogue(widened)).toThrow(/eligibilityRules/);
  });

  it('every generated tool carries a non-empty mustNotClaim (§4.5 — every metric renders the §6.4 line until it has a Tier D4 record)', () => {
    const catalogue = buildMetricCatalogue(METHOD_REGISTRY);
    expect(catalogue.length).toBeGreaterThan(0);
    for (const tool of catalogue) {
      expect(tool.mustNotClaim.length).toBeGreaterThan(0);
      expect(tool.mustNotClaim[0]).toContain('not a forecast');
    }
  });

  it('every generated tool input schema requires exactly {symbol}', () => {
    const catalogue = buildMetricCatalogue(METHOD_REGISTRY);
    for (const tool of catalogue) {
      expect(tool.inputSchema.required).toEqual(['symbol']);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });
});
