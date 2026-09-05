import { NextResponse } from 'next/server';
import {
  createLiveRniReadService,
  findLatestRniRunId,
  findRunSecurityByTicker,
  rniEnvironment,
} from '@/rni/read-model';
import {
  authorizeRniRead,
  mapRniReadError,
  rniErrorResponse,
  rniRequestId,
} from '@/rni/http';

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<{ ticker: string }> }>,
) {
  const requestId = rniRequestId(request);
  const unauthorized = await authorizeRniRead(requestId);
  if (unauthorized) return unauthorized;
  try {
    const environment = rniEnvironment();
    const runId =
      new URL(request.url).searchParams.get('runId') ??
      (await findLatestRniRunId(environment));
    if (!runId) {
      return rniErrorResponse(404, 'RUN_NOT_FOUND', 'No RNI run exists yet.', requestId);
    }
    const { ticker } = await context.params;
    const security = await findRunSecurityByTicker(runId, ticker.toUpperCase(), environment);
    if (!security) {
      return rniErrorResponse(
        404,
        'SOURCE_NOT_FOUND',
        'The ticker is not part of the requested run scope.',
        requestId,
      );
    }
    const detail = await createLiveRniReadService().getSecurityDetail(runId, security.id);
    return NextResponse.json({ data: detail });
  } catch (error) {
    return mapRniReadError(error, requestId);
  }
}
