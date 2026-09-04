import { createFixtureRniReadService } from '../../../../../fixtures/rni-ui/read-service';
import { rniFixtureIds, referenceSecurityDetail } from '@/rni/testing/reference-fixtures';
import { SecurityDetail } from '@/rni/ui/SecurityDetail';
import { resolveCitationEvidence } from '@/rni/ui/evidence';

export default async function NvdaSecurityDetailPage() {
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
