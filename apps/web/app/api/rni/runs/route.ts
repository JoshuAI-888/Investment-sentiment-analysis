import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rniManualRefreshScope } from '@/rni/contracts';
import {
  authorizeRniAdmin,
  mapRniOrchestrationError,
  rniRequestId,
  validateRniAdminCommand,
} from '@/rni/http';
import { createLiveRniRefreshService } from '@/rni/orchestration/composition';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const bodySchema = z.object({ scope: rniManualRefreshScope }).strict();

export async function POST(request: Request) {
  const requestId = rniRequestId(request);
  const authorization = await authorizeRniAdmin(requestId);
  if (authorization instanceof NextResponse) return authorization;
  const command = validateRniAdminCommand(request, requestId);
  if (command instanceof NextResponse) return command;
  try {
    const raw: unknown = await request.json();
    const body = bodySchema.safeParse(raw);
    if (!body.success) {
      return new NextResponse(
        JSON.stringify({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Provide one valid ticker or full-universe scope.',
            retryable: false,
            requestId,
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }
    const service = await createLiveRniRefreshService(authorization.userId);
    const data = await service.requestManualRefresh({
      idempotencyKey: command.idempotencyKey,
      scope: body.data.scope,
    });
    return NextResponse.json(
      { data },
      { status: data.disposition === 'accepted' ? 202 : 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return mapRniOrchestrationError(error, requestId);
  }
}
