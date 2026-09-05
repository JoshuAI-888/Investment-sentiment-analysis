import { notFound } from 'next/navigation';
import { env } from '@/env';
import {
  createFixtureRniReadService,
  type RniUiFixtureState,
} from '@/fixtures/rni-ui/read-service';
import { rniFixtureIds } from '@/rni/testing/reference-fixtures';
import { FixtureRouteUnavailableError, renderFixtureOnly } from '@/rni/ui/renderFixtureOnly';
import { RniStateMatrix, type RniStateMatrixEntry } from '@/rni/ui/RniStateMatrix';

export const dynamic = 'force-dynamic';

const stateLabels: Readonly<Record<RniUiFixtureState, string>> = {
  complete: 'Complete run',
  empty: 'Empty evidence',
  failed: 'Source failures',
  partial: 'Partial source coverage',
  refreshing: 'Refreshing sources',
  stale: 'Stale data',
  unpublished: 'Unpublished result',
};

async function FixtureStatus() {
  const entries = await Promise.all(
    (Object.keys(stateLabels) as RniUiFixtureState[]).map(
      async (id): Promise<RniStateMatrixEntry> => {
        const service = createFixtureRniReadService(id);
        const [run, platformSlices] = await Promise.all([
          service.getRun(rniFixtureIds.run),
          service.getPlatformSlices(rniFixtureIds.run),
        ]);
        return { id, label: stateLabels[id], run, platformSlices };
      },
    ),
  );
  return <RniStateMatrix entries={entries} />;
}

export default function RniFixtureStatusPage() {
  try {
    return renderFixtureOnly(env.PROVIDER_MODE, () => <FixtureStatus />);
  } catch (error) {
    if (error instanceof FixtureRouteUnavailableError) notFound();
    throw error;
  }
}
