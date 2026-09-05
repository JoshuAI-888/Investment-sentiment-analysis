import { redirect } from 'next/navigation';
import {
  PasswordChangeRequiredError,
  requireUser,
  UnauthenticatedError,
} from '@/services/auth';
import {
  createLiveRniReadService,
  findLatestRniRunId,
  rniEnvironment,
} from '@/rni/read-model';
import { ReadSurfaceState } from '@/rni/ui/ReadSurfaceState';
import { RniStateMatrix } from '@/rni/ui/RniStateMatrix';

export const dynamic = 'force-dynamic';

export default async function RniRunStatusPage() {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    throw error;
  }

  try {
    const runId = await findLatestRniRunId(rniEnvironment());
    if (!runId) {
      return (
        <ReadSurfaceState
          message="No RNI run exists in this environment yet."
          state="empty"
          title="Run status"
        />
      );
    }
    const service = createLiveRniReadService();
    const [run, platformSlices] = await Promise.all([
      service.getRun(runId),
      service.getPlatformSlices(runId),
    ]);
    return (
      <RniStateMatrix entries={[{ id: run.id, label: 'Latest run', run, platformSlices }]} />
    );
  } catch {
    return (
      <ReadSurfaceState
        message="Run status could not load a verified database snapshot. Retry after the service recovers."
        state="unavailable"
        title="Run status"
      />
    );
  }
}
