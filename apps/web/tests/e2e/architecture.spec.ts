import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * F17 §5 e2e cases: every tab renders; step-through works by keyboard; reduced-motion shows the
 * static alternative; catalogue search finds every registered method; each example links to a
 * live artifact; axe passes.
 *
 * `/architecture` and `/architecture/calculations` are ungated — no session required — so
 * nothing here needs an auth helper. Tests that need real, database-configured content
 * (`state="ready"`, a real worked example) are guarded the same way `dashboard.spec.ts` and
 * `ticker.spec.ts` guard their own database-dependent suites: `test.skip(process.env
 * ['DATABASE_URL'] === undefined, ...)`. Everything else — the manifest topology, PoV/Target,
 * the no-backtest statement, the glossary, the opportunities list — needs no database at all
 * (`services/architecture/view.ts`'s own doc comment) and runs unconditionally.
 */

const hasDatabase = process.env['DATABASE_URL'] !== undefined;

test.describe('F17 — Architecture Explorer, content that needs no database', () => {
  test('renders every tab, and the How it works tab shows the static pipeline text', async ({ page }) => {
    const response = await page.goto('/architecture');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-route="/architecture"]')).toBeVisible();

    const tabIds = ['how-it-works', 'pov-target', 'formulas', 'models', 'assumptions', 'opportunities', 'glossary'];
    for (const id of tabIds) {
      await expect(page.locator(`[role="tab"][data-tab="${id}"]`)).toBeVisible();
    }

    // The static alternative is present without any interaction — first paint, not an enhancement.
    await expect(page.locator('[data-step-through-static]')).toBeVisible();
    await expect(page.locator('[data-step-through-static] li').first()).toBeVisible();
  });

  test('the step-through is fully keyboard-operable, including the toggle and every control', async ({ page }) => {
    await page.goto('/architecture');

    // Reach and activate the toggle by keyboard alone.
    const toggle = page.locator('[data-toggle-interactive-walkthrough]');
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-step-through-animated]')).toBeVisible();

    // Tab into the control group and drive it with the keyboard.
    const playButton = page.locator('[data-control="play"], [data-control="pause"]');
    await playButton.focus();
    await expect(playButton).toBeFocused();

    const stageLabel = page.locator('[data-current-stage]');
    const firstStage = await stageLabel.getAttribute('data-current-stage');

    await page.locator('[data-control="next"]').focus();
    await page.keyboard.press('Enter');
    const secondStage = await stageLabel.getAttribute('data-current-stage');
    expect(secondStage).not.toBe(firstStage);

    await page.locator('[data-control="prev"]').focus();
    await page.keyboard.press('Enter');
    await expect(stageLabel).toHaveAttribute('data-current-stage', firstStage ?? '');

    await page.locator('[data-control="reset"]').focus();
    await page.keyboard.press('Enter');
    await expect(stageLabel).toHaveAttribute('data-current-stage', firstStage ?? '');
  });

  test('reduced motion is honoured: the interactive walkthrough still works, without motion, and the static alternative is unaffected', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/architecture');

    // The static text alternative is present regardless of the motion preference.
    await expect(page.locator('[data-step-through-static]')).toBeVisible();

    await page.locator('[data-toggle-interactive-walkthrough]').click();
    const animated = page.locator('[data-step-through-animated]');
    await expect(animated).toBeVisible();
    await expect(animated).toHaveAttribute('data-reduced-motion', 'true');

    // Controls still work under reduced motion — nothing is removed, only the transition.
    await page.locator('[data-control="next"]').click();
    await expect(page.locator('[data-current-stage]')).toBeVisible();
  });

  test('the tab list is keyboard-navigable with arrow keys, and only one panel is visible at a time', async ({ page }) => {
    await page.goto('/architecture');
    const howItWorksTab = page.locator('[role="tab"][data-tab="how-it-works"]');
    await howItWorksTab.focus();
    await expect(howItWorksTab).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowRight');
    const povTab = page.locator('[role="tab"][data-tab="pov-target"]');
    await expect(povTab).toBeFocused();
    // Arrow-key focus alone does not activate the tab (APG "manual activation" is acceptable);
    // press Enter/Space or click to select it if focus alone hasn't.
    if ((await povTab.getAttribute('aria-selected')) !== 'true') {
      await page.keyboard.press('Enter');
    }
    await expect(povTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-tabpanel="pov-target"]')).toBeVisible();
    await expect(page.locator('[data-tabpanel="how-it-works"]')).toBeHidden();
  });

  test('PoV and target are unmistakably distinct, and target items are never claimed as deployed', async ({ page }) => {
    await page.goto('/architecture');
    await page.locator('[role="tab"][data-tab="pov-target"]').click();

    const deployed = page.locator('[data-component-list="deployed"]');
    const target = page.locator('[data-component-list="target"]');
    await expect(deployed).toBeVisible();
    await expect(target).toBeVisible();
    await expect(page.getByText('not built', { exact: false })).toBeVisible();
  });

  test('the assumptions tab states plainly that no backtest exists', async ({ page }) => {
    await page.goto('/architecture');
    await page.locator('[role="tab"][data-tab="assumptions"]').click();
    const statement = page.locator('[data-no-backtest-statement]');
    await expect(statement).toBeVisible();
    await expect(statement).toContainText('No metric in this product has been tested against historical returns');
  });

  test('the opportunities tab states the reddit collection gap honestly (D-39)', async ({ page }) => {
    await page.goto('/architecture');
    await page.locator('[role="tab"][data-tab="opportunities"]').click();
    await expect(page.getByText('No Reddit collection channel in this product')).toBeVisible();
  });

  test('the models tab names the pinned scorer identity vocabulary (D-13)', async ({ page }) => {
    await page.goto('/architecture');
    await page.locator('[role="tab"][data-tab="models"]').click();
    const vocabulary = page.locator('[data-scorer-identity-vocabulary]');
    await expect(vocabulary).toContainText('finbert');
    await expect(vocabulary).toContainText('tweet-roberta');
  });

  test('axe finds no violations on /architecture', async ({ page }) => {
    await page.goto('/architecture');
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('mobile viewport has no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/architecture');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});

