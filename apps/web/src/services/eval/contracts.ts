/**
 * F12 §3 — "Produces: the corpus format; `EvalResult`; the judge schema; the CI gate."
 *
 * None of this is frozen (`docs/progress/f12-lane.md`): nothing outside `services/eval/`
 * consumes it, so it lives here rather than in `src/contracts/`, which is SPINE's
 * (`CLAUDE.md`). It builds **on top of** the frozen `EvidencePack`/`ClassifiedItem` (F10,
 * `src/contracts/evidence-pack.ts`) rather than redefining evidence shapes — a corpus pack is
 * an `EvidencePack` plus the human labels and expectations F12 §4.1 adds.
 */
import { z } from 'zod';
import { decimalString, socialAxis, stanceLabel, timestamp } from '@/contracts/primitives';
import { evidencePack } from '@/contracts/evidence-pack';

/** `docs/05-TEST-STRATEGY.md` §5.1's five buckets, verbatim. */
export const corpusBucket = z.enum([
  'clear_stance',
  'sarcasm_ambiguity',
  'ticker_collision',
  'conflicting_source',
  'thin_evidence',
]);
export type CorpusBucket = z.infer<typeof corpusBucket>;

/**
 * The run-level behaviour a bucket's pack is built to exercise, per §5.1's "Labels" column.
 * `stance_scored` is the default for a pack whose evidence supports a confident call.
 */
export const expectedOutcome = z.enum([
  'stance_scored',
  'unclear_no_direction',
  'mixed_no_confident_direction',
  'abstained',
]);
export type ExpectedOutcome = z.infer<typeof expectedOutcome>;

/** A human label for one evidence item's stance and relevance (F12 §4.1). */
export const itemLabel = z.object({
  itemId: z.string().min(1),
  /** `null` means "no confident direction" — sarcasm, ambiguity, or genuinely mixed signal. */
  expectedStance: stanceLabel.nullable(),
  expectedRelevant: z.boolean(),
  /** Why a human labeller called it this way — required so a disagreement is auditable (D-35's spirit). */
  note: z.string().min(1),
});
export type ItemLabel = z.infer<typeof itemLabel>;

/** A stored metric value the prose must string-match at display rounding (product invariant §6.2, B4). */
export const storedMetricValue = z.object({
  metricId: z.string().min(1),
  display: z.string().min(1),
});
export type StoredMetricValue = z.infer<typeof storedMetricValue>;

/**
 * One frozen, human-labelled evidence pack (F12 §4.1 / §5.1 of the test strategy).
 *
 * **Frozen artifact, not a live retrieval.** `frozen: true` is a literal, not a flag a caller
 * can flip — a pack is regenerated only by a deliberate, reviewed PR that also re-labels it
 * (F12 §4.1), never as a build side effect.
 *
 * `labelledBy` records provenance honestly. This starter corpus is hand-authored fixture data
 * for exercising the harness (see the lane report's DEFERRED section) — it is not the ≥30-pack
 * production corpus D-35 describes, and its `labelledBy` string says so rather than implying a
 * human-labelling process that did not happen for these ten packs.
 */
