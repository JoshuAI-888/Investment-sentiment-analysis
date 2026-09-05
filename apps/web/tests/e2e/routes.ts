/**
 * Every route in source §6.2, with the parameters the shells are exercised against.
 *
 * This list is the executable form of F01 §4.6 — "every route in source §6.2 exists and
 * renders a fixture state". A route added to the app and not to this list is a route the
 * gate never opens.
 */
export type PageRoute = { readonly path: string; readonly source: string };

/**
 * F02 removed thirteen entries this list used to carry unconditionally: `/settings/account` and
 * every `/admin/*` page. Each now calls `requireUser()`/`requireAdmin()` in its own body and
 * `redirect('/sign-in')`s an unauthenticated visitor (F02 §4.4) — so an unauthenticated
 * `page.goto` against any of them lands on `/sign-in`, which also renders `[data-state="fixture"]`
 * and returns 200. This file's generic loop would keep passing while proving nothing about the
 * page it claims to test — exactly the "one bad row poisons its neighbours" shape of bug, here
 * a redirect quietly answering for thirteen different routes. Found by lane-review.
 *
 * Real, non-vacuous coverage for all thirteen now lives in `tests/e2e/auth.spec.ts`:
 * `/settings/account` in "F02 — account deletion" (a signed-in session interacts with its real
 * content), and every `/admin/*` page and API route in "F02 — a real admin session reaches every
 * gated route" (a signed-in, *allowlisted* session reaches the real `RouteShell`, not the
 * sign-in redirect or the `AdminDenied` refusal `auth.spec.ts`'s other suite already proves).
 *
 * **`/dashboard` is deliberately not in this list at all — F07 review finding 3.** An earlier
 * version of this feature added it here as a fourteenth `GATED_PAGE_ROUTES` entry, but this
 * list's *only* consumer (`auth.spec.ts`'s `ADMIN_PAGES = GATED_PAGE_ROUTES.filter(path =>
 * path.startsWith('/admin'))`) filters it straight back out — `/dashboard` is a `requireUser()`
 * "member+" surface (F07 §4.6), not an admin-only one, so it never matched that filter and the
 * entry added zero real coverage. `/dashboard` gets its own, dedicated, unconditional case
 * instead: `auth.spec.ts`'s "F02 — sign-up and sign-in" describe
 * block's "sign-up, verify, and sign in with a password all reach the dashboard" test, which
 * also asserts the real page content rendered (`data-route`), the
 * same way the admin-positive suite asserts real content for `/admin/*`. Unlike
 * `tests/e2e/dashboard.spec.ts`'s five-states suite, that test needs no `DATABASE_URL` — a
 * cold-start dashboard reads Redis only, never Postgres (`assemble.ts`) — so it is not part of
 * the CI gap that file's own top-of-file comment documents.
 *
 * **`/social/reddit` removed the same way, F08.** It replaced F01's fixture shell with a real
 * `requireUser()`-gated leaderboard (`app/(app)/social/reddit/page.tsx`), so this list's generic
 * `[data-state="fixture"]` assertion no longer holds for it. Real coverage lives in
 * `tests/e2e/attention.spec.ts`: an unauthenticated visitor redirected to sign-in, and a
 * cold-start ("unavailable") render — which, unlike `/dashboard`'s, DOES need `DATABASE_URL`.
 * `assembleAttentionLeaderboard` has queried Postgres unconditionally since round 2 lane-review
 * made "unavailable" a fact about the database (`services/attention/leaderboard.ts`), not about
 * a Redis bookkeeping key; an earlier version of this comment claimed otherwise, before that fix.
 *
 * **F09 removes `/ticker/NVDA/social`, for the same reason F07 removed `/dashboard`.** It is now
 * a real, `requireUser()`-gated page (`app/(app)/ticker/[symbol]/social/page.tsx`) that no longer
 * renders `data-state="fixture"` — this file's generic unauthenticated-fixture loop would either
 * fail (real content) or pass vacuously (a sign-in redirect, which also renders
 * `data-state="fixture"` on `/sign-in` itself). Real, non-vacuous coverage lives in
 * `tests/e2e/ticker.spec.ts`, mirroring `dashboard.spec.ts`'s pattern: an unauthenticated-redirect
 * case with no `DATABASE_URL` dependency, plus a signed-in suite gated on `DATABASE_URL` the same
 * way `dashboard.spec.ts`'s state suite is.
 */
export const PAGE_ROUTES: readonly PageRoute[] = [
  { path: '/sign-in', source: '(auth)/sign-in' },
  { path: '/sign-up', source: '(auth)/sign-up' },
  { path: '/forgot-password', source: '(auth)/forgot-password' },
  { path: '/reset-password', source: '(auth)/reset-password' },
  { path: '/privacy', source: '(legal)/privacy' },
  { path: '/terms', source: '(legal)/terms' },
  { path: '/settings/calculations', source: '(app)/settings/calculations' },
  { path: '/architecture', source: '(app)/architecture' },
  { path: '/architecture/calculations', source: '(app)/architecture/calculations' },
  { path: '/calculations/calc_fixture', source: '(app)/calculations/[calculationId]' },
];

