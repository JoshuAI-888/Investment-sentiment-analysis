import { createFixtureRniReadService } from '../../../fixtures/rni-ui/read-service';
import { referenceRadarPage } from '@/rni/testing/reference-fixtures';
import { RetailRadar } from '@/rni/ui/RetailRadar';

export default async function RniRadarPage() {
  const service = createFixtureRniReadService('partial');
  return <RetailRadar page={await service.getRadarPage({ runId: referenceRadarPage.run.id })} />;
}
