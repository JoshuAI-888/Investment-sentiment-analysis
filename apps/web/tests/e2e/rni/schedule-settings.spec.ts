import AxeBuilder from '@axe-core/playwright';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { ScheduleSetting } from '@/rni/settings/schedule/schemas';

const scheduleUrl = 'https://app.test/api/rni/schedules';
const jobId = '00000000-0000-4000-8000-000000000009';

function nextRuns(startHour = 1, timezone = 'UTC'): ScheduleSetting['nextRuns'] {
  return Array.from({ length: 5 }, (_, index) => ({
    dueAt: `2026-09-05T${String(startHour + index).padStart(2, '0')}:00:00.000Z`,
    localTime: `05 Sept 2026 ${String(startHour + index).padStart(2, '0')}:00`,
    timezone,
  })) as ScheduleSetting['nextRuns'];
}

const initialSetting: ScheduleSetting = {
  jobId,
  version: 1,
  enabled: true,
  scheduleType: 'interval',
  scheduleExpression: '3600',
  displayTimezone: 'UTC',
  scope: { kind: 'full_universe' },
  nextDueAt: '2026-09-05T01:00:00.000Z',
  nextRuns: nextRuns(),
  observedAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
  updatedBy: 'schedule-admin',
};

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
    new URL('../../../src/rni/ui/ScheduleSettingsLiveHarness.tsx', import.meta.url),
  );
  const entry = `${root}/__rni_schedule_browser_entry.tsx`;
  const result = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: { alias: { '@': `${root}/src` } },
    esbuild: { jsx: 'automatic' },
    plugins: [
      {
        name: 'rni-schedule-browser-entry',
        resolveId: (id: string) => (id === entry ? entry : null),
        load: (id: string) =>
          id === entry
            ? `
        import { createElement } from 'react';
        import { createRoot } from 'react-dom/client';
        import { ScheduleSettingsLiveHarness } from ${JSON.stringify(component)};
        const root = createRoot(document.getElementById('root'));
        let mountId = 0;
        window.mountScheduleSettings = (initialSetting) => root.render(
          createElement(ScheduleSettingsLiveHarness, {
            initialSetting,
            key: String(++mountId),
          })
        );`
            : null,
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry, name: 'RniScheduleTest', formats: ['iife'] },
    },
  });
  browserBundle = (Array.isArray(result) ? result : [result])
    .flatMap((output) => output.output)
    .filter((chunk) => chunk.type === 'chunk')
    .map((chunk) => chunk.code ?? '')
    .join('\n');
  expect(browserBundle.length).toBeGreaterThan(0);
});

