import { env } from '@/env';
import { PostgresRniAiRouteSettingsService } from './repositories/store';

export function createLiveAiRouteSettingsService(actorId: string) {
  return new PostgresRniAiRouteSettingsService({
    environment: process.env['VERCEL_ENV'] ?? 'development',
    actorId,
    credentialsAvailable: (route) =>
      route === 'openai_direct' ? Boolean(env.OPENAI_API_KEY) : Boolean(env.AI_GATEWAY_API_KEY),
  });
}
