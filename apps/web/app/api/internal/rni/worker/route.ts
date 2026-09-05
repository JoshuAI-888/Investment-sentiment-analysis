import { env } from '@/env';
import { createLiveRniExecutionServices } from '@/rni/orchestration/composition';
import {
  getProductionRniWorkerExecutor,
  receiveRniWorkerRequest,
  RNI_WORKER_PATH,
} from '@/rni/orchestration/worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return receiveRniWorkerRequest(request, {
    expectedUrl: new URL(RNI_WORKER_PATH, env.APP_BASE_URL).toString(),
    currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY ?? '',
    nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY ?? '',
    now: () => new Date(),
    resolveExecutor: getProductionRniWorkerExecutor,
    createServices: createLiveRniExecutionServices,
  });
}
