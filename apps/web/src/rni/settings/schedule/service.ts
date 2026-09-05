import { env } from '@/env';
import { rniEnvironment } from '@/rni/read-model';
import { RniScheduleSettingsError } from './errors';
import { PostgresRniScheduleSettingsService } from './repositories/store';

/** Call only after the API/page has authenticated an administrator; no fixture fallback. */
export function createLiveScheduleSettingsService(actorId: string) {
  if (env.PROVIDER_MODE !== 'live' || !env.DATABASE_URL)
    throw new RniScheduleSettingsError('unavailable');
  return new PostgresRniScheduleSettingsService({ environment: rniEnvironment(), actorId });
}
