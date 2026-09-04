/**
 * B7 (verifier catch rate ≥ 0.90) and B8 (verifier false-positive rate ≤ 0.10) — F12 §4.2,
 * `01-PRODUCT-SPEC.md` §4 Tier B. Measures F11's actual, already-merged verifier
 * (`services/research/deterministic-checks.ts#runDeterministicChecks`, plus — for the two fault
 * classes deterministic code cannot catch — F11's bounded model-verification pass,
 * `services/research/verify.ts#runModelVerification`), consumed as-is, never reimplemented.
 *
 * **A documented interpretive choice, recorded here rather than silently assumed** (the same
 * discipline F11's own session log used for its `abstained` mapping): `05-TEST-STRATEGY.md` §5.2
 * and F12 §4.2 describe the seeded-error corpus as "used twice ... to measure the verifier", and
 * B8 (`01-PRODUCT-SPEC.md` §4) names its input as "known-good answers" — a different noun than
 * "answers with one injected fault each" (the seeded corpus's own definition). Read literally as
 * two separate corpora, those two sentences are inconsistent with the "used twice, same corpus"
 * framing paragraph. **The consistent reading, and the one this module implements**: each seeded-
 * error answer carries exactly one faulty claim and the rest of its claims copied verbatim from
 * the source pack's gold answer — those other claims *are* the "known-good answers" B8 names,
 * co-located in the same 40-answer corpus rather than in a separate one. B7 (catch rate) is then
 * measured over the faulty claims; B8 (false-positive rate) over the clean claims sitting
 * alongside them. This reading is what makes both numbers computable from the single corpus F12
 * §4.2 actually asks for ("≥ 40 answers ... used twice"), with no second, unspecified corpus
 * invented to satisfy B8's wording literally.
 */
import {
  runDeterministicChecks,
  type VerifyContext,
} from '@/services/research/deterministic-checks';
import type { MetricFact } from '@/services/research/metrics';
import type { ModelVerificationResult } from '@/services/research/verify';
import { D } from '@/calc/decimal';
import type { EvalCorpusPack } from './corpus';
import type { EvalFaultClass } from '@/contracts/eval';
import type { SeededErrorFile } from './schema';

export function toMetricFact(fact: {
  readonly metricId: string;
  readonly calculationId: string;
  readonly label: string;
  readonly display: string;
  readonly unit: string;
  readonly n: number | null;
  readonly window: string | null;
  readonly observedAt: string | null;
}): MetricFact {
  return { ...fact, observedAt: fact.observedAt === null ? null : new Date(fact.observedAt) };
}

export type ClaimCatch = {
  readonly claimId: string;
  readonly caughtByDeterministic: boolean;
  readonly caughtByModel: boolean;
};

/** One answer's per-claim catch record, plus which claim was the seeded fault. */
export type SeededAnswerVerdict = {
  readonly answerId: string;
  readonly faultClass: EvalFaultClass;
  readonly faultyClaimId: string;
  readonly cleanClaimIds: readonly string[];
  readonly claims: readonly ClaimCatch[];
};

/**
 * One answer's deterministic-check pass, always run (pure, zero cost, zero mocking). The model
 * verification pass is optional — supplying `null` measures the seven deterministically-catchable
 * fault classes for real and leaves the two semantic-only classes (`unsupported_causal_claim`,
 * `citation_unrelated_evidence`) recorded as `caughtByModel: false` for every claim, which is
 * disclosed by this module's return shape (`modelVerificationRan`), never silently folded into
 * the headline numbers as if it were a real measurement.
 */
