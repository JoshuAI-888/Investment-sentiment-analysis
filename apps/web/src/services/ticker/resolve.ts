/**
 * F09 §4.1: "Resolution goes through the security master by `security.id` — never by ticker
 * string (F03 §4.1). An ambiguous or ineligible symbol is refused with a stated reason, not
 * silently resolved to a guess."
 *
 * `repositories/security.ts` has no `findSecurityBySymbol` that takes a bare symbol with no
 * exchange — its own `findSecurityBySymbol(symbol, exchange)` requires one, because a symbol is
 * reassignable and not unique on its own (F03 §5). The route this feature owns
 * (`/ticker/[symbol]/social`) is given only a symbol, so this module resolves it by reusing
 * `searchSecurities` (already exact-and-prefix matching on `symbol`) and filtering to an exact,
 * case-insensitive match — never inventing a second repository function (SPINE-owned; a
 * `findSecurityBySymbolAcrossExchanges` would belong there, not here).
 */
import type { TickerRefusal } from './contract';
import { searchSecurities, type SecuritySearchResult } from '@/repositories/security';
import type { Queryable } from '@/repositories/client';

export type ResolvedSecurity = SecuritySearchResult;

export type ResolveResult =
  | { readonly ok: true; readonly security: ResolvedSecurity }
  | { readonly ok: false; readonly refusal: TickerRefusal };

/**
 * Round-4 lane-review finding 5: this set and `ui/ticker/SearchBox.tsx`'s ineligibility-badge
 * condition must name the same states — `search.ts`'s own invariant is "search should not
 * surface a result that resolution would then refuse" — and round 3 updated this one without the
 * other, so a delisted (`inactive`) security appeared as an ordinary clickable search result and
 * was then refused on click. They cannot share one constant: `ui/` may import only `contracts/`
 * (`02-ARCHITECTURE-CONTRACTS.md` §3, enforced by `architecture/layer-direction`), and adding a
 * new shared export under `contracts/` is a SPINE-owned change this lane cannot make unilaterally
 * — reported as a cross-lane note rather than made here. **Keep this set and the one in
 * `SearchBox.tsx`'s badge condition identical.**
 */
const INELIGIBLE_STATES = new Set(['unsupported', 'rights_blocked', 'inactive']);

/**
 * `symbol` arrives from a route param, so it is whatever a URL segment can carry — resolution
 * matches case-insensitively (`searchSecurities` already does `ilike`) and rejects an exact
 * match failure as `not_found`, an exchange collision as `ambiguous`, and a security whose
 * `security_profile_snapshot.eligibility_state` is `unsupported`/`rights_blocked`/`inactive` as
 * `ineligible` — `partial`, `ready` and "no profile snapshot yet" (`null`) are all allowed
 * through, since only the first three states are a stated, deliberate refusal upstream (F03 §4.4)
 * rather than an absence of information this page should treat as a block.
 */
export async function resolveTickerSymbol(
  symbol: string,
  asOfInstant: Date,
  db?: Queryable,
): Promise<ResolveResult> {
  const trimmed = symbol.trim();
  if (trimmed === '') {
    return {
      ok: false,
      refusal: { refused: true, reason: 'not_found', message: 'No symbol was given.' },
    };
  }

  const matches = await searchSecurities({ q: trimmed, asOfInstant, limit: 25 }, db);
  const exact = matches.filter((match) => match.symbol.toUpperCase() === trimmed.toUpperCase());

  if (exact.length === 0) {
    return {
      ok: false,
      refusal: {
        refused: true,
        reason: 'not_found',
        message: `No active security is on record for the symbol '${trimmed}'.`,
      },
    };
  }

  if (exact.length > 1) {
    const exchanges = exact.map((match) => match.exchange).join(', ');
    return {
      ok: false,
      refusal: {
        refused: true,
        reason: 'ambiguous',
        message:
          `'${trimmed}' resolves to more than one active security (exchanges: ${exchanges}). ` +
          'A ticker string is not a unique identity (F03 §5) — this page will not guess which one was meant.',
      },
    };
  }

  const security = exact[0] as ResolvedSecurity;
  if (security.eligibilityState !== null && INELIGIBLE_STATES.has(security.eligibilityState)) {
    return {
      ok: false,
      refusal: {
        refused: true,
        reason: 'ineligible',
        message: `'${trimmed}' is marked '${security.eligibilityState}' and is not eligible for this view.`,
      },
    };
  }

  return { ok: true, security };
}
