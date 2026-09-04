import path from 'node:path';
import { scanChunks } from './checks/bundle';
import { readFiles, walk, WEB_ROOT } from './checks/load';
import { report } from './checks/types';

/**
 * Client chunks only. `.next/server/` is server output and is *supposed* to contain the
 * database client — scanning it would report the architecture working correctly as a failure.
 */
const CLIENT_CHUNKS = path.join(WEB_ROOT, '.next/static');

const files = await walk(CLIENT_CHUNKS, ['.js', '.mjs']);

if (files.length === 0) {
  process.stdout.write(
    'check:bundle: no client chunks found under .next/static — run `pnpm build` first.\n',
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`check:bundle — scanning ${files.length} client chunk(s)\n`);
  process.exitCode = report('check:bundle', scanChunks(await readFiles(files)));
}
