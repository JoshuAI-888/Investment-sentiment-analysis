import { NextResponse } from 'next/server';
import { createLiveRniReadService } from '@/rni/read-model';
import { authorizeRniRead, mapRniReadError, rniRequestId } from '@/rni/http';

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<{ runId: string }> }>,
) {
  const requestId = rniRequestId(request);
  const unauthorized = await authorizeRniRead(requestId);
  if (unauthorized) return unauthorized;
  try {
    const { runId } = await context.params;
    const service = createLiveRniReadService();
    const [run, platformSlices] = await Promise.all([
      service.getRun(runId),
      service.getPlatformSlices(runId),
    ]);
    return NextResponse.json({ data: { run, platformSlices } });
  } catch (error) {
    return mapRniReadError(error, requestId);
  }
}
