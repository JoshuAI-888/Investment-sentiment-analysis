/**
 * F21 §4.3 — catalogue generation. *"Tool schemas are generated from `MethodRegistry`, not
 * hand-written: `methodId` → tool name; `symbolicFormula` and `title` → description;
 * `limitations[]` → the result's `limitations[]`; `eligibilityRules` → the `whenToUse` text. A
 * metric added to the registry appears in the catalogue with no code change. A registry entry
 * with no `whenToUse` derivation fails the build."*
 *
 * **What "no `whenToUse` derivation" means in this codebase's real registry.** The idealized
 * `MethodRegistryEntry` in `02-ARCHITECTURE-CONTRACTS.md` §4.3 carries an `inputSchema` field;
 * the real one built by F05 (`calc/registry.ts#methodDescriptor`) does not — every method here
 * computes from stored rows, not from caller-supplied parameters, so there is no per-metric
 * input schema to translate. `whenToUse` is derived from `eligibilityRules` instead (per this
 * section's own second sentence, which names that field as the source) — an entry whose
 * `eligibilityRules` is empty has nothing to derive a `whenToUse` from, so `buildDescriptors`
 * below throws for one exactly the way `services/calculations.ts#bindRegistry` already throws
 * on a compute/descriptor mismatch. Since `METHOD_REGISTRY` (and, transitively, this module) is
 * built once at import time, that throw fails `pnpm build`/`pnpm typecheck`'s module graph and
 * every test that imports this file — literally "fails the build", not a runtime 500.
 *
 * **Relationship to the 8 named tools in F21 §4.2's table.** Those eight
 * (`get_ticker_sentiment`, `compare_platforms`, `explain_spike`, `get_historical_window`,
 * `list_supporting_evidence`, `list_contradicting_evidence`, `open_calculation`, `get_coverage`)
 * are the product-facing capability surface and are hand-defined in `tools/`. This module
 * generates a *second*, additive set — one tool per unique registered metric — because §4.3's own
 * DoD test ("Add a throwaway registry entry; confirm a tool appears with no code change") is
 * about a single *tool*, and `get_ticker_sentiment` bundles many metrics into one call rather
 * than adding a tool per metric. The generated set is what makes that DoD test literally true;
 * the eight named tools are what makes §4.2's table true. `tests/unit/services/mcp/
 * catalogue.test.ts` is the registry-drift test for the generated half.
 */
import { METHOD_REGISTRY } from '@/services/calculations';
import type { MethodRegistryEntry } from '@/calc/registry';
import type { MethodRegistry } from '@/calc/registry';
import { mustNotClaimLines } from './must-not-claim';

export class CatalogueBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogueBuildError';
  }
}

export type GeneratedMetricTool = {
  /** `metric.<methodId with '.' replaced by '_'>` — MCP tool names are conventionally `[a-zA-Z0-9_-]+`; a bare `.` is legal in the JSON-RPC payload but several MCP hosts constrain tool names, so this stays conservative. */
  readonly name: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly title: string;
  readonly symbolicFormula: string;
  readonly description: string;
  /** Derived from `eligibilityRules` — F21 §4.3's own words for the source field. */
  readonly whenToUse: string;
  readonly limitations: readonly string[];
  readonly mustNotClaim: readonly string[];
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: { readonly symbol: { readonly type: 'string'; readonly description: string } };
    readonly required: readonly ['symbol'];
    readonly additionalProperties: false;
  };
};

function toolNameFor(methodId: string): string {
  return `metric.${methodId.replace(/\./g, '_')}`;
}

/** §4.3: "`eligibilityRules` → the `whenToUse` text." Throws when there is nothing to derive from. */
function whenToUseFor(entry: Pick<MethodRegistryEntry, 'id' | 'eligibilityRules'>): string {
  if (entry.eligibilityRules.length === 0) {
    throw new CatalogueBuildError(
      `Registry entry '${entry.id}' has no eligibilityRules — F21 §4.3 derives a tool's ` +
        "'whenToUse' text from that field, and an entry with none has nothing to derive it " +
        'from. A registry entry lacking a whenToUse derivation fails the build (§4.3, §6 DoD).',
    );
  }
  return entry.eligibilityRules.join(' ');
}

function descriptorFor(entry: MethodRegistryEntry): GeneratedMetricTool {
  return {
    name: toolNameFor(entry.id),
    methodId: entry.id,
    methodVersion: entry.version,
    title: entry.title,
    symbolicFormula: entry.symbolicFormula,
    description: `${entry.title} — ${entry.symbolicFormula}`,
    whenToUse: whenToUseFor(entry),
    limitations: [...entry.limitations],
    mustNotClaim: mustNotClaimLines(entry),
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'The security\'s ticker symbol, e.g. "GME".' },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  };
}

/** One entry per unique `methodId`, at its latest registered version. Pure function of the registry passed in — no module-level singleton — so the registry-drift test can pass a registry one entry larger without touching this module. */
export function buildMetricCatalogue(registry: MethodRegistry): readonly GeneratedMetricTool[] {
  const seen = new Set<string>();
  const out: GeneratedMetricTool[] = [];
  for (const entry of registry.all()) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(descriptorFor(registry.latest(entry.id)));
  }
  return out.sort((a, b) => (a.methodId < b.methodId ? -1 : a.methodId > b.methodId ? 1 : 0));
}

/**
 * The application's generated catalogue, built once at module load against the real
 * `METHOD_REGISTRY` — so a bad entry (empty `eligibilityRules`) fails at import time, the same
 * "drift fails at startup" guarantee `services/calculations.ts#METHOD_REGISTRY` itself documents.
 */
export const METRIC_TOOL_CATALOGUE: readonly GeneratedMetricTool[] = buildMetricCatalogue(METHOD_REGISTRY);

export function findMetricTool(name: string): GeneratedMetricTool | undefined {
  return METRIC_TOOL_CATALOGUE.find((tool) => tool.name === name);
}
