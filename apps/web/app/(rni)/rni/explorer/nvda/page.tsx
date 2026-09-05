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
import { RawDataExplorer } from '@/rni/ui/RawDataExplorer';
import { ReadSurfaceState } from '@/rni/ui/ReadSurfaceState';
import { resolveCitationEvidence } from '@/rni/ui/evidence';

export const dynamic = 'force-dynamic';

export default async function NvdaRawDataExplorerPage() {
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
          message="The latest RNI run does not contain NVDA evidence."
          state="empty"
          title="NVDA evidence explorer"
        />
      );
    }
    const service = createLiveRniReadService();
    const summary = await service.getSecuritySummary(runId, security.id);
    const evidenceByCitationId = await resolveCitationEvidence(
      service,
      summary.sections.flatMap((section) => section.citationIds),
    );
    return (
      <RawDataExplorer
        evidenceByCitationId={evidenceByCitationId}
        security={security}
        summary={summary}
      />
    );
  } catch (error) {
    const conflict = error instanceof RniReadError && error.code === 'CONFLICT';
    const forbidden = error instanceof RniReadError && error.code === 'FORBIDDEN';
    return (
      <ReadSurfaceState
        message={
          conflict
            ? 'The latest run is still processing or has no accepted cited publication.'
            : forbidden
              ? 'The saved evidence is no longer approved for display.'
              : 'The evidence explorer could not load a verified snapshot. Retry after the service recovers.'
        }
        state={conflict ? 'empty' : forbidden ? 'forbidden' : 'unavailable'}
        title="NVDA evidence explorer"
      />
    );
  }
}