/**
 * The thirteen routes named above, kept as their own list rather than dropped: `auth.spec.ts`
 * still needs the full set for its two *authenticated* suites (a non-admin session refused, an
 * admin session let through) — only the blind, unauthenticated smoke test in `routes.spec.ts`
 * is the wrong tool for a route that redirects before rendering.
 */
export const GATED_PAGE_ROUTES: readonly PageRoute[] = [
  { path: '/settings/account', source: '(app)/settings/account' },
  { path: '/admin', source: '(admin)/admin' },
  { path: '/admin/data-sources', source: '(admin)/admin/data-sources' },
  { path: '/admin/jobs', source: '(admin)/admin/jobs' },
  { path: '/admin/models', source: '(admin)/admin/models' },
  { path: '/admin/data-explorer', source: '(admin)/admin/data-explorer' },
  { path: '/admin/costs', source: '(admin)/admin/costs' },
  { path: '/admin/settings', source: '(admin)/admin/settings' },
  { path: '/admin/settings/universe', source: '(admin)/admin/settings/universe' },
  { path: '/admin/audit', source: '(admin)/admin/audit' },
  { path: '/admin/calculations', source: '(admin)/admin/calculations' },
  { path: '/admin/user-assumptions', source: '(admin)/admin/user-assumptions' },
  { path: '/admin/calculation-issues', source: '(admin)/admin/calculation-issues' },
];

export type ApiRoute = { readonly path: string; readonly method: 'GET' | 'POST'; readonly source: string };

/**
 * F02 removed five entries this list used to carry: `/api/admin/status`,
 * `/api/admin/jobs/job_fixture/runs`, `/api/admin/data`, `/api/admin/costs`,
 * `/api/admin/universe`, and `/api/auth/session`. Each of those routes now genuinely enforces
 * `requireAdmin()` in its own body (F02 §4.4) or is Better Auth's real router (`api/auth/
 * [...all]`) rather than a bare fixture shell, so an unauthenticated `GET` against any of them
 * correctly returns something other than `{ state: 'fixture' }` — the behaviour this file's
 * generic loop exists to prove is now the wrong assertion for these six. Their real behaviour
 * (401 unauthenticated, and the Wave 1 exit gate's "every operator route refuses a
 * non-allowlisted address") is covered in `tests/e2e/auth.spec.ts` instead.
 *
 * **F07 removes a seventh: `POST /api/dashboard/refresh`.** It now genuinely enforces
 * `requireUser()`, a rate limit, an idempotency lock and the global budget check — real
 * behaviour a `{ state: 'fixture' }` assertion would no longer be testing. Real coverage for it
 * lives in `tests/e2e/dashboard.spec.ts`, which does not currently run in CI (see that file's
 * top-of-file comment — F07 review finding 3). `GET /api/dashboard` (new in F07, not a former
 * fixture route) has its own, unconditional coverage instead — the "GET /api/dashboard requires
 * a session, then answers a signed-in one" case in `auth.spec.ts`'s "F02 — sign-up and sign-in"
 * describe block, added for the same reason `/dashboard` itself is not in `GATED_PAGE_ROUTES` above: it
 * needs no `DATABASE_URL` and is not gated behind the CI gap this comment names.
 *
 * **F09 removes two more: `GET /api/search` and `GET /api/ticker/NVDA/snapshot`.** Both now
 * genuinely enforce `requireUser()` and answer real, computed bodies rather than
 * `{ state: 'fixture' }`. Round-2 lane-review finding 6: this originally pointed at
 * `tests/e2e/ticker.spec.ts`, which asserts only the *page's* redirect, never either route's own
 * `401` — the dedicated unauthenticated-`401` coverage for both actually lives in
 * `tests/e2e/auth.spec.ts`'s "F02 — sign-in" describe block, mirroring `GET /api/dashboard`'s
 * precedent immediately above.
 *
 * **F11 removes the three research routes.** `POST /api/research`, `GET /api/research/[runId]`
 * and `GET /api/research/[runId]/stream` all now genuinely enforce `requireUser()` (each checks
 * it before doing anything else — a run lookup only happens after auth succeeds) and the two
 * `GET` routes additionally enforce a per-run ownership check (404, not just 401, on a run that
 * exists but is not the caller's own — lane-review finding 1). None answers `{ state: 'fixture'
 * }` any more, so this file's generic loop is the wrong tool for them, same reasoning as every
 * entry above. Dedicated unauthenticated-`401` coverage for all three lives in
 * `tests/e2e/auth.spec.ts`'s "F02 — sign-in" describe block, mirroring the two precedents
 * immediately above — this needs no `DATABASE_URL` since the auth check runs before any repository
 * read.
 */
export const API_ROUTES: readonly ApiRoute[] = [
  { path: '/api/cron/dispatch', method: 'POST', source: 'api/cron/dispatch' },
  { path: '/api/health/providers', method: 'GET', source: 'api/health/providers' },
  { path: '/api/architecture', method: 'GET', source: 'api/architecture' },
  {
    path: '/api/calculations/calc_fixture/inputs/input_fixture/raw',
    method: 'GET',
    source: 'api/calculations/[calculationId]/inputs/[inputKey]/raw',
  },
  { path: '/api/calculations/calc_fixture/export', method: 'GET', source: 'api/calculations/[calculationId]/export' },
];
