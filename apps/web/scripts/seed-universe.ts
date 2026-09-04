import { closePool, getPool } from '../src/repositories/client';
import { loadSeedFile, seedUniverse, SeedListMissing } from '../src/repositories/universe-seed';

const environment = process.env['APP_ENVIRONMENT'] ?? 'development';

try {
  const seed = await loadSeedFile();
  const outcome = await seedUniverse(environment, seed, getPool());

  if (outcome.seeded) {
    process.stdout.write(
      `seeded universe version ${outcome.universeVersion} with ${outcome.memberCount} members in ${environment}\n`,
    );
  } else {
    process.stdout.write(
      `no change — ${environment} already has ${outcome.existingVersions} universe version(s). ` +
        'A redeployment must never reinsert a symbol an administrator removed.\n',
    );
  }
} catch (error) {
  if (error instanceof SeedListMissing) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
} finally {
  await closePool();
}
