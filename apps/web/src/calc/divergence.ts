/**
 * `DivergenceState` — F06 §4.6, source §8.6. Pure data/types, no arithmetic.
 *
 * Lives in `calc/`, not `analytics/`: `02-ARCHITECTURE-CONTRACTS.md` §3 lets `analytics/`
 * import only `contracts/`, and `calc/methods/divergence-state.ts` — which is what actually
 * needs this mapping to turn a classified state into the artifact's `result` — is itself
 * likewise restricted to `contracts/`. `calc/` importing `analytics/` (or the reverse) is the
 * exact edge `architecture/layer-direction` exists to fail the build on, so the mapping sits
 * wherever its one real consumer sits. A later feature (F09, out of F06's scope) reads it back
 * through this module — `app/` is allowed to import both `calc/` and `analytics/` (§3) — rather
 * than re-deriving the mapping.
 *
 * The artifact's `result.exact` has to be a `DecimalString` (§4.2) — a categorical state has no
 * natural decimal form, so each state is assigned a stable integer code and this module is the
 * one place the mapping is written down.
 */

export const DIVERGENCE_STATES = [
  'confirming_interest',
  'bullish_discussion_weak_tape',
  'risk_focused_attention',
  'debate_uncertainty',
  'price_led_move',
  'no_clear_pattern',
] as const;

export type DivergenceState = (typeof DIVERGENCE_STATES)[number];

/** Source §8.6's table, verbatim order — the code a state maps to, `1`-indexed for legibility. */
export const DIVERGENCE_STATE_CODE: Readonly<Record<DivergenceState, string>> = {
  confirming_interest: '1',
  bullish_discussion_weak_tape: '2',
  risk_focused_attention: '3',
  debate_uncertainty: '4',
  price_led_move: '5',
  no_clear_pattern: '6',
};

export const DIVERGENCE_STATE_BY_CODE: Readonly<Record<string, DivergenceState>> = Object.fromEntries(
  Object.entries(DIVERGENCE_STATE_CODE).map(([state, code]) => [code, state as DivergenceState]),
);

/**
 * Source §8.6's "Interpretation template" column, with one deliberate deviation from its
 * verbatim wording: `debate_uncertainty`'s source text used the word "consensus", which
 * `01-PRODUCT-SPEC.md` §6's banned-vocabulary list forbids in anything a user reads.
 * `01-PRODUCT-SPEC.md` §6 is binding over source prose (`scripts/checks/copy.ts` cannot scan
 * `calc/`/`analytics/` — see the `no_clear_pattern` note below — so this is caught by review,
 * not by the lint). Meaning preserved; the word is not. Found by lane-review.
 */
export const DIVERGENCE_STATE_INTERPRETATION: Readonly<Record<DivergenceState, string>> = {
  confirming_interest:
    'Attention and price are moving in the same direction; causality is unproven.',
  bullish_discussion_weak_tape: 'Discussion is optimistic while price action is negative.',
  risk_focused_attention: 'Rising attention appears associated with concern or adverse events.',
  debate_uncertainty: 'Participation is rising without a shared read on direction.',
  price_led_move: 'The move is not accompanied by higher observed retail attention.',
  no_clear_pattern:
    'None of the five named patterns match this combination of attention, stance and price direction.',
};

/**
 * F-17, binding, verbatim — *"part of the method's output, not UI copy that a later feature
 * might drop."* `calc/methods/divergence-state.ts` attaches this to every artifact's `warnings`;
 * `scripts/checks/copy.ts` carries the identical literal independently (it cannot import this
 * module — `calc`/`analytics` and CI scripts do not cross that boundary) and fails a divergence
 * render that lacks it.
 */
export const DIVERGENCE_DISCLOSURE_LINE =
  'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.';
