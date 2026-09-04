import { expect, test } from '@playwright/test';

test('RNI manual refresh previews scope and accepts each intentional submission', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await page.goto('/rni/refresh/fixture');
  const ticker = page.getByRole('button', { name: 'Refresh NVDA' });
  const fullUniverse = page.getByRole('button', { name: 'Refresh full universe' });
  const release = page.getByRole('button', { name: 'Complete fixture request' });
  await expect(page.getByText('Scope preview: NVDA — NVIDIA Corporation · NASDAQ')).toBeVisible();
  await expect(page.getByText('Scope preview: 501 active securities')).toBeVisible();
  await ticker.click();
  await expect(ticker).toBeDisabled();
  await expect(fullUniverse).toBeDisabled();
  await release.click();
  await expect(page.getByRole('status')).toContainText('Accepted refresh');
  const firstRun = await page.getByRole('status').textContent();
  await ticker.click();
  await expect(ticker).toBeDisabled();
  await expect(fullUniverse).toBeDisabled();
  await release.click();
  await expect(page.getByRole('status')).toContainText('Accepted refresh');
  const secondRun = await page.getByRole('status').textContent();
  expect(secondRun).not.toBe(firstRun);
  await fullUniverse.click();
  await expect(ticker).toBeDisabled();
  await expect(fullUniverse).toBeDisabled();
  await release.click();
  await expect(page.locator('[data-rni-refresh-result-scope]')).toContainText(
    '501 active securities',
  );
  const fitsViewport = await page
    .locator('[data-rni-refresh-controls]')
    .evaluate((element) => element.scrollWidth <= window.innerWidth);
  expect(fitsViewport).toBe(true);
});
