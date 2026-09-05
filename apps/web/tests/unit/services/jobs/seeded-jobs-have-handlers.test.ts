/**
 * Every **enabled** seeded job must have a registered handler.
 *
 * This is the invariant `job-definitions-v1.json`'s own `notes` field has been carrying in prose
 * since F16a: a job seeded enabled with no handler is not a quiet no-op — the dispatcher claims
 * it every tick and fails it with `no_handler_registered`, hourly, loudly, and misleadingly. It
 * was avoided by hand until now (`substack.collect` shipped disabled precisely for this reason,
 * and was enabled in the same change that registered its handler). This asserts it instead.
 *
 * The reverse is deliberately *not* asserted: a handler with no seeded row, or a row seeded
 * disabled, is a legitimate intermediate state — that is exactly how a collector lands before it
 * is switched on.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerAllJobHandlers } from '@/services/jobs/handlers';
import { getJobHandler } from '@/services/jobs/registry';

type SeedRow = { jobKey: string; enabled: boolean };

describe('seeded job definitions', () => {
  it('every enabled row has a registered handler', async () => {
    registerAllJobHandlers();

    const raw = await readFile(
      join(process.cwd(), 'migrations/seed/job-definitions-v1.json'),
      'utf-8',
    );
    const parsed: unknown = JSON.parse(raw);
    const rows: SeedRow[] = Array.isArray(parsed)
      ? (parsed as SeedRow[])
      : ((parsed as { jobs: SeedRow[] }).jobs ?? []);

    expect(rows.length).toBeGreaterThan(0);

    const enabledWithoutHandler = rows
      .filter((row) => row.enabled)
      .map((row) => row.jobKey)
      .filter((jobKey) => getJobHandler(jobKey) === undefined);

    expect(enabledWithoutHandler).toEqual([]);
  });

  it('substack.collect is enabled and handled — D-16 clock started', async () => {
    registerAllJobHandlers();
    const raw = await readFile(
      join(process.cwd(), 'migrations/seed/job-definitions-v1.json'),
      'utf-8',
    );
    const parsed: unknown = JSON.parse(raw);
    const rows: SeedRow[] = Array.isArray(parsed)
      ? (parsed as SeedRow[])
      : ((parsed as { jobs: SeedRow[] }).jobs ?? []);

    const substack = rows.find((row) => row.jobKey === 'substack.collect');
    expect(substack?.enabled).toBe(true);
    expect(getJobHandler('substack.collect')).toBeDefined();
  });
});
