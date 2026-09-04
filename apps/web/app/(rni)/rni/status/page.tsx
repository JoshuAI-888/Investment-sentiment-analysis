import {
  createFixtureRniReadService,
  type RniUiFixtureState,
} from '../../../../fixtures/rni-ui/read-service';
import { rniFixtureIds } from '@/rni/testing/reference-fixtures';
import { RniStateMatrix, type RniStateMatrixEntry } from '@/rni/ui/RniStateMatrix';

const stateLabels: Readonly<Record<RniUiFixtureState, string>> = {
  complete: 'Complete run',
  empty: 'Empty evidence',
  failed: 'Source failures',
  partial: 'Partial source coverage',
  refreshing: 'Refreshing sources',
  stale: 'Stale data',
  unpublished: 'Unpublished result',
};

export default async function RniStateMatrixPage() {
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
