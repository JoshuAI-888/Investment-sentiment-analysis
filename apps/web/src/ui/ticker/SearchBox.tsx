'use client';

/**
 * F09 §4.5 — `GET /api/search?q=`. "No provider call per keystroke — the catalogue is local."
 * This component only ever calls this app's own `/api/search` route (never an adapter or an
 * external URL), and that route itself only reads `security`/`security_profile_snapshot`
 * (`services/ticker/search.ts`) — so a keystroke here cannot reach a paid provider by
 * construction, not merely by convention.
 */
import { useEffect, useState } from 'react';

type SearchResult = {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly eligibilityState: string | null;
};

const DEBOUNCE_MS = 200;

/**
 * Round-4 lane-review finding 5: pulled out to its own named, exported predicate so a plain unit
 * test can pin it against `services/ticker/resolve.ts`'s `INELIGIBLE_STATES` without needing
 * jsdom/`renderToStaticMarkup` — this codebase has no test infrastructure for a client
 * component's hooks/effects, but a pure function needs none. Must be kept identical to
 * `resolve.ts`'s set (`search.ts`'s own invariant: "search should not surface a result that
 * resolution would then refuse") — see the comment on that constant for why they cannot share one
 * module (`ui/` may import only `contracts/`, `architecture/layer-direction`).
 */
export function isIneligibleForDisplay(eligibilityState: string | null): boolean {
  return eligibilityState === 'unsupported' || eligibilityState === 'rights_blocked' || eligibilityState === 'inactive';
}

type SearchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'results'; readonly results: readonly SearchResult[] }
  // Round-3 lane-review finding 5: round 2 stopped the crash but rendered nothing for both a
  // fetch failure and a genuine zero-match query — pixel-identical, so a user with an expired
  // session sees the same "nothing appeared" as a user who searched for a ticker that does not
  // exist. This state is the honest third option: still no fabricated results, but a stated,
  // visible reason distinct from "no matches".
  | { readonly kind: 'error' };

export function SearchBox() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });

  useEffect(() => {
    if (query.trim() === '') {
      setState({ kind: 'idle' });
      return;
    }
    const handle = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then(async (response): Promise<SearchState> => {
          if (!response.ok) return { kind: 'error' };
          const body = (await response.json()) as { results: readonly SearchResult[] };
          return { kind: 'results', results: body.results };
        })
        .then((next) => setState(next))
        .catch(() => setState({ kind: 'error' }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div data-search-box="">
      <label htmlFor="ticker-search" className="sr-only">
        Search securities
      </label>
      <input
        id="ticker-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search symbol or company"
        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        data-search-input=""
      />
      {state.kind === 'error' ? (
        <p className="mt-2 text-sm text-red-700" data-search-error="">
          Search is unavailable right now. Try refreshing the page.
        </p>
      ) : state.kind === 'results' && state.results.length > 0 ? (
        <ul className="mt-2 divide-y divide-neutral-200 rounded border border-neutral-200" data-search-results="">
          {state.results.map((result) => (
            <li key={result.id} data-search-result={result.symbol} data-search-eligibility={result.eligibilityState ?? 'unknown'}>
              <a
                className="block px-3 py-2 text-sm hover:bg-neutral-50"
                href={`/ticker/${result.symbol}/social`}
              >
                <span className="font-semibold">{result.symbol}</span> — {result.name} ({result.exchange})
                {isIneligibleForDisplay(result.eligibilityState) ? (
                  <span className="ml-2 text-xs text-amber-700">not eligible: {result.eligibilityState}</span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
