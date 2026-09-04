/**
 * F12 §4.1–§4.3 — the shapes this feature's own harness reads and writes: the judge's output
 * schema, the frozen corpus pack format, and the seeded-error answer format.
 *
 * **Corpus packs conform to F10's real `EvidencePack`, not an invented shape** (F12 build brief:
 * "your ≥30 frozen packs should conform to this real type"). `EvalCorpusPack.pack` below is
 * exactly `@/services/evidence`'s `EvidencePack` — imported, not redeclared — so a corpus fixture
 * that fails to satisfy F10's own contract fails to parse here, rather than silently drifting
 * from what F11's synthesiser is actually built to consume.
 */
import { z } from 'zod';
import { evalBucket, evalFaultClass } from '@/contracts/eval';
import { synthesisOutput } from '@/services/research/schema';

// ── The judge's output (F12 §4.3) ───────────────────────────────────────────────────────────────

/** `{c1..c4: 1-5, violations: string[], rationale: string}` — F12 §4.3, verbatim. Strict: an
 * extra field is a schema-invalid response, never silently accepted (mirrors F11's `schema.ts`
 * docstring reasoning for the identical choice on `synthesisOutput`). */
export const judgeOutput = z
  .object({
    c1: z.number().int().min(1).max(5),
    c2: z.number().int().min(1).max(5),
    c3: z.number().int().min(1).max(5),
    c4: z.number().int().min(1).max(5),
    violations: z.array(z.string()),
    rationale: z.string().min(1),
  })
  .strict();
export type JudgeOutput = z.infer<typeof judgeOutput>;

// ── The frozen corpus (F12 §4.1, `05-TEST-STRATEGY.md` §5.1) ────────────────────────────────────

export const evalLabelSource = z.literal('llm_assisted_pending_human_audit');
export type EvalLabelSource = z.infer<typeof evalLabelSource>;

export const perItemLabel = z.object({
  itemId: z.string().min(1),
  stance: z.enum(['bullish', 'bearish', 'neutral', 'unclear']),
  /** Binary relevance verdict per F-05.1's bucket table ("expected relevance = 0 for the collided items"). */
  relevant: z.boolean(),
});
export type PerItemLabel = z.infer<typeof perItemLabel>;

export const evalCorpusLabels = z.object({
  perItem: z.array(perItemLabel),
  /** `05-TEST-STRATEGY.md` §5.1: "mixed" for conflicting-source, "unclear" for sarcasm/ambiguity. */
  expectedDirection: z.enum(['bullish', 'bearish', 'neutral', 'mixed', 'unclear']),
  /** The thin-evidence bucket's defining property (§5.1: "expected abstention"). */
  expectedAbstain: z.boolean(),
  /** Prose describing what a correct answer must NOT assert (F12 §4.1: "required abstentions"). */
  requiredAbstentions: z.array(z.string()),
});
export type EvalCorpusLabels = z.infer<typeof evalCorpusLabels>;

/** One stored metric a claim may cite — the shape `services/research/metrics.ts#MetricFact`
 * already defines, redeclared with string dates (frozen fixtures round-trip through JSON, which
 * has no `Date`) rather than imported, since the corpus format has to survive a `JSON.parse` on
 * its own with no live snapshot assembly behind it. */
export const evalMetricFact = z.object({
  metricId: z.string().min(1),
  calculationId: z.string().min(1),
  label: z.string().min(1),
  display: z.string().min(1),
  unit: z.string(),
  n: z.number().int().nullable(),
  window: z.string().nullable(),
  observedAt: z.string().nullable(),
});
export type EvalMetricFact = z.infer<typeof evalMetricFact>;

/**
 * `pack`/`excluded` items reference `@/services/evidence`'s `EvidencePack` shape structurally
 * (validated at load time by `corpus.ts` against the real TypeScript type, not re-encoded as a
 * zod schema here — `EvidencePack` embeds `contracts/evidence.ts#evidenceItem`'s zod-validated
 * `EvidenceItem` one level down, and re-deriving a parallel zod schema for the whole pack would
 * be exactly the "two lists that must be kept identical" trap `services/research/prompts.ts`
 * already warns about for `BANNED_VOCABULARY`). `corpus.ts#parseCorpusPack` does the structural
 * check by hand against the real fields this harness actually reads.
 */
export const evalCorpusPackMeta = z.object({
  id: z.string().min(1),
  bucket: evalBucket,
  labelSource: evalLabelSource,
  subjectSymbol: z.string().min(1),
  labels: evalCorpusLabels,
  metrics: z.array(evalMetricFact),
  /** The "gold" answer — a correct synthesis of this pack. Used both as the acceptable-claims
   * record F12 §4.1 asks for (`allClaims(goldOutput)` from `services/research/deterministic-
   * checks.ts`, imported as-is) and as the answer the Tier C judge scores per pack. */
  goldOutput: synthesisOutput,
});
export type EvalCorpusPackMeta = z.infer<typeof evalCorpusPackMeta>;

// ── The seeded-error corpus (F12 §4.2, `05-TEST-STRATEGY.md` §5.2) ──────────────────────────────

export const seededErrorAnswerMeta = z.object({
  id: z.string().min(1),
  packId: z.string().min(1),
  faultClass: evalFaultClass,
  /** The one claim in `output` carrying the injected fault. */
  faultyClaimId: z.string().min(1),
  /** The other claims in `output` — copied verbatim from the source pack's `acceptableClaims`,
   * expected to remain uncaught (F12 §4.2's second, false-positive-measuring use). */
  cleanClaimIds: z.array(z.string()),
  /**
   * Whether one of the eight deterministic checks (`services/research/deterministic-checks.ts`)
   * is, by construction, capable of catching this fault class at all. `false` for
   * `unsupported_causal_claim` and `citation_unrelated_evidence` — F12 §4.5's "does each claim
   * actually follow from its cited evidence" is explicitly "the one thing code cannot check"
   * (`services/research/prompts.ts#verifySystemPrompt`'s own docstring) — those two only ever
   * become catchable through the bounded model-verification pass.
   */
  deterministicallyCatchable: z.boolean(),
});
export type SeededErrorAnswerMeta = z.infer<typeof seededErrorAnswerMeta>;

/** `output` is a full `SynthesisOutput` (F11's own schema, imported) — a seeded-error answer is
 * structurally an ordinary research answer with exactly one fault planted in it. */
export const seededErrorFile = z.object({
  meta: seededErrorAnswerMeta,
  output: synthesisOutput,
});
export type SeededErrorFile = z.infer<typeof seededErrorFile>;
