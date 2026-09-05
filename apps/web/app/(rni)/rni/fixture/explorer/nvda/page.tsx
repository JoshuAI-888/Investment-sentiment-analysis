import { notFound } from 'next/navigation';
import { env } from '@/env';
import { createFixtureRniReadService } from '@/fixtures/rni-ui/read-service';
import { referenceRadarPage } from '@/rni/testing/reference-fixtures';
import { FixtureRouteUnavailableError, renderFixtureOnly } from '@/rni/ui/renderFixtureOnly';
import { RawDataExplorer } from '@/rni/ui/RawDataExplorer';
import { resolveCitationEvidence } from '@/rni/ui/evidence';

export const dynamic = 'force-dynamic';

async function FixtureExplorer() {
  const service = createFixtureRniReadService('partial');
  const radarPage = await service.getRadarPage({ runId: referenceRadarPage.run.id });
  const security = radarPage.rows.find((row) => row.security.ticker === 'NVDA')!.security;
  const summary = await service.getSecuritySummary(radarPage.run.id, security.id);
  const evidenceByCitationId = await resolveCitationEvidence(
    service,
    summary.sections.flatMap((section) => section.citationIds),
  );
  return (
    <RawDataExplorer
      evidenceByCitationId={evidenceByCitationId}
      security={security}
      summary={summary}
    />
  );
}

export default function RniFixtureExplorerPage() {
  try {
    return renderFixtureOnly(env.PROVIDER_MODE, () => <FixtureExplorer />);
  } catch (error) {
    if (error instanceof FixtureRouteUnavailableError) notFound();
    throw error;
  }
}
