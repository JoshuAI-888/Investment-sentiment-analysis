import { redirect } from 'next/navigation';
import {
  PasswordChangeRequiredError,
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
} from '@/services/auth';
import { AdminDenied } from '@/ui/AdminDenied';
import {
  createLiveRniUniverseReadService,
  findLatestStagedUniverseId,
  rniEnvironment,
} from '@/rni/read-model';
import { ReadSurfaceState } from '@/rni/ui/ReadSurfaceState';
import { UniverseSettings } from '@/rni/ui/UniverseSettings';

export const dynamic = 'force-dynamic';

type RniUniverseSettingsPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}>;

export default async function RniUniverseSettingsPage({
  searchParams,
}: RniUniverseSettingsPageProps) {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/rni/settings/universe" />;
    throw error;
  }

  const requestedParams = await searchParams;
  const requestedQuery = requestedParams.query;
  const query = typeof requestedQuery === 'string' ? requestedQuery : '';
  try {
    const service = createLiveRniUniverseReadService();
    const [active, searchResult, stagedId] = await Promise.all([
      service.getActiveUniverse(),
      service.searchActiveUniverse({ query, limit: 20 }),
      findLatestStagedUniverseId(rniEnvironment()),
    ]);
    const staged = stagedId ? await service.getStagedUniversePreview(stagedId) : null;
    return <UniverseSettings active={active} staged={staged} searchResult={searchResult} />;
  } catch {
    return (
      <ReadSurfaceState
        message="Universe settings could not load a verified active configuration."
        state="unavailable"
        title="Universe settings"
      />
    );
  }
}
