/**
 * F17 §4.5 — the searchable calculation catalogue.
 *
 * Combines the method registry (`analytics/registry.ts`, via `services/calculations.ts`'s
 * `METHOD_REGISTRY`) with each method's real worked example (`formula-examples.ts`). Nothing
 * here computes anything or invents a value — this module only shapes what the registry and the
 * artifact already say into one searchable entry per method.
 */
import type { MethodRegistryEntry } from '@/calc/registry';
import type { CalculationArtifact } from '@/calc/artifact';

/**
 * `ui/inspector-links.ts`'s own `inspectorHref`, duplicated rather than imported: `services/`
 * may import only `contracts/`, `repositories/`, `adapters/`, `analytics/`, `calc/`, `agent/`
 * (`02-ARCHITECTURE-CONTRACTS.md` §3; `eslint-rules/layers.ts`), never `ui/` — the dependency
 * points the other way. One line of duplication over a layer violation.
 */
function inspectorHref(calculationId: string): string {
  return `/calculations/${encodeURIComponent(calculationId)}`;
}

export type CatalogueEntry = {
  readonly methodId: string;
  readonly version: string;
  readonly title: string;
  readonly subjectKind: string;
  readonly unit: string;
  readonly symbolicFormula: string;
  readonly officialAssumptions: Readonly<Record<string, string>>;
  readonly eligibilityRules: readonly string[];
  readonly limitations: readonly string[];
  readonly failureBehaviour: string;
  readonly tierD4Record: string | null;
  readonly isLatestVersion: boolean;
  readonly example: {
    readonly calculationId: string;
    readonly href: string;
    readonly eligibility: CalculationArtifact['eligibility'];
    readonly display: string | null;
    readonly unit: string;
    readonly roundingRule: string;
    readonly abstentionReason: string | null;
  };
};

export function buildCatalogue(
  registryEntries: readonly MethodRegistryEntry[],
  latestVersionByMethodId: ReadonlyMap<string, string>,
  artifactsByKey: ReadonlyMap<string, CalculationArtifact>,
): readonly CatalogueEntry[] {
  return registryEntries
    .map((entry): CatalogueEntry | null => {
      const artifact = artifactsByKey.get(`${entry.id}@${entry.version}`);
      if (artifact === undefined) return null;
      return {
        methodId: entry.id,
        version: entry.version,
        title: entry.title,
        subjectKind: entry.subjectKind,
        unit: entry.unit,
        symbolicFormula: entry.symbolicFormula,
        officialAssumptions: entry.officialAssumptions,
        eligibilityRules: entry.eligibilityRules,
        limitations: entry.limitations,
        failureBehaviour: entry.failureBehaviour,
        tierD4Record: entry.tierD4Record ?? null,
        isLatestVersion: latestVersionByMethodId.get(entry.id) === entry.version,
        example: {
          calculationId: artifact.calculationId,
          href: inspectorHref(artifact.calculationId),
          eligibility: artifact.eligibility,
          display: artifact.result?.display ?? null,
          unit: artifact.result?.unit ?? entry.unit,
          roundingRule: artifact.result?.roundingRule ?? entry.roundingRule,
          abstentionReason: artifact.abstention?.message ?? null,
        },
      };
    })
    .filter((entry): entry is CatalogueEntry => entry !== null)
    .sort((a, b) => a.title.localeCompare(b.title) || a.version.localeCompare(b.version));
}

/** A stable id per catalogue map entry — `methodId@version`, matching the registry's own key. */
export function catalogueKey(methodId: string, version: string): string {
  return `${methodId}@${version}`;
}

const searchableText = (entry: CatalogueEntry): string =>
  [
    entry.methodId,
    entry.title,
    entry.symbolicFormula,
    entry.subjectKind,
    ...entry.limitations,
    ...entry.eligibilityRules,
  ]
    .join(' ')
    .toLowerCase();

/** Plain case-insensitive substring search across id, title, formula, subject kind, and prose. */
export function searchCatalogue(
  entries: readonly CatalogueEntry[],
  query: string,
): readonly CatalogueEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return entries;
  return entries.filter((entry) => searchableText(entry).includes(trimmed));
}
