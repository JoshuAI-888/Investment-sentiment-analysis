import { NextResponse } from 'next/server';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { getActiveUniverseVersion, getUniverseTable } from '@/services/admin/reads';

/**
 * F15 §4.3 — the universe selector's table read. `requireAdmin()` in this route's own body
 * (F02 §4.4); everything below is local reads only — see `repositories/universe-table.ts`'s
 * docstring for why this is one query, not one query per row.
 */
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
  const q = url.searchParams.get('q') ?? undefined;
  const sector = url.searchParams.get('sector') ?? undefined;
  const eligibleOnly = url.searchParams.get('eligibleOnly') === 'true';
  const page = Math.max(Number(url.searchParams.get('page') ?? '1'), 1);
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') ?? '50'), 1), 500);
  const membershipOfVersion = url.searchParams.get('membershipOfVersion') ?? undefined;

  const active = await getActiveUniverseVersion();

  const { rows, totalCount } = await getUniverseTable({
    q,
    sector,
    eligibleOnly,
    membershipOfVersion: membershipOfVersion ?? active?.id,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return NextResponse.json({
    state: 'ready',
    route: '/api/admin/universe',
    activeVersion: active === null ? null : { id: active.id, activatedAt: active.activatedAt, selectedCount: active.selectedCount },
    page,
    pageSize,
    totalCount,
    rows,
  });
}
