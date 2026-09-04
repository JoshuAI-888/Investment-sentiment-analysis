import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { GATED_PAGE_ROUTES } from './routes';

const ADMIN_PAGES = GATED_PAGE_ROUTES.filter((route) => route.path.startsWith('/admin'));
const ADMIN_API_ROUTES = [
  { path: '/api/admin/status', method: 'GET' as const },
  { path: '/api/admin/jobs/job_fixture/runs', method: 'GET' as const },
  { path: '/api/admin/data', method: 'GET' as const },
  { path: '/api/admin/costs', method: 'GET' as const },
  { path: '/api/admin/universe', method: 'GET' as const },
];

/**
 * `expect(page.getByLabel('Enter the six-digit code')).toBeVisible()` proves the *UI* has
 * moved past the request step, but Next.js's server-action response can settle a beat before
 * `rememberFixtureOtp` (`src/services/auth/fixture-otp-store.ts`) has actually run in the
 * server process this `request` context talks to over its own connection — an ordering gap of
 * single-digit milliseconds, never observable outside a test that reads the value back over a
 * second connection the instant the first one settles. It is not observable in `live` mode at
 * all: there, the value travels by email, which takes low-single-digit seconds to arrive, so no
 * real client could ever race it. `expect.poll` absorbs exactly that gap without weakening what
 * is asserted — a code must still exist, and the assertion still fails hard if it never appears.
 */
/**
 * `exclude` matters whenever the same email requests a second code in one test (rotate-on-
 * resend, or sign back in after deleting the account): the store still holds the *previous*
 * OTP until the new `sendVerificationOTP` call overwrites it, so "non-null" alone would happily
 * hand back a stale, already-used code and the eventual `Verify` click would fail silently,
 * waiting forever for a redirect that this now-invalid code will never earn.
 */