export const corpusPack = z
  .object({
    id: z.string().min(1),
    bucket: corpusBucket,
    pack: evidencePack,
    labels: z.array(itemLabel).min(1),
    expectedOutcome,
    acceptableClaims: z.array(z.string().min(1)).min(1),
    requiredAbstentions: z.array(z.string()),
    storedMetrics: z.array(storedMetricValue).min(1),
    /** The reference answer the judge and verifier are exercised against for this pack. */
    referenceAnswer: z.string().min(1),
    labelledBy: z.string().min(1),
    labelledAt: timestamp,
    frozen: z.literal(true),
  })
  .superRefine((value, ctx) => {
    const itemIds = new Set(value.pack.items.map((item) => item.item.id));
    const labelledIds = new Set(value.labels.map((label) => label.itemId));

    for (const label of value.labels) {
      if (!itemIds.has(label.itemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['labels'],
          message: `label references itemId ${label.itemId}, which is not in pack.items`,
        });
      }
    }
    for (const itemId of itemIds) {
      if (!labelledIds.has(itemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['labels'],
          message: `pack item ${itemId} carries no human label — every item in a frozen corpus pack must be labelled`,
        });
      }
    }

    const relevantCount = value.pack.items.filter((item) => item.relevant).length;

    if (value.bucket === 'thin_evidence') {
      if (relevantCount >= 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pack', 'items'],
          message: `thin_evidence bucket requires n < 5 relevant items (product invariant §6.3); got ${relevantCount}`,
        });
      }
      if (value.expectedOutcome !== 'abstained') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expectedOutcome'],
          message: 'thin_evidence bucket must expect abstention (05-TEST-STRATEGY.md §5.1)',
        });
      }
    }

    if (value.bucket === 'sarcasm_ambiguity' && value.expectedOutcome !== 'unclear_no_direction') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedOutcome'],
        message: 'sarcasm_ambiguity bucket must expect unclear_no_direction (05-TEST-STRATEGY.md §5.1)',
      });
    }

    if (value.bucket === 'conflicting_source' && value.expectedOutcome !== 'mixed_no_confident_direction') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedOutcome'],
        message: 'conflicting_source bucket must expect mixed_no_confident_direction (05-TEST-STRATEGY.md §5.1)',
      });
    }

    if (value.bucket === 'ticker_collision') {
      const hasCollidedItem = value.labels.some((label) => !label.expectedRelevant);
      if (!hasCollidedItem) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['labels'],
          message: 'ticker_collision bucket requires at least one item labelled expectedRelevant: false (05-TEST-STRATEGY.md §5.1)',
        });
      }
    }
  });
export type CorpusPack = z.infer<typeof corpusPack>;

/** `docs/05-TEST-STRATEGY.md` §5.2's nine fault classes, verbatim. */
export const faultClass = z.enum([
  'wrong_number',
  'swapped_ticker',
  'unsupported_causal_claim',
  'stale_date',
  'buy_recommendation',
  'price_target',
  'unrelated_citation',
  'stance_on_thin_sample',
  'fabricated_evidence_id',
]);
export type FaultClass = z.infer<typeof faultClass>;

/**
 * One seeded-error answer (F12 §4.2). `baseAnswer` is the clean answer before the fault was
 * injected — kept alongside `answer` so the same fixture serves both of §4.2's uses: `answer`
 * measures the verifier's catch rate (B7) and the judge's adversarial resistance; `baseAnswer`
 * measures the verifier's false-positive rate (B8) against a known-good answer for the same pack.
 */
export const seededErrorAnswer = z.object({
  id: z.string().min(1),
  packId: z.string().min(1),
  faultClass,
  baseAnswer: z.string().min(1),
  answer: z.string().min(1),
  faultDescription: z.string().min(1),
});
export type SeededErrorAnswer = z.infer<typeof seededErrorAnswer>;

/** F12 §4.3 / `01-PRODUCT-SPEC.md` §4 Tier C's four axes, 1-5 integer scores. */
export const judgeAxisScore = z.number().int().min(1).max(5);

/** The judge's response schema, exactly as F12 §4.3 specifies it. */
export const judgeResponse = z.object({
  c1: judgeAxisScore,
  c2: judgeAxisScore,
  c3: judgeAxisScore,
  c4: judgeAxisScore,
  violations: z.array(z.string()),
  rationale: z.string().min(1),
});
export type JudgeResponse = z.infer<typeof judgeResponse>;

/**
 * One evidence item as the judge is allowed to see it: its stable id (so a citation can be
 * checked against a real one, or exposed as fabricated), its text, and the two dates F11's
 * deterministic checks read (`05-TEST-STRATEGY.md` §6 items 3, 7, 8) — never anything about how
 * or why it was retrieved.
 *
 * **Review finding (lane-review round 1).** The original `judgeInput` carried evidence as bare
 * strings with no id or date, which made `fabricated_evidence_id` and `stale_date` structurally
 * undetectable — the judge cannot tell a fabricated citation from a real one without seeing ids,
 * or a stale date claim without seeing dates. This shape is the fix.
 */
export const judgeEvidenceItem = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  /** As retrieved; `null` when the provider never supplied one (F10's `evidenceItem` shape). */
  publishedAt: timestamp.nullable(),
  /** PIT: when the item became available to this run — never re-derived, never re-fetched. */
  availableAt: timestamp,
});
export type JudgeEvidenceItem = z.infer<typeof judgeEvidenceItem>;

/**
 * What the judge is allowed to see (F12 §4.3): the answer, the evidence (text, id, and dates),
 * and the stored metric values — **never** the synthesiser's prompt or reasoning. `judge.ts`
 * builds this and `judge-blind.test.ts` asserts the construction cannot leak anything else into
 * it.
 */
