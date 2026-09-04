import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ADR-013 / F16 §4.2, §4.5, §6, §7 review steps 5 and (in spirit) 8: "the admin can never
 * rewrite the QStash schedule or `vercel.json`," and the heartbeat "must not be able to run
 * jobs." Both are structural claims made in prose across this feature's module docs
 * (`app/api/cron/heartbeat/route.ts`, `services/jobs/heartbeat.ts`) — this file is the executable
 * version of §7 review step 5's "search for any code path that could write a QStash schedule",
 * automated rather than left as a one-time manual grep.
 *
 * **Extended by F16b (SURFACE, Wave 4)** to cover the admin edit/dry-run/preview surface this
 * feature adds — §4.2's own text: "editable: due times, cadence, enabled state, retry policy,
 * per-job budget ceiling. Not editable from any UI: the QStash schedule itself, `vercel.json`, or
 * the dispatch secret." The admin surface is a *second* place this claim could quietly stop being
 * true, so it gets the same automated check F16a's own files already have, not a one-time review
 * comment.
 */
const WEB_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

async function readSource(relativePath: string): Promise<string> {
  return readFile(path.join(WEB_ROOT, relativePath), 'utf-8');
}

describe('ADR-013 — nothing in this feature can write the QStash schedule or vercel.json', () => {
  const CANDIDATE_FILES = [
    'src/services/jobs/dispatch.ts',
    'src/services/jobs/job-service.ts',
    'src/services/jobs/qstash.ts',
    'src/services/jobs/heartbeat.ts',
    'app/api/cron/dispatch/route.ts',
    'app/api/cron/heartbeat/route.ts',
    // F16b (Wave 4) additions.
    'src/services/admin/jobs.ts',
    'src/services/admin/job-dry-run.ts',
    'src/services/admin/job-schedule-preview.ts',
    'src/ui/admin/JobsTable.tsx',
    'app/api/admin/jobs/route.ts',
    'app/api/admin/jobs/update/route.ts',
    'app/api/admin/jobs/[jobId]/preview/route.ts',
    'app/api/admin/jobs/[jobId]/dry-run/route.ts',
    'app/api/admin/jobs/[jobId]/runs/route.ts',
    'app/(admin)/admin/jobs/page.tsx',
  ];

  it.each(CANDIDATE_FILES)('%s never calls a QStash schedule-management endpoint or writes any file', async (file) => {
    const source = await readSource(file);
    // The QStash SDK's own schedule-management surface (`client.schedules.create/.delete/.pause`)
    // and any raw file write at all — the one file ADR-013 reserves for the human deploying this
    // app (`vercel.json`) is a build-time artifact no route handler has a legitimate reason to
    // touch, so "writes no file" is the stronger, false-positive-free property to check: a plain
    // `/vercel\.json/` string match would also flag this route's own doc comment, which mentions
    // the filename by name without ever writing it.
    expect(source).not.toMatch(/\.schedules\.(create|delete|pause|resume)\s*\(/);
    expect(source).not.toMatch(/writeFile(Sync)?\s*\(/);
  });
});

describe('F16 §4.5 — the heartbeat cannot execute a job', () => {
  it('the route imports nothing from the dispatch or job-execution modules', async () => {
    const source = await readSource('app/api/cron/heartbeat/route.ts');
    expect(source).not.toMatch(/from ['"].*\/(dispatch|job-service)['"]/);
    expect(source).not.toMatch(/\brunDispatchTick\b|\bexecuteJob\b/);
  });

  it('services/jobs/heartbeat.ts imports nothing from the dispatch or job-execution modules', async () => {
    const source = await readSource('src/services/jobs/heartbeat.ts');
    expect(source).not.toMatch(/from ['"].*\/(dispatch|job-service)['"]/);
    expect(source).not.toMatch(/\brunDispatchTick\b|\bexecuteJob\b|\bclaimJobRun\b|\bstartJobRun\b/);
  });
});
