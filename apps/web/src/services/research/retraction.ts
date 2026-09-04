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
 */
import type { ResearchRun } from '@/contracts/research';
import { RETRACTABLE_STATUSES } from './state-machine';
import { RetractionError, type ResearchRepositoryPort } from './ports';
import type { Clock } from '@/adapters/ports';

export type RetractRunArgs = {
  runId: string;
  reason: string;
  actor: string;
};

export async function retractRun(
  repo: ResearchRepositoryPort,
  clock: Clock,
  args: RetractRunArgs,
): Promise<ResearchRun> {
  const run = await repo.getRun(args.runId);
  if (run === null) {
    throw new RetractionError(`research_run ${args.runId} does not exist.`);
  }
  if (!RETRACTABLE_STATUSES.has(run.status)) {
    throw new RetractionError(
      `research_run ${args.runId} is "${run.status}" — only a run that is "complete" or "degraded" ` +
        'may be retracted (F11 §4.1). A run that never produced anything has nothing to retract.',
    );
  }
  if (args.reason.trim() === '') {
    throw new RetractionError('A retraction reason is required (R-18: "a retraction with no reason is indistinguishable from a bug").');
  }

  const at = clock.now();
  const retracted = await repo.retractRun({ runId: args.runId, reason: args.reason, actor: args.actor, at });

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

  return retracted;
}
