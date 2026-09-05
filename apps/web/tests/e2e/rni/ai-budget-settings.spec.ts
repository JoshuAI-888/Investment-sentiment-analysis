import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const initialSetting = {
  configVersion: '1',
  aiRoute: 'openai_direct',
  effectiveAt: '2026-09-05T12:00:00.000Z',
  budgets: {
    manualRunHardUsd: '2',
    fullUniverseHardUsd: '25',
    rolling24hHardUsd: '50',
    monthlyWarningUsd: '300',
    monthlyHardUsd: '500',
    currency: 'USD',
  },
  resolvedModels: [
    {
      task: 'rni_verification',
      provider: 'openai',
      modelId: 'gpt-5.6-sol',
      modelRevision: 'revision-1',
      promptVersion: 'rni-verification-v1',
    },
  ],
  options: [
    { aiRoute: 'openai_direct', available: true, unavailableReason: null },
    { aiRoute: 'vercel_ai_gateway', available: false, unavailableReason: 'Not configured.' },
  ],
};
const changedBudgets = {
  manualRunHardUsd: '1',
  fullUniverseHardUsd: '10',
  rolling24hHardUsd: '20',
  monthlyWarningUsd: '100',
  monthlyHardUsd: '200',
  currency: 'USD',
};
const budgetUrl = 'https://app.test/api/rni/settings/budgets';
let browserBundle: string;

// Exercise the actual live client in Chromium without a database, auth fixture or dev server.
// Vite is the already-installed Vitest runtime; the browser bundle is kept in memory only.
test.beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const testRuntime = createRequire(require.resolve('vitest/package.json'));
  type BuildOutput = { output: { type: string; code?: string }[] };
  const { build } = (await import(pathToFileURL(testRuntime.resolve('vite')).href)) as {
    build(options: Record<string, unknown>): Promise<BuildOutput | BuildOutput[]>;
  };
  const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/u, '');
  const component = fileURLToPath(
    new URL('../../../src/rni/ui/AiRouteSettingsLiveHarness.tsx', import.meta.url),
  );
  const entry = `${root}/__rni_budget_browser_entry.tsx`;
  const result = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: { alias: { '@': `${root}/src` } },
    esbuild: { jsx: 'automatic' },
    plugins: [
      {
        name: 'rni-budget-browser-entry',
        resolveId: (id: string) => (id === entry ? entry : null),
        load: (id: string) =>
          id === entry
            ? `
        import { createElement } from 'react';
        import { createRoot } from 'react-dom/client';
        import { AiRouteSettingsLiveHarness } from ${JSON.stringify(component)};
        window.mountSettings = (initialSetting) => createRoot(document.getElementById('root')).render(
          createElement(AiRouteSettingsLiveHarness, { initialSetting })
        );`
            : null,
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry, name: 'RniBudgetTest', formats: ['iife'] },
    },
  });
  browserBundle = (Array.isArray(result) ? result : [result])
    .flatMap((output) => output.output)
    .filter((chunk) => chunk.type === 'chunk')
    .map((chunk) => chunk.code ?? '')
    .join('\n');
  expect(browserBundle.length).toBeGreaterThan(0);
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.route('https://app.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><head><title>AI budget component test</title></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('https://app.test/');
  await page.addScriptTag({ content: browserBundle });
  await page.evaluate((setting) => {
    (window as unknown as { mountSettings(input: typeof initialSetting): void }).mountSettings(
      setting,
    );
  }, initialSetting);
  await expect(page.getByRole('heading', { name: 'AI budgets for future runs' })).toBeVisible();
});

async function fillBudgets(page: Page) {
  for (const [name, value] of Object.entries(changedBudgets)) {
    if (name !== 'currency') await page.locator(`input[name="${name}"]`).fill(value);
  }
  await page.getByLabel('Reason for budget change').fill('Lower future spending');
}

function receipt(key: string, budgets = changedBudgets, disposition = 'accepted') {
  return {
    data: {
      disposition,
      idempotencyKey: key,
      previousConfigVersion: '1',
      setting: { ...initialSetting, configVersion: '2', budgets },
    },
  };
}

test('five accessible budget inputs expose ceilings and keyboard order', async ({ page }) => {
  const labels = [
    'Manual ticker run limit (USD)',
    'Full-universe run limit (USD)',
    'Rolling 24-hour limit (USD)',
    'Calendar-month warning (USD)',
    'Calendar-month hard stop (USD)',
  ];
  const ceilings = ['2', '25', '50', '300', '500'];
  for (const [index, label] of labels.entries()) {
    const field = page.getByRole('spinbutton', { name: label, exact: true });
    await expect(field).toHaveAttribute('max', ceilings[index]!);
    await expect(field).toHaveAttribute('min', '0.01');
    await expect(field).toHaveAttribute('step', '0.01');
    await expect(field).toHaveAccessibleDescription(/Approved maximum: USD/);
  }
  await page.getByLabel(labels[0]!, { exact: true }).focus();
  for (const label of labels.slice(1)) {
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(label, { exact: true })).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Reason for budget change')).toBeFocused();
  await expect(
    page.getByText(
      /manual ticker ≤ full universe ≤ rolling 24 hours ≤ monthly warning < monthly hard stop/,
    ),
  ).toBeVisible();
});

