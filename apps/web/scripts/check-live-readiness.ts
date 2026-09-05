/**
 * Preflight for `PROVIDER_MODE=live` — F01 §4.2's schema, asked before it is too late to ask.
 *
 * `src/env.ts` validates at **module load** and throws on a missing key. That is the right
 * behaviour ("a process that starts with a half-valid environment fails later, somewhere else,
 * as a symptom that does not name its cause") but it has a sharp edge in production: flipping
 * `PROVIDER_MODE` to `live` with one required key unset does not degrade the deployment, it
 * **fails every request**, because the module that throws is imported by every server route.
 * The first evidence would be a dead site.
 *
 * This asks the same schema the same question in a process that can safely fail.
 *
 * Usage:
 *   vercel env pull .env.production --environment production
 *   pnpm --filter web check:live-readiness .env.production
 *
 * With no argument it checks the current `process.env`.
 *
 * **It never prints a value** — only key names and whether they are set. The output is meant to
 * be pasteable into an issue or a chat, and a secret that reaches either is a secret to rotate.
 */
import { readFile } from 'node:fs/promises';
import { checkLiveReadiness, parseDotenv } from './checks/live-readiness';

const file = process.argv[2];
const source: Record<string, string | undefined> = file
  ? parseDotenv(await readFile(file, 'utf-8'))
  : { ...process.env };
const label = file ?? 'process.env';

const report = checkLiveReadiness(source);

process.stdout.write(`check:live-readiness — ${label}\n`);

if (report.ok) {
  process.stdout.write('check:live-readiness: pass\n');
  process.stdout.write(
    'Every key PROVIDER_MODE=live requires is present. This checks presence and shape only — ' +
      'not whether a credential is actually accepted by its provider.\n',
  );
} else {
  process.stdout.write(
    `check:live-readiness: FAIL — ${report.missingKeys.length} key(s) would fail boot\n\n`,
  );
  for (const key of report.missingKeys) process.stdout.write(`  ${key}\n`);
  process.stdout.write(
    '\nSetting PROVIDER_MODE=live in Vercel with these unset does not degrade the deployment — ' +
      'env.ts throws at module load, so every server route fails. Set them first.\n',
  );
  process.exitCode = 1;
}
