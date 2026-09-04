import { expect, test } from '@playwright/test';

test.describe('RNI run and source-state matrix', () => {
  test('shows independent platform freshness and honest partial, refreshing, stale, and failed states', async ({
    page,
  }) => {
    await page.goto('/rni/status');
    await expect(page.locator('[data-rni-state-matrix]')).toContainText(
      'Run and source-state matrix',
    );

    const partial = page.locator('[data-rni-state="partial"]');
    await expect(partial).toContainText('Run: Partial');
    await expect(partial.locator('[data-rni-state-platform="reddit"]')).toContainText('Complete');
    await expect(partial.locator('[data-rni-state-platform="x"]')).toContainText('Unavailable');
    await expect(partial.locator('[data-rni-state-platform="x"]')).toContainText(
      'X_PROVIDER_UNAVAILABLE',
    );

    const refreshing = page.locator('[data-rni-state="refreshing"]');
    await expect(refreshing.getByRole('status')).toContainText('Run: Running');
    await expect(refreshing).toContainText('No derived combined result is shown');
    await expect(refreshing.locator('[data-rni-state-platform="reddit"]')).toContainText('Running');
    await expect(refreshing.locator('[data-rni-state-platform="x"]')).toContainText('Pending');

    const stale = page.locator('[data-rni-state="stale"]');
    await expect(stale).toContainText('2026-08-25T00:08:00.000Z');
    const failed = page.locator('[data-rni-state="failed"]');
    await expect(failed.getByRole('alert')).toHaveCount(2);
    await expect(page.locator('[data-rni-state="unpublished"]')).toContainText('Run: Partial');
  });
});
