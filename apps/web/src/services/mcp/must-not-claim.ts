/**
 * F21 §4.5 — the Tier D4 split. *"A metric that has passed Tier D4 renders its IC, Newey–West
 * t, sample period and a link to the versioned backtest record. Every other metric renders the
 * §6.4 disclosure. The component reads the registry to decide which — it is never a prop the
 * caller sets."*
 *
 * The registry's own field for this is `tierD4Record` (`calc/registry.ts#methodDescriptor`,
 * optional, `.min(1)` — "present only once the method has passed Tier D4"). No entry in
 * `analytics/registry.ts` sets it today (checked at module load below, not just asserted in a
 * comment — see `assertNoUnexpectedD4`), which matches `01-PRODUCT-SPEC.md` §6.4: "**Every
 * metric that has not passed Tier D4** — which today is every metric[...]".
 *
 * This is the single place that decision is made for the whole MCP surface, so `catalogue.ts`,
 * every tool in `tools/`, and every `ui/` renderer call this rather than re-deriving it — the
 * same discipline `services/ticker/methodology.ts` already applies to `METHOD_REGISTRY.latest()`.
 */
import type { MethodRegistryEntry } from '@/calc/registry';

/** `01-PRODUCT-SPEC.md` §6.4, verbatim — reproduced here once so every caller quotes the same string. */
export const TIER_D_DISCLOSURE =
  'This is a description of what is currently observable. It has not been tested against ' +
  'historical returns and is not a forecast.';

export type MustNotClaim =
  | { readonly tier: 'undisclosed'; readonly lines: readonly [typeof TIER_D_DISCLOSURE] }
  | {
      readonly tier: 'd4';
      readonly lines: readonly string[];
      readonly record: string;
    };

/**
 * §6.4: "A claim without that record is a build failure, not a copy choice." Reads the registry
 * entry's `tierD4Record`, never a caller-supplied flag — there is no parameter here a tool
 * handler could set to fabricate promotion.
 */
export function mustNotClaimFor(entry: Pick<MethodRegistryEntry, 'tierD4Record'>): MustNotClaim {
  if (entry.tierD4Record === undefined) {
    return { tier: 'undisclosed', lines: [TIER_D_DISCLOSURE] };
  }
  return {
    tier: 'd4',
    lines: [
      `Tier D4 record: ${entry.tierD4Record}`,
      'A validated relationship is per-metric, versioned and linked above — it is not a claim about the product as a whole.',
    ],
    record: entry.tierD4Record,
  };
}

/** Flattened for envelope construction — `ToolResultEnvelope.mustNotClaim` is `string[]`, not the discriminated union above. */
export function mustNotClaimLines(entry: Pick<MethodRegistryEntry, 'tierD4Record'>): readonly string[] {
  return mustNotClaimFor(entry).lines;
}
