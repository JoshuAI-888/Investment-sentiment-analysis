import { NextResponse } from 'next/server';
import { createLiveRniReadService, RniReadError } from '@/rni/read-model';
import {
  authorizeRniRead,
  mapRniReadError,
  rniErrorResponse,
  rniRequestId,
} from '@/rni/http';

export async function GET(request: Request) {
  const requestId = rniRequestId(request);
  const unauthorized = await authorizeRniRead(requestId);
  if (unauthorized) return unauthorized;
  try {
    const search = new URL(request.url).searchParams;
    const citationId = search.get('citationId');
    const sourceItemId = search.get('sourceItemId');
    if ((citationId === null) === (sourceItemId === null)) {
      return rniErrorResponse(
        400,
        'INVALID_REQUEST',
        'Provide exactly one citationId or sourceItemId.',
        requestId,
      );
    }
    const service = createLiveRniReadService();
    if (citationId) {
      const citation = await service.getCitation(citationId);
      const source = await service.getEvidence(citation.sourceItemId);
      if (
        citation.platform !== source.platform ||
        citation.url !== source.originalUrl ||
        !source.boundedContent.includes(citation.evidenceText)
      ) {
        throw new RniReadError('CITATION_INVALID');
      }
      return NextResponse.json({ data: { citation, source } });
    }
    const source = await service.getEvidence(sourceItemId!);
    return NextResponse.json({ data: { source } });
  } catch (error) {
    return mapRniReadError(error, requestId);
  }
}
