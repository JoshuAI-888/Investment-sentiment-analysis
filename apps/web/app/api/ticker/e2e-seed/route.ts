import { NextResponse } from 'next/server';
import { env } from '@/env';
import { seedAmbiguousTicker, seedEmptyTicker, seedFullTicker, seedIneligibleTicker } from '@/services/ticker/testing';

const ACTIONS = ['full', 'ambiguous', 'empty', 'ineligible'] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

/**
 * **Test-only. 404s in every mode except `fixture`.** Same guard as
 * `api/dashboard/e2e-seed/route.ts` (F07) and `api/auth/fixture-link/route.ts` (F02) — see
 * `src/services/ticker/testing.ts` for why F09's e2e suite needs this seam.
 */
export async function POST(request: Request) {
  if (env.PROVIDER_MODE !== 'fixture') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body === null || !isAction(body.action)) {
    return NextResponse.json({ error: 'invalid_action', validActions: ACTIONS }, { status: 400 });
  }

  if (body.action === 'full') return NextResponse.json(await seedFullTicker());
  if (body.action === 'ambiguous') return NextResponse.json(await seedAmbiguousTicker());
  if (body.action === 'ineligible') return NextResponse.json(await seedIneligibleTicker());
  return NextResponse.json(await seedEmptyTicker());
}
