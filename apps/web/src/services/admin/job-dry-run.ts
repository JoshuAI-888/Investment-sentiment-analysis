/**
 * F16 §4.4 — "Every job supports a dry run that reports what it *would* do, what it would call,
 * and what it would cost — without calling anything."
 *
 * This deliberately does **not** go through `runAdminMutation` (`services/admin/mutation.ts`,
 * F15 §4.1): a dry run does not create, version, or roll back any governed entity —
 * `job_definition` itself is untouched by it — so the pipeline's optimistic-concurrency check,
 * versioned write, and rollback target have nothing to apply to here. What a dry run writes
 * instead is exactly what F16a's dispatch core already writes for every run, scheduled or manual:
 * a `job_run` row, via the same `executeJob` every trigger type goes through (F16 §3 — "the
 * single execution path for every refresh in the system"). This module's only job is to call it
 * on the admin's behalf with `triggerType: 'manual', dryRun: true`, and to audit that an admin
 * asked for one — the same pattern `services/admin/reads.ts#auditAdminAccess` already uses for
 * data-explorer reads, another admin action that is not itself a versioned mutation.
 *
 * **Zero external calls, structurally, not by care at this call site.** `executeJob`'s own
 * `dryRun` branch (`services/jobs/job-service.ts`) returns before `DISPATCH_TABLE`'s handler is
 * ever looked up or invoked — the one place a real provider/adapter call could happen. This
 * module never touches that handler table itself; it only asks `executeJob` for a dry run and
 * reports what came back. See `tests/integration/admin-job-dry-run.test.ts` for the assertion
 * this is actually true end-to-end (real Postgres, a job whose `job_key` maps to a real handler
 * in `DISPATCH_TABLE`, zero `provider_calls`/`items_read`/`items_written` and no
 * `raw_provider_payload` row written).
 */
import { randomUUID } from 'node:crypto';
import { executeJob } from '@/services/jobs/job-service';
import { findJobDefinitionById } from '@/repositories/jobs';
import { insertAuditEvent } from '@/repositories/audit';
import type { Session } from '@/services/auth';
import type { JobRun } from '@/contracts/operations';
import { ADMIN_ENVIRONMENT } from './constants';

export type JobDryRunResult =
  | { readonly ok: true; readonly run: JobRun }
  | { readonly ok: false; readonly reason: 'not_found' };

export async function runJobDryRun(jobId: string, session: Session, reason: string): Promise<JobDryRunResult> {
  const job = await findJobDefinitionById(jobId);
  if (job === null) return { ok: false, reason: 'not_found' };

  // Never reused across two dry-run requests — each explicit admin click is its own auditable
  // run, unlike the scheduled path's `(job_id, due_at)`-derived key, which exists specifically to
  // collapse *re-deliveries of the same due instant* into one execution (F16 §4.1 step 4). A dry
  // run has no "due instant" to collapse against; a fresh `randomUUID()` per call is what makes
  // two deliberate dry-run requests two distinct, both-visible `job_run` rows, rather than the
  // second silently no-opping against the first via `claimJobRun`'s idempotency check.
  const idempotencyKey = `${jobId}:manual-dry-run:${randomUUID()}`;

  const result = await executeJob({
    job,
    triggerType: 'manual',
    idempotencyKey,
    // No real dispatch-tick Redis lock is held for an admin-initiated call outside the dispatch
    // loop — this is metadata recorded on the `job_run` row (`lock_key`, F16 §4.1), not an actual
    // acquired lock; nothing in `executeJob`'s dry-run branch uses it for exclusion.
    lockKey: `admin-dry-run:${jobId}`,
    requestedBy: session.userId,
    requestReason: reason,
    dryRun: true,
  });

  await insertAuditEvent({
    actorId: session.userId,
    actorRole: 'admin',
    action: 'job.dry_run',
    objectType: 'job_definition',
    objectId: job.id,
    environment: ADMIN_ENVIRONMENT,
    reason,
    beforeValue: null,
    afterValue: { runId: result.run.id, status: result.run.status, jobKey: job.jobKey },
    result: 'success',
    requestId: idempotencyKey,
    correlationId: idempotencyKey,
  });

  return { ok: true, run: result.run };
}
