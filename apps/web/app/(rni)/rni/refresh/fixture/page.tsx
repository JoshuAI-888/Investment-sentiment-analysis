import { notFound } from 'next/navigation';
import { env } from '@/env';
import { ManualRefreshFixtureHarness } from '@/rni/ui/ManualRefreshFixtureHarness';
import { FixtureRouteUnavailableError, renderFixtureOnly } from '@/rni/ui/renderFixtureOnly';

/** This fixture-only page must inspect validated mode at request time, never at build time. */
export const dynamic = 'force-dynamic';

export default function RniRefreshFixturePage() {
  try {
    return renderFixtureOnly(env.PROVIDER_MODE, () => <ManualRefreshFixtureHarness />);
  } catch (error) {
    if (error instanceof FixtureRouteUnavailableError) notFound();
    throw error;
  }
}
