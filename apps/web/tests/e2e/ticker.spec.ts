import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * F09 §5 e2e cases, mirroring `dashboard.spec.ts`'s pattern (duplicated helpers rather than
 * imported, since neither file exports them — see that file's own note for why).
 *
 * States are driven through `POST /api/ticker/e2e-seed` (`src/services/ticker/testing.ts`)
 * rather than a real collector, for the same reason `dashboard.spec.ts` seeds directly: no
 * social/attention collector is wired to this environment yet (F04's social adapters, F08's
 * leaderboard have not merged), so there is no other way to get a real, computable stance/
 * attention/news reading deterministically on every run. The read path itself
 * (`assembleTickerSnapshot`) is exercised for real; only the writing collectors are stood in for.
 */

async function readFixtureOtp(request: APIRequestContext, email: string, exclude?: string): Promise<string> {
  const deadline = Date.now() + 2000;
  let lastOtp: string | null = null;
  while (Date.now() < deadline) {
    const response = await request.get(`/api/auth/fixture-otp?email=${encodeURIComponent(email)}`);
    const body = (await response.json()) as { otp: string | null };
    lastOtp = body.otp;
    if (lastOtp !== null && lastOtp !== exclude) return lastOtp;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(lastOtp, `no fresh OTP was ever recorded for ${email}`).not.toBeNull();
  return lastOtp as string;
}

async function signIn(page: Page, request: APIRequestContext, email: string, exclude?: string): Promise<string> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('Enter the six-digit code')).toBeVisible();
  const otp = await readFixtureOtp(request, email, exclude);
  await page.getByLabel('Enter the six-digit code').fill(otp);
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL('**/dashboard');
  return otp;
}

async function seed(request: APIRequestContext, action: 'full' | 'ambiguous' | 'empty' | 'ineligible'): Promise<{ symbol: string }> {
  const response = await request.post('/api/ticker/e2e-seed', { data: { action } });
  expect(response.status(), 'the e2e-seed route only answers in fixture mode').toBe(200);
  return (await response.json()) as { symbol: string };
}

test.describe('F09 — ticker detail: unauthenticated visitor', () => {
  test('is redirected to sign-in rather than seeing the page', async ({ page }) => {
    const response = await page.goto('/ticker/NVDA/social');
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/sign-in');
  });
});

