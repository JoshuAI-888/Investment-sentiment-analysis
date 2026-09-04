'use client';

/**
 * F17 §4.5 — the searchable calculation catalogue's client-side filter.
 *
 * All data is already resolved server-side (`services/architecture/catalogue.ts`'s
 * `buildCatalogue`, from the real registry and real persisted artifacts) and passed in as props
 * — this component only filters an already-fetched list, so there is no fetch, no loading state,
 * and nothing here can render an entry the server did not already build from the live registry.
 *
 * `ui/` may import only `contracts/`, so the filter predicate is written locally rather than
 * imported from `services/architecture/catalogue.ts`'s own `searchCatalogue` — small, deliberate
 * duplication over a layer violation.
 */
import { useMemo, useState } from 'react';
import { FormulaCard, type FormulaCardProps } from './FormulaCard';

export type CatalogueBrowserProps = {
  readonly entries: readonly FormulaCardProps[];
};

function searchableText(entry: FormulaCardProps): string {
  return [entry.methodId, entry.title, entry.symbolicFormula, entry.subjectKind, ...entry.limitations, ...entry.eligibilityRules]
    .join(' ')
    .toLowerCase();
}

export function CatalogueBrowser({ entries }: CatalogueBrowserProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed === '') return entries;
    return entries.filter((entry) => searchableText(entry).includes(trimmed));
  }, [entries, query]);

  return (
    <div data-catalogue-browser="">
      <label htmlFor="catalogue-search" className="block text-sm font-medium">
        Search the calculation catalogue
      </label>
      <input
        id="catalogue-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name, formula, or id — e.g. rsi, stance, sector breadth"
        className="mt-1 w-full max-w-md rounded border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        data-catalogue-search-input=""
      />
      <p className="mt-1 text-xs text-neutral-500" role="status" data-result-count={filtered.length}>
        {filtered.length} of {entries.length} registered methods
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2" data-catalogue-results="">
        {filtered.map((entry) => (
          <FormulaCard key={`${entry.methodId}@${entry.version}`} {...entry} />
        ))}
      </div>
    </div>
  );
}
