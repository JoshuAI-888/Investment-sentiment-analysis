/**
 * The synthesis and verify LLM output schemas — F11 §4.4/§4.5. Strict (`z.strict()` where the
 * shape is an object literal the model must not pad), so an extra unexpected field is a
 * schema-invalid response, never silently accepted.
 *
 * **`singleSource` is not trusted from the model.** `claim-ledger.ts` computes it deterministically
 * from `evidenceIds` after the fact (F11 §6 DoD: "themes with one source are labelled
 * `single-source`") — the schema still requires the model to *attempt* the field so its own
 * self-assessment is available for comparison in the Inspector, but nothing downstream reads it
 * as authoritative.
 */
import { z } from 'zod';

export const claimTypeSchema = z.enum(['fact', 'calculation', 'interpretation', 'hypothesis']);

/**
 * One material, citable claim. `evidenceIds` are `evidence_item.id` UUIDs drawn only from the
 * pack the model was given; `metricIds` are `AxisMetric.metricId` strings from the deterministic
 * metrics the model was given. The deterministic verifier (`deterministic-checks.ts`) is what
 * actually enforces both resolve to something real — this schema only enforces *shape*.
 */
export const synthesisClaim = z
  .object({
    claimId: z.string().min(1),
    text: z.string().min(1),
    kind: claimTypeSchema,
    evidenceIds: z.array(z.string()),
    metricIds: z.array(z.string()),
    /** Almost always the run's single subject symbol — see deterministic check 6. */
    relatedTickers: z.array(z.string()),
    /** ISO date this claim asserts something happened on/as-of — `null` when the claim is not date-scoped. */
    assertedDate: z.string().nullable(),
  })
  .strict();
export type SynthesisClaim = z.infer<typeof synthesisClaim>;

export const synthesisTheme = z
  .object({
    title: z.string().min(1),
    claims: z.array(synthesisClaim).min(1),
    /** The model's own guess — see module docstring. Not authoritative. */
    singleSource: z.boolean(),
  })
  .strict();
export type SynthesisTheme = z.infer<typeof synthesisTheme>;

export const synthesisOutput = z
  .object({
    summary: z.string().min(1),
    /** ISO timestamp — deterministic check 8 compares this against the true oldest input. */
    statedFreshness: z.string(),
    /** Up to three (F11 §4.4). */
    themes: z.array(synthesisTheme).max(3),
    bullishCase: z.array(synthesisClaim),
    bearishCase: z.array(synthesisClaim),
    whatChanged: z.array(synthesisClaim),
    whatToMonitor: z.array(synthesisClaim),
  })
  .strict();
export type SynthesisOutput = z.infer<typeof synthesisOutput>;

/** `followup.ts` reuses this same shape, `synthesisOutput` replaced by a flat claim list is unnecessary — a follow-up answer is structurally a smaller synthesis. */
export const followupOutput = synthesisOutput;
export type FollowupOutput = SynthesisOutput;

// ── Model verification pass (F11 §4.5's "one bounded model pass") ──────────────────────────────

export const claimVerdict = z.enum(['supported', 'unsupported', 'contradicted']);

export const modelVerifyClaimResult = z
  .object({
    claimId: z.string().min(1),
    verdict: claimVerdict,
    reason: z.string().min(1),
  })
  .strict();
export type ModelVerifyClaimResult = z.infer<typeof modelVerifyClaimResult>;

export const modelVerifyOutput = z
  .object({
    results: z.array(modelVerifyClaimResult),
  })
  .strict();
export type ModelVerifyOutput = z.infer<typeof modelVerifyOutput>;

// ── Follow-up question generation (F11 §4.7) ────────────────────────────────────────────────────

export const followupQuestion = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();
export type FollowupQuestionCandidate = z.infer<typeof followupQuestion>;

export const followupQuestionsOutput = z
  .object({
    questions: z.array(followupQuestion).max(5),
  })
  .strict();
export type FollowupQuestionsOutput = z.infer<typeof followupQuestionsOutput>;
