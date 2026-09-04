import {
  GATE_MB,
  project,
  WAVE_1_PROJECTION,
  type LineItem,
} from './checks/storage-projection';

const projection = project(WAVE_1_PROJECTION);
const MB = 1024 * 1024;

const width = Math.max(...projection.lines.map((line) => line.key.length));
const render = (line: LineItem) =>
  `  ${line.key.padEnd(width)}  ${(line.bytes / MB).toFixed(1).padStart(8)} MB   ${line.note}\n`;

process.stdout.write(
  `Storage projection — 100 symbols, ${WAVE_1_PROJECTION.historyDays} d history, ` +
    `${WAVE_1_PROJECTION.artifactRetentionDays} d artifact retention.\n` +
    `An artifact is one computation invocation, not one rendered point (F-07).\n\n`,
);

process.stdout.write(`Counted against the ${GATE_MB} MB gate\n`);
for (const line of projection.lines
  .filter((l) => l.pool !== 'corpus')
  .sort((a, b) => b.bytes - a.bytes)) {
  process.stdout.write(render(line));
}
process.stdout.write(`\n  ${'TOTAL (with indexes)'.padEnd(width)}  ${projection.gatedMb.toFixed(1).padStart(8)} MB\n`);

process.stdout.write(`\nGoverned separately by §6.8's growth-rate budget, not by this gate\n`);
for (const line of projection.lines.filter((l) => l.pool === 'corpus')) {
  process.stdout.write(render(line));
}
process.stdout.write(
  `\n  ${'growth rate'.padEnd(width)}  ${projection.corpusMbPerMonth.toFixed(1).padStart(8)} MB/month   (D-33 planned 120–180)\n`,
);
process.stdout.write(
  `  ${`at ${WAVE_1_PROJECTION.historyDays} d`.padEnd(width)}  ${projection.corpusMbAtHistoryEnd.toFixed(1).padStart(8)} MB\n\n`,
);

const artifacts = projection.lines.filter((l) => l.pool === 'artifact');
const dominant = [...artifacts].sort((a, b) => b.bytes - a.bytes)[0];

process.stdout.write(
  `Against F-07's ${GATE_MB} MB figure: ${projection.gatedMb.toFixed(1)} MB — over it.\n` +
    `Dominant line: ${dominant?.key} at ${((dominant?.bytes ?? 0) / MB).toFixed(1)} MB.\n\n`,
);

process.stdout.write(
  `This script does NOT gate, and that is F22 §4.5's ruling rather than a concession:\n` +
    `the measured MB/month figure "replaces F-07's fixed < 300 MB ceiling, which is the wrong\n` +
    `instrument for a corpus designed to grow forever". A ceiling on a permanent corpus tells\n` +
    `you one thing once — the day you crossed it.\n\n` +
    `Two further reasons not to act on the number above:\n` +
    `  * It is a PROJECTION. The refresh cadences in WAVE_1_PROJECTION are assumptions; no\n` +
    `    feature spec fixes per-job cadences, and F16's five minutes is the dispatcher's. They\n` +
    `    are the term the result is most sensitive to.\n` +
    `  * The real instrument is \`pnpm --filter web measure:storage\`, which reads\n` +
    `    pg_total_relation_size and refuses to report a rate from fewer than two readings a day\n` +
    `    apart. Use that once the collector has run.\n`,
);
