import { expect, test } from '@playwright/test';
import {
  createFixtureRniAiRouteSettingsService,
  FixtureRniAiRouteSettingsService,
} from '../../../fixtures/rni-ui/read-service';
import { referenceRun } from '@/rni/testing/reference-fixtures';

test('fixture route settings preserve historical lineage and enforce idempotent future intent', async () => {
  const service = createFixtureRniAiRouteSettingsService();
  const historicalRun = structuredClone(referenceRun);
  const before = await service.getCurrentAiRouteSetting();
  const accepted = await service.updateFutureAiRoute({
    idempotencyKey: 'surface-ai-route-gateway-1',
    aiRoute: 'vercel_ai_gateway',
    reason: 'Exercise the configured Gateway route.',
  });
  const duplicate = await service.updateFutureAiRoute({
    idempotencyKey: 'surface-ai-route-gateway-1',
    aiRoute: 'vercel_ai_gateway',
    reason: 'Exercise the configured Gateway route.',
  });
  const after = await service.getCurrentAiRouteSetting();

  expect(before).toMatchObject({ configVersion: 'fixture-config-v1', aiRoute: 'openai_direct' });
  expect(accepted).toMatchObject({
    disposition: 'accepted',
    previousConfigVersion: before.configVersion,
    setting: { configVersion: 'fixture-config-v2', aiRoute: 'vercel_ai_gateway' },
  });
  expect(accepted.setting.resolvedModels.every(({ modelId }) => modelId.includes('/'))).toBe(true);
  expect(duplicate).toEqual({ ...accepted, disposition: 'duplicate' });
  expect(after).toEqual(accepted.setting);
  expect(historicalRun).toMatchObject({
    configVersion: 'fixture-config-v1',
    aiRoute: 'openai_direct',
  });
  await expect(
    service.updateFutureAiRoute({
      idempotencyKey: 'surface-ai-route-gateway-1',
      aiRoute: 'openai_direct',
      reason: 'Cross the idempotency intent.',
    }),
  ).rejects.toThrow(/idempotency key was reused/u);
});

test('fixture route settings reject unavailable Gateway selection', async () => {
  const service = new FixtureRniAiRouteSettingsService({ gatewayAvailable: false });
  const setting = await service.getCurrentAiRouteSetting();
  expect(setting.options.find(({ aiRoute }) => aiRoute === 'vercel_ai_gateway')).toMatchObject({
    available: false,
    unavailableReason: 'Gateway is not configured for this fixture.',
  });
  await expect(
    service.updateFutureAiRoute({
      idempotencyKey: 'surface-ai-route-unavailable-1',
      aiRoute: 'vercel_ai_gateway',
      reason: 'Attempt unavailable route.',
    }),
  ).rejects.toThrow(/route is unavailable/u);
});

test('RNI AI route settings show task models and switch only future configuration', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await page.goto('/rni/fixture/settings/ai-route');

  await expect(page.getByText('Current future-run configuration: fixture-config-v1')).toBeVisible();
  await expect(page.getByText('OpenAI Direct is selected for future RNI runs.')).toBeVisible();
  await expect(page.getByText('rni_verification')).toBeVisible();
  await expect(page.getByText('rni_challenger')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Vercel AI Gateway/ })).toBeEnabled();
  await expect(page.getByText('Existing runs and their recorded model lineage do not change.')).toBeVisible();

  await page.getByRole('radio', { name: /Vercel AI Gateway/ }).check();
  await page.getByLabel('Change reason').fill('Exercise configured Gateway for later fixture runs.');
  await page.getByRole('button', { name: 'Use Vercel AI Gateway for future runs' }).click();

  await expect(page.getByRole('status')).toContainText(
    'Accepted route setting: Vercel AI Gateway now applies from configuration fixture-config-v2.',
  );
  await expect(page.getByText('Previous configuration: fixture-config-v1.')).toBeVisible();
  await expect(page.getByText('OpenAI Direct is selected for future RNI runs.')).not.toBeVisible();
  await expect(page.getByText('Vercel AI Gateway is selected for future RNI runs.')).toBeVisible();
  await expect(page.getByText('openai/fixture-rni-model', { exact: true }).first()).toBeVisible();
  expect(
    await page.locator('main').evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
