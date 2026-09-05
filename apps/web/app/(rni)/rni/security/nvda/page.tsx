import { redirect } from 'next/navigation';
import {
  PasswordChangeRequiredError,
  requireUser,
  UnauthenticatedError,
} from '@/services/auth';
import {
  createLiveRniReadService,
  findLatestRniRunId,
  findRunSecurityByTicker,
  RniReadError,
  rniEnvironment,
} from '@/rni/read-model';
import { ReadSurfaceState } from '@/rni/ui/ReadSurfaceState';
import { SecurityDetail } from '@/rni/ui/SecurityDetail';
import { resolveCitationEvidence } from '@/rni/ui/evidence';

export const dynamic = 'force-dynamic';

export default async function NvdaSecurityDetailPage() {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    throw error;
  }

  try {
    const environment = rniEnvironment();
    const runId = await findLatestRniRunId(environment);
    const security = runId ? await findRunSecurityByTicker(runId, 'NVDA', environment) : null;
    if (!runId || !security) {
      return (
        <ReadSurfaceState
          message="The latest RNI run does not contain NVDA."
          state="empty"
          title="NVDA retail narrative"
        />
      );
    }
    const service = createLiveRniReadService();
    const detail = await service.getSecurityDetail(runId, security.id);
    const evidenceByCitationId = await resolveCitationEvidence(service, [
      ...detail.reddit.citationIds,
      ...detail.reddit.dimensions.flatMap((dimension) => dimension.citationIds),
      ...detail.x.citationIds,
      ...detail.x.dimensions.flatMap((dimension) => dimension.citationIds),
    ]);
    return <SecurityDetail detail={detail} evidenceByCitationId={evidenceByCitationId} />;
  } catch (error) {
    const forbidden = error instanceof RniReadError && error.code === 'FORBIDDEN';
    return (
      <ReadSurfaceState
        message={
          forbidden
            ? 'The saved evidence is no longer approved for display.'
            : 'NVDA narrative data could not be verified. Retry after the service recovers.'
        }
        state={forbidden ? 'forbidden' : 'unavailable'}
        title="NVDA retail narrative"
      />
    );
  }
}
