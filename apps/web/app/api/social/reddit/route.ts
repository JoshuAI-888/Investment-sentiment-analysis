import { NextResponse } from 'next/server';
import { requireUser, UnauthenticatedError, PasswordChangeRequiredError } from '@/services/auth';
import { assembleAttentionLeaderboard } from '@/services/attention/leaderboard';

/**
 * F08 §2 — `GET /api/social/reddit`. Authorization is re-checked in this handler's own body
 * (F02 §4.4), matching `GET /api/dashboard`'s (F07) precedent for the same reason.
 */
export async function GET() {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof PasswordChangeRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    throw error;
  }

  const leaderboard = await assembleAttentionLeaderboard();
  return NextResponse.json(leaderboard);
}