export async function verifySeededAnswer(
  file: SeededErrorFile,
  pack: EvalCorpusPack,
  modelVerify: ((ctx: VerifyContext) => Promise<ModelVerificationResult>) | null,
): Promise<SeededAnswerVerdict> {
  const ctx: VerifyContext = {
    output: file.output,
    pack: pack.pack,
    metrics: pack.meta.metrics.map(toMetricFact),
    subjectSymbol: pack.meta.subjectSymbol,
  };

  const deterministic = runDeterministicChecks(ctx);
  const deterministicByClaimId = new Set(
    deterministic.violations.map((v) => v.claimId).filter((id): id is string => id !== null),
  );

  let modelByClaimId = new Set<string>();
  if (modelVerify !== null) {
    const modelResult = await modelVerify(ctx);
    if (modelResult.kind === 'ok') {
      modelByClaimId = new Set(
        modelResult.results.filter((r) => r.verdict !== 'supported').map((r) => r.claimId),
      );
    }
    // A model-verification error/timeout is conservatively treated the same as F11's own
    // production behaviour (`resolveVerification`): it withholds, i.e. it does not add any
    // claim-level catches beyond what deterministic checks already found — never silently
    // credited as "caught everything".
  }

  const allClaimIds = [file.meta.faultyClaimId, ...file.meta.cleanClaimIds];
  const claims: ClaimCatch[] = allClaimIds.map((claimId) => ({
    claimId,
    caughtByDeterministic: deterministicByClaimId.has(claimId),
    caughtByModel: modelByClaimId.has(claimId),
  }));

  return {
    answerId: file.meta.id,
    faultClass: file.meta.faultClass,
    faultyClaimId: file.meta.faultyClaimId,
    cleanClaimIds: file.meta.cleanClaimIds,
    claims,
  };
}

export type VerifierMeasurement = {
  readonly catchRate: string;
  readonly falsePositiveRate: string;
  readonly totalFaulty: number;
  readonly caughtFaulty: number;
  readonly totalClean: number;
  readonly caughtClean: number;
  readonly byFaultClass: Readonly<Record<string, { readonly total: number; readonly caught: number }>>;
  /** `false` when no model-verification callback was supplied — B7/B8 then reflect only the
   * seven deterministically-catchable fault classes plus false positives that deterministic
   * checks alone happen to catch, not the full nine-class measurement F12 §4.2 asks for. */
  readonly modelVerificationRan: boolean;
};

export const B7_CATCH_RATE_GATE = '0.90';
export const B8_FALSE_POSITIVE_RATE_GATE = '0.10';

export function aggregateVerifierMeasurement(
  verdicts: readonly SeededAnswerVerdict[],
  modelVerificationRan: boolean,
): VerifierMeasurement {
  let totalFaulty = 0;
  let caughtFaulty = 0;
  let totalClean = 0;
  let caughtClean = 0;
  const byFaultClass: Record<string, { total: number; caught: number }> = {};

  for (const verdict of verdicts) {
    const bucket = (byFaultClass[verdict.faultClass] ??= { total: 0, caught: 0 });
    for (const claim of verdict.claims) {
      const caught = claim.caughtByDeterministic || claim.caughtByModel;
      if (claim.claimId === verdict.faultyClaimId) {
        totalFaulty += 1;
        if (caught) caughtFaulty += 1;
        bucket.total += 1;
        if (caught) bucket.caught += 1;
      } else {
        totalClean += 1;
        if (caught) caughtClean += 1;
      }
    }
  }

  const catchRate = totalFaulty === 0 ? '0' : new D(caughtFaulty).dividedBy(totalFaulty).toFixed(4);
  const falsePositiveRate = totalClean === 0 ? '0' : new D(caughtClean).dividedBy(totalClean).toFixed(4);

  return { catchRate, falsePositiveRate, totalFaulty, caughtFaulty, totalClean, caughtClean, byFaultClass, modelVerificationRan };
}

export function b7Passes(measurement: VerifierMeasurement): boolean {
  return new D(measurement.catchRate).greaterThanOrEqualTo(new D(B7_CATCH_RATE_GATE));
}

export function b8Passes(measurement: VerifierMeasurement): boolean {
  return new D(measurement.falsePositiveRate).lessThanOrEqualTo(new D(B8_FALSE_POSITIVE_RATE_GATE));
}
