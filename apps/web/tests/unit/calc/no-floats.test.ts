import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const WEB_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

async function filesUnder(relative: string): Promise<string[]> {
  const root = path.join(WEB_ROOT, relative);
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(full);
    }
  }

  await walk(root);
  return found;
}

/**
 * F05 DoD item 1: *"No JS `number` is used for arithmetic in `calc/` or `analytics/`; the lint
 * rule proves it."*
 *
 * The rule's own behaviour is tested by F01's rule-tester suite. What is *not* covered there is
 * whether the rule is actually armed over these two directories — a rule that is correct and
 * unwired proves nothing, and that is exactly the state `no-unbounded-pit-read` was in until F22
 * armed it. So this plants a violation in `calc/`, runs the real ESLint configuration over it,
 * and requires a report.
 */
const PROBE = path.join(WEB_ROOT, 'src/calc/__float_probe__.ts');

describe('F05 §4.1 — the no-float rule is armed over calc/ and analytics/', () => {
  afterAll(async () => {
    await rm(PROBE, { force: true });
  });

  // CAN FAIL — remove the rule from eslint.config.ts and this stops reporting.
  it('reports arithmetic on a numeric literal placed in calc/', async () => {
    await writeFile(
      PROBE,
      'export const drift = (x: number): number => x * 1.05;\n' +
        'export const coerced = (s: string): number => Number(s) + parseFloat(s);\n',
      'utf8',
    );

    const eslint = new ESLint({ cwd: WEB_ROOT });
    const [result] = await eslint.lintFiles([PROBE]);
    const rules = (result?.messages ?? []).map((message) => message.ruleId);

    expect(rules).toContain('architecture/no-float-in-analytics');
    // Both shapes the rule exists to catch: literal arithmetic, and the two coercions.
    expect(rules.filter((rule) => rule === 'architecture/no-float-in-analytics').length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('finds no float coercion anywhere in the shipped calc/ or analytics/ source', async () => {
    // A second, cheaper net that does not depend on ESLint resolving at all. The rule is the
    // gate; this is the assertion that the gate has nothing queued behind it today.
    const files = [...(await filesUnder('src/calc')), ...(await filesUnder('src/analytics'))].filter(
      (file) => file !== PROBE,
    );
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(/\bNumber\s*\(/);
      expect(source, file).not.toMatch(/\bparseFloat\s*\(/);
      expect(source, file).not.toMatch(/\bparseInt\s*\(/);
    }
  });
});