async function mount(page: Page, setting: ScheduleSetting) {
  await page.evaluate((input) => {
    (
      window as unknown as {
        mountScheduleSettings(value: ScheduleSetting): void;
      }
    ).mountScheduleSettings(input);
  }, setting);
  await expect(page.getByRole('heading', { name: 'Refresh schedule', level: 1 })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.route('https://app.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><head><title>Schedule component test</title></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('https://app.test/');
  await page.addScriptTag({ content: browserBundle });
  await mount(page, initialSetting);
});

function changedSetting(
  version: number,
  input: {
    enabled: boolean;
    scheduleType: 'interval' | 'cron';
    scheduleExpression: string;
    displayTimezone: string;
  },
): ScheduleSetting {
  return {
    ...initialSetting,
    enabled: input.enabled,
    scheduleType: input.scheduleType,
    scheduleExpression: input.scheduleExpression,
    displayTimezone: input.displayTimezone,
    version,
    nextDueAt: '2026-09-05T02:00:00.000Z',
    nextRuns: nextRuns(2, input.displayTimezone),
    observedAt: '2026-09-05T01:00:00.000Z',
    updatedAt: '2026-09-05T01:00:00.000Z',
  };
}

function receipt(
  key: string,
  setting: ScheduleSetting,
  disposition: 'accepted' | 'duplicate' = 'accepted',
) {
  return { data: { disposition, idempotencyKey: key, setting } };
}

async function enterCronChange(page: Page, reason = 'Use a quarter-hour cadence') {
  await page.getByLabel('Cadence type').selectOption('cron');
  await page.getByLabel('Cron expression').fill('*/15 * * * *');
  await page.getByLabel('IANA timezone').fill('Pacific/Auckland');
  await page.getByLabel('Change reason').fill(reason);
}

test('renders five saved times and switches interval/cron controls without hiding pause semantics', async ({
  page,
}) => {
  const preview = page.getByRole('region', { name: 'Saved schedule: next five times' });
  await expect(preview.getByRole('listitem')).toHaveCount(5);
  await expect(preview.locator('time')).toHaveCount(5);
  await expect(preview.locator('time').first()).toHaveAttribute(
    'datetime',
    '2026-09-05T01:00:00.000Z',
  );
  await expect(preview.getByText('05 Sept 2026 01:00 (UTC)')).toBeVisible();
  await expect(page.getByLabel('Interval seconds')).toHaveValue('3600');

  await page.getByLabel('Cadence type').selectOption('cron');
  await expect(page.getByLabel('Cron expression')).toBeVisible();
  await expect(page.getByText(/Cron previews must be at least five minutes apart/u)).toBeVisible();

  await mount(page, { ...initialSetting, enabled: false });
  await expect(page.getByText('Version 1 · Paused', { exact: false })).toBeVisible();
  await expect(
    page.getByText('Paused. These are projections only; no scheduled work will start.'),
  ).toBeVisible();
  await expect(page.getByText(/Changes affect future schedule fires only/u)).toBeVisible();
  await expect(
    page.getByText(/Saving or resuming recalculates the next fire forward from the save time/u),
  ).toBeVisible();
});

test('retries an ambiguous save with the exact same intent body and idempotency key', async ({
  page,
}) => {
  const expectedBody = {
    expectedVersion: 1,
    enabled: true,
    scheduleType: 'cron',
    scheduleExpression: '*/15 * * * *',
    displayTimezone: 'Pacific/Auckland',
    reason: 'Use a quarter-hour cadence',
  } as const;
  const requests: { key: string; body: string | null; json: unknown }[] = [];
  const saved = changedSetting(2, expectedBody);
  await page.route(scheduleUrl, async (route) => {
    const request = route.request();
    const key = request.headers()['idempotency-key']!;
    requests.push({ key, body: request.postData(), json: request.postDataJSON() });
    expect(request.method()).toBe('POST');
    if (requests.length === 1) await route.abort('failed');
    else await route.fulfill({ json: receipt(key, saved, 'duplicate') });
  });

  await enterCronChange(page);
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByRole('alert')).toContainText('Retry the same change safely');
  await page.getByRole('button', { name: 'Save schedule' }).click();

  await expect(page.getByRole('status')).toContainText('This change was already saved');
  expect(requests).toHaveLength(2);
  expect(requests[0]!.json).toEqual(expectedBody);
  expect(requests[0]!.key).toMatch(/^[a-f0-9-]{36}$/u);
  expect(requests[1]).toEqual(requests[0]);
  await expect(page.getByText('Version 2 · Active', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Cron expression')).toHaveValue('*/15 * * * *');
});

test('locks a conflicted editor until reload and resumes from the server version', async ({
  page,
}) => {
  const latest = changedSetting(2, {
    enabled: false,
    scheduleType: 'cron',
    scheduleExpression: '0 * * * *',
    displayTimezone: 'Pacific/Auckland',
  });
  let postCount = 0;
  let acceptedBody: unknown;
  await page.route(scheduleUrl, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ json: { data: latest } });
      return;
    }
    postCount++;
    if (postCount === 1) {
      await route.fulfill({ status: 409, json: { error: { code: 'CONFLICT' } } });
      return;
    }
    acceptedBody = request.postDataJSON();
    const body = acceptedBody as {
      enabled: boolean;
      scheduleType: 'interval' | 'cron';
      scheduleExpression: string;
      displayTimezone: string;
    };
    await route.fulfill({
      json: receipt(request.headers()['idempotency-key']!, changedSetting(3, body)),
    });
  });

  await enterCronChange(page, 'First edit conflicts');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByRole('alert')).toContainText('Reload the latest schedule before editing');
  await expect(page.getByLabel('Enable scheduled refreshes')).toBeDisabled();
  await expect(page.getByLabel('Cadence type')).toBeDisabled();
  await expect(page.getByLabel('Change reason')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save schedule' })).toBeDisabled();

  await page.getByRole('button', { name: 'Reload latest schedule' }).click();
  await expect(page.getByRole('status')).toContainText('Latest schedule loaded');
  await expect(page.getByText('Version 2 · Paused', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Cadence type')).toHaveValue('cron');
  await expect(page.getByLabel('Cron expression')).toHaveValue('0 * * * *');
  await expect(page.getByLabel('Change reason')).toBeEnabled();

  await page.getByLabel('Change reason').fill('Resume from the latest saved version');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByRole('status')).toContainText('Schedule saved');
  expect(acceptedBody).toEqual({
    expectedVersion: 2,
    enabled: false,
    scheduleType: 'cron',
    scheduleExpression: '0 * * * *',
    displayTimezone: 'Pacific/Auckland',
    reason: 'Resume from the latest saved version',
  });
  await expect(page.getByText('Version 3 · Paused', { exact: false })).toBeVisible();
});

for (const responseKind of ['malformed', 'crossed'] as const) {
  test(`fails safely on a ${responseKind} save response without relabelling the saved version`, async ({
    page,
  }) => {
    await page.route(scheduleUrl, async (route) => {
      if (responseKind === 'malformed') {
        await route.fulfill({
          contentType: 'application/json',
          body: '{"data":',
        });
        return;
      }
      const key = route.request().headers()['idempotency-key']!;
      await route.fulfill({
        json: receipt(
          key,
          changedSetting(2, {
            enabled: true,
            scheduleType: 'cron',
            scheduleExpression: '30 * * * *',
            displayTimezone: 'Pacific/Auckland',
          }),
        ),
      });
    });

    await enterCronChange(page);
    await page.getByRole('button', { name: 'Save schedule' }).click();
    await expect(page.getByRole('alert')).toContainText('could not be saved');
    await expect(page.getByText('Version 1 · Active', { exact: false })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
  });
}

test('has labelled keyboard controls, no scoped accessibility violations and no narrow overflow', async ({
  page,
}) => {
  await expect(page.locator('main h1')).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Cadence and timezone' })).toBeVisible();
  await expect(page.getByLabel('Interval seconds')).toHaveAccessibleDescription(
    /Intervals: 300–31536000 seconds/u,
  );

  await page.getByLabel('Enable scheduled refreshes').focus();
  for (const label of ['Cadence type', 'Interval seconds', 'IANA timezone', 'Change reason']) {
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(label)).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Save schedule' })).toBeFocused();

  const results = await new AxeBuilder({ page }).include('main').analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  const [scrollWidth, clientWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});
