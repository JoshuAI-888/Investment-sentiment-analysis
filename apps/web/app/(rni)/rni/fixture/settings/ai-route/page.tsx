import { notFound } from 'next/navigation';
import { env } from '@/env';
import { createFixtureRniAiRouteSettingsService } from '@/fixtures/rni-ui/read-service';
import { AiRouteSettingsFixtureHarness } from '@/rni/ui/AiRouteSettingsFixtureHarness';
import { FixtureRouteUnavailableError, renderFixtureOnly } from '@/rni/ui/renderFixtureOnly';

export const dynamic = 'force-dynamic';

async function FixtureAiRouteSettings() {
  const setting = await createFixtureRniAiRouteSettingsService().getCurrentAiRouteSetting();
  return <AiRouteSettingsFixtureHarness initialSetting={setting} />;
}

export default function RniFixtureAiRouteSettingsPage() {
  try {
    return renderFixtureOnly(env.PROVIDER_MODE, () => <FixtureAiRouteSettings />);
  } catch (error) {
    if (error instanceof FixtureRouteUnavailableError) notFound();
    throw error;
  }
}
