import { notFound } from 'next/navigation';
import { env } from '@/env';
import { createFixtureRniReadService } from '@/fixtures/rni-ui/read-service';
import { referenceRadarPage } from '@/rni/testing/reference-fixtures';
import { RetailRadar } from '@/rni/ui/RetailRadar';
import { resolveCitationEvidence } from '@/rni/ui/evidence';
import { FixtureRouteUnavailableError, renderFixtureOnly } from '@/rni/ui/renderFixtureOnly';

export const dynamic = 'force-dynamic';

async function FixtureRadar() {
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

export default function RniFixtureRadarPage() {
  try {
    return renderFixtureOnly(env.PROVIDER_MODE, () => <FixtureRadar />);
  } catch (error) {
    if (error instanceof FixtureRouteUnavailableError) notFound();
    throw error;
  }
}
