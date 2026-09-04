import { closePool, getPool } from '../src/repositories/client';
import {
  growthPerMonth,
  measureStorage,
  MIN_SPAN_DAYS,
  recordMeasurement,
} from '../src/repositories/storage';

const MB = 1024 * 1024;

const pool = getPool();
const measurements = await measureStorage(pool);
await recordMeasurement(measurements, new Date(), pool);

process.stdout.write('Measured storage (F22 §4.5) — pg_total_relation_size, not a projection\n\n');

const byClass = new Map<string, number>();
for (const m of measurements) {
  byClass.set(m.retentionClass, (byClass.get(m.retentionClass) ?? 0) + m.totalBytes);
}

for (const [retentionClass, bytes] of [...byClass].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`  ${retentionClass.padEnd(18)} ${(bytes / MB).toFixed(2).padStart(10)} MB\n`);
}

const growth = await growthPerMonth(pool);
process.stdout.write('\nGrowth rate\n');
if (growth.length === 0) {
  process.stdout.write(
    `  not derivable yet — a rate needs two readings at least ${MIN_SPAN_DAYS} day apart.\n` +
      '  A single reading is a size; two a minute apart give a rate whose magnitude is an\n' +
      '  artifact of the denominator. Either one reported as growth is how a projection gets\n' +
      '  mistaken for a measurement, which is exactly what F03 §4.5 produced.\n',
  );
} else {
  for (const reading of growth) {
    process.stdout.write(
      `  ${reading.retentionClass.padEnd(18)} ${(reading.bytesPerMonth / MB).toFixed(2).padStart(10)} MB/month ` +
        `(${reading.samples} readings over ${reading.spanDays.toFixed(1)} d)\n`,
    );
  }
}

await closePool();
