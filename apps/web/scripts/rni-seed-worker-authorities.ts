import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { closePool, getPool, withTransaction } from '../src/repositories/client';
import { assertDraftRniWorkerConfigAuthorityTarget } from '../src/rni/repositories/worker-manifest';
import {
  defaultRniWorkerAuthorityPackPersistence,
  parseRniReviewedWorkerAuthorityPack,
  seedRniReviewedWorkerAuthorityPack,
} from '../src/rni/orchestration/worker-authority-pack';

const [reviewedPackPath] = process.argv.slice(2);
if (reviewedPackPath === undefined || reviewedPackPath.trim() === '') {
  throw new Error('Usage: pnpm rni:seed-worker-authorities <reviewed-worker-authorities.json>');
}

const pack = parseRniReviewedWorkerAuthorityPack(
  JSON.parse(await readFile(resolve(reviewedPackPath), 'utf8')),
);
const pool = getPool();

try {
  const result = await seedRniReviewedWorkerAuthorityPack(pack, {
    transaction: (work) => withTransaction(work, pool),
    assertDraftConfig: assertDraftRniWorkerConfigAuthorityTarget,
    ...defaultRniWorkerAuthorityPackPersistence,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await closePool();
}
