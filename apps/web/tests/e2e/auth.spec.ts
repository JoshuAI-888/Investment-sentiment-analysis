import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { GATED_PAGE_ROUTES } from './routes';

const ADMIN_PAGES = GATED_PAGE_ROUTES.filter((route) => route.path.startsWith('/admin'));

/**
 * F15 landed real content on eight of the twelve `/admin/*` pages
 * (`/admin`, `/admin/settings`, `/admin/settings/universe`, `/admin/audit`, `/admin/costs`,
 * `/admin/models`, `/admin/data-explorer`, `/admin/calculation-issues`) — those no longer render
 * F01's `data-state="fixture"` shell, so the negative-auth check (still true for all twelve:
 * every one still refuses a non-admin) and the positive "an admin reaches it" check now diverge
 * per page. `/admin/data-sources`, `/admin/jobs` (F16b) and `/admin/user-assumptions` remain
 * fixture.
 */
const ADMIN_PAGES_WITH_REAL_CONTENT = new Set([
  '/admin',
  '/admin/settings',
  '/admin/settings/universe',
  '/admin/audit',
  '/admin/costs',
  '/admin/models',
  '/admin/data-explorer',
  '/admin/calculation-issues',
]);

const ADMIN_API_ROUTES = [
  // F15-built, real content — GET reads.
  { path: '/api/admin/status', method: 'GET' as const, real: true },
  { path: '/api/admin/data', method: 'GET' as const, real: true },
  { path: '/api/admin/costs', method: 'GET' as const, real: true },
  { path: '/api/admin/universe', method: 'GET' as const, real: true },
  { path: '/api/admin/audit', method: 'GET' as const, real: true },
  { path: '/api/admin/models', method: 'GET' as const, real: true },
  { path: '/api/admin/calculation-issues', method: 'GET' as const, real: true },
  // F15-built mutations — POST. An authenticated admin with no/invalid body reaches validation
  // (400), never authorization (401); that is the "admin reaches it" signal for a mutation route,
  // since a genuinely valid payload needs seeded domain data this suite does not provision.
  { path: '/api/admin/universe/draft', method: 'POST' as const, real: true, mutation: true },
  { path: '/api/admin/universe/activate', method: 'POST' as const, real: true, mutation: true },
  { path: '/api/admin/universe/rollback', method: 'POST' as const, real: true, mutation: true },
  { path: '/api/admin/settings', method: 'POST' as const, real: true, mutation: true },
  { path: '/api/admin/settings/rollback', method: 'POST' as const, real: true, mutation: true },
  { path: '/api/admin/calculation-issues/resolve', method: 'POST' as const, real: true, mutation: true },
  // Still fixture — F16b's own tab.
  { path: '/api/admin/jobs/job_fixture/runs', method: 'GET' as const, real: false },
];

/** ≥ 12 chars — `emailAndPassword.minPasswordLength` (`src/services/auth/instance.ts`). */
const PASSWORD = 'correct horse battery staple';

/**
 * Reads back the verification/reset link `readFixtureLink` recorded instead of mailing it
 * (`src/services/auth/fixture-link-store.ts`). `expect.poll`-style retry absorbs the same
 * single-digit-millisecond ordering gap `auth.spec.ts` always had to absorb for the OTP store —
 * a Next.js server action's response can settle a beat before the write actually lands.
 */
async function readFixtureLink(request: APIRequestContext, email: string): Promise<string> {
  const deadline = Date.now() + 2000;
  let lastUrl: string | null = null;

  while (Date.now() < deadline) {
    const response = await request.get(`/api/auth/fixture-link?email=${encodeURIComponent(email)}`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { url: string | null };
    lastUrl = body.url;
    if (lastUrl !== null) return lastUrl;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  expect(lastUrl, `no fresh verification/reset link was ever recorded for ${email} within 2s`).not.toBeNull();
  return lastUrl as string;
}

/**
 * Creates the account, clicks its verification link, and lands signed in —
 * `emailVerification.autoSignInAfterVerification` (`instance.ts`) sets the session cookie the
 * moment the link is visited, so no separate password sign-in is needed to reach `/dashboard`
 * from here. Every address used across this suite is unique, so sign-up never collides with an
 * account created by a different test.
 */
async function signUpAndVerify(page: Page, request: APIRequestContext, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/Check your email/)).toBeVisible();

  const verifyUrl = await readFixtureLink(request, email);
  await page.goto(verifyUrl);
  await page.goto('/dashboard');
}

/** The real sign-in form, password auth's own path to a session — distinct from the auto-sign-in verification gives. */
async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

