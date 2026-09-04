import { NextResponse } from 'next/server';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { getAdminOverview } from '@/services/admin/reads';

/**
 * F15 §4.8 — the `/admin` overview. Cheap, independently-fetchable panels (config/universe
 * status, open-issue count, recent audit activity) rather than one heavy aggregate — the
 * "streams independently" requirement is honoured by keeping each read small, not by adding a
 * caching layer this build did not have time to wire (reported under Deferred).
 */
export async function GET() {
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

  const { config, universe, openIssueCount, recentAudit } = await getAdminOverview();

  return NextResponse.json({
    state: 'ready',
    route: '/api/admin/status',
    config: config === null ? null : { id: config.id, activatedAt: config.activatedAt, changeReason: config.changeReason },
    universe:
      universe === null
        ? null
        : { id: universe.id, activatedAt: universe.activatedAt, selectedCount: universe.selectedCount },
    openIssueCount,
    recentAudit,
  });
}
