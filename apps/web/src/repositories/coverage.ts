/**
 * Coverage windows, heartbeats and gap detection (F22 §4.4).
 *
 * Gap detection reads heartbeats rather than the fact tables, and the distinction matters: a
 * quiet hour on Reddit is not a gap. `items_seen = 0` with a heartbeat present means the
 * collector ran and the window was genuinely empty. **A gap is the absence of the heartbeat**,
 * not the absence of data — conflating the two manufactures gaps on every quiet weekend and
 * makes the real ones unfindable.
 */
import type { CoverageAxis, CoverageGap, CoverageWindow, GapReason } from '../contracts/coverage';
import { getPool, type Queryable } from './client';

export async function recordHeartbeat(
  axis: CoverageAxis,
  observedAt: Date,
  itemsSeen: number,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    `insert into collector_heartbeat (axis, observed_at, items_seen)
     values ($1, $2, $3)
     on conflict (axis, observed_at) do nothing`,
    [axis, observedAt, itemsSeen],
  );
}

export async function recordGap(
  gap: { axis: CoverageAxis; from: Date; to: Date; reason: GapReason; detail?: unknown },
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    `insert into coverage_gap (axis, gap_from, gap_to, reason, detail)
     values ($1, $2, $3, $4, $5)
     on conflict (axis, gap_from, gap_to) do nothing`,
    [gap.axis, gap.from, gap.to, gap.reason, JSON.stringify(gap.detail ?? {})],
  );
}

export async function listGaps(
  axis: CoverageAxis,
  db: Queryable = getPool(),
): Promise<CoverageGap[]> {
  const { rows } = await db.query<{
    axis: CoverageAxis;
    gap_from: Date;
    gap_to: Date;
    reason: GapReason;
  }>(
    'select axis, gap_from, gap_to, reason from coverage_gap where axis = $1 order by gap_from',
    [axis],
  );

  return rows.map((row) => ({
    axis: row.axis,
    from: row.gap_from,
    to: row.gap_to,
    reason: row.reason,
    // A literal, not a column (F22 §3). D-16 admits no other kind.
    permanent: true as const,
  }));
}

export async function coverageWindowFor(
  axis: CoverageAxis,
  db: Queryable = getPool(),
): Promise<CoverageWindow | null> {
  const { rows: start } = await db.query<{ started_at: Date }>(
    'select started_at from collector_start where axis = $1',
    [axis],
  );
  const startedAt = start[0]?.started_at;
  if (startedAt === undefined) return null;

  const { rows: last } = await db.query<{ last: Date | null }>(
    'select max(observed_at) as last from collector_heartbeat where axis = $1',
    [axis],
  );

  return {
    axis,
    startedAt,
    gaps: await listGaps(axis, db),
    lastObservedAt: last[0]?.last ?? null,
  };
}

/**
 * Finds intervals between consecutive heartbeats longer than the threshold and records them.
 *
 * Idempotent by the unique constraint on `(axis, gap_from, gap_to)`: re-running the detector
 * over the same history writes nothing new. It has to be — the detector runs on a schedule and
 * a duplicate gap would inflate every coverage figure that counts them.
 */
export async function detectGaps(
  axis: CoverageAxis,
  thresholdMs: number,
  reason: GapReason = 'collector_down',
  db: Queryable = getPool(),
): Promise<CoverageGap[]> {
  const { rows } = await db.query<{ observed_at: Date }>(
    'select observed_at from collector_heartbeat where axis = $1 order by observed_at',
    [axis],
  );

  const found: CoverageGap[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]?.observed_at;
    const current = rows[index]?.observed_at;
    if (previous === undefined || current === undefined) continue;

    if (current.getTime() - previous.getTime() <= thresholdMs) continue;

    const gap: CoverageGap = {
      axis,
      from: previous,
      to: current,
      reason,
      permanent: true,
    };
    await recordGap({ ...gap, detail: { thresholdMs } }, db);
    found.push(gap);
  }

  return found;
}