test.describe('F02 — sign-up and sign-in', () => {
  test('sign-up, verify, and sign in with a password all reach the dashboard', async ({ page, request }) => {
    const email = `e2e-full-sign-up-${Date.now()}@example.com`;

    await signUpAndVerify(page, request, email);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
    await expect(page.locator('[data-route="/dashboard"]')).toBeVisible();

    // The verification link auto-signs in, but the password itself must independently work too
    // — sign out and use the real sign-in form.
    await page.goto('/settings/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/sign-in');

    await signIn(page, email);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });

  test('GET /api/dashboard requires a session, then answers a signed-in one', async ({ page, request }) => {
    const unauthenticated = await request.get('/api/dashboard');
    expect(unauthenticated.status()).toBe(401);

    const email = `e2e-api-dashboard-${Date.now()}@example.com`;
    await signUpAndVerify(page, request, email);

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

  test('a wrong password is refused; the correct one still works afterwards', async ({ page, request }) => {
    const email = `e2e-wrong-password-${Date.now()}@example.com`;
    await signUpAndVerify(page, request, email);
    await page.goto('/settings/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/sign-in');

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('the-wrong-password-entirely');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That email or password is wrong.')).toBeVisible();
    expect(new URL(page.url()).pathname).not.toBe('/dashboard');

    await signIn(page, email);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });

  test('an unverified account cannot sign in until the verification link is clicked', async ({ page, request }) => {
    const email = `e2e-unverified-${Date.now()}@example.com`;

    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(/Check your email/)).toBeVisible();

    // No verification click yet — the password is correct, but the account cannot sign in.
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/verification link/)).toBeVisible();
    expect(new URL(page.url()).pathname).not.toBe('/dashboard');

    const verifyUrl = await readFixtureLink(request, email);
    await page.goto(verifyUrl);
    await signIn(page, email);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });

  // "sign-up refuses a non-allowlisted address" is not exercisable here: the allowlist gate on
  // account creation (`isAccountCreationAllowed`, `src/services/auth/allowlist.ts`) is
  // `live`-mode only, by design — see `instance.ts`'s doc comment on why, and the non-admin
  // suite below for the test seam that decision exists to preserve. Covered instead at the unit
  // level (`tests/unit/services/auth/allowlist.test.ts`).

  test('the password-reset request: an allowlisted-looking and an arbitrary address get the same response shape', async ({
    request,
  }) => {
    const first = await request.post('/api/auth/request-password-reset', {
      data: { email: 'looks-allowlisted@example.com', redirectTo: '/reset-password' },
    });
    const second = await request.post('/api/auth/request-password-reset', {
      data: { email: `arbitrary-${Date.now()}@example.com`, redirectTo: '/reset-password' },
    });

    expect(first.status()).toBe(second.status());
    expect(await first.json()).toEqual(await second.json());
  });

  test('forgot password → reset link → sign in with the new password', async ({ page, request }) => {
    const email = `e2e-reset-${Date.now()}@example.com`;
    await signUpAndVerify(page, request, email);
    await page.goto('/settings/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/sign-in');

    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(/reset link is on its way/)).toBeVisible();

    const resetUrl = await readFixtureLink(request, email);
    const newPassword = 'a completely different passphrase';
    await page.goto(resetUrl);
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Set password' }).click();
    await page.waitForURL('**/sign-in');

    await signIn(page, email, newPassword);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });
});

/** D-38's known initial credential — `src/services/auth/seed-account.ts`'s `WELCOME_PASSWORD`. */
const WELCOME_PASSWORD = 'welcome1';

