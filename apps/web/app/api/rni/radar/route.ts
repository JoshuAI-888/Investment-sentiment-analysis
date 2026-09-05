import { NextResponse } from 'next/server';
import {
  createLiveRniReadService,
  findLatestRniRunId,
  rniEnvironment,
} from '@/rni/read-model';
import { authorizeRniRead, mapRniReadError, rniRequestId } from '@/rni/http';

export async function GET(request: Request) {
  const requestId = rniRequestId(request);
  const unauthorized = await authorizeRniRead(requestId);
  if (unauthorized) return unauthorized;
  try {
    const search = new URL(request.url).searchParams;
    const runId = search.get('runId') ?? (await findLatestRniRunId(rniEnvironment()));
    if (!runId) {
      return NextResponse.json({ data: null }, { status: 200 });
    }
    const rawLimit = search.get('limit');
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    const page = await createLiveRniReadService().getRadarPage({
      runId,
      cursor: search.get('cursor'),
      limit,
    });
    return NextResponse.json({ data: page });
  } catch (error) {
    return mapRniReadError(error, requestId);
  }
}
