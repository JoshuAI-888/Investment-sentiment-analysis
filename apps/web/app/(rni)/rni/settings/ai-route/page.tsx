import { createFixtureRniAiRouteSettingsService } from '../../../../../fixtures/rni-ui/read-service';
import { AiRouteSettingsFixtureHarness } from '@/rni/ui/AiRouteSettingsFixtureHarness';
import type { RniAiRouteSettingsService } from '@/rni/contracts';

function createAiRouteSettingsService(): RniAiRouteSettingsService {
  return createFixtureRniAiRouteSettingsService();
}

export default async function RniAiRouteSettingsPage() {
  const setting = await createAiRouteSettingsService().getCurrentAiRouteSetting();
  return <AiRouteSettingsFixtureHarness initialSetting={setting} />;
}
