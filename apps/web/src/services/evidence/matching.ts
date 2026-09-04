/**
 * The deterministic half of F10 §4.2's relevance rule: *"exact-symbol match, company-name
 * match, and a ticker-collision guard for ambiguous tokens (`AI`, `ON`, `IT`, `ALL`) that
 * requires a corroborating company-name or cashtag reference."*
 *
 * Pure — no I/O, no LLM call, no clock. Deliberately importable from anywhere, including a
 * future `calc/` consumer, though nothing here does that today. `entity-collision.ts` and
 * `relevance.ts` are the ones that decide *what to do* with a `DeterministicVerdict` — whether
 * to call the LLM at all, and for which of the two registered methods.
 */
import type { Security } from '@/contracts/security';

/**
 * The four tokens named in the spec, plus a documented extension point. Ambiguity is a property
 * of a *symbol* being an ordinary English word or common abbreviation — `AI` (C3.ai), `ON` (ON
 * Semiconductor), `IT` (Gartner), `ALL` (Allstate) — not a fixed vocabulary unrelated to any
 * particular security. A symbol not in this set is never treated as ambiguous, whatever the
 * surrounding text says.
 */
export const AMBIGUOUS_TICKERS: ReadonlySet<string> = new Set(['AI', 'ON', 'IT', 'ALL']);

export type MatchVia = 'cashtag' | 'symbol' | 'company_name' | 'alias' | 'none';

export type DeterministicVerdict = {
  /** Any signal — cashtag, bare symbol, company name, or alias — fired. */
  readonly matched: boolean;
  readonly matchedVia: MatchVia;
  /** True only when the *matching* signal is a bare symbol token for an ambiguous ticker. */
  readonly ambiguous: boolean;
  /**
   * True when the match needs no further check: a cashtag, a company-name hit, an alias hit, or
   * a bare-symbol hit for a *non*-ambiguous ticker. False only for the one case the spec's
   * collision guard exists to resolve — a bare ambiguous token with no corroborating signal in
   * the same text — which is the signal `entity-collision.ts` uses to decide whether to spend an
   * LLM call at all.
   */
  readonly corroborated: boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary match on alphanumerics, so `IT` does not fire inside `CREDIT` or `WAIT`. */
function tokenRegex(token: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(token)}(?![A-Za-z0-9])`);
}

/** Case-insensitive substring match — company names and aliases are not tickers, no boundary rule. */
function looseRegex(phrase: string): RegExp {
  return new RegExp(escapeRegExp(phrase), 'i');
}

export function deterministicMatch(
  text: string,
  security: Pick<Security, 'symbol' | 'name' | 'aliases'>,
): DeterministicVerdict {
  const symbol = security.symbol.toUpperCase();
  const ambiguous = AMBIGUOUS_TICKERS.has(symbol);

  const cashtagMatch = tokenRegex(`$${symbol}`).test(text);
  if (cashtagMatch) return { matched: true, matchedVia: 'cashtag', ambiguous, corroborated: true };

  const nameMatch = security.name.length > 0 && looseRegex(security.name).test(text);
  if (nameMatch) return { matched: true, matchedVia: 'company_name', ambiguous, corroborated: true };

  const aliasMatch = security.aliases.find((alias) => alias.length > 0 && looseRegex(alias).test(text));
  if (aliasMatch !== undefined) {
    return { matched: true, matchedVia: 'alias', ambiguous, corroborated: true };
  }

  const symbolMatch = tokenRegex(symbol).test(text);
  if (symbolMatch) {
    return { matched: true, matchedVia: 'symbol', ambiguous, corroborated: !ambiguous };
  }

  return { matched: false, matchedVia: 'none', ambiguous, corroborated: false };
}
