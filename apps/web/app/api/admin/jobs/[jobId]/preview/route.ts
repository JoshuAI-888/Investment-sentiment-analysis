import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { getJobById } from '@/services/admin/reads';
import { previewNextDueAt } from '@/services/admin/job-schedule-preview';
import { scheduleType as scheduleTypeSchema } from '@/contracts/operations';
import { InvalidScheduleError } from '@/services/jobs/schedule';

/**
 * F16 §4.4 — "Next-run preview is shown per job in the admin UI." A pure computation: reads the
 * job row, then calls `previewNextDueAt` (which itself calls F16a's own `computeNextDueAt`) —
 * writes nothing, calls no provider, incurs no cost. Not a mutation, so it does not go through
 * `runAdminMutation`; nothing here is audited, the same way `services/admin/settings-catalogue.ts`
 * reads are not — no `job_definition` state changes as a result of asking for a preview.
 */
const previewSchema = z.object({
  nextDueAt: z.string().datetime().optional(),
  scheduleType: scheduleTypeSchema.optional(),
  scheduleExpression: z.string().min(1).optional(),
  displayTimezone: z.string().min(1).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  try {
    await requireAdmin();
  } catch (error) {
    if (
      error instanceof UnauthenticatedError ||
      error instanceof UnauthorizedError ||
      error instanceof PasswordChangeRequiredError
    ) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw error;
  }

  const job = await getJobById(jobId);
  if (job === null) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 });
  }

  const rawBody: unknown = await request.json().catch(() => ({}));
  const parsed = previewSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ status: 'invalid', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const nextDueAt = previewNextDueAt(
      job,
      {
        nextDueAt: parsed.data.nextDueAt === undefined ? undefined : new Date(parsed.data.nextDueAt),
        scheduleType: parsed.data.scheduleType,
        scheduleExpression: parsed.data.scheduleExpression,
        displayTimezone: parsed.data.displayTimezone,
      },
      new Date(),
    );
    return NextResponse.json({ status: 'ok', jobId, nextDueAt: nextDueAt.toISOString() });
  } catch (error) {
    if (error instanceof InvalidScheduleError) {
      return NextResponse.json({ status: 'invalid', issues: [error.message] }, { status: 400 });
    }
    throw error;
  }
}
