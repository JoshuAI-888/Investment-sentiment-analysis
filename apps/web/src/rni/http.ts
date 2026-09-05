import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { RniErrorCode } from './contracts';
import { RniReadError } from './read-model';
import {
  PasswordChangeRequiredError,
  requireAdmin,
  requireUser,
  UnauthenticatedError,
  UnauthorizedError,
} from '@/services/auth';

export function rniRequestId(request: Request): string {
  return request.headers.get('x-request-id')?.trim() || randomUUID();
}

export function rniErrorResponse(
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

export async function authorizeRniRead(requestId: string): Promise<NextResponse | null> {
  try {
    await requireUser();
    return null;
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof PasswordChangeRequiredError) {
      return rniErrorResponse(401, 'UNAUTHENTICATED', 'Sign in is required.', requestId);
    }
    throw error;
  }
}

export async function authorizeRniAdmin(
  requestId: string,
): Promise<{ userId: string } | NextResponse> {
  try {
    const session = await requireAdmin();
    return { userId: session.userId };
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof PasswordChangeRequiredError) {
      return rniErrorResponse(401, 'UNAUTHENTICATED', 'Sign in is required.', requestId);
    }
    if (error instanceof UnauthorizedError) {
      return rniErrorResponse(403, 'FORBIDDEN', 'Administrator access is required.', requestId);
    }
    throw error;
  }
}

export function mapRniReadError(error: unknown, requestId: string): NextResponse {
  if (!(error instanceof RniReadError)) {
    return rniErrorResponse(
      503,
      'PROVIDER_UNAVAILABLE',
      'The RNI data service is temporarily unavailable.',
      requestId,
    );
  }
  const mapping: Partial<
    Record<RniErrorCode, Readonly<{ status: number; message: string; retryable?: boolean }>>
  > = {
    CITATION_INVALID: {
      status: 422,
      message: 'The saved citation lineage could not be verified.',
    },
    CONFLICT: {
      status: 409,
      message: 'The requested RNI result is not publishable yet.',
      retryable: true,
    },
    FORBIDDEN: { status: 403, message: 'The saved evidence is not approved for display.' },
    INVALID_REQUEST: { status: 400, message: 'The RNI request is invalid.' },
    PROVIDER_UNAVAILABLE: {
      status: 503,
      message: 'The RNI data service is temporarily unavailable.',
    },
    RUN_NOT_FOUND: { status: 404, message: 'The requested RNI run was not found.' },
    SOURCE_NOT_FOUND: { status: 404, message: 'The requested RNI source was not found.' },
    UNIVERSE_SYNC_INVALID: {
      status: 422,
      message: 'The saved RNI universe could not be verified.',
    },
  };
  const selected = mapping[error.code] ?? {
    status: 500,
    message: 'The RNI request could not be completed.',
  };
  return rniErrorResponse(
    selected.status,
    error.code,
    selected.message,
    requestId,
    undefined,
    selected.retryable,
  );
}
