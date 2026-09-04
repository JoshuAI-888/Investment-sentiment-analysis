/**
 * Measured storage, per retention class (F22 §4.5).
 *
 * §4.5 is explicit that this **replaces F-07's fixed `< 300 MB` ceiling**, "which is the wrong
 * instrument for a corpus designed to grow forever". A ceiling on a permanent corpus tells you
 * one thing, once: the day you crossed it. A growth rate tells you how long you have, every
 * time you measure it.
 *
 * Measured, not projected. F03 §4.5's projection turned entirely on an assumed refresh cadence
 * that no feature spec fixes; this reads `pg_total_relation_size`.
 */
import { RETENTION_POLICY, type RetentionClass } from './retention';
import { getPool, type Queryable } from './client';

export type TableMeasurement = {
  readonly table: string;
  readonly retentionClass: RetentionClass;
  readonly totalBytes: number;
  readonly rowCount: number;
};

export type GrowthReading = {
  readonly retentionClass: RetentionClass;
  readonly bytesPerMonth: number;
  readonly spanDays: number;
  readonly samples: number;
};

const CLASS_BY_TABLE = new Map(
  RETENTION_POLICY.map((rule) => [rule.table, rule.retentionClass] as const),
);

export async function measureStorage(db: Queryable = getPool()): Promise<TableMeasurement[]> {
  const { rows } = await db.query<{ table_name: string; total_bytes: string; row_count: string }>(
    `select c.relname as table_name,
            pg_total_relation_size(c.oid)::text as total_bytes,
            coalesce(s.n_live_tup, 0)::text as row_count
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public' and c.relkind = 'r'
      order by pg_total_relation_size(c.oid) desc`,
  );

  return rows.map((row) => ({
    table: row.table_name,
    retentionClass: CLASS_BY_TABLE.get(row.table_name) ?? 'operational',
    totalBytes: Number(row.total_bytes),
    rowCount: Number(row.row_count),
  }));
}

/**
 * Persists a reading so growth can be derived from two of them.
 *
 * **One timestamp for the whole batch**, passed in rather than defaulted per row. Letting each
 * row take its own `now()` makes every table its own "reading" microseconds apart, and the rate
 * derived from that is a division by very nearly zero — which is not a small error, it is a
 * number with no relationship to the quantity it claims to measure.
 */
export async function recordMeasurement(
  measurements: readonly TableMeasurement[],
  measuredAt: Date = new Date(),
  db: Queryable = getPool(),
): Promise<void> {
  for (const measurement of measurements) {
    await db.query(
      `insert into storage_measurement (measured_at, retention_class, table_name, total_bytes, row_count)
       values ($1, $2, $3, $4, $5)`,
      [
        measuredAt,
        measurement.retentionClass,
        measurement.table,
        measurement.totalBytes,
        measurement.rowCount,
      ],
    );
  }
}

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30;

/**
 * Two readings a minute apart do not describe a month. Below this span the arithmetic is a
 * division by very nearly zero and produces a confident, enormous, meaningless figure — which
 * is worse than reporting nothing, because it looks like data.
 */
export const MIN_SPAN_DAYS = 1;

/**
 * Growth per class, from the earliest and latest stored measurements.
 *
 * Returns nothing for a class with fewer than two readings, or with less than `MIN_SPAN_DAYS`
 * between them — deliberately, in both cases. A single reading is a size, not a rate; and two
 * readings taken in the same minute produce a rate whose magnitude is an artifact of the
 * denominator. Reporting either as a growth figure is how a projection gets mistaken for a
 * measurement, which is exactly what F03 §4.5's number turned out to be.
 */
export async function growthPerMonth(db: Queryable = getPool()): Promise<GrowthReading[]> {
  const { rows } = await db.query<{
    retention_class: RetentionClass;
    first_at: Date;
    last_at: Date;
    first_bytes: string;
    last_bytes: string;
    samples: string;
  }>(
    `with per_class as (
       select retention_class, measured_at, sum(total_bytes) as bytes
         from storage_measurement
        group by retention_class, measured_at
     ),
     bounds as (
       select retention_class,
              min(measured_at) as first_at,
              max(measured_at) as last_at,
              count(*)::text   as samples
         from per_class group by retention_class
     )
     select b.retention_class,
            b.first_at, b.last_at, b.samples,
            f.bytes::text as first_bytes,
            l.bytes::text as last_bytes
       from bounds b
       join per_class f on f.retention_class = b.retention_class and f.measured_at = b.first_at
       join per_class l on l.retention_class = b.retention_class and l.measured_at = b.last_at`,
  );

  const readings: GrowthReading[] = [];

  for (const row of rows) {
    const samples = Number(row.samples);
    if (samples < 2) continue;

    const spanMs = row.last_at.getTime() - row.first_at.getTime();
    const spanDays = spanMs / MS_PER_DAY;
    if (spanDays < MIN_SPAN_DAYS) continue;

    const grown = Number(row.last_bytes) - Number(row.first_bytes);

    readings.push({
      retentionClass: row.retention_class,
      bytesPerMonth: (grown / spanDays) * DAYS_PER_MONTH,
      spanDays,
      samples,
    });
  }

  return readings;
}
