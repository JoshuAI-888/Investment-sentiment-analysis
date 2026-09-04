import pg from 'pg';

/**
 * Runs once, before the whole e2e suite. Truncates `attention_snapshot` — nowhere near
 * `repositories/attention.ts` (which exposes no delete/reset function, correctly: D-16's
 * forward-only collection gives the application layer no legitimate reason to ever remove a real
 * observation) — as e2e-only test infrastructure, the exact same use of `TRUNCATE` that
 * `tests/integration/helpers/db.ts#truncateAll` already makes for the identical reason (append-
 * only triggers reject `DELETE` but not `TRUNCATE`, and `attention_snapshot` has no such trigger
 * at all, so this is not even weakening one).
 *
 * **Why this needs to exist — lane-review round 3 finding 2.** `services/attention/testing.ts`'s
 * `seedAttentionUnavailable` can only ever delete Redis keys: the same "no SQL outside
 * repositories" constraint and the absence of any delete-capable repository function apply to it
 * as to every other service module. That was sufficient before round 2, when Redis's own
 * `lastCollectedAt` key alone decided "unavailable". It stopped being sufficient the moment round
 * 2 made `assembleAttentionLeaderboard` decide that state from Postgres instead — a Redis-only
 * seed cannot make "Postgres has no `attention_snapshot` row for any active security" true on its
 * own. `attention.spec.ts` is the only spec file in this suite that ever writes an
 * `attention_snapshot` row (confirmed by grep at review time), so truncating it once here, before
 * anything runs, plus that file's own file-wide serial execution order (cold start is declared,
 * and therefore runs, before either seeded state), together make the cold-start test's "Postgres
 * has never collected anything" premise genuinely true — not true by accident of which worker
 * happened to pick it up first, or of what a previous, unrelated `vitest run tests/integration`
 * invocation against the same shared database happened to leave behind.
 *
 * **Gated on an explicit opt-in, not merely on `E2E_BASE_URL` being unset — lane-review round 4
 * finding 2.** `pnpm test:e2e` with no `E2E_BASE_URL` is the *normal local development flow*
 * (Playwright starts its own server against whatever `DATABASE_URL` the developer's shell
 * happens to have) — it is not evidence the database is disposable. Under D-16 collection is
 * forward-only with no backfill, so silently truncating a database that happens to hold real
 * accrued history is exactly the failure `CLAUDE.md` ranks above every feature on the board. This
 * runs only when `E2E_ALLOW_ATTENTION_TRUNCATE=1` is set explicitly (CI's e2e step sets it,
 * `.github/workflows/ci.yml`, since `app_test` there is always a disposable, freshly migrated
 * database) — never inferred from `DATABASE_URL`'s mere presence.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') return;
  if (process.env['E2E_ALLOW_ATTENTION_TRUNCATE'] !== '1') return;

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query<{ present: boolean }>(
      "select to_regclass('public.attention_snapshot') is not null as present",
    );
    if (rows[0]?.present === true) {
      await pool.query('truncate table attention_snapshot restart identity cascade');
    }
  } finally {
    await pool.end();
  }
}