async function readFixtureOtp(
  request: APIRequestContext,
  email: string,
  exclude?: string,
): Promise<string> {
  const deadline = Date.now() + 2000;
  let lastOtp: string | null = null;

  while (Date.now() < deadline) {
    const response = await request.get(`/api/auth/fixture-otp?email=${encodeURIComponent(email)}`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { otp: string | null };
    lastOtp = body.otp;
    if (lastOtp !== null && lastOtp !== exclude) return lastOtp;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  expect(lastOtp, `no fresh OTP was ever recorded for ${email} within 2s`).not.toBeNull();
  expect(lastOtp, `the OTP for ${email} never rotated past the previous, already-used one`).not.toBe(exclude);
  return lastOtp as string;
}

test.describe('F02 — sign-in', () => {
  test('full sign-in reaches the dashboard', async ({ page, request }) => {
    const email = `e2e-full-sign-in-${Date.now()}@example.com`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByLabel('Enter the six-digit code')).toBeVisible();

    const otp = await readFixtureOtp(request, email);
    await page.getByLabel('Enter the six-digit code').fill(otp);
    await page.getByRole('button', { name: 'Verify' }).click();

    await page.waitForURL('**/dashboard');
    expect(new URL(page.url()).pathname).toBe('/dashboard');
    // F07 review finding 3: `/dashboard` is deliberately not in `GATED_PAGE_ROUTES`
    // (`routes.ts`'s own comment explains why — it is a `requireUser()` surface, not an
    // admin-only one, so the admin-positive suite below is the wrong home for it). This is its
    // real, dedicated coverage instead — asserting the actual page rendered, not merely that
    // the URL changed, the same way the admin-positive suite asserts real content for
    // `/admin/*` rather than just a redirect having not happened.
    await expect(page.locator('[data-route="/dashboard"]')).toBeVisible();
  });

  test('GET /api/dashboard requires a session, then answers a signed-in one', async ({ page, request }) => {
    // F07 review finding 3(b): `GET /api/dashboard` had no coverage in any configuration —
    // `routes.spec.ts`'s generic fixture-state loop excludes it (F07 removed it from
    // `API_ROUTES`, `routes.ts`'s own comment explains why) and `dashboard.spec.ts`'s suite does
    // not run in CI (that file's top-of-file comment). This case needs no `DATABASE_URL` — a
    // cold-start dashboard read touches only Redis (`assemble.ts`) — so it runs unconditionally.
    const unauthenticated = await request.get('/api/dashboard');
    expect(unauthenticated.status()).toBe(401);

    const email = `e2e-api-dashboard-${Date.now()}@example.com`;
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();
    const otp = await readFixtureOtp(request, email);
    await page.getByLabel('Enter the six-digit code').fill(otp);
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForURL('**/dashboard');

    const response = await page.request.get('/api/dashboard');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { state?: string };
    expect(typeof body.state).toBe('string');
  });

  /**
   * Round-1 lane-review finding 5. `/api/search` and `/api/ticker/[symbol]/snapshot` gained a
   * `requireUser()` check in F09's build, but were removed from `routes.spec.ts`'s
   * `API_ROUTES` fixture-state loop with the claim that "real coverage lives in
   * `tests/e2e/ticker.spec.ts`" — which asserts the *page's* redirect, never the API route's own
   * 401. This is the dedicated coverage that claim was missing, mirroring `GET /api/dashboard`'s
   * precedent above.
   */
  test('GET /api/search requires a session', async ({ request }) => {
    const unauthenticated = await request.get('/api/search?q=AAPL');
    expect(unauthenticated.status()).toBe(401);
  });

  test('GET /api/ticker/:symbol/snapshot requires a session', async ({ request }) => {
    const unauthenticated = await request.get('/api/ticker/AAPL/snapshot');
    expect(unauthenticated.status()).toBe(401);
  });

  test('three wrong codes invalidate the code, even the correct one afterwards', async ({ page, request }) => {
    const email = `e2e-three-strikes-${Date.now()}@example.com`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByLabel('Enter the six-digit code')).toBeVisible();

    const otp = await readFixtureOtp(request, email);
    const wrong = otp === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByLabel('Enter the six-digit code').fill(wrong);
      await page.getByRole('button', { name: 'Verify' }).click();
      await expect(page.getByText(/wrong or has expired|Too many wrong codes/)).toBeVisible();
    }

    // The 4th attempt, with the code that was actually correct, must still be refused — the
    // attempt cap invalidated it, not just the three wrong guesses.
    await page.getByLabel('Enter the six-digit code').fill(otp);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText(/wrong or has expired|Too many wrong codes/)).toBeVisible();
    expect(new URL(page.url()).pathname).not.toBe('/dashboard');
  });

  test('the account-enumeration probe: an allowlisted-looking and an arbitrary address get the same response shape', async ({
    request,
  }) => {
    const first = await request.post('/api/auth/email-otp/send-verification-otp', {
      data: { email: 'looks-allowlisted@example.com', type: 'sign-in' },
    });
    const second = await request.post('/api/auth/email-otp/send-verification-otp', {
      data: { email: `arbitrary-${Date.now()}@example.com`, type: 'sign-in' },
    });

    expect(first.status()).toBe(second.status());
    expect(await first.json()).toEqual(await second.json());
  });
});

test.describe('F02 — every operator route refuses a signed-in, non-admin session (Wave 1 exit gate)', () => {
  test.beforeEach(async ({ page, request }) => {
    // `playwright.config.ts` sets `ADMIN_EMAIL_ALLOWLIST` to exactly one fixed address,
    // `e2e-admin@example.com` (see the admin-session suite below), so any address that is not
    // that literal string — every address generated here, by construction — signs in
    // successfully but matches no allowlist entry. That is exactly "a non-allowlisted address",
    // reachable without a live Resend call. Do not switch this to a fixed address: doing so risks
    // colliding with the one allowlisted address below and turning this suite's "refuses a
    // non-admin" into "an admin was refused", passing on the wrong premise (found by a second
    // lane-review pass, after `ADMIN_EMAIL_ALLOWLIST` stopped being unset here).
    //
    // `Date.now()` alone is not unique enough here: this `beforeEach` runs once per test in
    // both loops below (~11 tests), which Playwright can start in the same millisecond across
    // workers. Two tests racing on the identical email means whichever's `sendVerificationOTP`
    // lands second overwrites the fixture store's entry, and the first test's `readFixtureOtp`
    // can read back a code for a request it never made — `Verify` then either fails outright or
    // waits forever for a `/dashboard` redirect that code was never going to earn, exactly the
    // `waitForURL` timeout this suite intermittently hit. The random suffix removes the
    // collision instead of just making it rarer.
    const email = `e2e-non-admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`;
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();
    const otp = await readFixtureOtp(request, email);
    await page.getByLabel('Enter the six-digit code').fill(otp);
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForURL('**/dashboard');
  });

  for (const route of ADMIN_PAGES) {
    test(`page ${route.path} refuses`, async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);
      await expect(page.getByText('Not authorized')).toBeVisible();
    });
  }

  for (const route of ADMIN_API_ROUTES) {
    test(`route handler ${route.method} ${route.path} refuses`, async ({ page }) => {
      // `page.request`, not the bare `request` fixture: it shares `page`'s cookie jar, which is
      // what makes this "a signed-in, non-admin call" rather than merely an unauthenticated one
      // (both return 401 today, but only the former is the property this suite names).
      const response =
        route.method === 'GET' ? await page.request.get(route.path) : await page.request.post(route.path);
      expect(response.status()).toBe(401);
    });
  }
});

