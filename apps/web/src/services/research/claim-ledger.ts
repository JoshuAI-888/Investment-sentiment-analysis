/**
 * F11 §4.6 — the claim ledger.
 *
 * "Every material claim → `{claimId, text, kind, evidenceIds[], metricIds[], verifierVerdict}`.
 * The ledger is what makes 'every claim resolves to a source' auditable rather than
 * aspirational, and it is what a retraction later points at."
 *
 * Built once per run, from the same flattened claim list the verifier already scored — never
 * recomputed from prose, since the ledger's whole point is to be the *record* of what was
 * checked, not a second guess at it.
 */
import { claimLedgerEntry } from '@/contracts/research';
import type { NewClaimLedgerEntry } from './ports';
import type { FlatClaim } from './synthesis';
import { runPerClaimDeterministicChecks, type VerifierContext } from './verifier/checks';
import type { ModelVerificationVerdict } from './verifier/model-pass';

/** A nil UUID stands in for the not-yet-assigned `id` — this only validates shape, never persists. */
const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Re-checks every built entry against `claimLedgerEntry`'s own refine (product invariant §6.3:
 * "every material factual claim resolves to an evidence_item or a calculation_id"). A synthesis
 * claim that slipped an empty `evidenceIds`/`metricIds` past the eight text-scanning checks
 * (none of which asserts *presence*, only that what *is* cited resolves) would otherwise reach
 * `repo.insertClaims` and fail there — too late to withhold the prose it belongs to. Returns the
 * zod issue messages for every entry that fails, empty when every entry is well-formed.
 */
export function validateLedgerShape(entries: readonly NewClaimLedgerEntry[]): readonly string[] {
  return entries.flatMap((entry) => {
    const result = claimLedgerEntry.safeParse({ ...entry, id: entry.id ?? PLACEHOLDER_ID });
    return result.success ? [] : result.error.issues.map((issue) => `${entry.claimText}: ${issue.message}`);
  });
}

/** `claim.materiality`: F11 §4.6 does not spell out the split, so this lane draws the line the
 * same way `contracts/research.ts`'s own refine does — a `fact`/`calculation` claim is what the
 * ledger's support requirement binds on, so those are `material`; `interpretation`/`hypothesis`
 * claims (a bullish/bearish "case" is inherently interpretive) are `supporting`. */
function materialityFor(claim: FlatClaim): 'material' | 'supporting' {
  return claim.kind === 'fact' || claim.kind === 'calculation' ? 'material' : 'supporting';
}

export type BuildClaimLedgerArgs = {
  runId: string;
  claims: readonly FlatClaim[];
  ctx: VerifierContext;
  /** `null` when the whole run was withheld by a verifier error/timeout before this pass ran — every claim becomes `withheld`. */
  modelVerdict: ModelVerificationVerdict | null;
};

export function buildClaimLedger(args: BuildClaimLedgerArgs): readonly NewClaimLedgerEntry[] {
  const verdictByIndex = new Map(
    (args.modelVerdict?.verdicts ?? []).map((verdict) => [verdict.claimIndex, verdict]),
  );

  return args.claims.map((claim, index) => {
    const deterministic = runPerClaimDeterministicChecks(claim, args.ctx);
    const modelVerdict = verdictByIndex.get(index) ?? null;

    // A claim's own deterministic failure is checked first, regardless of whether the run-wide
    // model pass ever ran — the offending claim itself is `contradicted`, not merely `withheld`
    // pending a check the orchestrator skipped precisely *because* this claim already failed
    // (`orchestrator.ts` never spends the model-verification budget once any deterministic check
    // fails). `withheld` is reserved for a claim that passed every check code can run but whose
    // one remaining check — the model pass — never completed for the whole run (its own
    // timeout/error, `F-10`).
    const verificationStatus = (() => {
      if (!deterministic.passed) return 'contradicted' as const;
      if (args.modelVerdict === null) return 'withheld' as const;
      if (modelVerdict === null) return 'unverified' as const;
      return modelVerdict.supported ? ('verified' as const) : ('unsupported' as const);
    })();

    const notes = [...deterministic.failures, ...(modelVerdict === null ? [] : [modelVerdict.rationale])];

    return {
      runId: args.runId,
      claimText: claim.text,
      claimType: claim.kind,
      materiality: materialityFor(claim),
      evidenceIds: claim.evidenceIds,
      metricIds: claim.metricIds,
      verificationStatus,
      verifierNotes: notes.length === 0 ? null : notes.join(' | '),
    };
  });
}
