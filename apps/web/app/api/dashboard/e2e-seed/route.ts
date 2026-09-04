import { NextResponse } from 'next/server';
import { env } from '@/env';
import { resetRefreshRateLimit, seedBudgetExceeded, seedDashboardState, type SeedState } from '@/services/dashboard/testing';
import { resolveRedisClient } from '@/services/dashboard/redis';

const VALID_STATES: readonly SeedState[] = ['fresh', 'stale', 'insufficient', 'degraded', 'empty'];

function isSeedState(value: unknown): value is SeedState {
  return typeof value === 'string' && (VALID_STATES as readonly string[]).includes(value);
}

/**
 * **Test-only. 404s in every mode except `fixture`.** Same guard, same reasoning, as
 * `api/auth/fixture-link/route.ts` (F02): a real deployment always runs `live`
 * (`env.ts` validates `PROVIDER_MODE` at process start), so there is no environment variable
 * that makes this route reachable in production. See `src/services/dashboard/testing.ts` for
 * why the e2e suite needs a seam here rather than driving every state through the real
 * pipeline.
 *
 * Named `e2e-seed`, not `__test__` — a Next.js App Router folder prefixed with `_` is a
 * "private folder" excluded from routing, and `__test__` would silently never register as a
 * route at all rather than fail loudly.
 *
 * Two request shapes: `{ state }` seeds one of F07 §4.5's five display states directly;
 * `{ action: 'exceed_budget' }` writes one real `cost_event` row so the budget-refusal e2e case
 * exercises the actual `checkGlobalBudget` path instead of a seeded marker.
 */
export async function POST(request: Request) {
  if (env.PROVIDER_MODE !== 'fixture') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { state?: unknown; action?: unknown } | null;
  if (body === null) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (body.action === 'exceed_budget') {
    await seedBudgetExceeded();
    return NextResponse.json({ ok: true, action: 'exceed_budget' });
  }

  if (body.action === 'reset_rate_limit') {
    await resetRefreshRateLimit(resolveRedisClient());
    return NextResponse.json({ ok: true, action: 'reset_rate_limit' });
  }

  if (!isSeedState(body.state)) {
    return NextResponse.json({ error: 'invalid_state', validStates: VALID_STATES }, { status: 400 });
  }

  await seedDashboardState(body.state, resolveRedisClient());
  return NextResponse.json({ ok: true, state: body.state });
}
