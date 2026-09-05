import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  authorizeRniAdmin,
  mapRniOrchestrationError,
  rniRequestId,
  validateRniAdminCommand,
} from '@/rni/http';
import { createLiveRniRefreshService } from '@/rni/orchestration/composition';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<{ runId: string }> }>,
) {
  const requestId = rniRequestId(request);
  const authorization = await authorizeRniAdmin(requestId);
  if (authorization instanceof NextResponse) return authorization;
  const command = validateRniAdminCommand(request, requestId);
  if (command instanceof NextResponse) return command;
  try {
    const raw = await request.text();
    if (raw.trim() !== '' && raw.trim() !== '{}') {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'The retry body must be empty.', retryable: false, requestId } },
        { status: 400 },
      );
    }
    const runId = z.string().uuid().parse((await context.params).runId);
    const service = await createLiveRniRefreshService(authorization.userId);
    const data = await service.rerun({ runId, idempotencyKey: command.idempotencyKey });
    return NextResponse.json(
      { data },
      { status: data.disposition === 'accepted' ? 202 : 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return mapRniOrchestrationError(error, requestId);
  }
}
