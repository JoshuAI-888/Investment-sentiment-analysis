import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/env';
import {
  rniAiBudgetSettingUpdateRequest,
  rniAiBudgetSettingUpdateResult,
  rniAiRouteSetting,
  rniErrorEnvelope,
} from '@/rni/contracts';
import { createLiveAiRouteSettingsService } from '@/rni/settings/ai-route/service';
import { RniAiRouteSettingsError } from '@/rni/settings/ai-route/errors';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

function failure(error: unknown, requestId: string) {
  const [status, code, message, retryable] =
    error instanceof UnauthenticatedError || error instanceof PasswordChangeRequiredError
      ? ([401, 'UNAUTHENTICATED', 'Sign in is required.', false] as const)
      : error instanceof UnauthorizedError
        ? ([
            403,
            'FORBIDDEN',
            'Administrator access and same-origin requests are required.',
            false,
          ] as const)
        : error instanceof RniAiRouteSettingsError && error.kind === 'invalid'
          ? ([
              400,
              'INVALID_REQUEST',
              'Provide positive USD limits within the safety ceilings, in the required order, a reason and Idempotency-Key.',
              false,
            ] as const)
          : error instanceof RniAiRouteSettingsError && error.kind === 'conflict'
            ? ([
                409,
                'CONFLICT',
                'This idempotency key belongs to another settings change.',
                false,
              ] as const)
            : ([
                503,
                'PROVIDER_UNAVAILABLE',
                'AI budget configuration is currently unavailable.',
                true,
              ] as const);
  return NextResponse.json(
    rniErrorEnvelope.parse({ error: { code, message, retryable, requestId } }),
    { status, headers },
  );
}

export async function GET() {
  const requestId = randomUUID();
  try {
    const session = await requireAdmin();
    const data = rniAiRouteSetting.parse(
      await createLiveAiRouteSettingsService(session.userId).getCurrentAiRouteSetting(),
    );
    return NextResponse.json({ data }, { headers });
  } catch (error) {
    return failure(error, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await requireAdmin();
    if (request.headers.get('origin') !== new URL(env.APP_BASE_URL).origin)
      throw new UnauthorizedError();
    const key = request.headers.get('idempotency-key')?.trim();
    if (!key || key.length > 200) throw new RniAiRouteSettingsError('invalid');
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new RniAiRouteSettingsError('invalid');
    }
    const parsed = rniAiBudgetSettingUpdateRequest.omit({ idempotencyKey: true }).safeParse(body);
    if (!parsed.success) throw new RniAiRouteSettingsError('invalid');
    const data = rniAiBudgetSettingUpdateResult.parse(
      await createLiveAiRouteSettingsService(session.userId).updateFutureAiBudgets({
        ...parsed.data,
        idempotencyKey: key,
      }),
    );
    return NextResponse.json({ data }, { headers });
  } catch (error) {
    return failure(error, requestId);
  }
}
