import { NextResponse } from 'next/server';
import { requireUser, UnauthenticatedError } from '@/services/auth';
import { checkGlobalBudget } from '@/services/dashboard/budget';
import { acquireRefreshLock, checkRefreshRateLimit } from '@/services/dashboard/rate-limit';
import { recordRefusal } from '@/services/dashboard/refusal';
import { resolveRedisClient } from '@/services/dashboard/redis';
import { runDashboardRefresh } from '@/services/dashboard/refresh';
import type { RefreshResponse } from '@/services/dashboard/contract';

/**
 * F07 §4.6 — `POST /api/dashboard/refresh`. "authenticated ... rate-limited, idempotent,
 * budget-checked against the global ceiling, and runs through the same internal job service."
 * Order matters and is deliberate: auth first (an unauthenticated caller learns nothing about
 * budget or rate state), then the coarse checks that refuse cheaply, then the actual work.
 */
export async function POST() {
  let session;
  try {
    session = await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    throw error;
  }

  const redis = resolveRedisClient();

  async function respondRefused(reason: 'rate_limited' | 'budget' | 'in_progress', message: string) {
    // F07 review finding 1: the marker this writes must expire, or a transient refusal
    // permanently disables the refresh control with no path back (`services/dashboard/
    // refusal.ts`'s doc comment has the full story and the per-reason TTL reasoning).
    await recordRefusal(redis, reason, message);
    const body: RefreshResponse = { status: 'refused', reason, message };
    return NextResponse.json(body);
  }

  const rateLimit = await checkRefreshRateLimit(redis);
  if (!rateLimit.allowed) {
    return respondRefused(
      'rate_limited',
      `A refresh already ran in the last ${String(rateLimit.retryAfterSeconds)} seconds. Try again shortly.`,
    );
  }

  const budget = await checkGlobalBudget();
  if (!budget.allowed) {
    return respondRefused('budget', budget.message);
  }

  const lock = await acquireRefreshLock(redis);
  if (lock === null) {
    return respondRefused('in_progress', 'A refresh is already running. Try again once it finishes.');
  }

  try {
    const outcome = await runDashboardRefresh({ redis, requestedBy: session.userId });
    if (!outcome.ok) {
      const body: RefreshResponse = { status: 'error', message: outcome.message };
      return NextResponse.json(body, { status: 503 });
    }
    const body: RefreshResponse = { status: 'ok', computedAt: new Date(outcome.computedAt) };
    return NextResponse.json(body);
  } finally {
    await lock.release();
  }
}
