import { NextResponse } from 'next/server';
import { env } from '@/env';
import { resolveRedisClient } from '@/services/attention/redis';
import {
  seedAttentionDegraded,
  seedAttentionDegradedNoNewData,
  seedAttentionFresh,
  seedAttentionNeverCollectedMalformed,
  seedAttentionStale,
  seedAttentionUnavailable,
} from '@/services/attention/testing';

const VALID_STATES = [
  'fresh',
  'unavailable',
  'degraded',
  'stale',
  'degraded_no_new_data',
  'never_collected_malformed',
] as const;
type ValidState = (typeof VALID_STATES)[number];

function isValidState(value: unknown): value is ValidState {
  return typeof value === 'string' && (VALID_STATES as readonly string[]).includes(value);
}

/**
 * **Test-only. 404s in every mode except `fixture`.** Same guard as `api/auth/fixture-otp` (F02)
 * and `api/dashboard/e2e-seed` (F07) — see `src/services/attention/testing.ts` for why F08's e2e
 * suite needs a seam here rather than driving every state through a live ApeWisdom fixture.
 */
export async function POST(request: Request) {
  if (env.PROVIDER_MODE !== 'fixture') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { state?: unknown } | null;
  if (body === null || !isValidState(body.state)) {
    return NextResponse.json({ error: 'invalid_state', validStates: VALID_STATES }, { status: 400 });
  }

  const redis = resolveRedisClient();
  if (body.state === 'fresh') await seedAttentionFresh(redis);
  if (body.state === 'unavailable') await seedAttentionUnavailable(redis);
  if (body.state === 'degraded') await seedAttentionDegraded(redis);
  if (body.state === 'stale') await seedAttentionStale(redis);
  if (body.state === 'degraded_no_new_data') await seedAttentionDegradedNoNewData(redis);
  if (body.state === 'never_collected_malformed') await seedAttentionNeverCollectedMalformed(redis);

  return NextResponse.json({ ok: true, state: body.state });
}
