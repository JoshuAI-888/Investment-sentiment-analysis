import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every source file on disk must be tracked by git.
 *
 * This exists because of a real failure. `.gitignore` carried an unanchored `data/`, intended
 * for a data directory at the repository root. Git patterns without a leading slash match at
 * **any** depth, so it also matched `apps/web/app/api/admin/data/` — and
 * `app/api/admin/data/route.ts` was never committed. It existed on disk, so every local run
 * passed; CI checked out a tree without it and the route returned 404.
 *
 * That is the worst shape a bug can have: invisible locally, and the local run is where you
 * look. The class is "a source file that exists for me and not for anybody else", and this
 * catches all of it rather than that one route.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const GOVERNED = [
  'apps/web/app',
  'apps/web/src',
  'apps/web/scripts',
  'apps/web/eslint-rules',
  'apps/web/migrations',
  'apps/web/tests',
  'services',
];

const SOURCE = /\.(ts|tsx|js|mjs|py|sql|json|sh)$/;

/** Build output and caches are ignored on purpose and are not source. */
const BUILD_OUTPUT = /(^|\/)(node_modules|\.next|test-results|playwright-report|__pycache__)\//;

function untrackedButPresent(): string[] {
  // `--others --ignored --exclude-standard` lists files git can see but is not tracking,
  // including the ones it is ignoring — which is exactly the failure mode.
  const output = execFileSync(
    'git',
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...GOVERNED],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );

  return output
    .split('\n')
    .filter((line) => line !== '')
    .filter((line) => !BUILD_OUTPUT.test(line))
    .filter((line) => SOURCE.test(line));
}

describe('every source file is tracked', () => {
  it('finds no source file that git is ignoring', () => {
    const offenders = untrackedButPresent();
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `These files exist on disk but git is ignoring them, so CI will check out a tree without them:\n  ${offenders.join('\n  ')}\n` +
            'Usually a .gitignore pattern with no leading slash matching at an unintended depth.',
    ).toEqual([]);
  });

  it('has the route that found this bug', () => {
    // Pinned by name. The generic assertion above would pass again if this file were deleted
    // rather than un-ignored, and the route is a §6.2 requirement either way.
    const tracked = execFileSync('git', ['ls-files', 'apps/web/app/api/admin/data/route.ts'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(tracked.trim()).toBe('apps/web/app/api/admin/data/route.ts');
  });
});
