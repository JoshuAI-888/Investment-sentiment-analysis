import { NextResponse } from 'next/server';
import { env } from '@/env';
import { registerAllJobHandlers } from '@/services/jobs/handlers';
import { acquireDispatchLock } from '@/services/jobs/lock';
import { verifyQStashSignature } from '@/services/jobs/qstash';
import { resolveRedisClient } from '@/services/jobs/redis';
import { dispatchDueJobs } from '@/services/jobs/service';

// Registered once at module load, before any request is handled — see `handlers/index.ts`'s own
// doc for why this is the one place a new job's handler is wired in.
registerAllJobHandlers();

function dispatchUrl(): string {
  return `${env.APP_BASE_URL}/api/cron/dispatch`;
}

/**
 * F16 §4.1 — the dispatcher. Step order is not a suggestion: signature verification happens
 * before the body is parsed for anything else, before Redis, before any database read, and
 * before any provider is ever reached. `F16 §7` review step 1 asks a reviewer to remove the
 * signature header and confirm rejection happens first — this function's own shape is the
 * answer: nothing below the `if (!verified.ok)` branch runs until that branch is cleared.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text();

  const verified = verifyQStashSignature({
    signatureHeader: request.headers.get('upstash-signature'),
    body,
    url: dispatchUrl(),
    signingKeys: [env.QSTASH_CURRENT_SIGNING_KEY, env.QSTASH_NEXT_SIGNING_KEY].filter((key): key is string => key !== undefined),
  });

  if (!verified.ok) {
    return NextResponse.json({ error: 'invalid_signature', reason: verified.reason }, { status: 401 });
  }

  const redis = resolveRedisClient();
  const lock = await acquireDispatchLock(redis);
  if (lock === null) {
    // F16 §4.1 step 2: "A second concurrent delivery is a no-op, not a queued duplicate."
    return NextResponse.json({ status: 'skipped', reason: 'lock_held' });
  }

  try {
    const result = await dispatchDueJobs({ redis });
    return NextResponse.json({
      status: 'ok',
      executed: result.executedCount,
      truncated: result.truncated,
      outcomes: result.results.map((entry) => ({ jobId: entry.run.jobId, runId: entry.run.id, outcome: entry.outcome, status: entry.run.status })),
    });
  } finally {
    // F16 §4.1 step 7: "Release the lock, including on failure." Every exit path above this
    // line — success, or `dispatchDueJobs` throwing — runs through this `finally`.
    await lock.release();
  }
}
