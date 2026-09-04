import { redirect } from 'next/navigation';
import { AdminDenied } from '@/ui/AdminDenied';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';
import { getJobsView } from '@/services/admin/reads';
import { JobsTable, type JobRow } from '@/ui/admin/JobsTable';

/**
 * F02 §4.4: `requireAdmin()` called in this route's own body. F16 §4.2/§4.4 (F16b, Wave 4) —
 * admin-editable job rows, the dry-run path, and next-run preview. ADR-013: never the QStash
 * schedule, `vercel.json`, or the dispatch secret — there is no control on this page for any of
 * them (`services/admin/jobs.ts`'s module doc; `tests/unit/services/jobs/adr-013-invariants.test.ts`).
 */
export default async function Page() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin/jobs" />;
    throw error;
  }

  const jobs = await getJobsView();
  const rows: JobRow[] = jobs.map((job) => ({
    id: job.id,
    jobKey: job.jobKey,
    displayName: job.displayName,
    enabled: job.enabled,
    scheduleType: job.scheduleType,
    scheduleExpression: job.scheduleExpression,
    displayTimezone: job.displayTimezone,
    maxAttempts: job.maxAttempts,
    backoffPolicy: job.backoffPolicy,
    maxCostUsdPerRun: job.maxCostUsdPerRun,
    nextDueAt: job.nextDueAt.toISOString(),
    version: job.version,
  }));

  return (
    <main data-route="/admin/jobs" className="mx-auto max-w-4xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Jobs</h1>
      <p className="text-sm text-neutral-600">
        Editable here (F16 §4.2): due times, cadence, enabled state, retry policy, per-job budget
        ceiling. The QStash schedule, `vercel.json` and the dispatch secret are never editable
        from any UI (ADR-013) — Wave 1&apos;s dispatch core (F16a) owns everything else about how
        these jobs actually run.
      </p>
      <JobsTable initialJobs={rows} />
    </main>
  );
}
