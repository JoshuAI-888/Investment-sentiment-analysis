import { NextResponse } from 'next/server';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { getAuditEvents } from '@/services/admin/reads';

/** F15 §4.6/§4.8 — the audit tab. Read-only, paginated, filterable. */
export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const objectType = url.searchParams.get('objectType') ?? undefined;
  const objectId = url.searchParams.get('objectId') ?? undefined;
  const actorId = url.searchParams.get('actorId') ?? undefined;
  const action = url.searchParams.get('action') ?? undefined;
  const beforeRaw = url.searchParams.get('before');
  const before = beforeRaw === null ? undefined : new Date(beforeRaw);
  const limit = Number(url.searchParams.get('limit') ?? '50');

  const events = await getAuditEvents({ objectType, objectId, actorId, action, before, limit });

  return NextResponse.json({
    state: 'ready',
    route: '/api/admin/audit',
    events,
    nextCursor: events.length > 0 ? events[events.length - 1]?.occurredAt.toISOString() : null,
  });
}
