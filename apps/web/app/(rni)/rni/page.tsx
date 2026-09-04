import { createFixtureRniReadService } from '../../../fixtures/rni-ui/read-service';
import { referenceRadarPage } from '@/rni/testing/reference-fixtures';
import { RetailRadar } from '@/rni/ui/RetailRadar';
import { resolveCitationEvidence } from '@/rni/ui/evidence';

export default async function RniRadarPage() {
  const service = createFixtureRniReadService('partial');
  const page = await service.getRadarPage({ runId: referenceRadarPage.run.id });
  const evidenceByCitationId = await resolveCitationEvidence(
    service,
    page.rows.flatMap((row) => [
      ...row.reddit.citationIds,
      ...row.x.citationIds,
      ...row.combined.citationIds,
    ]),
  );
  return <RetailRadar page={page} evidenceByCitationId={evidenceByCitationId} />;
}
