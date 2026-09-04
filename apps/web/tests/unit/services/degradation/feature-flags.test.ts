import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { env, envSchema } from '../../../../src/env';

/**
 * F18 §4.4 DoD: "X, Stocktwits and Congress are hidden by default, not greyed." X has a real UI
 * surface this feature gates (`services/ticker/snapshot.ts`'s `env.FEATURE_X` check, covered by
 * `tests/integration/ticker-snapshot-feature-flag.test.ts`). Stocktwits and Congress have no UI
 * surface anywhere in this codebase (verified below) — nothing to gate is the correct state, per
 * `CLAUDE.md`'s "never scrape X or Stocktwits" and D-23's account-taxonomy deferral — but a
 * negative verified once by hand is a negative that stops being true on the next PR
 * (`tests/unit/codebase-invariants.test.ts`'s own stated reason for existing), so it is asserted
 * here instead of merely observed during this feature's build.
 */
const WEB_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const UI_SURFACES = [path.join(WEB_ROOT, 'app'), path.join(WEB_ROOT, 'src/ui')];
const EXTENSIONS = ['.ts', '.tsx'];

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(full)));
    } else if (EXTENSIONS.includes(path.extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
}

describe('F18 §4.4 — Stocktwits and Congress have no UI surface to gate', () => {
  it('no app/ or src/ui/ file mentions Stocktwits as a rendered surface', async () => {
    const files = await walk(UI_SURFACES[0] as string);
    files.push(...(await walk(UI_SURFACES[1] as string)));

    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (/stocktwits/i.test(content)) offenders.push(file);
    }
    expect(offenders, `Stocktwits appeared in a UI file — it needs a FEATURE_STOCKTWITS gate now: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no app/ or src/ui/ file mentions Congress/congressional trades as a rendered surface', async () => {
    const files = await walk(UI_SURFACES[0] as string);
    files.push(...(await walk(UI_SURFACES[1] as string)));

    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      if (/congress/i.test(content)) offenders.push(file);
    }
    expect(offenders, `Congress appeared in a UI file — it needs a FEATURE_CONGRESS gate now: ${offenders.join(', ')}`).toEqual([]);
  });

  it('all three flags default to false — hidden, not merely off-by-configuration', () => {
    expect(env.FEATURE_X).toBe(false);
    expect(env.FEATURE_STOCKTWITS).toBe(false);
    expect(env.FEATURE_CONGRESS).toBe(false);
    // Confirm the schema's own default, not just this process's already-loaded value — a
    // reader six months from now with a polluted shell environment should still see the
    // *declared* default is false.
    const parsed = envSchema.safeParse({ PROVIDER_MODE: 'fixture' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.FEATURE_X).toBe(false);
      expect(parsed.data.FEATURE_STOCKTWITS).toBe(false);
      expect(parsed.data.FEATURE_CONGRESS).toBe(false);
    }
  });
});
