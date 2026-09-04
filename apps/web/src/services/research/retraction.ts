/**
 * F11 §4.8 / F-20 — run retraction.
 *
 * "An operator can mark a run `retracted` with a reason and an actor. The retraction is visible
 * everywhere the run renders, including any shared snapshot. Nothing is deleted: the run, its
 * claims, its evidence links and its artifacts remain for audit."
 *
 * This module enforces the one precondition F11 §4.1's diagram states (`complete|degraded →
 * retracted`) before delegating to the repository port — `ResearchRepositoryPort.retractRun`
 * (`ports.ts`) additionally enforces it at its own boundary so a future caller that skips this
 * function cannot bypass the rule either. Nothing here issues a delete of any kind; the
 * append-only `research_event` row this writes is the only new fact.
 *
 * **`02-ARCHITECTURE-CONTRACTS.md` §8, all four (lane-review finding 8):** "Every mutation is a
 * server action or POST route with server-side authorization, zod input validation, an
 * optimistic-concurrency check, reason capture and an `audit_event` write." Before this fix, only
 * "reason capture" was true — there was no entry point at all, no concurrency check, and no
 * audit trail. `app/api/research/[runId]/retract/route.ts` is the entry point (`requireAdmin()`
 * for authorization, zod for the body); `expectedStatus` below is the concurrency check; the
 * `AuditPort` call is the audit write.
 */
import type { ResearchRun } from '@/contracts/research';
import { RETRACTABLE_STATUSES } from './state-machine';
import { RetractionError, type AuditPort, type ResearchRepositoryPort, type ResearchRunStatus } from './ports';
import type { Clock } from '@/adapters/ports';

export type RetractRunArgs = {
  runId: string;
  reason: string;
  actor: string;
  /** ARCH §8's optimistic-concurrency check — the status the caller last observed the run at. */
  expectedStatus: ResearchRunStatus;
};

export async function retractRun(
  repo: ResearchRepositoryPort,
  clock: Clock,
  audit: AuditPort,
  args: RetractRunArgs,
): Promise<ResearchRun> {
  const run = await repo.getRun(args.runId);
  const at = clock.now();

  async function fail(message: string): Promise<never> {
    await audit.record({
      actorId: args.actor,
      actorRole: 'admin',
      action: 'research.retract',
      objectType: 'research_run',
      objectId: args.runId,
      reason: args.reason,
      result: 'rejected',
      beforeValue: run === null ? null : { status: run.status },
      afterValue: null,
      occurredAt: at,
    });
    throw new RetractionError(message);
  }

  if (run === null) {
    return fail(`research_run ${args.runId} does not exist.`);
  }
  if (args.reason.trim() === '') {
    return fail('A retraction reason is required (R-18: "a retraction with no reason is indistinguishable from a bug").');
  }
  if (!RETRACTABLE_STATUSES.has(run.status)) {
    return fail(
      `research_run ${args.runId} is "${run.status}" — only a run that is "complete" or "degraded" ` +
        'may be retracted (F11 §4.1). A run that never produced anything has nothing to retract.',
    );
  }
  if (run.status !== args.expectedStatus) {
    return fail(
      `research_run ${args.runId} is now "${run.status}", not the "${args.expectedStatus}" this request was made against — ` +
        'it changed since the caller last read it (ARCH §8 optimistic-concurrency check).',
    );
  }

  const retracted = await repo.retractRun({
    runId: args.runId,
    reason: args.reason,
    actor: args.actor,
    at,
    expectedStatus: args.expectedStatus,
  });

  const events = await repo.listEvents(args.runId);
  const sequence = events.length === 0 ? 0 : Math.max(...events.map((event) => event.sequence)) + 1;
  await repo.appendEvent({
    runId: args.runId,
    sequence,
    eventType: 'retraction',
    label: 'retracted',
    payload: { kind: 'outcome', status: 'retracted', reason: args.reason },
    createdAt: at,
  });

  await audit.record({
    actorId: args.actor,
    actorRole: 'admin',
    action: 'research.retract',
    objectType: 'research_run',
    objectId: args.runId,
    reason: args.reason,
    result: 'success',
    beforeValue: { status: run.status },
    afterValue: { status: retracted.status, retractedReason: retracted.retractedReason },
    occurredAt: at,
  });

  return retracted;
}
