import { notFound } from 'next/navigation';
import { env } from '@/env';
import { FixtureRniAiRouteSettingsService } from '../../../../../../fixtures/rni-ui/read-service';
import { AiRouteSettingsFixtureHarness } from '@/rni/ui/AiRouteSettingsFixtureHarness';
import { FixtureRouteUnavailableError, renderFixtureOnly } from '@/rni/ui/renderFixtureOnly';

export const dynamic = 'force-dynamic';

async function UnavailableGatewayFixture() {
  const service = new FixtureRniAiRouteSettingsService({ gatewayAvailable: false });
  const setting = await service.getCurrentAiRouteSetting();
  return <AiRouteSettingsFixtureHarness gatewayAvailable={false} initialSetting={setting} />;
}

/** A guarded browser fixture that exposes the unavailable-route accessibility state. */
export default function RniAiRouteUnavailableFixturePage() {
  try {
    return renderFixtureOnly(env.PROVIDER_MODE, () => <UnavailableGatewayFixture />);
  } catch (error) {
    if (error instanceof FixtureRouteUnavailableError) notFound();
    throw error;
  }
}
