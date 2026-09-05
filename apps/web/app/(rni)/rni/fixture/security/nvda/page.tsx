import { notFound } from 'next/navigation';
import { env } from '@/env';
import { createFixtureRniReadService } from '@/fixtures/rni-ui/read-service';
import { referenceSecurityDetail, rniFixtureIds } from '@/rni/testing/reference-fixtures';
import { FixtureRouteUnavailableError, renderFixtureOnly } from '@/rni/ui/renderFixtureOnly';
import { SecurityDetail } from '@/rni/ui/SecurityDetail';
import { resolveCitationEvidence } from '@/rni/ui/evidence';

export const dynamic = 'force-dynamic';

async function FixtureSecurityDetail() {
  const service = createFixtureRniReadService('partial');
  const detail = await service.getSecurityDetail(referenceSecurityDetail.runId, rniFixtureIds.nvda);
  const evidenceByCitationId = await resolveCitationEvidence(service, [
    ...detail.reddit.citationIds,
    ...detail.reddit.dimensions.flatMap((dimension) => dimension.citationIds),
    ...detail.x.citationIds,
    ...detail.x.dimensions.flatMap((dimension) => dimension.citationIds),
  ]);
  return <SecurityDetail detail={detail} evidenceByCitationId={evidenceByCitationId} />;
}

export default function RniFixtureSecurityDetailPage() {
  try {
    return renderFixtureOnly(env.PROVIDER_MODE, () => <FixtureSecurityDetail />);
  } catch (error) {
    if (error instanceof FixtureRouteUnavailableError) notFound();
    throw error;
  }
}
