/**
 * F16a §6 DoD: "the trigger-eligible job set is a seeded column" — and there are currently zero
 * `job_definition` rows, so the dispatcher would claim an empty set without this.
 *
 * **Why a script, not a numbered `migrations/*.sql` file.** Every migration in this repository
 * is pure DDL — checked directly, there is not one `insert` statement across the fourteen
 * numbered files — and the one thing every existing seed in this codebase agrees on
 * (`scripts/seed-universe.ts` over `src/repositories/universe-seed.ts`, and the `ensureConfigVersion`
 * helper duplicated in `services/attention/testing.ts` and `services/ticker/testing.ts`) is that
 * data — as opposed to schema — is seeded by a script run deliberately against a live
 * `DATABASE_URL`, the same way `docs/DEPLOY.md` MT-08 already describes running `pnpm
 * seed:universe`. `job_definition.config_version` is `not null references config_version`, and
 * no migration creates one either — every existing "ensure an active config_version" helper in
 * this codebase is exactly this kind of runtime bootstrap, not a migration; this script follows
 * the identical pattern rather than inventing a fifth version of it.
 *
 * **Raw SQL here is lint-legal, not a workaround.** `eslint-rules/no-sql-outside-repositories.ts`
 * explicitly allows `repositories/`, `migrations/`, `tests/` *and* `scripts/` — the insert below
 * is not reachable from `services/`, `app/` or `ui/`, so `no-unbounded-pit-read` (which only
 * inspects `repositories/`) has nothing here to miss. `repositories/jobs.ts` has no
 * `insertJobDefinition` function — only reads and `advanceJobDefinitionSchedule` update an
 * *existing* row — so there is no repository call this script could make instead; reported under
 * this feature's `CONTRACTS` in case SPINE would rather this insert lived behind a real
 * repository function.
 *
 * **Idempotent per `job_key`, not all-or-nothing like `seedUniverse`.** Universe membership is a
 * one-time, frozen methodological commitment (D-27) — either the whole set exists or none of it
 * does. Job definitions are not: `substack.collect` is seeded disabled today because no handler
 * exists for it yet, and the very next feature to land registers one and (per this row's own
 * `notes`) flips it on — this script must still be safely re-runnable at that point without
 * touching the three rows that already exist and may have already drifted from this file's
 * values via the ordinary dispatcher (`next_due_at` advances every tick) or, eventually, F16b's
 * admin UI. `on conflict (job_key) do nothing` is exactly that: add what is missing, never
 * overwrite what is already there.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool } from '../src/repositories/client';
import { findJobDefinitionByKey } from '../src/repositories/jobs';
import { activateConfigVersion, findActiveConfigVersion, insertConfigVersion } from '../src/repositories/versions';

const CONFIG_ENVIRONMENT = 'production';

type SeedJob = {
  readonly jobKey: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly scheduleType: 'interval' | 'cron';
  readonly scheduleExpression: string;
  readonly displayTimezone: string;
  readonly priority: number;
  readonly maxRuntimeSeconds: number;
  readonly concurrencyPolicy: 'skip' | 'queue' | 'cancel_running';
  readonly maxAttempts: number;
  readonly triggerEligible: boolean;
  /** True for a job that must never be claimed by the ordinary clock scan (`x.sampling_window`) —
   *  seeded with a `next_due_at` far enough in the future that `dueJobDefinitions` never selects
   *  it on its own; it is dispatchable only through the D-15 trigger path. */
  readonly farFutureNextDueAt?: boolean;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, '..', 'migrations', 'seed', 'job-definitions-v1.json');

/** Comfortably beyond any horizon this system's own retention or forecasting logic reasons
 *  about — a sentinel, not a real prediction of when this job might run on the clock. */
const FAR_FUTURE_DUE_AT = new Date('9999-12-31T00:00:00.000Z');

async function ensureConfigVersion(): Promise<string> {
  const existing = await findActiveConfigVersion(CONFIG_ENVIRONMENT);
  if (existing !== null) return existing.id;

  const draft = await insertConfigVersion({
    environment: CONFIG_ENVIRONMENT,
    createdBy: 'seed-job-definitions',
    changeReason: 'F16a: bootstrap an active config_version so the Wave 1 job_definition seed has one to reference',
    checksum: 'seed-job-definitions-v1',
  });
  const activated = await activateConfigVersion(CONFIG_ENVIRONMENT, draft.id, {
    actorId: 'seed-job-definitions',
    actorRole: 'system',
    reason: 'F16a job_definition seed bootstrap',
    requestId: 'seed-job-definitions',
    correlationId: 'seed-job-definitions',
  });
  return activated.id;
}

async function run(): Promise<void> {
  const raw = await readFile(SEED_PATH, 'utf8');
  const { jobs } = JSON.parse(raw) as { readonly jobs: readonly SeedJob[] };

  const pool = getPool();
  const configVersionId = await ensureConfigVersion();
  const now = new Date();

  let inserted = 0;
  let alreadyPresent = 0;

  for (const job of jobs) {
    const existing = await findJobDefinitionByKey(job.jobKey, pool);
    if (existing !== null) {
      alreadyPresent += 1;
      continue;
    }

    const nextDueAt = job.farFutureNextDueAt === true ? FAR_FUTURE_DUE_AT : now;

    await pool.query(
      `insert into job_definition
         (job_key, display_name, enabled, schedule_type, schedule_expression, display_timezone,
          priority, max_runtime_seconds, concurrency_policy, max_attempts, trigger_eligible,
          next_due_at, config_version, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (job_key) do nothing`,
      [
        job.jobKey,
        job.displayName,
        job.enabled,
        job.scheduleType,
        job.scheduleExpression,
        job.displayTimezone,
        job.priority,
        job.maxRuntimeSeconds,
        job.concurrencyPolicy,
        job.maxAttempts,
        job.triggerEligible,
        nextDueAt,
        configVersionId,
        'seed-job-definitions',
      ],
    );
    inserted += 1;
  }

  process.stdout.write(`seeded ${String(inserted)} job_definition row(s); ${String(alreadyPresent)} already present\n`);
}

try {
  await run();
} finally {
  await closePool();
}
