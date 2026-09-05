import { NextResponse } from 'next/server';
import {
  authorizeRniAdmin,
  validateRniAdminCommand,
  rniRequestId,
  rniErrorResponse,
} from '@/rni/http';
import { scheduleUpdateBody } from '@/rni/settings/schedule/schemas';
import { RniScheduleSettingsError } from '@/rni/settings/schedule/errors';
import { createLiveScheduleSettingsService } from '@/rni/settings/schedule/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

function uncached(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function failure(error: unknown, requestId: string) {
  const response =
    (error instanceof RniScheduleSettingsError && error.kind === 'invalid') ||
    error instanceof SyntaxError
      ? rniErrorResponse(
          400,
          'INVALID_REQUEST',
          'Provide a valid bounded schedule and change reason.',
          requestId,
        )
      : error instanceof RniScheduleSettingsError && error.kind === 'conflict'
        ? rniErrorResponse(
            409,
            'CONFLICT',
            'The schedule changed or this key belongs to another change. Reload before editing.',
            requestId,
          )
        : rniErrorResponse(
            503,
            'PROVIDER_UNAVAILABLE',
            'Schedule settings are currently unavailable.',
            requestId,
          );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: Request) {
  const requestId = rniRequestId(request);
  try {
    const auth = await authorizeRniAdmin(requestId);
    if (auth instanceof NextResponse) return uncached(auth);
    const data = await createLiveScheduleSettingsService(auth.userId).getCurrentSchedule();
    return NextResponse.json({ data }, { headers });
  } catch (error) {
    return failure(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = rniRequestId(request);
  try {
    const auth = await authorizeRniAdmin(requestId);
    if (auth instanceof NextResponse) return uncached(auth);
    const command = validateRniAdminCommand(request, requestId);
    if (command instanceof NextResponse) return uncached(command);
    const body = scheduleUpdateBody.safeParse(await request.json());
    if (!body.success) throw new RniScheduleSettingsError('invalid');
    const data = await createLiveScheduleSettingsService(auth.userId).updateSchedule({
      ...body.data,
      idempotencyKey: command.idempotencyKey,
    });
    return NextResponse.json({ data }, { headers });
  } catch (error) {
    return failure(error, requestId);
  }
}
