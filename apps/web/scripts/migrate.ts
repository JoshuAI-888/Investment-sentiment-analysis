import { getPool, closePool } from '../src/repositories/client';
import { migrate } from '../src/repositories/migrate';

const pool = getPool();
const outcome = await migrate(pool);

for (const filename of outcome.applied) process.stdout.write(`applied  ${filename}\n`);
for (const filename of outcome.skipped) process.stdout.write(`skipped  ${filename}\n`);
process.stdout.write(`\n${outcome.applied.length} applied, ${outcome.skipped.length} already present\n`);

await closePool();
