import { NextResponse } from 'next/server';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { getCostLedgerView } from '@/services/admin/reads';

/**
 * F15 §4.7 — the cost ledger view. Priced, actual and **unpriced** usage shown distinctly;
 * `spendInWindow`/`costBreakdownInWindow` already exclude a reconciled row's superseded
 * estimate, and neither collapses an unpriced call into `$0.00` (F03 §4.2's own invariant,
 * reused here rather than reimplemented). Budget threshold *values* are read from the settings
 * catalogue (§4.2) this feature owns — enforcement is F18's (§2 Out).
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
  const now = new Date();
  const from = url.searchParams.get('from') !== null
    ? new Date(url.searchParams.get('from') as string)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = url.searchParams.get('to') !== null ? new Date(url.searchParams.get('to') as string) : now;

  const { totals, breakdown, thresholds } = await getCostLedgerView(from, to);

  return NextResponse.json({
    state: 'ready',
    route: '/api/admin/costs',
    window: { from: from.toISOString(), to: to.toISOString() },
    totals,
    breakdown,
    thresholds,
  });
}
