import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/env';
import { dispatchLiveRniSchedule } from '@/rni/orchestration/composition';
import { rniErrorResponse, rniRequestId } from '@/rni/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: Request): boolean {
  const expected = env.INTERNAL_DISPATCH_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/u, '') ?? '';
  if (!expected) return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  if (suppliedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  const requestId = rniRequestId(request);
  if (!authorized(request)) {
    return rniErrorResponse(403, 'FORBIDDEN', 'Internal dispatch authorization failed.', requestId);
  }
  try {
    return NextResponse.json(
      { data: await dispatchLiveRniSchedule() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return rniErrorResponse(
      503,
      'PROVIDER_UNAVAILABLE',
      'RNI scheduling or queue publication is unavailable.',
      requestId,
    );
  }
}
