import { expect, test } from '@playwright/test';

test.describe('RNI raw-data explorer', () => {
  test('traverses a summary section through its citation to a bounded source record', async ({
    page,
  }) => {
    await page.goto('/rni/explorer/nvda');
    await expect(page.locator('[data-rni-raw-explorer]')).toContainText(
      'NVDA — NVIDIA Corporation',
    );

    const redditSummary = page.locator('[data-rni-summary-section="reddit-sentiment"]');
    const sourceLink = redditSummary.getByRole('link', { name: 'View source 1 (reddit)' });
    await expect(sourceLink).toHaveAttribute(
      'href',
      '#source-00000000-0000-4000-8000-000000000002',
    );
    await sourceLink.click();
    await expect(page).toHaveURL(/#source-00000000-0000-4000-8000-000000000002$/u);

    const source = page.locator('[data-rni-source-record="00000000-0000-4000-8000-000000000002"]');
    await expect(source).toContainText('Reddit');
    await expect(source).toContainText('NVDA has execution momentum; AMD is still catching up.');
    await expect(source.getByRole('link', { name: 'Open original source' })).toHaveAttribute(
      'href',
      'https://www.reddit.com/r/stocks/comments/fixture-comparison-1/',
    );
    await expect(page.locator('[data-rni-summary-section="x-sentiment"]')).toContainText(
      'No publishable source record is available',
    );
  });
});
