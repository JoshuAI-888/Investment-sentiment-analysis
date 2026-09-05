import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import type { RniErrorCode } from './contracts';
import { RniReadError } from './read-model';
import { RniOrchestrationError } from './orchestration/budget';
import { env } from '@/env';
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

export function validateRniAdminCommand(request: Request, requestId: string) {
  if (request.headers.get('origin') !== new URL(env.APP_BASE_URL).origin) {
    return rniErrorResponse(403, 'FORBIDDEN', 'The request origin is not allowed.', requestId);
  }
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return rniErrorResponse(
      400,
      'INVALID_REQUEST',
      'A non-empty Idempotency-Key header of at most 200 characters is required.',
      requestId,
    );
  }
  return { idempotencyKey };
}

export function mapRniOrchestrationError(error: unknown, requestId: string): NextResponse {
  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    return rniErrorResponse(400, 'INVALID_REQUEST', 'The RNI request is invalid.', requestId);
  }
  if (!(error instanceof RniOrchestrationError)) {
    return rniErrorResponse(
      503,
      'PROVIDER_UNAVAILABLE',
      'Live RNI orchestration is currently unavailable.',
      requestId,
    );
  }
  if (error.code === 'NOT_FOUND') {
    return rniErrorResponse(404, 'RUN_NOT_FOUND', 'The requested RNI run was not found.', requestId);
  }
  if (['BUDGET_RUN', 'BUDGET_DAY', 'BUDGET_MONTH'].includes(error.code)) {
    return rniErrorResponse(
      429,
      'BUDGET_EXHAUSTED',
      'The RNI budget ceiling does not permit this refresh.',
      requestId,
    );
  }
  if (error.code === 'INVALID_PLAN') {
    return rniErrorResponse(400, 'INVALID_REQUEST', 'The RNI refresh request is invalid.', requestId);
  }
  return rniErrorResponse(
    409,
    'CONFLICT',
    'The RNI refresh could not be accepted in its current state.',
    requestId,
    undefined,
    ['STALE_EXECUTION', 'NOT_DUE'].includes(error.code),
  );
}
