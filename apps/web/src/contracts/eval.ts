/**
 * F12 — the evaluation harness's own persisted shapes. Tables in `0015_`.
 *
 * **Additive only, per `CLAUDE.md`: "`src/contracts/` belongs to SPINE — a needed contract
 * change is reported, not made", with the stated exception "strictly additive schema additions
 * genuinely needed."** This is a wholly new file — nothing existing here is edited — scoped to
 * exactly what F12 §3 "Produces" names: `EvalResult` and the run it belongs to. Mirrors
 * `contracts/research.ts`'s own precedent for the identical situation (F11's build brief quotes
 * it verbatim): a new Wave-3 feature owns a wholly new table with no prior repository, so the
 * contract for it is added here rather than routed through SPINE for a table nothing yet reads.
 *
 * **Determinism (F12 §4.5).** `modelIds` records every model route exercised by the run (judge,
 * and — when the seeded-error measurement also exercised it — verify), so a threshold change can
 * be re-evaluated, and a model-route change can be distinguished from a real regression, without
 * re-running anything (`05-TEST-STRATEGY.md` §5.4: "an unexplained score movement between runs is
 * investigated, not accepted").
 */
import { z } from 'zod';
import { jsonValue, timestamp, uuid } from './primitives';

/** F12 §4.1 — the five corpus buckets `05-TEST-STRATEGY.md` §5.1 names. */
export const evalBucket = z.enum([
  'clear_stance',
  'sarcasm_ambiguity',
  'ticker_collision',
  'conflicting_source',
  'thin_evidence',
]);
export type EvalBucket = z.infer<typeof evalBucket>;

/** F12 §4.2 — the nine seeded fault classes `05-TEST-STRATEGY.md` §5.2 names. */
export const evalFaultClass = z.enum([
  'wrong_number',
  'swapped_ticker',
  'unsupported_causal_claim',
  'stale_date',
  'buy_recommendation',
  'price_target',
  'citation_unrelated_evidence',
  'stance_on_thin_sample',
  'fabricated_evidence_id',
]);
export type EvalFaultClass = z.infer<typeof evalFaultClass>;

/** One eval harness invocation. `kind` distinguishes what the run measured — corpus (Tier C
 * judge gate over the gold answers), seeded_error (B7/B8 verifier + judge-adversarial
 * validation), or calibration (MT-11's human/judge Spearman, run separately and rarely). */
export const evalRunKind = z.enum(['corpus', 'seeded_error', 'calibration']);
export type EvalRunKind = z.infer<typeof evalRunKind>;

export const evalRun = z.object({
  id: uuid,
  kind: evalRunKind,
  corpusVersion: z.string().min(1),
  /** e.g. `{ judge: "openai/gpt-5.2", verify: "anthropic/claude-opus-5" }` — F12 §4.5. */
  modelIds: jsonValue,
  startedAt: timestamp,
  completedAt: timestamp.nullable(),
  /** The aggregated numbers this run produced — shape is `EvalRunSummary` (`services/eval/`), stored as-is so a threshold change can re-derive a verdict without re-running the models. */
  summary: jsonValue.nullable(),
  gatePassed: z.boolean().nullable(),
  createdAt: timestamp,
});
export type EvalRun = z.infer<typeof evalRun>;

export const evalResultKind = z.enum(['gold', 'seeded_error']);
export type EvalResultKind = z.infer<typeof evalResultKind>;

/** One scored answer within one run — one corpus pack's gold answer, or one seeded-error answer. */
export const evalResult = z.object({
  id: uuid,
  evalRunId: uuid,
  packId: z.string().min(1),
  answerId: z.string().min(1),
  kind: evalResultKind,
  faultClass: evalFaultClass.nullable(),
  judgeC1: z.number().int().min(1).max(5).nullable(),
  judgeC2: z.number().int().min(1).max(5).nullable(),
  judgeC3: z.number().int().min(1).max(5).nullable(),
  judgeC4: z.number().int().min(1).max(5).nullable(),
  judgeViolations: jsonValue,
  judgeRationale: z.string().nullable(),
  /** `null` when this result carries no verifier measurement (a judge-only corpus run). */
  verifierOutcome: z.enum(['verified', 'verification_failed', 'not_run']).nullable(),
  createdAt: timestamp,
});
export type EvalResult = z.infer<typeof evalResult>;

/** MT-11 — one human hand-score against the same rubric, for the calibration Spearman. */
export const evalCalibrationScore = z.object({
  id: uuid,
  evalRunId: uuid,
  answerId: z.string().min(1),
  humanC1: z.number().int().min(1).max(5),
  humanC2: z.number().int().min(1).max(5),
  humanC3: z.number().int().min(1).max(5),
  humanC4: z.number().int().min(1).max(5),
  scoredBy: z.string().min(1),
  createdAt: timestamp,
});
export type EvalCalibrationScore = z.infer<typeof evalCalibrationScore>;
