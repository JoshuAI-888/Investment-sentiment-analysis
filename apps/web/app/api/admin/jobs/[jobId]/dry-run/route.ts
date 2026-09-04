import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { runJobDryRun } from '@/services/admin/job-dry-run';

/**
 * F16 §4.4 — "Every job supports a dry run that reports what it would do, what it would call,
 * and what it would cost — without calling anything." See `services/admin/job-dry-run.ts` for why
 * this is not `runAdminMutation` — a dry run does not version or roll back `job_definition`.
 */
const dryRunSchema = z.object({
  reason: z.string().min(3, 'a reason is required'),
});

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  let session;
  try {
    session = await requireAdmin();
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

  const rawBody: unknown = await request.json().catch(() => ({}));
  const parsed = dryRunSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ status: 'invalid', issues: parsed.error.issues }, { status: 400 });
  }

  const result = await runJobDryRun(jobId, session, parsed.data.reason);
  if (!result.ok) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({
    status: 'ok',
    run: {
      id: result.run.id,
      status: result.run.status,
      dryRun: result.run.dryRun,
      itemsRead: result.run.itemsRead,
      itemsWritten: result.run.itemsWritten,
      providerCalls: result.run.providerCalls,
      estimatedCostUsd: result.run.estimatedCostUsd,
      metrics: result.run.metrics,
    },
  });
}
