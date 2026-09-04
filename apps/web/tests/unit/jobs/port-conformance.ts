/**
 * Executable conformance suites for the ports in `src/services/jobs/ports.ts`.
 *
 * **These are not tests of the in-memory fakes.** They are the contract every implementation of
 * a port must satisfy, written so that SPINE's real Postgres/Redis-backed implementations can be
 * run against exactly the same assertions by importing this file and passing a factory. The
 * fakes are simply the first subject.
 *
 * lane-review found the reason this exists: the rule that `markOutage` preserves the *first*
 * failure's timestamp was implemented correctly in the fake and asserted against the fake, which
 * is a test of the thing that was already right. A real implementation that wrote `since = at`
 * on every call would have rendered every outage as seconds old forever, and nothing in the diff
 * would have caught it. A conformance suite is the difference between a rule that is documented
 * and a rule that is checked.
 */
import { expect } from 'vitest';
import type { ProviderError } from '@/contracts/provider';
import type { ScoringQueueEntry, ScorerHealthPort, ScoringQueuePort } from '@/services/jobs/ports';

const UPSTREAM: ProviderError = { kind: 'upstream', status: 503 };
const TIMEOUT: ProviderError = { kind: 'timeout' };

/**
 * The `ScorerHealthPort` contract, in full.
 *
 * `makePort` must return a **fresh, empty** port on every call — each assertion below starts
 * from a clean state, and a shared one would let an earlier case mask a later one.
 */
export async function assertScorerHealthPortContract(
  makePort: () => ScorerHealthPort | Promise<ScorerHealthPort>,
): Promise<void> {
  // 1. An outage records the moment it started.
  {
    const port = await makePort();
    await port.markOutage({ at: new Date('2026-08-30T11:04:00.000Z'), error: UPSTREAM });
    const health = await port.read();
    expect(health.state).toBe('outage');
    expect(health.since).toBe('2026-08-30T11:04:00.000Z');
  }

  // 2. THE RULE. Repeated failures do not move `since`. F18 renders "unavailable since {ts}";
  //    an implementation that overwrote it would make a two-hour outage read as seconds old,
  //    forever, and the banner's one number would be the wrong one.
  {
    const port = await makePort();
    await port.markOutage({ at: new Date('2026-08-30T11:04:00.000Z'), error: UPSTREAM });
    await port.markOutage({ at: new Date('2026-08-30T11:09:00.000Z'), error: UPSTREAM });
    await port.markOutage({ at: new Date('2026-08-30T13:04:00.000Z'), error: TIMEOUT });
    const health = await port.read();
    expect(health.since).toBe('2026-08-30T11:04:00.000Z');
  }

  // 3. `lastError` MAY move, and should: the most recent failure is the useful one to log.
  {
    const port = await makePort();
    await port.markOutage({ at: new Date('2026-08-30T11:04:00.000Z'), error: UPSTREAM });
    await port.markOutage({ at: new Date('2026-08-30T11:09:00.000Z'), error: TIMEOUT });
    const health = await port.read();
    expect(health.state === 'outage' && health.lastError).toEqual(TIMEOUT);
  }

  // 4. Recovery ends the outage and starts an uptime clock.
  {
    const port = await makePort();
    await port.markOutage({ at: new Date('2026-08-30T11:04:00.000Z'), error: UPSTREAM });
    await port.markHealthy({ at: new Date('2026-08-30T12:00:00.000Z') });
    const health = await port.read();
    expect(health.state).toBe('ok');
    expect(health.since).toBe('2026-08-30T12:00:00.000Z');
  }

  // 5. `markHealthy` is idempotent. The worker calls it on every drained pass, so an
  //    implementation that moved `since` each time would report uptime as always ~0.
  {
    const port = await makePort();
    await port.markOutage({ at: new Date('2026-08-30T11:04:00.000Z'), error: UPSTREAM });
    await port.markHealthy({ at: new Date('2026-08-30T12:00:00.000Z') });
    await port.markHealthy({ at: new Date('2026-08-30T12:05:00.000Z') });
    await port.markHealthy({ at: new Date('2026-08-30T14:00:00.000Z') });
    expect((await port.read()).since).toBe('2026-08-30T12:00:00.000Z');
  }

  // 6. A second outage after a recovery is a NEW outage, and takes the new timestamp. The
  //    first-timestamp rule is scoped to one outage, not to all of history.
  {
    const port = await makePort();
    await port.markOutage({ at: new Date('2026-08-30T11:04:00.000Z'), error: UPSTREAM });
    await port.markHealthy({ at: new Date('2026-08-30T12:00:00.000Z') });
    await port.markOutage({ at: new Date('2026-08-30T15:30:00.000Z'), error: UPSTREAM });
    expect((await port.read()).since).toBe('2026-08-30T15:30:00.000Z');
  }
}

