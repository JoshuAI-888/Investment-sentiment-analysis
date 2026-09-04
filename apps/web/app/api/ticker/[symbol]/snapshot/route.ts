import { NextResponse } from 'next/server';
import { requireUser, UnauthenticatedError } from '@/services/auth';
import { assembleTickerSnapshot } from '@/services/ticker/snapshot';

/**
 * F09 §2 — `GET /api/ticker/:symbol/snapshot`. Authorization is checked in this handler's own
 * body (F02 §4.4), not assumed from the page that usually calls the same service directly.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    throw error;
  }

  const { symbol } = await params;
  const snapshot = await assembleTickerSnapshot(symbol);
  return NextResponse.json(snapshot);
}
