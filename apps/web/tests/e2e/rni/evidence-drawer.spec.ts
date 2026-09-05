import { expect, test } from '@playwright/test';

test.describe('RNI evidence drawer', () => {
  test('uses unique dialog controls for repeated citations and keeps keyboard focus in the drawer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/rni/fixture');

    const controls = await page
      .locator('[data-rni-citation-id="00000000-0000-4000-8000-000000000014"]')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-controls')));
    expect(controls).toHaveLength(8);
    expect(new Set(controls).size).toBe(controls.length);

    const trigger = page
      .locator('[data-rni-radar-card="NVDA"] [data-rni-platform="reddit"] [data-rni-citation-id]')
      .first();
    await trigger.click();
    const dialog = page.locator('[role="dialog"]');
    const close = dialog.getByRole('button', { name: 'Close evidence' });
    const sourceLink = dialog.getByRole('link', { name: 'Open canonical source' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sourceLink).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(sourceLink).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('resolves an X Radar citation through its platform-bound bounded source evidence', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/rni/fixture');
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
    await page.goto('/rni/fixture/security/nvda');
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
