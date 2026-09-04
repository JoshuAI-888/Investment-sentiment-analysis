import { expect, test } from '@playwright/test';

test('RNI manual refresh prevents double-submit and replays the same key as duplicate', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await page.goto('/rni/refresh');
  const ticker = page.getByRole('button', { name: 'Refresh NVDA' });
  await ticker.click();
  await expect(ticker).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Accepted refresh');
  await ticker.click();
  await expect(page.getByRole('status')).toContainText('Duplicate refresh');
  await page.getByRole('button', { name: 'Refresh full universe' }).click();
  await expect(page.locator('[data-rni-refresh-scope-preview]')).toContainText(
    '501 active securities',
  );
  const fitsViewport = await page
    .locator('[data-rni-refresh-controls]')
    .evaluate((element) => element.scrollWidth <= window.innerWidth);
  expect(fitsViewport).toBe(true);
});
