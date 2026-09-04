/**
 * Combines the deterministic checks (`deterministic-checks.ts`) with the bounded model
 * verification pass (F11 §4.5) into one run-level verdict, and builds the claim ledger entries
 * that verdict implies.
 *
 * **The rule this module exists to make impossible to get around:** prose is published only when
 * *every* deterministic check passes *and* the model verifier judges *every* claim `supported`.
 * Any deterministic failure, any model-verifier `unsupported`/`contradicted` verdict, or any
 * model-verifier error/timeout all resolve to the same outcome — `verification_failed`, prose
 * withheld — the only thing that differs is what the claim ledger records happened.
 */
import type { SynthesisOutput } from './schema';
import { modelVerifyOutput, type ModelVerifyClaimResult } from './schema';
import { allClaims, runDeterministicChecks, type VerifyContext, type CheckResult } from './deterministic-checks';
import { verifySystemPrompt, VERIFY_PROMPT_VERSION } from './prompts';
import type { ResearchModelClient } from './model-tasks';
import type { NewClaimLedgerEntry } from '@/repositories/research';

export type VerificationOutcome =
  | { readonly kind: 'verified'; readonly claims: readonly NewClaimLedgerEntry[] }
  | {
      readonly kind: 'verification_failed';
      readonly claims: readonly NewClaimLedgerEntry[];
      readonly reason: string;
    };

function materialityOf(kind: string): 'material' | 'supporting' {
  // Every claim this feature emits is offered as load-bearing content of the answer — F11 §4.6:
  // "every material claim ... resolves to an evidence_item or a calculation_id" is the exact
  // guarantee this whole verifier exists to make real, so nothing here is downgraded to
  // 'supporting' just to dodge the claim_ledger DB constraint that only binds 'material' rows.
  void kind;
  return 'material';
}

function withheldEntries(runId: string, output: SynthesisOutput, notes: string): NewClaimLedgerEntry[] {
  return allClaims(output).map((claim) => ({
    runId,
    claimText: claim.text,
    claimType: claim.kind,
    materiality: materialityOf(claim.kind),
    evidenceIds: claim.evidenceIds,
    metricIds: claim.metricIds,
    verificationStatus: 'withheld' as const,
    verifierNotes: notes,
  }));
}

export type RunModelVerificationInput = {
  readonly runId: string;
  readonly output: SynthesisOutput;
  readonly client: ResearchModelClient;
  readonly maxOutputTokens: number;
};

export type ModelVerificationResult =
  | { readonly kind: 'ok'; readonly results: readonly ModelVerifyClaimResult[] }
  | { readonly kind: 'error'; readonly detail: string };

/** The one bounded model call (F11 §4.5). A schema-invalid, upstream, or budget-denied response is `'error'` — never coerced into a verdict. */
export async function runModelVerification(input: RunModelVerificationInput): Promise<ModelVerificationResult> {
  const claims = allClaims(input.output);
  const prompt = JSON.stringify({
    claims: claims.map((claim) => ({
      claimId: claim.claimId,
      text: claim.text,
      evidenceIds: claim.evidenceIds,
      metricIds: claim.metricIds,
    })),
  });

  const result = await input.client.run(
    {
      task: 'verify',
      promptVersion: VERIFY_PROMPT_VERSION,
      system: verifySystemPrompt(),
      prompt,
      maxOutputTokens: input.maxOutputTokens,
    },
    modelVerifyOutput,
  );

  if (!result.ok) {
    return { kind: 'error', detail: `${result.error.kind}: ${JSON.stringify(result.error)}` };
  }
  return { kind: 'ok', results: result.data.results };
}

/**
 * Runs the deterministic checks, and — only when they all pass — folds in an already-run model
 * verification result to produce the final outcome and claim ledger. `modelVerification` is
 * `null` for a claim-free draft (nothing to verify) or when the caller has not run the model
 * pass yet; passing `{kind: 'error', ...}` is how a timeout/error is threaded through.
 */
export function resolveVerification(
  runId: string,
  ctx: VerifyContext,
  modelVerification: ModelVerificationResult | null,
): VerificationOutcome {
  const deterministic: CheckResult = runDeterministicChecks(ctx);

  if (!deterministic.ok) {
    const summary = deterministic.violations.map((violation) => violation.detail).join('; ');
    return {
      kind: 'verification_failed',
      claims: withheldEntries(runId, ctx.output, `deterministic check failed: ${summary}`),
      reason: `deterministic verification failed (${String(deterministic.violations.length)} violation(s)): ${summary}`,
    };
  }

  if (modelVerification === null) {
    return {
      kind: 'verification_failed',
      claims: withheldEntries(runId, ctx.output, 'model verification pass did not run'),
      reason: 'model verification pass did not run',
    };
  }

  if (modelVerification.kind === 'error') {
    return {
      kind: 'verification_failed',
      claims: withheldEntries(runId, ctx.output, `model verification error: ${modelVerification.detail}`),
      reason: `model verification pass failed: ${modelVerification.detail}`,
    };
  }

  const claims = allClaims(ctx.output);
  const verdictByClaimId = new Map(modelVerification.results.map((entry) => [entry.claimId, entry]));

  const entries: NewClaimLedgerEntry[] = claims.map((claim) => {
    const verdict = verdictByClaimId.get(claim.claimId);
    const verificationStatus =
      verdict === undefined
        ? ('withheld' as const)
        : verdict.verdict === 'supported'
          ? ('verified' as const)
          : verdict.verdict === 'contradicted'
            ? ('contradicted' as const)
            : ('unsupported' as const);
    return {
      runId,
      claimText: claim.text,
      claimType: claim.kind,
      materiality: materialityOf(claim.kind),
      evidenceIds: claim.evidenceIds,
      metricIds: claim.metricIds,
      verificationStatus,
      verifierNotes: verdict === null || verdict === undefined ? 'no model verdict returned for this claim' : verdict.reason,
    };
  });

  const allSupported = entries.every((entry) => entry.verificationStatus === 'verified');
  if (allSupported) {
    return { kind: 'verified', claims: entries };
  }

  const failing = entries.filter((entry) => entry.verificationStatus !== 'verified');
  return {
    kind: 'verification_failed',
    // Re-emit with 'withheld' as the persisted status for the *published* ledger, per this
    // module's own rule that a failed run withholds prose entirely — but the actual model
    // verdict is preserved in `verifierNotes` rather than discarded, so the audit trail still
    // shows what the model actually said, not just that the run failed.
    claims: entries.map((entry) => ({
      ...entry,
      verificationStatus: 'withheld' as const,
      verifierNotes:
        entry.verificationStatus === 'verified'
          ? `model verdict: supported (run withheld overall — ${String(failing.length)} other claim(s) failed verification)`
          : `model verdict: ${entry.verificationStatus} — ${entry.verifierNotes}`,
    })),
    reason: `${String(failing.length)} of ${String(entries.length)} claim(s) failed model verification`,
  };
}
