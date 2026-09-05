import { redirect } from 'next/navigation';
import {
  PasswordChangeRequiredError,
  requireUser,
  UnauthenticatedError,
} from '@/services/auth';
import {
  createLiveRniReadService,
  findLatestVisibleRniRunId,
  RniReadError,
  rniEnvironment,
} from '@/rni/read-model';
import { RetailRadar } from '@/rni/ui/RetailRadar';
import { ReadSurfaceState } from '@/rni/ui/ReadSurfaceState';
import { resolveCitationEvidence } from '@/rni/ui/evidence';

export const dynamic = 'force-dynamic';

export default async function RniRadarPage() {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    throw error;
  }

  try {
    const runId = await findLatestVisibleRniRunId(rniEnvironment());
    if (!runId) {
      return (
        <ReadSurfaceState
          message="No RNI run exists in this environment yet. An administrator can request one from Manual refresh."
          state="empty"
          title="Retail Radar"
        />
      );
    }
    const service = createLiveRniReadService();
    const page = await service.getRadarPage({ runId, limit: 50 });
    const evidenceByCitationId = await resolveCitationEvidence(
      service,
      page.rows.flatMap((row) => [
        ...row.reddit.citationIds,
        ...row.x.citationIds,
        ...row.combined.citationIds,
      ]),
    );
    return <RetailRadar page={page} evidenceByCitationId={evidenceByCitationId} />;
  } catch (error) {
    const forbidden = error instanceof RniReadError && error.code === 'FORBIDDEN';
    return (
      <ReadSurfaceState
        message={
          forbidden
            ? 'The saved evidence is no longer approved for display.'
            : 'Retail Radar could not load a verified database snapshot. Retry after the service recovers.'
        }
        state={forbidden ? 'forbidden' : 'unavailable'}
        title="Retail Radar"
      />
    );
  }
}
