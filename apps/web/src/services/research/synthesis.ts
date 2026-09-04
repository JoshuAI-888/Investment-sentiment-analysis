/**
 * F11 §4.4 — the synthesis schema and prompt.
 *
 * "Strict zod schema: summary; up to three narrative themes each with ≥ 2 supporting evidence
 * IDs (a single-source theme is labelled `single-source`); a bullish case; a bearish case; what
 * changed; what to monitor. Every field's claims carry evidence IDs or metric IDs."
 *
 * A `SynthesisClaim` is the atomic unit everywhere in this feature — the verifier (`verifier/`)
 * runs its eight checks per claim, and the claim ledger (`claim-ledger.ts`) is a 1:1 projection
 * of the claims that come back from here. Building the schema around claims from the start,
 * rather than a paragraph of prose plus a citations array bolted on, is what makes "every
 * citation marker resolves to an evidence_item" (`05-TEST-STRATEGY.md` §6, check 2) a structural
 * property instead of something a regex has to go find in free text.
 */
import { z } from 'zod';
import { claimType, verificationStatus } from '@/contracts/research';
import { socialAxis } from '@/contracts/primitives';
import type { ModelClient } from './ports';
import type { Clock } from '@/adapters/ports';
import { withDeadline } from './latency-budget';

/** Bumped whenever the prompt's *meaning* changes; recorded on every run (F11 §4.4). */
export const SYNTHESIS_PROMPT_VERSION = 'research.synthesis@1.0.0';

export const synthesisClaim = z.object({
  text: z.string().min(1),
  kind: claimType,
  evidenceIds: z.array(z.string().uuid()),
  metricIds: z.array(z.string()),
  /**
   * Non-null exactly when this claim asserts something about one axis's aggregate stance — the
   * hook verifier check 5 (`no stance asserted where n < 5`) needs, since "n" is a per-axis
   * sample count and nothing else in the claim's own shape says which axis it is about.
   */
  assertsStanceForAxis: socialAxis.nullable(),
});
export type SynthesisClaim = z.infer<typeof synthesisClaim>;

function distinctEvidenceCount(claims: readonly SynthesisClaim[]): number {
  return new Set(claims.flatMap((claim) => claim.evidenceIds)).size;
}

export const synthesisTheme = z
  .object({
    title: z.string().min(1),
    claims: z.array(synthesisClaim).min(1),
    /** F11 §4.4: "a single-source theme is labelled `single-source`." */
    singleSource: z.boolean(),
  })
  .refine((theme) => theme.singleSource === distinctEvidenceCount(theme.claims) < 2, {
    message:
      'singleSource must be true iff the theme cites fewer than two distinct evidence items — this is what makes the label load-bearing rather than decorative.',
    path: ['singleSource'],
  });
export type SynthesisTheme = z.infer<typeof synthesisTheme>;

export const synthesisOutput = z.object({
  summary: z.array(synthesisClaim).min(1),
  themes: z.array(synthesisTheme).max(3),
  bullishCase: z.array(synthesisClaim),
  bearishCase: z.array(synthesisClaim),
  whatChanged: z.array(synthesisClaim),
  whatToMonitor: z.array(synthesisClaim),
  /**
   * F11 §4.5 check 8: "stated freshness matches the oldest input's `observed_at`." A dedicated
   * field rather than a claim buried in `summary`, because the check needs exactly one place to
   * read this from, not a text search for a freshness-shaped sentence.
   */
  statedFreshnessAsOf: z.string().datetime({ offset: true }),
});
export type SynthesisOutput = z.infer<typeof synthesisOutput>;

/** Every claim across every section, tagged with which section it came from (for diagnostics). */
export type FlatClaim = SynthesisClaim & { section: string };

/**
 * A theme's `title` renders verbatim in `complete` prose (and streams as part of the `stage`
 * label) but is not itself a `SynthesisClaim` — before this fix, none of the eight deterministic
 * checks ever saw it, since every check iterates `claims` (lane-review finding 4: a title like
 * "Strong buy signal: 40% surge ahead" over one clean, correctly-cited claim sailed straight to
 * `complete`). Folded into a synthetic claim instead of exempted or checked ad hoc — this is the
 * "fold title into a claim" option named in that finding, and it is what makes "unverified prose
 * can reach a user by no code path" true of this field too, at the cost of running the
 * evidence/date checks against a claim that (correctly) cites nothing: a title date-checked
 * against zero cited items always fails check 7, which is the conservative, safe direction for
 * text this codebase renders without ever asking the model to cite it.
 */
