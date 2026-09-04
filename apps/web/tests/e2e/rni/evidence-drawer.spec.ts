import { expect, test } from '@playwright/test';

test.describe('RNI evidence drawer', () => {
  test('resolves an X Radar citation through its platform-bound bounded source evidence', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/rni');
    await page
      .locator('[data-rni-radar-card="NVDA"] [data-rni-platform="x"] [data-rni-citation-id]')
      .first()
      .click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toHaveAttribute('data-rni-evidence-platform', 'x');
    await expect(dialog).toContainText('X evidence');
    await expect(dialog).toContainText('NVDA demand remains strong');
    await expect(dialog.locator('[data-rni-source-item-id]')).toHaveAttribute(
      'data-rni-source-item-id',
      '00000000-0000-4000-8000-000000000024',
    );
    await expect(dialog.getByRole('link', { name: 'Open canonical source' })).toHaveAttribute(
      'href',
      'https://x.com/fixture/status/1',
    );
  });

  test('opens a Reddit dimension citation without using the citation ID as a source ID', async ({
    page,
  }) => {
    await page.goto('/rni/security/nvda');
    await page
      .locator(
        '[data-rni-detail-platform="reddit"] [data-rni-dimension="company_fundamentals"] [data-rni-citation-id]',
      )
      .click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toHaveAttribute('data-rni-evidence-platform', 'reddit');
    await expect(dialog).toContainText('NVDA has execution momentum');
    await expect(dialog.locator('[data-rni-source-item-id]')).toHaveAttribute(
      'data-rni-source-item-id',
      '00000000-0000-4000-8000-000000000002',
    );
    await expect(dialog).toContainText('NVDA has execution momentum; AMD is still catching up.');
  });
});
