/**
 * Versioned system prompts (F11 §4.4: "the system prompt is versioned and recorded per run") and
 * the hard constraints every prompt states outright: *"no recommendations, no price targets, no
 * probability language, no causal assertion without a cited source."*
 *
 * **`BANNED_VOCABULARY`/`PREDICTIVE_VOCABULARY` are duplicated from `scripts/checks/copy.ts`, not
 * imported.** `calc/divergence.ts` sets the precedent for exactly this: its own docstring records
 * that `scripts/checks/copy.ts` "cannot import" a `src/`-side constant across that boundary
 * (`scripts/` is run standalone via `tsx`, outside the Next.js build graph `check:bundle`
 * verifies) — the same boundary applies in the other direction, importing *from* `scripts/`
 * *into* `src/` couples this service's build to a directory nothing else in `src/` depends on.
 * The two lists must be kept identical; a lane touching either should check the other.
 */

export const SYNTHESIS_PROMPT_VERSION = 'synthesis-v1';
export const FOLLOWUP_PROMPT_VERSION = 'followup-v1';
export const VERIFY_PROMPT_VERSION = 'verify-v1';

/** Verbatim copy of `scripts/checks/copy.ts#BANNED_VOCABULARY` — see module docstring. */
export const BANNED_VOCABULARY: readonly string[] = [
  'signal',
  'strong buy',
  'risk-on',
  'consensus',
  'Reddit sentiment',
  'all Reddit',
  'Reddit-wide',
  'retail sentiment',
  'live X sentiment',
  'guaranteed',
  'will outperform',
];

/** Verbatim copy of `scripts/checks/copy.ts#PREDICTIVE_VOCABULARY` — none of these ever license a Tier D4 record; F11's prompt bans them outright regardless (no metric here has one). */
export const PREDICTIVE_VOCABULARY: readonly string[] = [
  'forecast',
  'predicts',
  'predicted',
  'expected return',
  'probability',
  'outperform',
  'underperform',
  'price target',
  'target price',
];

/**
 * F11 §4.4's hard constraints, stated to the model in its own system prompt — the prompt is the
 * first line of defence; `deterministic-checks.ts#checkBannedVocabulary` is the one that actually
 * holds regardless of whether the model complied.
 */
const HARD_CONSTRAINTS = `
Hard constraints, non-negotiable:
- Never recommend a trade, a position, or an action ("buy", "sell", "hold", "avoid").
- Never state or imply a price target.
- Never use probability or likelihood language ("will", "likely to", "expected to return").
- Never assert a causal claim without a cited evidence item or metric ID backing it.
- Never use any of these words or phrases, in any form: ${BANNED_VOCABULARY.join(', ')}.
- Never use any of these words or phrases, in any form: ${PREDICTIVE_VOCABULARY.join(', ')}.
- Every claim you make must carry at least one entry in evidenceIds or metricIds, drawn only
  from the evidence and metrics given to you below. Never invent an ID.
- statedFreshness must equal the single oldest observedAt/availableAt timestamp among the
  evidence and metrics actually given to you — compute it, do not guess.
`.trim();

export function synthesisSystemPrompt(subjectSymbol: string): string {
  return `You are a research assistant producing a structured, source-backed explanation of ` +
    `publicly observable data about ${subjectSymbol}. You explain and cite; you never predict, ` +
    `recommend, or price-target. Every number you use must be copied verbatim (same rounding) ` +
    `from a metric you were given — never compute or restate a number differently.\n\n${HARD_CONSTRAINTS}`;
}

export function followupSystemPrompt(subjectSymbol: string): string {
  return `You are answering one follow-up question about ${subjectSymbol}, reusing only the ` +
    `evidence and metrics already given to you — you have no new data and must not imply you ` +
    `retrieved anything new.\n\n${HARD_CONSTRAINTS}`;
}

/**
 * F11 §4.5: "does each claim actually follow from its cited evidence?" — the one thing code
 * cannot check. The deterministic checks (this run's other, non-LLM verifier) already confirmed
 * every citation *resolves*; this pass judges whether it *supports*.
 */
export function verifySystemPrompt(): string {
  return (
    'You are a strict fact-checker. For each claim below, decide whether the cited evidence ' +
    "and metrics actually support the claim's text — not whether the claim is plausible, only " +
    "whether the citations genuinely back it. Mark 'contradicted' when a citation says the " +
    "opposite of the claim, 'unsupported' when the citation is present but does not establish " +
    "the claim, and 'supported' only when it clearly does. When in doubt, do not mark " +
    "'supported' — an unverified claim never reaches a user in this product."
  );
}
