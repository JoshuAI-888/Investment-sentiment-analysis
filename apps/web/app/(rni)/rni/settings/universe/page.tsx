import { createFixtureRniUniverseReadService } from '../../../../../fixtures/rni-ui/read-service';
import { UniverseSettings } from '@/rni/ui/UniverseSettings';
import type { RniUniverseReadService } from '@/rni/contracts';

type RniUniverseSettingsPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}>;

function createUniverseReadService(): RniUniverseReadService {
  return createFixtureRniUniverseReadService();
}

export default async function RniUniverseSettingsPage({
  searchParams,
}: RniUniverseSettingsPageProps) {
  const requestedParams = await searchParams;
  const requestedQuery = requestedParams.query;
  const query = typeof requestedQuery === 'string' ? requestedQuery : '';
  const service = createUniverseReadService();
  const [active, staged, searchResult] = await Promise.all([
    service.getActiveUniverse(),
    service.getStagedUniversePreview('101'),
    service.searchActiveUniverse({ query, limit: 20 }),
  ]);

  return <UniverseSettings active={active} staged={staged} searchResult={searchResult} />;
}
