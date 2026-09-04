import { NextResponse } from 'next/server';
import { requireUser, UnauthenticatedError } from '@/services/auth';
import { assembleDashboard } from '@/services/dashboard/assemble';
import { resolveRedisClient } from '@/services/dashboard/redis';

/**
 * F07 §2 — `GET /api/dashboard`. Authorization is checked in this handler's own body
 * (F02 §4.4), not assumed from the page that usually calls the same service directly.
 */
export async function GET() {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    throw error;
  }

  const dashboard = await assembleDashboard({ redis: resolveRedisClient() });
  return NextResponse.json(dashboard);
}