test.describe('F02 — a real admin session reaches every gated route', () => {
  // The negative-auth suite above proves every operator route refuses a signed-in, non-admin
  // session — but nothing previously proved the mirror: that a signed-in, *allowlisted* session
  // is actually let through. `playwright.config.ts` sets `ADMIN_EMAIL_ALLOWLIST` to exactly this
  // address for that reason. Found by lane-review: `requireAdmin()`'s only two tested outcomes
  // were "unauthenticated" and "authenticated but refused" — replacing its body with an
  // unconditional throw would have passed every existing test, including this file's own
  // negative-auth suite, which passes *harder* under that regression.
  //
  // **Serial, deliberately.** The allowlist is exactly one fixed address (there is only one
  // admin, D-11), so every test here signs in as the same email — unlike the non-admin suite's
  // `Date.now()`-plus-random addresses, there is no unique-address escape from the exact race
  // that suite's own comment documents (`fullyParallel` workers racing `sendVerificationOTP`
  // against the fixture store for one identifier).
  test.describe.configure({ mode: 'serial' });

  // Every test signs back in as the same fixed admin address, so — exactly like "account
  // deletion"'s `signIn()` below — each `beforeEach` must exclude the previous test's already-
  // used code. Without it, `readFixtureOtp`'s "non-null" check happily hands back that stale
  // code the instant it is still sitting in the fixture store, and `Verify` fails silently on a
  // code that was correct for a sign-in this test never made.
  let previousOtp: string | undefined;

  test.beforeEach(async ({ page, request }) => {
    const email = 'e2e-admin@example.com';
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send code' }).click();
    const otp = await readFixtureOtp(request, email, previousOtp);
    previousOtp = otp;
    await page.getByLabel('Enter the six-digit code').fill(otp);
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForURL('**/dashboard');
  });

  for (const route of ADMIN_PAGES) {
    test(`page ${route.path} renders its real content, not a redirect or a refusal`, async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);
      // Also closes the F01-route-existence gap `routes.ts` documents: an unauthenticated visit
      // to this same path 200s and renders `[data-state="fixture"]` too, from `/sign-in` after
      // the redirect — so the path check is what proves this response is the page itself.
      expect(new URL(page.url()).pathname).toBe(route.path);
      await expect(page.locator('[data-state="fixture"]').first()).toBeVisible();
      await expect(page.getByText('Not authorized')).toHaveCount(0);
    });
  }

  for (const route of ADMIN_API_ROUTES) {
    test(`route handler ${route.method} ${route.path} answers rather than refusing`, async ({ page }) => {
      const response =
        route.method === 'GET' ? await page.request.get(route.path) : await page.request.post(route.path);
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { state?: string };
      expect(body.state).toBe('fixture');
    });
  }
});

test.describe('F02 — account deletion', () => {
  test('deletion then sign-in creates a fresh account', async ({ page, request }) => {
    const email = `e2e-delete-then-return-${Date.now()}@example.com`;
    let previousOtp: string | undefined;

    async function signIn() {
      await page.goto('/sign-in');
      await page.getByLabel('Email').fill(email);
      await page.getByRole('button', { name: 'Send code' }).click();
      const otp = await readFixtureOtp(request, email, previousOtp);
      previousOtp = otp;
      await page.getByLabel('Enter the six-digit code').fill(otp);
      await page.getByRole('button', { name: 'Verify' }).click();
      await page.waitForURL('**/dashboard');
    }

    await signIn();
    await page.goto('/settings/account');
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await page.getByRole('button', { name: 'Confirm delete' }).click();
    await page.waitForURL('**/sign-in');

    // Signing in again with the same address must work exactly like the first time — a fresh
    // account, not an error about a deleted one.
    await signIn();
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });
});
