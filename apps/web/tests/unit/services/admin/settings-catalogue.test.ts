/**
 * F15 §4.2/§5 — the allowlisted key catalogue and its per-key validators.
 */
import { describe, expect, it } from 'vitest';
import { findCatalogueEntry, SETTINGS_CATALOGUE } from '@/services/admin/settings-catalogue';
import { updateSettingMutation } from '@/services/admin/settings';

describe('SETTINGS_CATALOGUE — the key allowlist', () => {
  it('every entry validates its own default value', () => {
    for (const entry of SETTINGS_CATALOGUE) {
      const result = entry.schema.safeParse(entry.defaultValue);
      expect(result.success, `default for ${entry.key} must validate against its own schema`).toBe(true);
    }
  });

  it('D-15 trigger thresholds are present and operator-editable', () => {
    expect(findCatalogueEntry('trigger.price_move_pct')).toBeDefined();
    expect(findCatalogueEntry('trigger.window_minutes')).toBeDefined();
    expect(findCatalogueEntry('trigger.x_reads_per_event')).toBeDefined();
  });

  it('D-32 budget ceilings start at zero for X, not D-20\'s steady-state numbers', () => {
    expect(findCatalogueEntry('x.monthly_read_ceiling')?.defaultValue).toBe(0);
    expect(findCatalogueEntry('x.daily_read_ceiling')?.defaultValue).toBe(0);
  });

  it('budget thresholds seed D-32\'s $290/$320/$350, not the source spec\'s stale $80/$90/$100', () => {
    expect(findCatalogueEntry('budget.warn_usd')?.defaultValue).toBe('290.00');
    expect(findCatalogueEntry('budget.reduce_usd')?.defaultValue).toBe('320.00');
    expect(findCatalogueEntry('budget.hard_usd')?.defaultValue).toBe('350.00');
  });

  it('a key not in the catalogue does not exist', () => {
    expect(findCatalogueEntry('secret.database_url')).toBeUndefined();
  });
});

describe('updateSettingMutation.schema — ADR-012 allowlist enforcement', () => {
  it('rejects a key that is not in the catalogue', () => {
    const result = updateSettingMutation.schema.safeParse({
      reason: 'try to sneak a key in',
      expectedVersion: null,
      key: 'DATABASE_URL',
      value: 'postgres://evil',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a value that fails the catalogue entry own type validator', () => {
    const result = updateSettingMutation.schema.safeParse({
      reason: 'wrong type',
      expectedVersion: null,
      key: 'trigger.window_minutes',
      value: 'not-a-number',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-typed value for an allowlisted key', () => {
    const result = updateSettingMutation.schema.safeParse({
      reason: 'raise the trigger threshold',
      expectedVersion: '5',
      key: 'trigger.price_move_pct',
      value: '4.50',
    });
    expect(result.success).toBe(true);
  });
});
