import { createFixtureRniReadService } from '../../../../../fixtures/rni-ui/read-service';
import { referenceRadarPage } from '@/rni/testing/reference-fixtures';
import { RawDataExplorer } from '@/rni/ui/RawDataExplorer';
import { resolveCitationEvidence } from '@/rni/ui/evidence';

export default async function NvdaRawDataExplorerPage() {
  const service = createFixtureRniReadService('partial');
  const radarPage = await service.getRadarPage({ runId: referenceRadarPage.run.id });
  const security = radarPage.rows.find((row) => row.security.ticker === 'NVDA')?.security;
  if (!security) throw new Error('NVDA fixture security is required for the raw-data explorer');

  const summary = await service.getSecuritySummary(radarPage.run.id, security.id);
  const evidenceByCitationId = await resolveCitationEvidence(
    service,
    summary.sections.flatMap((section) => section.citationIds),
  );
  return (
    <RawDataExplorer
      security={security}
      summary={summary}
      evidenceByCitationId={evidenceByCitationId}
    />
  );
}
