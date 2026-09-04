/**
 * F11 §4.2 — the staged latency budget, as data and as a timing helper.
 *
 * "The 30s p95 is decomposed and each stage is individually bounded and measured." Each row's
 * "on overrun" behaviour differs (some stages proceed with a partial result and a recorded gap;
 * deterministic analysis hard-fails; synthesis and verification each demote the run to a named
 * terminal state) — this file only supplies the numbers and the generic race-a-timer mechanism.
 * The overrun *behaviour* for each stage lives in `orchestrator.ts`, next to the transition it
 * causes, not here.
 */
import type { Clock } from '@/adapters/ports';

export const STAGE_BUDGET_MS = {
  fanOut: 8_000,
  deterministicAnalysis: 1_000,
  classification: 6_000,
  synthesis: 10_000,
  verification: 4_000,
} as const;

/** F11 §4.2's row: "Total wall clock | 30 s hard cap | whatever has completed is returned." */
export const TOTAL_BUDGET_MS = 30_000;

export type TimedResult<T> = { value: T; elapsedMs: number; timedOut: false } | { value: null; elapsedMs: number; timedOut: true };

/**
 * Races `promise` against `budgetMs` using the injected `clock`, never `setTimeout` directly —
 * so every timeout branch in this feature's tests is driven by a fake clock instead of a real
 * wall-clock sleep (`04-BUILD-LOOP.md` §2.4: a test that waits on real time is a slow, flaky
 * test for no benefit here).
 *
 * This does **not** cancel `promise` — there is no cross-cutting cancellation primitive for an
 * arbitrary port call, and inventing one here would be exactly the kind of contract this lane
 * does not own (`ports.ts`'s docstring). A caller that must not leave the losing side running
 * passes an `AbortSignal` through its own port method instead; `withDeadline` only decides which
 * side the orchestrator acts on first.
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  budgetMs: number,
  clock: Clock,
): Promise<TimedResult<T>> {
  const startedAt = clock.now().getTime();

  const timeout: Promise<{ timedOut: true }> = clock
    .sleep(budgetMs)
    .then(() => ({ timedOut: true as const }));

  const work: Promise<{ timedOut: false; value: T }> = promise.then((value) => ({
    timedOut: false as const,
    value,
  }));

  const result = await Promise.race([work, timeout]);
  const elapsedMs = clock.now().getTime() - startedAt;

  if (result.timedOut) {
    return { value: null, elapsedMs, timedOut: true };
  }
  return { value: result.value, elapsedMs, timedOut: false };
}