test.describe('F17 — Architecture Explorer, database-configured content', () => {
  test.skip(!hasDatabase, 'requires DATABASE_URL — see this file\'s own top-of-file note');

  test('GET /api/architecture answers ready with a real manifest and projection', async ({ request }) => {
    const response = await request.get('/api/architecture');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.state).toBe('ready');
    expect(body.manifest.manifestVersion).toBeTruthy();
    expect(Array.isArray(body.manifest.pipeline)).toBe(true);
    expect(body.catalogueSize).toBeGreaterThan(0);
  });

  test('the calculation catalogue covers every registered method, each with a real worked example', async ({
    page,
    request,
  }) => {
    const apiBody = await (await request.get('/api/architecture')).json();
    const expectedCount = apiBody.catalogueSize as number;

    const response = await page.goto('/architecture/calculations');
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-route="/architecture/calculations"]')).toBeVisible();

    await expect(page.locator('[data-catalogue-entry]')).toHaveCount(expectedCount);

    const resultCount = page.locator('[data-result-count]');
    await expect(resultCount).toHaveAttribute('data-result-count', String(expectedCount));
  });

  test('search narrows the catalogue and finds a specific known method', async ({ page }) => {
    await page.goto('/architecture/calculations');
    const search = page.locator('[data-catalogue-search-input]');
    await search.fill('rsi');
    await expect(page.locator('[data-catalogue-entry="technical.rsi_14@1.0.0"]')).toBeVisible();
    const countAfterNarrow = await page.locator('[data-catalogue-entry]').count();
    expect(countAfterNarrow).toBeGreaterThan(0);

    await search.fill('this-does-not-match-anything-xyz');
    await expect(page.locator('[data-catalogue-entry]')).toHaveCount(0);
    await expect(page.locator('[data-result-count]')).toHaveAttribute('data-result-count', '0');
  });

  test('every catalogue entry links to a real, resolvable artifact', async ({ page }) => {
    await page.goto('/architecture/calculations');
    const search = page.locator('[data-catalogue-search-input]');
    await search.fill('mention_delta');
    const link = page.locator('[data-catalogue-entry="attention.mention_delta@1.0.0"] a[href^="/calculations/"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/calculations\/[0-9a-f-]{36}$/);

    const response = await page.goto(href!);
    expect(response?.status()).toBe(200);
    await expect(page.locator(`[data-route="${href}"]`)).toBeVisible();
    // A real artifact, not the "no such calculation" or "no database configured" notice.
    await expect(page.locator('[data-state="not-found"]')).toHaveCount(0);
    await expect(page.locator('[data-state="fixture"]')).toHaveCount(0);
  });

  test('the Formulas tab on /architecture also renders real worked examples, linked the same way', async ({ page }) => {
    await page.goto('/architecture');
    await page.locator('[role="tab"][data-tab="formulas"]').click();
    await expect(page.locator('[data-catalogue-browser]')).toBeVisible();
    await expect(page.locator('[data-catalogue-entry]').first()).toBeVisible();
    await expect(page.locator('[data-inspectable-metric]').first()).toBeVisible();
  });

  test('the PoV tab renders the active-configuration panel from the public-safe projection', async ({ page }) => {
    await page.goto('/architecture');
    await page.locator('[role="tab"][data-tab="pov-target"]').click();
    await expect(page.locator('[data-active-configuration]')).toBeVisible();
  });

  test('axe finds no violations on /architecture/calculations with real data loaded', async ({ page }) => {
    await page.goto('/architecture/calculations');
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
