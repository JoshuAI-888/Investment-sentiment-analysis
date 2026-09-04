import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  fmpSecurityMasterSnapshot,
  importFmpSecurityMasterSnapshot,
} from '../src/repositories/security';
import { closePool } from '../src/repositories/client';

const [snapshotPath, environment = 'development', actorId = 'joshuai'] = process.argv.slice(2);
if (snapshotPath === undefined || snapshotPath.trim() === '') {
  throw new Error(
    'Usage: pnpm rni:bootstrap-security-master <reviewed-fmp-profile-export.json> [environment] [actor-id]',
  );
}

const snapshot = fmpSecurityMasterSnapshot.parse(
  JSON.parse(await readFile(resolve(snapshotPath), 'utf8')),
);
try {
  const result = await importFmpSecurityMasterSnapshot({
    environment,
    actorId,
    idempotencyKey: `fmp-security-master:${snapshot.payloadSha256}`,
    correlationId: `fmp-security-master:${snapshot.payloadSha256}`,
    snapshot,
  });

  process.stdout.write(
    `${JSON.stringify({
      importId: result.importId,
      importedCount: result.importedCount,
      reusedCount: result.reusedCount,
      replayed: result.replayed,
    })}\n`,
  );
} finally {
  await closePool();
}
