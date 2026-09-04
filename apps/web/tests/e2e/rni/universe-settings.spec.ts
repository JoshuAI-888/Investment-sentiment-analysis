import { expect, test } from '@playwright/test';
import { createFixtureRniUniverseReadService } from '../../../fixtures/rni-ui/read-service';
import { presentActiveUniverseVersion } from '@/rni/ui/UniverseSettings';
import { referenceLegacyActiveUniverseVersion } from '@/rni/testing/reference-fixtures';

test('presents the legacy active universe without provider lineage', () => {
  expect(presentActiveUniverseVersion(referenceLegacyActiveUniverseVersion)).toEqual({
    source: 'Legacy seed',
    retrievedAt: 'Not available for the legacy seed',
  });
});

test('fixture universe search validates and binds generic active-member results', async () => {
  const service = createFixtureRniUniverseReadService();
  const active = await service.getActiveUniverse();
  const initial = await service.searchActiveUniverse({});
  expect(initial.version).toEqual(active.version);
  expect(initial.query).toBe('');
  expect(initial.members.map(({ ticker }) => ticker)).toContain('NVDA');
  expect(initial.hasMore).toBe(true);

  const partial = await service.searchActiveUniverse({ query: 'soft', limit: 20 });
  expect(partial.version).toEqual(active.version);
  expect(partial.members.map(({ ticker }) => ticker)).toEqual(['MSFT']);
  expect(partial.hasMore).toBe(false);

  const mixedCaseTicker = await service.searchActiveUniverse({ query: 'mSfT', limit: 20 });
  expect(mixedCaseTicker.members.map(({ ticker }) => ticker)).toEqual(['MSFT']);

  const noMatches = await service.searchActiveUniverse({ query: 'not-a-member', limit: 20 });
  expect(noMatches.members).toEqual([]);
  expect(noMatches.hasMore).toBe(false);

  const limited = await service.searchActiveUniverse({ query: 'a', limit: 2 });
  expect(limited.members).toHaveLength(2);
  expect(limited.hasMore).toBe(true);

  await expect(service.searchActiveUniverse({ query: '', limit: 51 })).rejects.toThrow();
});

test('RNI universe settings defaults to NVDA and finds any active member', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await page.goto('/rni/settings/universe');
  await expect(page.getByText('Default: NVDA — NVIDIA Corporation · NASDAQ')).toBeVisible();
  await expect(
    page.getByText('Source: FMP S&P 500 constituent', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Retrieved at: 2026-09-04T23:30:00.000Z', { exact: true }),
  ).toBeVisible();

  const searchInput = page.getByRole('searchbox', { name: 'Search active S&P 500 members' });
  for (let tabCount = 0; tabCount < 20; tabCount += 1) {
    if (await searchInput.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(searchInput).toBeFocused();
  await page.keyboard.type('SoFt');
  await page.keyboard.press('Tab');
  const submit = page.getByRole('button', { name: 'Search members' });
  await expect(submit).toBeFocused();
  await page.keyboard.press('Enter');

  await page.waitForURL((url) => url.searchParams.get('query') === 'SoFt');
  await expect(page.getByText('MSFT — Microsoft Corporation · NASDAQ')).toBeVisible();
  const searchStatus = page.getByRole('status');
  await expect(searchStatus).toHaveAttribute('aria-live', 'polite');
  await expect(searchStatus).toContainText('Results are bound to active version 100.');
  await expect(page.getByText('Active version 100 → staged version 101')).toBeVisible();
  await expect(page.getByText('PLTR — Palantir Technologies Inc. · NASDAQ')).toBeVisible();
  await expect(page.getByText('No members removed.')).toBeVisible();
  expect(
    await page.locator('main').evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
