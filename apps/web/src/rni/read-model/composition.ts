import { RNI_ACTIVE_SOURCE_RIGHTS_POLICY_VERSION } from '../config';
import { PostgresRniReadService, PostgresRniUniverseReadService } from './service';

export function rniEnvironment(): string {
  return process.env['VERCEL_ENV'] ?? 'development';
}

export function createLiveRniReadService() {
  return new PostgresRniReadService({
    environment: rniEnvironment(),
    rightsPolicyVersion: async () => RNI_ACTIVE_SOURCE_RIGHTS_POLICY_VERSION,
  });
}

export function createLiveRniUniverseReadService() {
  return new PostgresRniUniverseReadService({
    environment: rniEnvironment(),
    rightsPolicyVersion: async () => RNI_ACTIVE_SOURCE_RIGHTS_POLICY_VERSION,
  });
}
