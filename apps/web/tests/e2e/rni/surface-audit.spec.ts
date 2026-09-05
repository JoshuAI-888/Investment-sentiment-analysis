import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const surfaceRoutes = [
  '/rni/fixture',
  '/rni/fixture/security/nvda',
  '/rni/fixture/explorer/nvda',
  '/rni/fixture/status',
  '/rni/refresh/fixture',
  '/rni/fixture/settings/universe',
  '/rni/fixture/settings/ai-route',
] as const;

test('every SURFACE route has one primary heading, no scoped axe violations, and no narrow overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });

  for (const route of surfaceRoutes) {
    await page.goto(route);
    await expect(page.locator('[data-rni-read-state="loading"]')).toHaveCount(0);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('main h1')).toHaveCount(1);

    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations, `${route}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);

    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth, `${route} should not horizontally overflow at 375px`).toBeLessThanOrEqual(
      clientWidth,
    );
  }
});

test('the fixture-only unavailable Gateway state disables the route and states why', async ({ page }) => {
  await page.goto('/rni/settings/ai-route/fixture');

  const gateway = page.getByRole('radio', { name: /Vercel AI Gateway/ });
  await expect(gateway).toBeDisabled();
  await expect(gateway).toHaveAttribute(
    'aria-describedby',
    'rni-ai-route-vercel_ai_gateway-description',
  );
  await expect(page.locator('#rni-ai-route-vercel_ai_gateway-description')).toHaveText(
    'Unavailable: Gateway is not configured for this fixture.',
  );
});