export const judgeInput = z.object({
  answerText: z.string().min(1),
  evidence: z.array(judgeEvidenceItem),
  storedMetrics: z.array(storedMetricValue),
});
export type JudgeInput = z.infer<typeof judgeInput>;

/** One eval run's model identity, recorded per run (F12 §4.5). */
export const evalModelRoute = z.object({
  judgeModelId: z.string().min(1),
  judgeModelVersion: z.string().min(1),
  temperature: z.literal(0),
});
export type EvalModelRoute = z.infer<typeof evalModelRoute>;

/**
 * All four fields are decimal strings, not JS numbers (`02-ARCHITECTURE-CONTRACTS.md` §4.2).
 *
 * **Review finding (lane-review round 1).** A mean-of-three-fractions computed in floating
 * point can land at `3.9999999999999996` instead of the exact `4.0`, failing the gate on a
 * corpus whose true mean is exactly at the threshold, while a naive display rounds the same
 * float back to `"4.00"` — a report that says PASS-shaped numbers next to a FAIL verdict.
 * `gate.ts` computes this with `decimal.js`, the same discipline `verifier-harness.ts` already
 * uses for B7/B8, and keeps it a decimal string end to end rather than converting back to a
 * float for storage.
 */
export const tierCGateVerdict = z.object({
  passed: z.boolean(),
  perAxisMean: z.object({
    c1: decimalString,
    c2: decimalString,
    c3: decimalString,
    c4: decimalString,
  }),
  overallMean: decimalString,
  c2Floor: z.number(),
  c2Failures: z.array(z.string()),
  tierBViolationCount: z.number().int().nonnegative(),
  reasons: z.array(z.string()),
});
export type TierCGateVerdict = z.infer<typeof tierCGateVerdict>;

/**
 * `goodCount` is the count of **distinct** base answers B8 was measured against, not the count
 * of seeded-error fixtures — several fixtures share one pack's clean `baseAnswer` (they inject
 * different faults into the same answer), and counting it once per fixture would make B8's
 * denominator wrong (lane-review round 1 finding 6).
 */
export const verifierMeasurement = z.object({
  catchRate: decimalString,
  falsePositiveRate: decimalString,
  seededCount: z.number().int().nonnegative(),
  goodCount: z.number().int().nonnegative(),
  catchRateThreshold: decimalString,
  falsePositiveRateThreshold: decimalString,
  catchRatePassed: z.boolean(),
  falsePositiveRatePassed: z.boolean(),
});
export type VerifierMeasurement = z.infer<typeof verifierMeasurement>;

export const calibrationResult = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('pending'),
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal('complete'),
    n: z.number().int().positive(),
    spearman: z.number(),
    threshold: decimalString,
    trusted: z.boolean(),
  }),
]);
export type CalibrationResult = z.infer<typeof calibrationResult>;

/**
 * Tier D1 (`01-PRODUCT-SPEC.md` §4): per-axis stance macro-F1 against a hand-labelled set,
 * "a single blended figure is not admissible" (D-14). `macroF1` is `null` when the corpus has
 * zero labelled items on that axis — a missing axis is reported as missing, never as a zero.
 */
export const stanceAxisF1 = z.object({
  macroF1: decimalString.nullable(),
  n: z.number().int().nonnegative(),
});
export type StanceAxisF1 = z.infer<typeof stanceAxisF1>;

export const stanceMacroF1Report = z.object({
  reddit: stanceAxisF1,
  x: stanceAxisF1,
  substack: stanceAxisF1,
});
export type StanceMacroF1Report = z.infer<typeof stanceMacroF1Report>;

export { socialAxis };

/** One stored eval run (F12 §4.5 / DoD "eval results are stored per run and comparable"). */
export const evalRunRecord = z.object({
  runId: z.string().min(1),
  runAt: timestamp,
  corpusVersion: z.string().min(1),
  modelRoute: evalModelRoute,
  tierC: tierCGateVerdict,
  verifier: verifierMeasurement.nullable(),
  calibration: calibrationResult.nullable(),
  /** Tier D1, informational on a starter corpus this small — see `stance-accuracy.ts`'s docstring. */
  stanceD1: stanceMacroF1Report.nullable(),
});
export type EvalRunRecord = z.infer<typeof evalRunRecord>;