test('ordered validation and ceilings fail visibly before any request', async ({ page }) => {
  let calls = 0;
  await page.route(budgetUrl, async (route) => {
    calls++;
    await route.abort();
  });
  await fillBudgets(page);
  await page.getByLabel('Full-universe run limit (USD)', { exact: true }).fill('0.50');
  await page.getByRole('button', { name: 'Save budgets for future runs' }).click();
  await expect(page.getByRole('alert')).toContainText('Keep limits ordered');
  await expect(page.getByLabel('Full-universe run limit (USD)', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByLabel('Full-universe run limit (USD)', { exact: true }).fill('10');
  await page.getByLabel('Manual ticker run limit (USD)', { exact: true }).fill('2.01');
  await page.getByRole('button', { name: 'Save budgets for future runs' }).click();
  await expect(page.getByRole('alert')).toContainText('within each maximum');
  expect(calls).toBe(0);
});

test('saves only budget intent and displays the accepted future configuration', async ({
  page,
}) => {
  await page.route(budgetUrl, async (route) => {
    const request = route.request();
    expect(request.method()).toBe('PATCH');
    expect(request.postDataJSON()).toEqual({
      reason: 'Lower future spending',
      budgets: changedBudgets,
    });
    expect(request.headers()['idempotency-key']).toMatch(/^[a-f0-9-]{36}$/);
    await route.fulfill({ json: receipt(request.headers()['idempotency-key']!) });
  });
  await fillBudgets(page);
  await page.getByRole('button', { name: 'Save budgets for future runs' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Accepted budget settings now apply from configuration 2.',
  );
  await expect(
    page.getByText('Previous configuration: 1. Existing runs remain unchanged.'),
  ).toBeVisible();
  await expect(page.getByLabel('Manual ticker run limit (USD)', { exact: true })).toHaveValue('1');
});

test('an ambiguous failure retries the same key and body and accepts duplicate receipt', async ({
  page,
}) => {
  const requests: { key: string; body: string | null }[] = [];
  await page.route(budgetUrl, async (route) => {
    const key = route.request().headers()['idempotency-key']!;
    requests.push({ key, body: route.request().postData() });
    if (requests.length === 1) await route.abort('failed');
    else await route.fulfill({ json: receipt(key, changedBudgets, 'duplicate') });
  });
  await fillBudgets(page);
  await page.getByRole('button', { name: 'Save budgets for future runs' }).click();
  await expect(page.getByRole('alert')).toContainText('Retry the same change safely');
  await page.getByRole('button', { name: 'Save budgets for future runs' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Duplicate budget settings now apply from configuration 2.',
  );
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test('editing a failed intent allocates a new key', async ({ page }) => {
  const keys: string[] = [];
  await page.route(budgetUrl, async (route) => {
    keys.push(route.request().headers()['idempotency-key']!);
    await route.abort();
  });
  await fillBudgets(page);
  await page.getByRole('button', { name: 'Save budgets for future runs' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Reason for budget change').fill('A distinct future budget change');
  await page.getByRole('button', { name: 'Save budgets for future runs' }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).not.toBe(keys[0]);
});

test('blocks repeated submission and editing while a budget command is in flight', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route(budgetUrl, async (route) => {
    calls++;
    await gate;
    await route.fulfill({ json: receipt(route.request().headers()['idempotency-key']!) });
  });
  await fillBudgets(page);
  await page.getByRole('button', { name: 'Save budgets for future runs' }).click();
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByLabel('Reason for budget change')).toBeDisabled();
  await expect(page.getByLabel('Manual ticker run limit (USD)', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save budgets for future runs' })).toBeDisabled();
  await page
    .locator('form')
    .last()
    .evaluate((form) => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  release!();
  await expect(page.getByRole('status')).toContainText('Accepted budget settings');
  expect(calls).toBe(1);
});

test('shows a safe failure without exposing a provider response body', async ({ page }) => {
  await page.route(budgetUrl, (route) =>
    route.fulfill({ status: 503, body: 'secret-token private-provider-response' }),
  );
  await fillBudgets(page);
  await page.getByRole('button', { name: 'Save budgets for future runs' }).click();
  await expect(page.getByRole('alert')).toContainText('Retry the same change safely');
  await expect(page.locator('body')).not.toContainText('secret-token');
  await expect(page.locator('body')).not.toContainText('private-provider-response');
});

for (const crossing of ['key', 'budgets'] as const) {
  test(`rejects a crossed ${crossing} receipt without relabelling the active setting`, async ({
    page,
  }) => {
    await page.route(budgetUrl, async (route) =>
      route.fulfill({
        json: receipt(
          crossing === 'key' ? 'another-command' : route.request().headers()['idempotency-key']!,
          crossing === 'budgets' ? { ...changedBudgets, manualRunHardUsd: '0.50' } : changedBudgets,
        ),
      }),
    );
    await fillBudgets(page);
    await page.getByRole('button', { name: 'Save budgets for future runs' }).click();
    await expect(page.getByRole('alert')).toContainText('could not be saved');
    await expect(
      page.getByText('Current future-run configuration: 1, effective at', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
  });
}