function entry(overrides: Partial<ScoringQueueEntry> = {}): ScoringQueueEntry {
  return {
    itemId: 'item-1',
    axis: 'reddit',
    form: 'post',
    scorerId: 'finbert',
    reason: 'initial',
    supersedesScoreId: null,
    targetScorerVersion: null,
    enqueuedAt: '2026-08-30T12:00:00.000Z',
    ...overrides,
  };
}

/**
 * The `ScoringQueuePort` contract — the two rules `ports.ts`'s doc comments state but that were,
 * before this, checked only by whichever fake happened to get them right. Found by lane-review:
 * `fakeQueue.release` never repositions a released entry at all, so it only *looks* like it
 * preserves order because `lease` re-sorts by `enqueuedAt` on every call — a Redis
 * implementation that `RPUSH`es a released entry to the tail would reshuffle the backlog under
 * an outage, and nothing executable here would have caught it.
 *
 * `makePort` must return a **fresh, empty** port on every call, exactly as
 * `assertScorerHealthPortContract` requires.
 */
export async function assertScoringQueuePortContract(
  makePort: () => ScoringQueuePort | Promise<ScoringQueuePort>,
): Promise<void> {
  // 1. THE RULE from the doc comment: `enqueue` is idempotent per
  //    `(itemId, reason, supersedesScoreId)`. The collector may re-enqueue an item it already
  //    wrote when a poll overlaps; a non-idempotent implementation produces two live entries and
  //    eventually two score rows for one item under one revision.
  {
    const port = await makePort();
    await port.enqueue([entry({ itemId: 'a' })]);
    await port.enqueue([entry({ itemId: 'a' })]);
    const stats = await port.stats({ at: new Date('2026-08-30T12:00:00.000Z') });
    expect(stats.depth).toBe(1);
  }

  // 1b. The idempotency key is the *triple*, not the item alone — a genuinely different entry
  //     for the same item (a re-score, naming the row it supersedes) must not be swallowed by
  //     the initial-scoring entry already sitting in the queue.
  {
    const port = await makePort();
    await port.enqueue([entry({ itemId: 'a', reason: 'initial', supersedesScoreId: null })]);
    await port.enqueue([entry({ itemId: 'a', reason: 'rescore', supersedesScoreId: 'score-1' })]);
    const stats = await port.stats({ at: new Date('2026-08-30T12:00:00.000Z') });
    expect(stats.depth).toBe(2);
  }

  // 2. THE RULE: `release` preserves original enqueue order. An outage must not reshuffle the
  //    backlog — the oldest waiting item stays the oldest waiting item across any number of
  //    lease/release cycles, which is what §4.2 rule 3's "oldest unscored age" counter and D-16's
  //    forward-only guarantee both assume. The trap this is written to catch: an implementation
  //    that `RPUSH`es a released entry to the tail of a list. That looks correct in isolation —
  //    a solitary released entry, re-leased alone, comes back looking fine — and only shows the
  //    reshuffle when something else was already waiting *behind* it at release time, which is
  //    exactly what this case sets up.
  {
    const port = await makePort();
    await port.enqueue([
      entry({ itemId: 'oldest', enqueuedAt: '2026-08-30T12:00:00.000Z' }),
      entry({ itemId: 'newer', enqueuedAt: '2026-08-30T12:01:00.000Z' }),
    ]);

    const at = new Date('2026-08-30T12:05:00.000Z');
    // Only `oldest` is leased. `newer` is left waiting, never touched, at its original
    // position — the position a tail-append on release would displace it from.
    const leased = await port.lease({ max: 1, at });
    expect(leased.map((e) => e.itemId)).toEqual(['oldest']);

    await port.release({ leaseIds: [leased[0]!.leaseId], at, countsAsAttempt: false });

    const relaunched = await port.lease({ max: 2, at });
    expect(relaunched.map((e) => e.itemId)).toEqual(['oldest', 'newer']);
  }
}
