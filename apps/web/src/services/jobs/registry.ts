/**
 * The job-handler registry — `job_key` → the function that actually does the work.
 *
 * F16 §3: "the internal job service shared by scheduled, triggered and manual paths." This is
 * the extension point that keeps it shared: `JobService.execute` (`service.ts`) never has a
 * `switch` over job keys, and adding a new job (the very next one being `substack.collect`,
 * landing right after this feature) is one call to `registerJobHandler` in `handlers/index.ts`,
 * never a change to this file or to `service.ts` itself.
 *
 * **Dry run (F16 §4.4) is a property of the handler, not of this registry.** Every handler must
 * check `ctx.dryRun` itself, before it makes its first external call, and return a description
 * instead — "makes zero external calls" is a per-handler discipline this module cannot enforce
 * structurally, only by convention and by the DoD's own test (`handlers/*.test.ts`).
 */
import type { Queryable } from '@/repositories/client';
import type { JobDefinition, JobRun } from '@/contracts/operations';
import type { RedisClient } from './redis';

export type TerminalJobRunStatus = 'succeeded' | 'degraded' | 'failed' | 'cancelled' | 'skipped';

/** What a handler asks `JobService` to do on its behalf when it wants to open a triggered job. */
export type DispatchTriggeredJobInput = {
  readonly jobDefinition: JobDefinition;
  /** Distinguishes this triggered run from any other opened by the same tick (F16 §4.1b). */
  readonly extraIdempotencyComponent: string;
  readonly requestReason: string;
};

export type DispatchTriggeredJobResult = {
  readonly outcome: 'executed' | 'already_claimed' | 'concurrency_skipped';
  readonly run: JobRun | null;
};

export type JobHandlerContext = {
  readonly db: Queryable;
  readonly redis: RedisClient;
  /** The instant this run is executing at — not the job's own `next_due_at`. */
  readonly now: Date;
  /** The due instant this specific run was claimed for (F16 §4.1 step 4's `due_at`). */
  readonly dueAt: Date;
  readonly dryRun: boolean;
  readonly jobRun: JobRun;
  readonly jobDefinition: JobDefinition;
  /**
   * F16 §4.1b: how a handler (today, only `market-data.poll`) opens a bounded trigger window
   * through the identical `JobService` path, lock and idempotency machinery a scheduled or
   * manual run uses — never a second, parallel execution path. Injected here rather than
   * imported directly from `service.ts` so `service.ts` and the handlers can depend on each
   * other in exactly one direction (`service.ts` imports the registry and the handlers register
   * into it; a handler never imports `service.ts`), avoiding a circular import between the file
   * that dispatches and the file that decides to open a trigger.
   */
  readonly dispatchTriggeredJob: (input: DispatchTriggeredJobInput) => Promise<DispatchTriggeredJobResult>;
};

export type JobHandlerOutcome = {
  readonly status: TerminalJobRunStatus;
  readonly itemsRead?: number;
  readonly itemsWritten?: number;
  readonly providerCalls?: number;
  readonly estimatedCostUsd?: string;
  readonly unpricedUnits?: unknown;
  readonly error?: unknown;
  readonly metrics?: unknown;
  readonly dataAsOf?: Date | null;
  /**
   * F16 §4.4: populated only on a dry run, in place of any real work. `service.ts` folds this
   * into the recorded `job_run.metrics` so a dry run is still inspectable after the fact.
   */
  readonly dryRunSummary?: {
    readonly willCall: readonly string[];
    readonly estimatedCostUsd: string;
    readonly message: string;
  };
};

export type JobHandler = (ctx: JobHandlerContext) => Promise<JobHandlerOutcome>;

const handlers = new Map<string, JobHandler>();

/** Throws on a duplicate registration — two handlers for one `job_key` is a build-time mistake,
 *  not a runtime condition to tolerate silently. */
export function registerJobHandler(jobKey: string, handler: JobHandler): void {
  if (handlers.has(jobKey)) {
    throw new Error(`a job handler is already registered for '${jobKey}' — registration must be exactly once per job_key`);
  }
  handlers.set(jobKey, handler);
}

export function getJobHandler(jobKey: string): JobHandler | undefined {
  return handlers.get(jobKey);
}

/** Test-only: lets a test register a fake handler without leaking into the next test file. */
export function resetJobHandlersForTesting(): void {
  handlers.clear();
}
