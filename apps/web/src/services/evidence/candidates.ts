/**
 * Deterministic relevance candidacy — F10 §4.2.
 *
 * "Relevance is deterministic: exact-symbol match, company-name match, and a ticker-collision
 * guard for ambiguous tokens (`AI`, `ON`, `IT`, `ALL`) that requires a corroborating
 * company-name or cashtag reference." This module is that first, cheap, no-LLM pass. It decides
 * only whether an item is even a *candidate* worth spending a `relevance.filter` or
 * `entity.collision_guard` call on — it never itself decides `relevant: true` for an ambiguous
 * token (that needs semantic context per §4.4, which a lexicon cannot supply) and it never
 * excludes a non-ambiguous, unmatched item by calling an LLM (there is nothing to judge: the
 * security is not named at all).
 *
 * **Two-stage design, deliberately split across this module and `entity.collision_guard`:**
 * 1. Here: does the text corroborate the ambiguous token with a company name, alias or cashtag
 *    at all? If not, exclude immediately — no LLM call is worth spending on a bare "AI" with
 *    nothing nearby that could even plausibly be about the security.
 * 2. In `collision-guard.ts`: given that corroboration exists, is the mention actually *about*
 *    the security, or is it a company name and the word "AI" that both happen to appear in an
 *    unrelated sentence? That is the semantic judgment §4.4 says a lexicon cannot make, which is
 *    why corroboration alone does not end the pipeline here.
 */

/** F10 §4.2's four named ambiguous tokens, verbatim. */
export const AMBIGUOUS_TOKENS = ['AI', 'ON', 'IT', 'ALL'] as const;
export type AmbiguousToken = (typeof AMBIGUOUS_TOKENS)[number];

const AMBIGUOUS_TOKEN_SET: ReadonlySet<string> = new Set(AMBIGUOUS_TOKENS);

export type SecurityIdentity = {
  readonly symbol: string;
  readonly companyName: string;
  readonly aliases?: readonly string[];
};

export type MentionCandidate =
  | { readonly kind: 'cashtag'; readonly matched: string }
  | { readonly kind: 'symbol'; readonly matched: string }
  | { readonly kind: 'company_name'; readonly matched: string }
  | { readonly kind: 'ambiguous'; readonly token: AmbiguousToken; readonly corroborated: boolean }
  | { readonly kind: 'none' };

/** Escapes a string for use inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWord(
  text: string,
  word: string,
  options: { caseSensitive: boolean } = { caseSensitive: false },
): boolean {
  const pattern = new RegExp(
    `(?<![A-Za-z0-9])${escapeRegExp(word)}(?![A-Za-z0-9])`,
    options.caseSensitive ? '' : 'i',
  );
  return pattern.test(text);
}

function containsCashtag(text: string, symbol: string): boolean {
  const pattern = new RegExp(`\\$${escapeRegExp(symbol)}(?![A-Za-z0-9])`, 'i');
  return pattern.test(text);
}

/**
 * Normalized substring match for a company name or alias — the same "trim, lowercase, collapse
 * whitespace" normalization `repositories/evidence.ts`'s `normalizeTitle` uses, so a name match
 * here is not defeated by incidental casing or double spacing.
 */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A trailing corporate suffix, requiring a real separator (a comma, or at least one space)
 * immediately before it — never a bare `\s*`, which would also match inside an ordinary word
 * ending in "co" (e.g. "Sysco", "Geico") with no separator at all. Applied iteratively (lane-
 * review finding 3): social text overwhelmingly says "Tesla", not "Tesla, Inc." — `security.name`
 * carries the one legal name, with no `aliases` populated for a short form, so without this a
 * real, on-topic mention is misread as "no mention of the security" and never even reaches
 * `relevance.filter`.
 */
const CORPORATE_SUFFIX_PATTERN =
  /(?:,\s*|\s+)(?:incorporated|corporation|holdings|company|limited|inc|corp|ltd|llc|plc|co)\.?\s*$/i;

function stripCorporateSuffix(name: string): string {
  let stripped = name.trim();
  let previous: string;
  do {
    previous = stripped;
    stripped = stripped.replace(CORPORATE_SUFFIX_PATTERN, '').trim();
  } while (stripped !== previous && stripped.length > 0);
  return stripped;
}

function containsCompanyName(text: string, name: string): boolean {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) return false;
  const normalizedText = normalize(text);
  if (normalizedText.includes(normalize(trimmedName))) return true;

  const shortForm = stripCorporateSuffix(trimmedName);
  if (shortForm.length === 0 || shortForm === trimmedName) return false;
  return normalizedText.includes(normalize(shortForm));
}

/**
 * The candidacy verdict for one item's text against one security.
 *
 * `text` is expected to be the item's title and snippet concatenated — callers decide how to
 * build that, since the pack builder is the one place that knows the item shape.
 */
export function detectMention(text: string, security: SecurityIdentity): MentionCandidate {
  const symbol = security.symbol.trim();
  const isAmbiguousSymbol = AMBIGUOUS_TOKEN_SET.has(symbol.toUpperCase());

  // A cashtag is never ambiguous — `$AI` is unambiguously a ticker reference regardless of
  // whether "AI" the word is also a common one, so this check runs before the ambiguity branch.
  if (containsCashtag(text, symbol)) {
    return { kind: 'cashtag', matched: `$${symbol}` };
  }

  if (isAmbiguousSymbol) {
    const token = symbol.toUpperCase() as AmbiguousToken;
    // Ambiguous tokens are checked case-sensitively as a bare word — "on" or "it" in ordinary
    // lowercase prose is not a candidate mention at all, only a standalone all-caps occurrence
    // is even a candidate for the corroboration check.
    if (!containsWord(text, token, { caseSensitive: true })) {
      return { kind: 'none' };
    }
    const corroborated =
      containsCompanyName(text, security.companyName) ||
      (security.aliases ?? []).some((alias) => containsCompanyName(text, alias));
    return { kind: 'ambiguous', token, corroborated };
  }

  if (containsWord(text, symbol)) {
    return { kind: 'symbol', matched: symbol };
  }

  if (containsCompanyName(text, security.companyName)) {
    return { kind: 'company_name', matched: security.companyName };
  }

  const aliasMatch = (security.aliases ?? []).find((alias) => containsCompanyName(text, alias));
  if (aliasMatch !== undefined) {
    return { kind: 'company_name', matched: aliasMatch };
  }

  return { kind: 'none' };
}
