/**
 * F11 §4.5 — "one bounded model pass for what code cannot check: does each claim actually follow
 * from its cited evidence? Strict schema, temperature 0, its own task route."
 *
 * **F-10, binding:** "a verifier error or timeout means the run lands in `verification_failed`
 * and prose is withheld." This module never throws past its own boundary and never silently
 * treats a failure as a pass — `runModelVerificationPass` returns a tagged result, and the
 * orchestrator is the only place that decides what a `timeout` or `error` outcome means for the
 * run's state (`orchestrator.ts`).
 *
 * D-34: the model here is `AI_MODEL_VERIFY`, bound through the `ModelClient`'s `'verify'` task
 * route — a different vendor from `AI_MODEL_SYNTHESIS`, enforced at env-boot time
 * (`src/env.ts`), not re-checked here. "A model checking itself is not a check."
 */
import { z } from 'zod';
import type { Clock } from '@/adapters/ports';
import type { ModelClient } from '../ports';
import type { FlatClaim } from '../synthesis';
import { withDeadline } from '../latency-budget';

export const modelVerificationVerdict = z.object({
  verdicts: z.array(
    z.object({
      /** Index into the flattened claim list this pass was given — not a free-text quote-back. */
      claimIndex: z.number().int().nonnegative(),
      supported: z.boolean(),
      rationale: z.string().min(1),
    }),
  ),
});
export type ModelVerificationVerdict = z.infer<typeof modelVerificationVerdict>;

export type ModelVerificationOutcome =
  | { outcome: 'ok'; verdict: ModelVerificationVerdict }
  | { outcome: 'timeout' }
  | { outcome: 'error'; error: unknown };

function buildVerificationPrompt(claims: readonly FlatClaim[], evidenceSummary: string): string {
  const claimLines = claims
    .map((claim, index) => `${String(index)}. [${claim.section}] "${claim.text}" (cites: ${claim.evidenceIds.join(', ') || 'none'})`)
    .join('\n');

  return [
    'You are the independent claim verifier. For each numbered claim below, decide whether it',
    'actually follows from the evidence items it cites. Do not use outside knowledge. A claim',
    'that cites nothing can never be "supported" — mark it unsupported.',
    '',
    'Claims:',
    claimLines,
    '',
    'Evidence:',
    evidenceSummary,
  ].join('\n');
}

export async function runModelVerificationPass(
  model: ModelClient,
  claims: readonly FlatClaim[],
  evidenceSummary: string,
  clock: Clock,
  budgetMs: number,
): Promise<ModelVerificationOutcome> {
  if (claims.length === 0) {
    return { outcome: 'ok', verdict: { verdicts: [] } };
  }

  try {
    const timed = await withDeadline(
      model.verify(
        'verify',
        { prompt: buildVerificationPrompt(claims, evidenceSummary), context: {} },
        modelVerificationVerdict,
      ),
      budgetMs,
      clock,
    );
    if (timed.timedOut) return { outcome: 'timeout' };
    return { outcome: 'ok', verdict: timed.value };
  } catch (error) {
    return { outcome: 'error', error };
  }
}
