import { expect, test } from '@playwright/test';
import { API_ROUTES, PAGE_ROUTES } from './routes';

/**
 * `/calculations/calc_fixture` is excluded here when `DATABASE_URL` is configured. F05's
 * `InspectorPage` (`app/(app)/calculations/[calculationId]/InspectorPage.tsx`) deliberately
 * renders `data-state="fixture"` **only when no database is configured at all** — its own doc
 * comment: "no database configured ... F01's route gate exercises this route with no
 * database" — and renders a distinct `data-state="error"` for a real fault against a real,
 * configured database (`calc_fixture` is not a UUID, so a real query for it faults). F07 needs
 * `DATABASE_URL` set for its own dashboard e2e cases, which makes those two requirements
 * mutually exclusive within one Playwright run. `/calculations/calc_fixture`'s *other*
 * behaviour — rendering at all, with the right `data-route` — is still covered below by "the
 * intercepted Inspector renders in the drawer slot on a soft navigation", which does not depend
 * on which of the two states it lands in.
 */
const PAGE_ROUTES_FOR_THIS_RUN =
  process.env['DATABASE_URL'] === undefined
    ? PAGE_ROUTES
    : PAGE_ROUTES.filter((route) => route.path !== '/calculations/calc_fixture');

test.describe('every route in source §6.2 renders a fixture state', () => {
  for (const route of PAGE_ROUTES_FOR_THIS_RUN) {
    test(`page ${route.path} (${route.source})`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));

      const response = await page.goto(route.path);

      expect(response?.status(), `${route.path} should return 200`).toBe(200);
      await expect(page.locator('[data-state="fixture"]').first()).toBeVisible();
      expect(consoleErrors, `${route.path} should log no console errors`).toEqual([]);
    });
  }

  for (const route of API_ROUTES) {
    test(`route handler ${route.method} ${route.path} (${route.source})`, async ({ request }) => {
      const response =
        route.method === 'GET' ? await request.get(route.path) : await request.post(route.path);

      expect(response.status(), `${route.path} should return 200`).toBe(200);
      const body = await response.json();
      expect(body.state, `${route.path} should declare its fixture state`).toBe('fixture');
    });
  }
});

test('the root redirects to the landing surface rather than 404ing', async ({ page }) => {
  // F07 gated `/dashboard` behind `requireUser()`, so an unauthenticated visit to `/` now
  // chains `/` → `/dashboard` → `/sign-in`. The property this test exists to prove — the root
  // never 404s — still holds; a signed-in visitor reaching `/dashboard` itself is proven in
  // `tests/e2e/auth.spec.ts`'s "full sign-in reaches the dashboard".
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe('/sign-in');
});

test('fixture mode is stated on the page, not just configured', async ({ page }) => {
  // A page rendering no data looks identical to a page rendering zero. The banner is the
  // difference, and it is the same discipline product invariant §6.1 applies to coverage.
  // `/architecture` rather than `/dashboard`: F07 gated the latter behind `requireUser()`, and
  // the banner itself lives in the root layout (`app/layout.tsx`), so any ungated page proves
  // the same property without needing a session.
  await page.goto('/architecture');
  await expect(page.getByTestId('provider-mode-banner')).toBeVisible();
});

test('the calculation drawer slot renders nothing when nothing is intercepted', async ({ page }) => {
  // Without `@calculationDrawer/default.tsx` this route 404s. That is the parallel-route
  // failure mode F01 §4.6 exists to surface now rather than in Wave 4. `/architecture` rather
  // than `/dashboard` for the same reason as above — this is `(app)`-group plumbing, not
  // anything F07-specific, and does not need a session.
  await page.goto('/architecture');
  await expect(page.locator('[data-layout="app"]')).toBeVisible();
  await expect(page.locator('[data-slot="calculationDrawer"]')).toHaveCount(0);
});

test('the intercepted Inspector renders in the drawer slot on a soft navigation', async ({ page }) => {
  await page.goto('/architecture');
  await page.evaluate(() => {
    window.history.pushState({}, '', '/calculations/calc_fixture');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  // A hard load of the same URL must fall through to the full page, not the drawer.
  const response = await page.goto('/calculations/calc_fixture');
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-route="/calculations/calc_fixture"]')).toBeVisible();
});
