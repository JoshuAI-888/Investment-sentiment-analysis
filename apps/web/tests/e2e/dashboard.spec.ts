import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * ============================================================================================
 * CI GAP — F07 review finding 3: this suite does NOT currently run in CI.
 *
 * Both `test.skip(process.env['DATABASE_URL'] === undefined, ...)` guards below fire in
 * `.github/workflows/ci.yml`'s "End-to-end tests" step, which sets no `DATABASE_URL` in its
 * `env:` block (unlike the "Contract tests" and "Integration tests" steps, which both set
 * `DATABASE_URL: postgres://postgres:postgres@localhost:5432/app_test`) — so 9 of this file's 10
 * tests skip silently on every CI run. Only "F07 — dashboard: unauthenticated visitor" (the one
 * test with no such guard) actually executes today.
 *
 * The one-line fix — **not this lane's to make**, `.github/workflows/ci.yml` is F01-owned —
 * is to add the same `DATABASE_URL` line to the "End-to-end tests" step's `env:` block. Until
 * that lands, a green CI run has NOT exercised F07 §5's e2e DoD item, and this gap should be
 * escalated or routed to whoever next touches that workflow file rather than assumed closed.
 * ============================================================================================
 *
 * F07 §5 e2e cases: the dashboard renders from seeded data; every number opens an Inspector;
 * stale, degraded, insufficient and cold-start states each render from a seeded condition; a
 * refresh refused by the global budget check renders its explanation; axe passes; mobile
 * viewport has no horizontal scroll.
 *
 * States are driven through `POST /api/dashboard/e2e-seed` (`src/services/dashboard/testing.ts`)
 * rather than the real refresh pipeline — see that file's doc comment for why: the committed
 * fixtures (2 daily bars, 2 articles) cannot produce a "fresh" reading against `price.regime`'s
 * 21-bar / `news.sentiment`'s 3-article floors, and this lane may not edit COLLECT's fixtures to
 * make them. The budget-refusal case below is the one state driven through the real pipeline —
 * it needs no fixture change, just a real `cost_event` row.
 */

/** ≥ 12 chars — `emailAndPassword.minPasswordLength` (`src/services/auth/instance.ts`). */
const PASSWORD = 'correct horse battery staple';

/** Mirrors `auth.spec.ts`'s helper — duplicated rather than imported, since neither file exports it. */
async function readFixtureLink(request: APIRequestContext, email: string): Promise<string> {
  const deadline = Date.now() + 2000;
  let lastUrl: string | null = null;
  while (Date.now() < deadline) {
    const response = await request.get(`/api/auth/fixture-link?email=${encodeURIComponent(email)}`);
    const body = (await response.json()) as { url: string | null };
    lastUrl = body.url;
    if (lastUrl !== null) return lastUrl;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(lastUrl, `no fresh verification link was ever recorded for ${email}`).not.toBeNull();
  return lastUrl as string;
}

/**
 * Signs up, verifies (auto-signs in), and lands on `/dashboard`. Unlike the old OTP helper,
 * repeat calls for the *same* address are not needed here — a password sign-in does not
 * invalidate anything on reuse — so this suite always sign-up-once, sign-in-with-password on
 * every later visit, mirroring `auth.spec.ts`'s own pattern.
 */
async function signUpAndVerify(page: Page, request: APIRequestContext, email: string): Promise<void> {
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/Check your email/)).toBeVisible();
  const verifyUrl = await readFixtureLink(request, email);
  await page.goto(verifyUrl);
  await page.goto('/dashboard');
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

async function seed(request: APIRequestContext, state: 'fresh' | 'stale' | 'insufficient' | 'degraded' | 'empty'): Promise<void> {
  const response = await request.post('/api/dashboard/e2e-seed', { data: { state } });
  expect(response.status(), 'the e2e-seed route only answers in fixture mode').toBe(200);
}

