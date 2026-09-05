import { notFound } from 'next/navigation';
import { env } from '@/env';
import { createFixtureRniUniverseReadService } from '@/fixtures/rni-ui/read-service';
import { FixtureRouteUnavailableError, renderFixtureOnly } from '@/rni/ui/renderFixtureOnly';
import { UniverseSettings } from '@/rni/ui/UniverseSettings';

export const dynamic = 'force-dynamic';

type PageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}>;

async function FixtureUniverse({ searchParams }: PageProps) {
  const requested = await searchParams;
  const query = typeof requested.query === 'string' ? requested.query : '';
  const service = createFixtureRniUniverseReadService();
  const [active, staged, searchResult] = await Promise.all([
    service.getActiveUniverse(),
    service.getStagedUniversePreview('101'),
    service.searchActiveUniverse({ query, limit: 20 }),
  ]);
  return <UniverseSettings active={active} staged={staged} searchResult={searchResult} />;
}

export default function RniFixtureUniversePage(props: PageProps) {
  try {
    return renderFixtureOnly(env.PROVIDER_MODE, () => <FixtureUniverse {...props} />);
  } catch (error) {
    if (error instanceof FixtureRouteUnavailableError) notFound();
    throw error;
  }
}
