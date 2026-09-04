import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { runAdminMutation } from '@/services/admin/mutation';
import { draftUniverseMutation, activateUniverseMutation } from '@/services/admin/universe';
import { getUniverseMembers } from '@/services/admin/reads';
import { mutationResponse } from '@/services/admin/http';

const bodySchema = z.object({
  reason: z.string().min(3),
  expectedVersion: z.string().regex(/^\d+$/).nullable(),
  targetVersionId: z.string().regex(/^\d+$/),
});

/**
 * F15 §4.4 — "rollback activates a prior version as a new version." Composed from the two
 * mutations already defined (`draftUniverseMutation`, `activateUniverseMutation`) rather than a
 * bespoke write path: it reads the target historical version's membership, drafts a new version
 * with that membership, and activates it — the new version's row is a fresh insert, and the
 * historical version it copied stays exactly as it was (`universe_version_append_only`).
 */
export async function POST(request: Request) {
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

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ status: 'invalid', issues: parsed.error.issues }, { status: 400 });
  }
  const { reason, expectedVersion, targetVersionId } = parsed.data;

  const targetMembers = await getUniverseMembers(targetVersionId);
  if (targetMembers.length === 0) {
    return NextResponse.json(
      { status: 'invalid', issues: [`universe_version ${targetVersionId} has no members to roll back to`] },
      { status: 400 },
    );
  }

  const draftOutcome = await runAdminMutation(
    draftUniverseMutation,
    {
      reason: `Rollback to universe_version ${targetVersionId}: ${reason}`,
      expectedVersion,
      targetSecurityIds: targetMembers,
      selectionSource: 'preset',
    },
    session,
  );
  if (!draftOutcome.ok) return mutationResponse(draftOutcome);

  const activateOutcome = await runAdminMutation(
    activateUniverseMutation,
    {
      reason: `Rollback to universe_version ${targetVersionId}: ${reason}`,
      expectedVersion,
      targetSecurityIds: targetMembers,
      selectionSource: 'preset',
      draftVersionId: draftOutcome.objectId,
    },
    session,
  );
  return mutationResponse(activateOutcome);
}
