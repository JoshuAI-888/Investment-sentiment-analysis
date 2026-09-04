/**
 * F16 §4.2 / ADR-013 — the job-definition edit mutation, run through the same uniform 8-step
 * pipeline every other admin mutation uses (`services/admin/mutation.ts`, F15 §4.1).
 *
 * **Editable, and only these**: due times (`nextDueAt`), cadence (`scheduleType` +
 * `scheduleExpression`, edited together — see the schema's own refine — plus `displayTimezone`),
 * enabled state, retry policy (`maxAttempts` + `backoffPolicy`), per-job budget ceiling
 * (`maxCostUsdPerRun`). `jobUpdateSchema` below has no field for `jobKey`, `scope`, `priority`,
 * `maxRuntimeSeconds`, `concurrencyPolicy`, `dependencies`, `maxCallsPerRun`, `triggerEligible`
 * or `configVersion` — those are absent from the schema, not merely unused, so there is no way to
 * express an edit to them through this route at all. **Nothing in this file, or anything it
 * calls, ever touches the QStash schedule, `vercel.json`, or the dispatch secret** (ADR-013, F16
 * §4.2 — a named review item; `tests/unit/services/jobs/adr-013-invariants.test.ts` is extended
 * by this feature to check this file structurally, the same way it already checks F16a's).
 */
import { z } from 'zod';
import type { Queryable } from '@/repositories/client';
import { decimalString } from '@/contracts/primitives';
import { scheduleType as scheduleTypeSchema, type JobDefinition } from '@/contracts/operations';
import { findJobDefinitionById, updateJobDefinition } from '@/repositories/jobs';
import { AdminMutationConflictError } from './errors';
import { ADMIN_ENVIRONMENT } from './constants';
import { cadenceOrDueTimeChanged, previewNextDueAt } from './job-schedule-preview';
import type { AdminMutationBase, LoadedCurrent, MutationDefinition } from './mutation';

const EDITABLE_FIELD_NAMES = [
  'nextDueAt',
  'scheduleType',
  'scheduleExpression',
  'displayTimezone',
  'enabled',
  'maxAttempts',
  'backoffPolicy',
  'maxCostUsdPerRun',
] as const;

export const jobUpdateSchema = z
  .object({
    reason: z.string().min(3, 'a change reason is required'),
    expectedVersion: z.string().regex(/^\d+$/, "expectedVersion must be the job's current version number"),
    jobId: z.string().uuid(),
    nextDueAt: z.string().datetime().optional(),
    scheduleType: scheduleTypeSchema.optional(),
    scheduleExpression: z.string().min(1).optional(),
    displayTimezone: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    maxAttempts: z.number().int().positive().optional(),
    backoffPolicy: z.record(z.unknown()).optional(),
    maxCostUsdPerRun: decimalString.nullable().optional(),
  })
  .superRefine((input, ctx) => {
    if (!EDITABLE_FIELD_NAMES.some((field) => input[field] !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `at least one editable field must be supplied (${EDITABLE_FIELD_NAMES.join(', ')})`,
      });
    }
    // §4.2's "cadence" is one edit, not two independently-drifting halves — a `scheduleType`
    // change with no new `scheduleExpression` (or vice versa) would leave the row's type and
    // expression inconsistent with either the old cadence or the new one.
    const cadenceFieldsGiven = [input.scheduleType, input.scheduleExpression].filter((v) => v !== undefined).length;
    if (cadenceFieldsGiven === 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduleExpression'],
        message: 'scheduleType and scheduleExpression must be edited together, not one at a time',
      });
    }
  });
export type JobUpdateInput = z.infer<typeof jobUpdateSchema> & AdminMutationBase;

async function loadCurrentJob(input: JobUpdateInput, tx: Queryable): Promise<LoadedCurrent | null> {
  const job = await findJobDefinitionById(input.jobId, tx);
  if (job === null) return null;
  return { objectId: job.id, version: String(job.version), snapshot: job };
}

