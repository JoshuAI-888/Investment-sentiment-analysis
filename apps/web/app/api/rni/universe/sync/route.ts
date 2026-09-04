import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/env';
import type { RniErrorCode } from '@/rni/contracts';
import { syncFmpUniverseFromEnvironment } from '@/rni/universe/composition';
import {
  PasswordChangeRequiredError,
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
} from '@/services/auth';

function errorResponse(
  status: number,
  code: RniErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
  retryable = status >= 500,
) {
  return NextResponse.json(
    { error: { code, message, retryable, requestId, ...(details ? { details } : {}) } },
    { status },
  );
}

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id') ?? randomUUID();
  let session;
  try {
    session = await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof PasswordChangeRequiredError) {
      return errorResponse(401, 'UNAUTHENTICATED', 'Sign in is required.', requestId);
    }
    if (error instanceof UnauthorizedError) {
      return errorResponse(403, 'FORBIDDEN', 'Administrator access is required.', requestId);
    }
    throw error;
  }

  const origin = request.headers.get('origin');
  if (origin === null || origin !== new URL(env.APP_BASE_URL).origin) {
    return errorResponse(403, 'FORBIDDEN', 'The request origin is not allowed.', requestId);
  }
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (idempotencyKey === undefined || idempotencyKey === '' || idempotencyKey.length > 200) {
    return errorResponse(
      400,
      'INVALID_REQUEST',
      'A non-empty Idempotency-Key header of at most 200 characters is required.',
      requestId,
    );
  }

  const environment = process.env['VERCEL_ENV'] ?? 'development';
  const result = await syncFmpUniverseFromEnvironment({
    environment,
    actorId: session.userId,
    idempotencyKey,
    correlationId: requestId,
  });
  if (!result.ok && result.kind === 'in_progress') {
    return errorResponse(
      409,
      'CONFLICT',
      'This universe synchronization is already running.',
      requestId,
      { retryAt: result.retryAt },
      true,
    );
  }
  if (!result.ok && result.kind === 'command_failed') {
    return errorResponse(
      409,
      'CONFLICT',
      'This universe synchronization key has a terminal failed outcome.',
      requestId,
      { commandState: 'failed' },
    );
  }
  if (!result.ok && result.kind === 'provider') {
    return errorResponse(
      503,
      'PROVIDER_UNAVAILABLE',
      'FMP did not return a usable S&P 500 constituent response.',
      requestId,
      { providerError: result.error.kind },
    );
  }
  if (!result.ok) {
    return errorResponse(
      422,
      'UNIVERSE_SYNC_INVALID',
      'The candidate universe failed validation; the active universe was not changed.',
      requestId,
      { issues: result.issues },
    );
  }

  return NextResponse.json(
    {
      data: {
        universeVersion: result.staged.version.id,
        status: result.staged.version.status,
        memberCount: result.staged.memberCount,
        reused: result.staged.reused,
        impactPreview: result.staged.impactPreview,
      },
    },
    { status: result.staged.reused ? 200 : 202 },
  );
}
