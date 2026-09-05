import { expect, test } from '@playwright/test';

test.describe('RNI security detail', () => {
  test('renders four independent dimensions per platform and preserves NVDA divergence', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/rni/fixture/security/nvda');

    await expect(page.locator('[data-rni-security-detail]')).toContainText(
      'NVDA — NVIDIA Corporation',
    );
    const reddit = page.locator('[data-rni-detail-platform="reddit"]');
    const x = page.locator('[data-rni-detail-platform="x"]');
    await expect(reddit.locator('[data-rni-dimension]')).toHaveCount(4);
    await expect(x.locator('[data-rni-dimension]')).toHaveCount(4);
    await expect(reddit.locator('[data-rni-dimension="market_trading"]')).toContainText('Bullish');
    await expect(x.locator('[data-rni-dimension="market_trading"]')).toContainText('Bearish');
    await expect(reddit.locator('[data-rni-citation-id]')).toHaveCount(5);
    await expect(x.locator('[data-rni-citation-id]')).toHaveCount(5);
  });

  test('keeps the detail readable on a narrow viewport and exposes citation focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/rni/fixture/security/nvda');

    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    const citation = page
      .locator('[data-rni-detail-platform="reddit"] [data-rni-citation-id]')
      .first();
    for (
      let index = 0;
      index < 10 && !(await citation.evaluate((element) => document.activeElement === element));
      index += 1
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(citation).toBeFocused();
  });
});
