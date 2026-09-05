import { expect, test } from '@playwright/test';

test.describe('RNI Retail Radar', () => {
  test('renders independent divergent and partial source cells with company identity', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/rni/fixture');
    await expect(page.locator('[data-rni-radar-row="NVDA"]')).toContainText(
      'NVDA — NVIDIA Corporation',
    );
    await expect(
      page.locator('[data-rni-radar-row="NVDA"] [data-rni-platform="reddit"]'),
    ).toContainText('2 eligible sources');
    await expect(page.locator('[data-rni-radar-row="NVDA"] [data-rni-platform="x"]')).toContainText(
      '5 eligible sources',
    );
    await expect(
      page.locator('[data-rni-radar-row="NVDA"] [data-rni-combined-state="divergent"]'),
    ).toBeAttached();
    await expect(
      page.locator('[data-rni-radar-row="AMD"] [data-rni-combined-state="partial"]'),
    ).toBeAttached();
  });

  test('uses narrow cards without horizontal overflow and exposes keyboard focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/rni/fixture');
    await expect(page.locator('[data-rni-radar-card="NVDA"]')).toContainText('NVIDIA Corporation');
    expect(await page.locator('table').isVisible()).toBe(false);
    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    const citation = page
      .locator('[data-rni-radar-card="NVDA"] [data-rni-citation-id]')
      .first();
    for (
      let index = 0;
      index < 24 && !(await citation.evaluate((element) => document.activeElement === element));
      index += 1
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(citation).toBeFocused();
  });
});