test.describe('F07 — dashboard: unauthenticated visitor', () => {
  test('is redirected to sign-in rather than seeing the dashboard', async ({ page }) => {
    const response = await page.goto('/dashboard');
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/sign-in');
  });
});

test.describe('F07 — dashboard states', () => {
  // `e2e-seed` persists real artifacts (`persistArtifact`), which needs `DATABASE_URL` —
  // absent today from `.github/workflows/ci.yml`'s "End-to-end tests" step (reported under
  // this feature's `CONTRACTS`). Skipping rather than failing here is the same honesty
  // `describe.skipIf(url === undefined)` already applies throughout `tests/integration/`.
  test.skip(process.env['DATABASE_URL'] === undefined, 'needs DATABASE_URL — see this feature CONTRACTS report');
  test.describe.configure({ mode: 'serial' });
  const email = 'e2e-dashboard@example.com';

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signUpAndVerify(page, context.request, email);
    await context.close();
  });

  // Every test gets a fresh, cookie-isolated context — so every test signs in for real, with
  // the password set up once in `beforeAll`.
  test.beforeEach(async ({ page }) => {
    await signIn(page, email);
  });

  test('fresh: renders the market composite, its component breakdown, and every sector tile — each number opens an Inspector', async ({
    page,
    request,
  }) => {
    await seed(request, 'fresh');
    await page.reload();

    expect(await page.locator('main').getAttribute('data-state')).toBe('fresh');
    await expect(page.locator('[data-market-composite-card]')).toBeVisible();

    const compositeMetric = page.locator('[data-market-composite-card] [data-inspectable-metric]').first();
    await expect(compositeMetric).toBeVisible();
    const calculationId = await compositeMetric.getAttribute('data-calculation-id');
    expect(calculationId).not.toBeNull();

    const link = compositeMetric.getByRole('link', { name: 'How this was calculated' });
    await expect(link).toHaveAttribute('href', `/calculations/${String(calculationId)}`);

    // All four rows always render — F07 §4.2: a composite from three components must look
    // different from one from four, not merely be inspectable differently.
    await expect(page.locator('[data-composite-component]')).toHaveCount(4);
    await expect(page.locator('[data-composite-component="sampled_retail_stance"]')).toHaveAttribute(
      'data-participated',
      'false',
    );
    await expect(page.locator('[data-composite-component="news_sentiment"]')).toHaveAttribute('data-participated', 'true');

    // Eleven sector tiles, each with two inspectable metrics.
    await expect(page.locator('[data-sector-tile]')).toHaveCount(11);
    await expect(page.locator('[data-sector-tile] [data-inspectable-metric]')).toHaveCount(22);
  });

  test('stale: every metric renders its "refresh failed" marker', async ({ page, request }) => {
    await seed(request, 'stale');
    await page.reload();

    expect(await page.locator('main').getAttribute('data-state')).toBe('stale');
    await expect(page.locator('[data-freshness="stale"]').first()).toBeVisible();
    await expect(page.getByText(/refresh failed/).first()).toBeVisible();
  });

  test('insufficient: abstained metrics state a reason, never a zero or a dash', async ({ page, request }) => {
    await seed(request, 'insufficient');
    await page.reload();

    expect(await page.locator('main').getAttribute('data-state')).toBe('insufficient');
    const abstained = page.locator('[data-abstained]').first();
    await expect(abstained).toBeVisible();
    await expect(abstained).toContainText('No value —');
    await expect(abstained).not.toHaveText('0');
    await expect(abstained).not.toHaveText('—');
  });

  test('degraded: the panel names the unavailable providers', async ({ page, request }) => {
    await seed(request, 'degraded');
    await page.reload();

    expect(await page.locator('main').getAttribute('data-state')).toBe('degraded');
    await expect(page.locator('[data-degraded-panel]')).toBeVisible();
    await expect(page.locator('[data-degraded-provider="market"]')).toBeVisible();
    await expect(page.locator('[data-degraded-provider="marketaux"]')).toBeVisible();
  });

  test('empty (cold start): explains that history is accruing and names the depth so far', async ({ page, request }) => {
    await seed(request, 'empty');
    await page.reload();

    expect(await page.locator('main').getAttribute('data-state')).toBe('empty');
    await expect(page.locator('[data-empty-state]')).toBeVisible();
    await expect(page.locator('[data-empty-state]')).toContainText('accruing');
    await expect(page.locator('[data-market-composite-card]')).toHaveCount(0);
  });

  test('axe finds no violations on the fresh state', async ({ page, request }) => {
    await seed(request, 'fresh');
    await page.reload();
    // Scoped to `main` — this feature's own content. The root layout's provider-mode banner
    // (`app/layout.tsx`, F01, every page in the app) fails axe's "region" rule regardless of
    // which page renders it; that is a pre-existing, page-independent gap this feature did not
    // introduce and does not own, worth its own fix rather than blocking this one.
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('keyboard traversal reaches the refresh control and an Inspector link', async ({ page, request }) => {
    await seed(request, 'fresh');
    await page.reload();

    // Every `InspectableMetric` ends in a real `<a>`, and the refresh control is a real
    // `<button>` — both keyboard-reachable by construction, proven here rather than assumed.
    let reachedRefresh = false;
    let reachedInspectorLink = false;
    for (let tab = 0; tab < 40 && !(reachedRefresh && reachedInspectorLink); tab += 1) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => ({
        tag: document.activeElement?.tagName ?? null,
        hasRefreshAttr: document.activeElement?.hasAttribute('data-refresh-button') ?? false,
        text: document.activeElement?.textContent ?? '',
      }));
      if (focused.hasRefreshAttr) reachedRefresh = true;
      if (focused.tag === 'A' && focused.text.includes('How this was calculated')) reachedInspectorLink = true;
    }

    expect(reachedRefresh).toBe(true);
    expect(reachedInspectorLink).toBe(true);
  });

  test('mobile viewport has no horizontal scroll', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seed(request, 'fresh');
    await page.reload();

    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});

