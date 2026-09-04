import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { auditAdminAccess, getDataExplorerResults } from '@/services/admin/reads';
import { ADMIN_ENVIRONMENT } from '@/services/admin/constants';

/**
 * F15 §4.5 — the data explorer. Rights-checked and retention-aware in the query itself
 * (`repositories/data-explorer.ts`), size-limited to a hard cap, and **audited on every access**
 * — including a call that returns zero rows, since "an admin looked" is the fact being recorded,
 * not "an admin found something."
 */
export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const provider = url.searchParams.get('provider') ?? undefined;
  const securityId = url.searchParams.get('securityId') ?? undefined;
  const contentClass = url.searchParams.get('contentClass') ?? undefined;
  const limit = Number(url.searchParams.get('limit') ?? '50');
  const asOf = new Date();

  const query = { provider, securityId, contentClass, asOf, limit };
  const { rows, restricted } = await getDataExplorerResults(query);

  const requestId = randomUUID();
  await auditAdminAccess({
    actorId: session.userId,
    actorRole: 'admin',
    action: 'data_explorer.view',
    objectType: 'raw_provider_payload',
    objectId: provider ?? securityId ?? contentClass ?? 'all',
    environment: ADMIN_ENVIRONMENT,
    reason: 'admin data explorer access',
    beforeValue: null,
    afterValue: { query: { provider, securityId, contentClass, limit }, returned: rows.length, restricted },
    result: 'success',
    requestId,
    correlationId: requestId,
  });

  return NextResponse.json({
    state: 'ready',
    route: '/api/admin/data',
    rows,
    restricted,
    auditedAs: requestId,
  });
}
