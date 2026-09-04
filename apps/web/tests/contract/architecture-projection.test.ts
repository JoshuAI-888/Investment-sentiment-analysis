import { describe, expect, it } from 'vitest';
import type { AppSetting, ModelRoute } from '@/contracts/config';
import {
  projectSettings,
  projectModelRoutes,
  PUBLIC_SAFE_SETTING_KEYS,
} from '@/services/architecture/projection';

/**
 * F17 §4.2/§6/§7 step 2 — "the projection is an allowlist, not a redaction pass... CI asserts
 * the projection contains no restricted field, by allowlist comparison rather than by pattern
 * matching." This test constructs deliberately hostile input — rows naming restricted keys and
 * rows carrying every field the underlying tables actually have — and asserts none of it
 * survives projection, so the allowlist is proven by construction rather than by trusting the
 * caller only ever passes safe rows.
 */

function appSetting(overrides: Partial<AppSetting>): AppSetting {
  return {
    configVersion: '1',
    settingKey: 'trigger.price_move_pct',
    scopeType: 'global',
    scopeId: '',
    value: '3.00',
    valueType: 'decimal',
    governanceClass: 'trigger',
    settingSchemaVersion: '1',
    methodAffecting: false,
    sensitive: false,
    ...overrides,
  };
}

function modelRoute(overrides: Partial<ModelRoute>): ModelRoute {
  return {
    configVersion: '1',
    task: 'relevance',
    transport: 'batch_api',
    primaryProvider: 'openai',
    primaryModel: 'gpt-5-mini',
    modelRevision: 'gpt-5-mini-2026-01-01',
    fallbackChain: [],
    promptVersion: '1',
    schemaVersion: '1',
    calibrationVersion: null,
    temperature: '0.00',
    maxInputTokens: 8000,
    maxOutputTokens: 500,
    timeoutMs: 30000,
    maxCostUsd: '0.05',
    allowedDataClasses: [],
    shadowModel: null,
    canaryPercent: '0.00',
    evaluationRunId: null,
    enabled: true,
    ...overrides,
  };
}

describe('architecture projection — settings allowlist', () => {
  it('never emits a setting key outside the allowlist, even when one is present in the raw rows', () => {
    const rows = [
      appSetting({ settingKey: 'trigger.price_move_pct', value: '4.50' }),
      // A restricted-shaped key that is NOT in the allowlist — a real admin secret would never
      // reach `app_setting` (the DB rejects `sensitive: true`), but an operational or internal
      // key genuinely could exist here without being public-safe.
      appSetting({ settingKey: 'internal.db_pool_size', value: '10', governanceClass: 'operational' }),
      appSetting({ settingKey: 'internal.admin_session_secret_prefix', value: 'sk_live_', governanceClass: 'operational' }),
    ];

    const projected = projectSettings(rows);

    expect(projected.map((entry) => entry.key).every((key) => PUBLIC_SAFE_SETTING_KEYS.has(key))).toBe(true);
    expect(projected.some((entry) => entry.key === 'internal.db_pool_size')).toBe(false);
    expect(projected.some((entry) => entry.key === 'internal.admin_session_secret_prefix')).toBe(false);
    expect(JSON.stringify(projected)).not.toContain('sk_live_');
  });

  it('a settings row with no matching allowlist entry contributes nothing — the output size is fixed by the allowlist, not by the input', () => {
    const projected = projectSettings([appSetting({ settingKey: 'not.in.allowlist', value: 'anything' })]);
    expect(projected).toHaveLength(PUBLIC_SAFE_SETTING_KEYS.size);
    expect(projected.some((entry) => entry.key === 'not.in.allowlist')).toBe(false);
  });

  it('an allowlisted key with no row yet still renders — as unset, never fabricated', () => {
    const projected = projectSettings([]);
    const priceThreshold = projected.find((entry) => entry.key === 'trigger.price_move_pct');
    expect(priceThreshold?.value).toBeNull();
    expect(priceThreshold?.governanceClass).toBe('unset');
  });

  it('adversarial (PR review step 2): a widened allowlist is the only way a new field could ever appear — proven by an unlisted key never leaking regardless of what the row carries', () => {
    const hostileRow = appSetting({
      settingKey: 'ADMIN_EMAIL_ALLOWLIST', // if this ever became a settings-table row by mistake
      value: 'owner@example.com',
      governanceClass: 'admin',
    });
    const projected = projectSettings([hostileRow]);
    expect(JSON.stringify(projected)).not.toContain('owner@example.com');
    expect(JSON.stringify(projected)).not.toContain('ADMIN_EMAIL_ALLOWLIST');
  });
});

describe('architecture projection — model route allowlist', () => {
  it('never emits maxCostUsd, canaryPercent, evaluationRunId, shadowModel, fallbackChain, allowedDataClasses, calibrationVersion, temperature, token/timeout limits — only the descriptive fields', () => {
    const rows = [
      modelRoute({
        maxCostUsd: '999.99',
        canaryPercent: '50.00',
        evaluationRunId: '11111111-1111-4111-8111-111111111111',
        shadowModel: { provider: 'anthropic', model: 'claude-shadow' },
        fallbackChain: [{ provider: 'anthropic', model: 'claude-fallback' }],
        allowedDataClasses: ['restricted'],
        calibrationVersion: 'calib-9',
      }),
    ];
    const projected = projectModelRoutes(rows);
    expect(projected).toHaveLength(1);
    const json = JSON.stringify(projected);
    expect(json).not.toContain('999.99');
    expect(json).not.toContain('50.00');
    expect(json).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(json).not.toContain('claude-shadow');
    expect(json).not.toContain('claude-fallback');
    expect(json).not.toContain('restricted');
    expect(json).not.toContain('calib-9');
    expect(Object.keys(projected[0] ?? {}).sort()).toEqual(
      ['enabled', 'modelRevision', 'primaryModel', 'primaryProvider', 'promptVersion', 'schemaVersion', 'task', 'transport'].sort(),
    );
  });

  it('drops a route whose task is not in the live MODEL_TASKS vocabulary, rather than rendering it as though it were real', () => {
    const projected = projectModelRoutes([modelRoute({ task: 'not_a_real_task' })]);
    expect(projected).toHaveLength(0);
  });
});
