import { createFixtureRniReadService } from '../../../../../fixtures/rni-ui/read-service';
import { rniFixtureIds, referenceSecurityDetail } from '@/rni/testing/reference-fixtures';
import { SecurityDetail } from '@/rni/ui/SecurityDetail';

export default async function NvdaSecurityDetailPage() {
  const service = createFixtureRniReadService('partial');
  const detail = await service.getSecurityDetail(referenceSecurityDetail.runId, rniFixtureIds.nvda);
  return <SecurityDetail detail={detail} />;
}