function titleClaim(theme: SynthesisTheme): SynthesisClaim {
  return { text: theme.title, kind: 'interpretation', evidenceIds: [], metricIds: [], assertsStanceForAxis: null };
}

export function flattenSynthesis(output: SynthesisOutput): readonly FlatClaim[] {
  const sections: Array<[string, readonly SynthesisClaim[]]> = [
    ['summary', output.summary],
    ...output.themes.map((theme, index): [string, readonly SynthesisClaim[]] => [
      `theme[${String(index)}] ${theme.title}`,
      [titleClaim(theme), ...theme.claims],
    ]),
    ['bullishCase', output.bullishCase],
    ['bearishCase', output.bearishCase],
    ['whatChanged', output.whatChanged],
    ['whatToMonitor', output.whatToMonitor],
  ];
  return sections.flatMap(([section, claims]) => claims.map((claim) => ({ ...claim, section })));
}

/**
 * F11 §4.4: "Hard prompt constraints: no recommendations, no price targets, no probability
 * language, no causal assertion without a cited source. The system prompt is versioned and
 * recorded per run." The constraints are stated here, in the one place the prompt is built, so
 * a reviewer checking "does the system prompt invite a recommendation or a forecast"
 * (`04-BUILD-LOOP.md` PR review step 4) has one function to read rather than a prompt scattered
 * across call sites.
 */
export function buildSynthesisPrompt(input: {
  question: string;
  securitySymbol: string;
  evidenceSummary: string;
  metricsSummary: string;
}): string {
  return [
    `You are the research synthesiser for ${input.securitySymbol}. Promptversion: ${SYNTHESIS_PROMPT_VERSION}.`,
    'Answer strictly from the evidence and metrics provided below. Every claim you make must carry',
    'either evidence IDs or metric IDs (or both) drawn only from what is listed — never invent one.',
    '',
    'Hard constraints, none of which may be violated by any claim:',
    '- No investment recommendation, no "buy"/"sell"/"hold" language, no price target.',
    '- No probability or certainty language ("will", "likely", "guaranteed", "% chance").',
    '- No causal assertion ("because X, Y happened") unless the claim cites the evidence for X.',
    '- A theme built from fewer than two distinct evidence items must be labelled single-source.',
    '- State the freshness of this analysis as the OLDEST observed_at among the evidence actually',
    '  used, never the newest — an analysis is only as fresh as its stalest necessary input.',
    '',
    `Question: ${input.question}`,
    '',
    'Evidence available (cite only these IDs):',
    input.evidenceSummary,
    '',
    'Metrics available (cite only these IDs; numbers in your prose must match one exactly):',
    input.metricsSummary,
  ].join('\n');
}

export type RunSynthesisResult =
  | { outcome: 'ok'; output: SynthesisOutput }
  | { outcome: 'timeout' }
  | { outcome: 'error'; error: unknown };

/** F11 §4.2: synthesis is bounded at 10s; an overrun demotes the run to `degraded`, never throws here. */
export async function runSynthesis(
  model: ModelClient,
  prompt: string,
  context: Readonly<Record<string, unknown>>,
  clock: Clock,
  budgetMs: number,
): Promise<RunSynthesisResult> {
  try {
    const timed = await withDeadline(
      model.synthesize('synthesis', { prompt, context }, synthesisOutput),
      budgetMs,
      clock,
    );
    if (timed.timedOut) return { outcome: 'timeout' };
    return { outcome: 'ok', output: timed.value };
  } catch (error) {
    return { outcome: 'error', error };
  }
}

/** Re-exported so callers building a `ClaimLedgerEntry` do not import `contracts/research` twice for one enum. */
export const CLAIM_VERIFICATION_STATUS = verificationStatus;