test.describe('F09 — ticker detail: signed-in states', () => {
  // Real Postgres data (`e2e-seed` persists real rows and artifacts) — same CONTRACTS note as
  // `dashboard.spec.ts`: absent `DATABASE_URL`, this suite skips rather than fails.
  test.skip(process.env['DATABASE_URL'] === undefined, 'needs DATABASE_URL — see this feature CONTRACTS report');
  test.describe.configure({ mode: 'serial' });
  const email = 'e2e-ticker@example.com';
  let previousOtp: string | undefined;

  test.beforeEach(async ({ page, request }) => {
    previousOtp = await signIn(page, request, email, previousOtp);
  });

  test('a fully-seeded ticker renders every axis, and every number opens an Inspector', async ({ page, request }) => {
    const { symbol } = await seed(request, 'full');
    await page.goto(`/ticker/${symbol}/social`);

    expect(await page.locator('main').getAttribute('data-state')).toBe('ready');

    // Four axes, structurally separate.
    await expect(page.locator('[data-axis="attention"]')).toBeVisible();
    await expect(page.locator('[data-axis="sampled-stance"]')).toBeVisible();
    await expect(page.locator('[data-axis="news"]')).toBeVisible();
    await expect(page.locator('[data-axis="price"]')).toBeVisible();

    // Three per-frame stance disclosures (D-14).
    await expect(page.locator('[data-stance-frame="reddit"]')).toBeVisible();
    await expect(page.locator('[data-stance-frame="x"]')).toBeVisible();
    await expect(page.locator('[data-stance-frame="substack"]')).toBeVisible();
    await expect(page.locator('[data-selection-bias-note]').first()).toBeVisible();

    // Every rendered InspectableMetric has a real calculationId and an Inspector link.
    const metrics = page.locator('[data-inspectable-metric]');
    const count = await metrics.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const metric = metrics.nth(i);
      const calculationId = await metric.getAttribute('data-calculation-id');
      expect(calculationId, 'every InspectableMetric must carry a calculationId').not.toBeNull();
      const link = metric.getByRole('link', { name: 'How this was calculated' });
      await expect(link).toHaveAttribute('href', `/calculations/${String(calculationId)}`);
    }
  });

  test('the evidence drawer shows the stored snippet and marks the unreachable source honestly', async ({ page, request }) => {
    const { symbol } = await seed(request, 'full');
    await page.goto(`/ticker/${symbol}/social`);

    const drawer = page.locator('[data-evidence-drawer]');
    await expect(drawer).toBeVisible();
    await drawer.locator('summary').click();

    await expect(page.locator('[data-evidence-item]').first()).toBeVisible();
    await expect(page.getByText('the stored snippet as retrieved', { exact: false }).first()).toBeVisible();

    const unreachable = page.locator('[data-evidence-availability="unreachable"]');
    await expect(unreachable).toBeVisible();
    await expect(unreachable.locator('[data-evidence-unreachable]')).toContainText('source no longer reachable');
    // The link is still shown for an unreachable source (F-19).
    await expect(unreachable.locator('a', { hasText: 'Open source' })).toBeVisible();
  });

  /**
   * Round-1 lane-review finding 4: this used to guard the only assertion behind
   * `if ((await divergence.count()) > 0)`, and the `full` seed never inserted a
   * `price_return_snapshot` row — so `buildDivergence` always returned `available: false` and
   * the guarded assertion never ran on any e2e run. `seedFullTicker` now inserts a 7-day return,
   * so the divergence panel genuinely renders and this assertion is no longer conditional.
   */
  test('the divergence state carries the §6.4 disclosure line verbatim', async ({ page, request }) => {
    const { symbol } = await seed(request, 'full');
    await page.goto(`/ticker/${symbol}/social`);

    const divergence = page.locator('[data-divergence-disclosure]');
    await expect(divergence).toHaveText(
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    );
  });

  test('an ambiguous symbol is refused with a stated reason, not silently resolved', async ({ page, request }) => {
    const { symbol } = await seed(request, 'ambiguous');
    await page.goto(`/ticker/${symbol}/social`);

    await expect(page.locator('[data-refused="ambiguous"]')).toBeVisible();
    await expect(page.locator('[data-refusal-message]')).toContainText('more than one active security');
  });

  test('an ineligible symbol is refused with a stated reason', async ({ page, request }) => {
    const { symbol } = await seed(request, 'ineligible');
    await page.goto(`/ticker/${symbol}/social`);

    await expect(page.locator('[data-refused="ineligible"]')).toBeVisible();
  });

  test('an ETF with nothing on record renders legibly, not error-shaped', async ({ page, request }) => {
    const { symbol } = await seed(request, 'empty');
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    const response = await page.goto(`/ticker/${symbol}/social`);
    expect(response?.status()).toBe(200);
    expect(await page.locator('main').getAttribute('data-state')).toBe('ready');
    await expect(page.locator('[data-attention-empty]')).toBeVisible();
    await expect(page.locator('[data-axis="sampled-stance"]')).toBeVisible();
    // Whether stance rendered "not yet computed" (no active config_version) or a real
    // insufficient_data abstention (an earlier test in this serial run already activated one)
    // depends on suite ordering, which this test must not assume either way — both are honest,
    // legible states, and either satisfies "not error-shaped".
    const notComputed = page.locator('[data-stance-not-computed]');
    const abstained = page.locator('[data-abstained]');
    await expect(notComputed.or(abstained).first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('axe finds no violations on a fully-seeded ticker', async ({ page, request }) => {
    const { symbol } = await seed(request, 'full');
    await page.goto(`/ticker/${symbol}/social`);
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('mobile viewport has no horizontal scroll', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const { symbol } = await seed(request, 'full');
    await page.goto(`/ticker/${symbol}/social`);

    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('the search box returns local results with no provider call — typing does not 500 or hang', async ({ page, request }) => {
    const { symbol } = await seed(request, 'full');
    await page.goto(`/ticker/${symbol}/social`);

    await page.locator('[data-search-input]').fill(symbol.slice(0, 4));
    await expect(page.locator(`[data-search-result="${symbol}"]`)).toBeVisible();
  });

  /**
   * Round-2 lane-review finding 1. `SearchBox` used to call `response.json()` unconditionally —
   * a 401 (an expired session, mid-page) resolves to `{ error: 'unauthenticated' }`, and reading
   * `body.results` off that threw a `TypeError` **during render**, taking the whole page down
   * with it. Forcing a real 401 through Playwright's own route interception (no unit-test
   * infrastructure in this codebase can mock `fetch` inside a component's `useEffect` — every
   * existing UI test is a pure `renderToStaticMarkup` snapshot with no hooks or network) is what
   * actually exercises the code path this fix changed.
   *
   * Round-3 lane-review finding 5: the round-2 fix stopped the crash but rendered nothing for
   * the 401 case — pixel-identical to a genuine zero-match search, so a user with an expired
   * session could not tell "nothing matched" from "search is broken". `SearchBox` now renders a
   * stated `[data-search-error]` message for a failed fetch instead, which this test asserts on.
   */
  test('the search box degrades honestly, without crashing the page, when the session has expired mid-page', async ({ page, request }) => {
    const { symbol } = await seed(request, 'full');
    await page.goto(`/ticker/${symbol}/social`);

    await page.route('**/api/search*', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthenticated' }) });
    });

    await page.locator('[data-search-input]').fill(symbol.slice(0, 4));
    // The page must still be up — no error boundary, no crash — and the failure must be stated,
    // not indistinguishable from a fabricated "no matches" claim it cannot back.
    await expect(page.locator('h1, h2').first()).toBeVisible();
    await expect(page.locator('[data-search-results]')).toHaveCount(0);
    await expect(page.locator('[data-search-error]')).toBeVisible();
  });
});
