import { createFixtureRniUniverseReadService } from '../../../../../fixtures/rni-ui/read-service';
import { UniverseSettings } from '@/rni/ui/UniverseSettings';

export default async function RniUniverseSettingsPage() {
  const service = createFixtureRniUniverseReadService();
  const active = await service.getActiveUniverse();
  const staged = await service.getStagedUniversePreview('101');
  return <UniverseSettings active={active} staged={staged} />;
}
