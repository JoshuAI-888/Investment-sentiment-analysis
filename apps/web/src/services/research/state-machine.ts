/**
 * F11 §4.1 — the research state machine, as data.
 *
 * ```
 * queued → gathering → analyzing → synthesizing → verifying → complete
 *                                               ↘ verification_failed   (F-10)
 *               ↘ abstained (insufficient evidence)
 *               ↘ degraded (deterministic metrics only; prose timed out or withheld)
 *               ↘ failed
 * complete|degraded → retracted   (operator action, F-20)
 * ```
 *
 * Ten states, matching the diagram exactly (`queued`, `gathering`, `analyzing`,
 * `synthesizing`, `verifying`, `complete`, `verification_failed`, `abstained`, `degraded`,
 * `failed`); `retracted` is a distinct, operator-applied overlay only ever reached from
 * `complete`/`degraded` (`retraction.ts`), and `cancelled` is the merged `researchRunStatus`
 * enum's ninth value with no path into it from this orchestrator today (no user-cancel action
 * exists yet) — accepted here as a valid terminal status so the type stays exhaustive over the
 * real DB enum, per `contracts/research.ts`'s docstring: `gathering`/`analyzing`/
 * `synthesizing`/`verifying` are **not** separate `research_run.status` values — see
 * `MEMORY.md` D-42 and migration `0014`. They map to `status = 'running'` plus a
 * `research_event` row naming the sub-stage, which is what `dbStatusFor` below encodes.
 */
import type { ResearchRunStatus } from './ports';

export const RESEARCH_STAGES = [
  'queued',
  'gathering',
  'analyzing',
  'synthesizing',
  'verifying',
  'complete',
  'verification_failed',
  'abstained',
  'degraded',
  'failed',
] as const;

export type ResearchStage = (typeof RESEARCH_STAGES)[number];

/**
 * The DB column a stage is persisted under. Sub-stages collapse to `'running'` (see module doc).
 * An explicit switch, not `RUNNING_SUBSTAGES.has(stage) ? 'running' : stage` — the ternary's
 * `else` branch types as the full `ResearchStage` union, which includes the four sub-stage
 * names that are not valid `ResearchRunStatus` values at all; the switch is what makes that a
 * compile error instead of a value TypeScript would otherwise accept structurally.
 */
export function dbStatusFor(stage: ResearchStage): ResearchRunStatus {
  switch (stage) {
    case 'gathering':
    case 'analyzing':
    case 'synthesizing':
    case 'verifying':
      return 'running';
    case 'queued':
    case 'complete':
    case 'verification_failed':
    case 'abstained':
    case 'degraded':
    case 'failed':
      return stage;
  }
}

export const TERMINAL_STAGES: ReadonlySet<ResearchStage> = new Set([
  'complete',
  'verification_failed',
  'abstained',
  'degraded',
  'failed',
]);

export function isTerminal(stage: ResearchStage): boolean {
  return TERMINAL_STAGES.has(stage);
}

/** Only these two starting states may ever be retracted (F11 §4.1's last line). */
export const RETRACTABLE_STATUSES: ReadonlySet<ResearchRunStatus> = new Set(['complete', 'degraded']);

/**
 * A per-run sequence generator for `research_event.sequence` (the table's primary key is
 * `(run_id, sequence)` — global, cross-run state would be both wrong and untestable). One
 * instance is created per `runResearch` call in `orchestrator.ts`; nothing shares it.
 */
export function createSequenceCounter(): () => number {
  let next = 0;
  return () => {
    const current = next;
    next += 1;
    return current;
  };
}
