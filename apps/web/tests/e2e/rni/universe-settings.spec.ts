import { expect, test } from '@playwright/test';

test('RNI universe settings defaults to NVDA and finds any active member', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await page.goto('/rni/settings/universe');
  await expect(page.getByText('Default: NVDA — NVIDIA Corporation · NASDAQ')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search active S&P 500 members' }).fill('MiCrO');
  await expect(page.getByText('MSFT — Microsoft Corporation · NASDAQ')).toBeVisible();
  await expect(page.getByText('Active version 100 → staged version 101')).toBeVisible();
  expect(
    await page.locator('main').evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