test.describe('F02 — D-38: the "welcome1" seeded-account path', () => {
  test('a nonexistent address signs in on the first attempt with welcome1, and is forced to change it', async ({
    page,
  }) => {
    const email = `e2e-welcome1-${Date.now()}@example.com`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(WELCOME_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Signed in, but every protected route redirects here instead of rendering — not just the
    // dashboard, proving this is `requireUser()`'s own gate, not a special case on one page.
    await page.waitForURL('**/change-password');
    await expect(page.getByText(/temporary password/)).toBeVisible();

    const otherProtectedPage = await page.goto('/settings/account');
    expect(otherProtectedPage?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/change-password');

    const newPassword = 'a genuinely new chosen password';
    await page.goto('/change-password');
    await page.getByLabel('Current password').fill(WELCOME_PASSWORD);
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Set password' }).click();
    await page.waitForURL('**/dashboard');

    // The flag is genuinely cleared, not just bypassed for this one session: sign out, and both
    // the old temporary password and a plain re-visit to a protected page behave normally now.
    await page.goto('/settings/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/sign-in');

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(WELCOME_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That email or password is wrong.')).toBeVisible();

    await signIn(page, email, newPassword);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });

  test('a wrong, non-welcome1 password against a nonexistent address is refused outright, no account created', async ({
    page,
  }) => {
    const email = `e2e-welcome1-wrong-${Date.now()}@example.com`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('not-the-welcome-password-at-all');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That email or password is wrong.')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/sign-in');

    // Nothing was created by the wrong guess — welcome1 still works, exactly like a fresh address.
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(WELCOME_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/change-password');
  });

  test('a self-service, already-verified account is unaffected by a stray welcome1 attempt', async ({
    page,
    request,
  }) => {
    const email = `e2e-welcome1-real-account-${Date.now()}@example.com`;
    await signUpAndVerify(page, request, email);
    await page.goto('/settings/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/sign-in');

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(WELCOME_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That email or password is wrong.')).toBeVisible();

    // The real password still works — the guess did not overwrite or otherwise touch the account.
    await signIn(page, email);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });

  test('a signed-in user with no pending password change can still visit /change-password voluntarily', async ({
    page,
    request,
  }) => {
    const email = `e2e-voluntary-change-${Date.now()}@example.com`;
    await signUpAndVerify(page, request, email);

    const newPassword = 'a different voluntarily-chosen password';
    await page.goto('/change-password');
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Set password' }).click();
    await page.waitForURL('**/dashboard');

    await page.goto('/settings/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/sign-in');
    await signIn(page, email, newPassword);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });
});

test.describe('F02 — every operator route refuses a signed-in, non-admin session (Wave 1 exit gate)', () => {
  test.beforeEach(async ({ page, request }) => {
    // `playwright.config.ts` sets `ADMIN_EMAIL_ALLOWLIST` to exactly one fixed address,
    // `e2e-admin@example.com` (see the admin-session suite below). Any address that is not that
    // literal string still signs up successfully here: `isAccountCreationAllowed`
    // (`src/services/auth/allowlist.ts`) only enforces the allowlist in `live` mode — e2e runs
    // in fixture mode, deliberately (see `instance.ts`'s doc comment), which is what makes it
    // possible to build a genuinely signed-in, non-allowlisted session here at all. Do not switch
    // this to a fixed address: doing so risks colliding with the one allowlisted address below
    // and turning "refuses a non-admin" into "an admin was refused", passing on the wrong
    // premise. `Date.now()` alone is also not unique enough across parallel workers, hence the
    // random suffix too.
    const email = `e2e-non-admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`;
    await signUpAndVerify(page, request, email);
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
      const response =
        route.method === 'GET' ? await page.request.get(route.path) : await page.request.post(route.path);
      expect(response.status()).toBe(401);
    });
  }
});

test.describe('F02 — a real admin session reaches every gated route', () => {
  // The negative-auth suite above proves every operator route refuses a signed-in, non-admin
  // session; this is the mirror. `playwright.config.ts` sets `ADMIN_EMAIL_ALLOWLIST` to exactly
  // this address. Serial, and signed up once in `beforeAll`: unlike password-less OTP, a
  // password sign-in does not invalidate anything on reuse, so every test after the first can
  // just sign in again with the same credential rather than re-registering.
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    // `beforeAll` has no test-scoped `page` fixture, so a throwaway browser context stands in —
    // only used to run the one-time sign-up-and-verify; every actual test below gets its own.
    const context = await browser.newContext();
    const page = await context.newPage();
    await signUpAndVerify(page, context.request, 'e2e-admin@example.com');
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    await signIn(page, 'e2e-admin@example.com');
  });

  for (const route of ADMIN_PAGES) {
    test(`page ${route.path} renders its real content, not a redirect or a refusal`, async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe(route.path);
      // Both F01's fixture shell (`RouteShell`) and every F15-built page carry `data-route`
      // matching the path — the fixture shell additionally carries `data-state="fixture"`,
      // which the seven F15 pages (`ADMIN_PAGES_WITH_REAL_CONTENT`) no longer do.
      await expect(page.locator(`[data-route="${route.path}"]`).first()).toBeVisible();
      if (!ADMIN_PAGES_WITH_REAL_CONTENT.has(route.path)) {
        await expect(page.locator('[data-state="fixture"]').first()).toBeVisible();
      }
      await expect(page.getByText('Not authorized')).toHaveCount(0);
    });
  }

  for (const route of ADMIN_API_ROUTES) {
    test(`route handler ${route.method} ${route.path} answers rather than refusing`, async ({ page }) => {
      const response =
        route.method === 'GET' ? await page.request.get(route.path) : await page.request.post(route.path);

      if (!route.real) {
        expect(response.status()).toBe(200);
        const body = (await response.json()) as { state?: string };
        expect(body.state).toBe('fixture');
        return;
      }

      if ('mutation' in route && route.mutation) {
        // An admin with no request body reaches validation (400), never authorization (401) —
        // that is the "past the auth gate" signal for a mutation route; a genuinely valid
        // payload needs seeded domain data (a security master, an active config version) this
        // suite does not provision.
        expect(response.status()).not.toBe(401);
        expect([200, 400]).toContain(response.status());
        return;
      }

      expect(response.status()).toBe(200);
      const body = (await response.json()) as { state?: string };
      expect(body.state).toBe('ready');
    });
  }
});

test.describe('F02 — account deletion', () => {
  test('deletion then sign-up creates a fresh account', async ({ page, request }) => {
    const email = `e2e-delete-then-return-${Date.now()}@example.com`;

    await signUpAndVerify(page, request, email);
    await page.goto('/settings/account');
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await page.getByRole('button', { name: 'Confirm delete' }).click();
    await page.waitForURL('**/sign-in');

    // Deletion removes the user row entirely — signing back in needs a fresh sign-up, exactly
    // like the first time, not an error about a deleted account.
    await signUpAndVerify(page, request, email);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });
});
