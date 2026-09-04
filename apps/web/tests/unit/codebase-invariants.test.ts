import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Two of F01's DoD items are negatives — "no X appears anywhere in the codebase". A negative
 * verified once by hand is a negative that stops being true on the next PR, so both are
 * asserted here instead.
 *
 * Scope is *application code*: `apps/web` and `services/`. It is deliberately not the docs.
 * F01 §4.2 lists the four D-11 keys rather than deleting them, precisely so a reader arriving
 * from 00-ADVERSARIAL-REVIEW.md F-04 can see that the mitigation expired rather than that it
 * was forgotten — and the ADRs do the same. Naming a dead key in a decision record is the
 * opposite of shipping it.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const SCANNED_DIRS = [
  path.join(WEB_ROOT, 'src'),
  path.join(WEB_ROOT, 'app'),
  path.join(WEB_ROOT, 'scripts'),
  path.join(WEB_ROOT, 'eslint-rules'),
  path.join(WEB_ROOT, 'tests'),
  path.join(REPO_ROOT, 'services'),
];

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.py', '.json', '.sh', '.sql'];

/** This file necessarily contains every banned string, so it excludes itself. */
const SELF = fileURLToPath(import.meta.url);

async function sourceFiles(): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (full === SELF) continue;
      if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) found.push(full);
    }
  }

  await Promise.all(SCANNED_DIRS.map(walk));
  return found;
}

async function offenders(pattern: RegExp): Promise<string[]> {
  const files = await sourceFiles();
  const hits: string[] = [];

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    if (pattern.test(content)) hits.push(path.relative(REPO_ROOT, file));
    pattern.lastIndex = 0;
  }

  return hits;
}

describe('F01 DoD — the negatives', () => {
  it('finds source files to scan at all', () => {
    // Without this, every assertion below passes vacuously the day the walker breaks.
    return expect(sourceFiles()).resolves.not.toHaveLength(0);
  });

  it.each([
    'SIGNUP_MODE',
    'ACCOUNT_DAILY_RESEARCH_LIMIT',
    'ACCOUNT_MONTHLY_COST_LIMIT_USD',
    'OTP_DAILY_GLOBAL_LIMIT',
  ])('D-11: %s appears nowhere in application code', async (key) => {
    // These four are void: open signup and the `pending` tier are cut, per-account budgets are
    // cut, and the OTP throttle machinery is cut. The global ceiling is the only budget control.
    await expect(offenders(new RegExp(`\\b${key}\\b`))).resolves.toEqual([]);
  });

  it('F-21: no HF_ variable appears in application code', async () => {
    // All seven were removed with the shadow-evaluation track. D-13 reintroduced pinned models
    // in the scorer service, but they are pinned in the image by commit SHA, not configured by
    // environment — which is the whole difference between D-13 and what F-21 cut.
    await expect(offenders(/\bHF_[A-Z][A-Z0-9_]*\b/)).resolves.toEqual([]);
  });

  it('F-21: no FEATURE_HF_SHADOW flag survives either', async () => {
    // R-19 cut shadow evaluation entirely, so the flag governs nothing. A flag governing
    // nothing is a flag someone eventually switches on.
    await expect(offenders(/\bFEATURE_HF_SHADOW\b/)).resolves.toEqual([]);
  });

  it('D-12: no Linkup key survives the source stack replacement', async () => {
    await expect(offenders(/\bLINKUP_API_KEY\b/)).resolves.toEqual([]);
  });
});
