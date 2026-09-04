import { NextResponse } from 'next/server';
import { requireUser, UnauthenticatedError } from '@/services/auth';
import { searchTickers } from '@/services/ticker/search';

/**
 * F09 §4.5 — `GET /api/search?q=`. Local security-master search, no provider call per keystroke
 * (F03 §4.4). Authorization is checked in this handler's own body (F02 §4.4).
 */
export async function GET(request: Request) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    throw error;
  }

  const q = new URL(request.url).searchParams.get('q') ?? '';
  const result = await searchTickers(q, new Date());
  return NextResponse.json(result);
}