test.describe('F07 — refresh refused by the global budget check', () => {
  // `checkGlobalBudget` reads `cost_event` — needs `DATABASE_URL`, same note as above.
  test.skip(process.env['DATABASE_URL'] === undefined, 'needs DATABASE_URL — see this feature CONTRACTS report');

  test('renders its explanation and disables the control', async ({ page, request }) => {
    await signUpAndVerify(page, request, 'e2e-dashboard-budget@example.com');

    // Reset the process-global cooldown/lock first — `dashboard:refresh:cooldown` is shared
    // across every test that has ever called the real refresh route, so without this a prior
    // test's cooldown could make this one's first call refuse for the wrong reason.
    await request.post('/api/dashboard/e2e-seed', { data: { action: 'reset_rate_limit' } });

    // A real `cost_event` this month, at the ceiling — driven through the real budget path
    // (`checkGlobalBudget` → `repositories/cost.ts#spendInWindow`), not a seeded marker. This is
    // the one dashboard state this suite proves end to end rather than through `e2e-seed`'s
    // direct artifact seeding.
    const seeded = await request.post('/api/dashboard/e2e-seed', { data: { action: 'exceed_budget' } });
    expect(seeded.status()).toBe(200);

    const refreshResponse = await page.request.post('/api/dashboard/refresh');
    const body = (await refreshResponse.json()) as { status: string; reason?: string; message?: string };
    expect(body.status).toBe('refused');
    expect(body.reason).toBe('budget');
    expect(body.message).toContain('global ceiling');

    await page.reload();
    await expect(page.locator('[data-refresh-button]')).toBeDisabled();
    await expect(page.locator('[data-refresh-refused-explanation]')).toContainText('global ceiling');
  });
});