function scheduleEditFrom(input: JobUpdateInput): {
  readonly nextDueAt?: Date | undefined;
  readonly scheduleType?: JobDefinition['scheduleType'] | undefined;
  readonly scheduleExpression?: string | undefined;
  readonly displayTimezone?: string | undefined;
} {
  return {
    nextDueAt: input.nextDueAt === undefined ? undefined : new Date(input.nextDueAt),
    scheduleType: input.scheduleType,
    scheduleExpression: input.scheduleExpression,
    displayTimezone: input.displayTimezone,
  };
}

export const updateJobMutation: MutationDefinition<JobUpdateInput> = {
  objectType: 'job_definition',
  action: 'job.update',
  environment: ADMIN_ENVIRONMENT,
  schema: jobUpdateSchema,
  loadCurrent: loadCurrentJob,
  // Pure read, per `MutationDefinition.impactPreview`'s own contract — `previewNextDueAt` is a
  // pure function (F16a's `computeNextDueAt` underneath it is too), so this never writes.
  impactPreview: async (input, current, _tx) => {
    if (current === null) {
      return { found: false, jobId: input.jobId };
    }
    const job = current.snapshot as JobDefinition;
    const edit = scheduleEditFrom(input);
    const newNextDueAt = previewNextDueAt(job, edit, new Date());

    return {
      found: true,
      jobKey: job.jobKey,
      previousNextDueAt: job.nextDueAt.toISOString(),
      newNextDueAt: newNextDueAt.toISOString(),
      previousEnabled: job.enabled,
      newEnabled: input.enabled ?? job.enabled,
      previousScheduleType: job.scheduleType,
      newScheduleType: input.scheduleType ?? job.scheduleType,
      previousScheduleExpression: job.scheduleExpression,
      newScheduleExpression: input.scheduleExpression ?? job.scheduleExpression,
      previousDisplayTimezone: job.displayTimezone,
      newDisplayTimezone: input.displayTimezone ?? job.displayTimezone,
      previousMaxAttempts: job.maxAttempts,
      newMaxAttempts: input.maxAttempts ?? job.maxAttempts,
      previousMaxCostUsdPerRun: job.maxCostUsdPerRun,
      newMaxCostUsdPerRun: input.maxCostUsdPerRun === undefined ? job.maxCostUsdPerRun : input.maxCostUsdPerRun,
    };
  },
  write: async (input, current, tx) => {
    if (current === null) {
      throw new Error(`job_definition ${input.jobId} does not exist.`);
    }
    const job = current.snapshot as JobDefinition;
    const edit = scheduleEditFrom(input);
    // Only actually move `next_due_at` when the admin explicitly asked to — a direct override, or
    // a cadence swap that invalidates the old due instant's meaning. An edit that touches only
    // `enabled`, retry policy, or the budget ceiling must not silently nudge the schedule too.
    const nextDueAt = cadenceOrDueTimeChanged(edit) ? previewNextDueAt(job, edit, new Date()) : undefined;

    const updated = await updateJobDefinition(
      input.jobId,
      job.version,
      {
        nextDueAt,
        scheduleType: input.scheduleType,
        scheduleExpression: input.scheduleExpression,
        displayTimezone: input.displayTimezone,
        enabled: input.enabled,
        maxAttempts: input.maxAttempts,
        backoffPolicy: input.backoffPolicy,
        maxCostUsdPerRun: input.maxCostUsdPerRun,
      },
      'admin',
      tx,
    );

    if (updated === null) {
      // The row existed at `loadCurrent` above but no longer matches `expectedVersion` at write
      // time — a genuine concurrent writer (the dispatcher's own `advanceJobDefinitionSchedule`,
      // which runs outside any admin transaction) landed between the two reads. Re-fetch so the
      // conflict response carries the row's real current state, not just "it changed".
      const actual = await findJobDefinitionById(input.jobId, tx);
      throw new AdminMutationConflictError(
        `job_definition ${input.jobId} was modified (likely by a dispatcher tick) between being ` +
          'read and this edit being applied — reload and reapply.',
        { objectId: input.jobId, expected: job.version, actual },
      );
    }

    return { objectId: updated.id, afterValue: updated, rollbackTarget: null };
  },
};
