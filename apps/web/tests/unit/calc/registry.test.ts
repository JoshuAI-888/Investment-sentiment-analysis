import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EDITABLE_ASSUMPTION_ALLOWLIST,
  MethodNotRegistered,
  MethodRegistry,
  validateDescriptor,
  validateOverride,
} from '../../../src/calc/registry';
import { methods as DESCRIPTORS } from '../../../src/analytics/registry';
import { bindRegistry, MethodBindingError, METHOD_REGISTRY } from '../../../src/services/calculations';
import { descriptor } from './fixtures';

const WEB_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('F05 §4.4 — the registry is the sole source of editable assumptions', () => {
  it('accepts an override on a key the registry and the code allowlist both permit', () => {
    const outcome = validateOverride(
      descriptor({ id: 'attention.rank_change' }),
      'min_mentions',
      '40',
    );
    expect(outcome).toEqual({ ok: true, key: 'min_mentions', value: '40' });
  });

  it('rejects an override on a key the registry does not list as editable', () => {
    const outcome = validateOverride(descriptor({ id: 'attention.rank_change' }), 'board_size', '5');
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.rejection.reason).toBe('not_registered');
  });

  // CAN FAIL — the DoD item, verbatim: "a database-only 'editable' flag is rejected by a test".
  it('rejects a key the registry marks editable but the code allowlist does not', () => {
    // This is the exact attack §4.4 names. The registry is projected into the database so the
    // Inspector and the Explorer can read it, and a projection is data. Here the projection has
    // been edited to make a prohibited parameter editable, with bounds that look reasonable.
    const tampered = descriptor({
      id: 'attention.rank_change',
      officialAssumptions: { min_mentions: '25', board_size: '100' },
      editableAssumptions: [
        { key: 'min_mentions', min: '1', max: '1000', unit: 'mentions', label: 'Minimum mentions' },
        { key: 'board_size', min: '1', max: '10000', unit: 'ranks', label: 'Board size' },
      ],
    });

    // The registry alone says yes...
    expect(tampered.editableAssumptions.some((e) => e.key === 'board_size')).toBe(true);
    // ...and the answer is still no, because the second gate lives in source.
    const outcome = validateOverride(tampered, 'board_size', '5');
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.rejection.reason).toBe('not_code_allowlisted');
    expect(outcome.ok === false && outcome.rejection.message).toMatch(/code-level allowlist/);
  });

  it('rejects a value outside the registered bounds, at each end', () => {
    const entry = descriptor({ id: 'attention.rank_change' });
    expect(validateOverride(entry, 'min_mentions', '0').ok).toBe(false);
    expect(validateOverride(entry, 'min_mentions', '1001').ok).toBe(false);
    expect(validateOverride(entry, 'min_mentions', '1').ok).toBe(true);
    expect(validateOverride(entry, 'min_mentions', '1000').ok).toBe(true);
  });

  it('rejects a value that is not a decimal string', () => {
    const outcome = validateOverride(descriptor({ id: 'attention.rank_change' }), 'min_mentions', '4e1');
    expect(outcome.ok === false && outcome.rejection.reason).toBe('not_a_decimal');
  });

  it('rejects every override in an official scenario, before looking at anything else', () => {
    // §6: official scheduled materialisation ignores personal assumptions entirely. An override
    // that is *evaluated* and then discarded is one somebody eventually stops discarding.
    const outcome = validateOverride(
      descriptor({ id: 'attention.rank_change' }),
      'min_mentions',
      '40',
      { scenario: 'official' },
    );
    expect(outcome.ok === false && outcome.rejection.reason).toBe('official_scenario');
  });

  it('the code allowlist alone does not make a key editable either', () => {
    // Symmetry matters: adding a key here without adding it to the registry changes nothing.
    // Making a parameter editable requires a code review either way.
    expect(EDITABLE_ASSUMPTION_ALLOWLIST['attention.rank_change']).toContain('min_mentions');
    const noEditables = descriptor({ id: 'attention.rank_change', editableAssumptions: [] });
    expect(validateOverride(noEditables, 'min_mentions', '40').ok).toBe(false);
  });
});

describe('F05 §4.4 — a descriptor that cannot be trusted does not parse', () => {
  it('rejects an editable assumption with no official default', () => {
    expect(() =>
      validateDescriptor(
        descriptor({
          officialAssumptions: { board_size: '100' },
          editableAssumptions: [
            { key: 'ghost', min: '1', max: '2', unit: 'x', label: 'Ghost' },
          ],
        }),
      ),
    ).toThrow(/no official default/);
  });

  it('rejects inverted bounds', () => {
    expect(() =>
      validateDescriptor(
        descriptor({
          editableAssumptions: [
            { key: 'min_mentions', min: '100', max: '1', unit: 'x', label: 'Backwards' },
          ],
        }),
      ),
    ).toThrow(/inverted/);
  });

  it('rejects an official default a user is forbidden to reproduce', () => {
    expect(() =>
      validateDescriptor(
        descriptor({
          officialAssumptions: { min_mentions: '25', board_size: '100' },
          editableAssumptions: [
            { key: 'min_mentions', min: '30', max: '90', unit: 'x', label: 'Out of reach' },
          ],
        }),
      ),
    ).toThrow(/outside the bounds/);
  });

  it('rejects an unregistered rounding rule', () => {
    expect(() => validateDescriptor(descriptor({ roundingRule: 'about_right' }))).toThrow(
      /not a registered rounding rule/,
    );
  });

  it('rejects a float where a decimal string belongs', () => {
    expect(() =>
      validateDescriptor(descriptor({ officialAssumptions: { min_mentions: 25 } as never })),
    ).toThrow();
  });

  it('rejects a version that is not semver', () => {
    expect(() => validateDescriptor(descriptor({ version: 'v1' }))).toThrow();
  });
});

describe('F05 §4.4 — the shipped registry', () => {
  it('parses every descriptor', () => {
    for (const entry of DESCRIPTORS) expect(() => validateDescriptor(entry)).not.toThrow();
  });

  it('binds every descriptor to arithmetic, and every piece of arithmetic to a descriptor', () => {
    expect(METHOD_REGISTRY.all()).toHaveLength(DESCRIPTORS.length);
  });

  it('refuses a descriptor with no arithmetic bound to it', () => {
    expect(() => bindRegistry([descriptor({ id: 'nothing.here' })], {})).toThrow(MethodBindingError);
  });

  it('refuses arithmetic with no descriptor', () => {
    expect(() =>
      bindRegistry([], { 'orphan.method@1.0.0': () => ({ value: null as never }) }),
    ).toThrow(/no registry entry/);
  });

  it('every registered method names a golden fixture that exists on disk', async () => {
    // `check:calc-coverage` fails a method with an empty `goldens` array. That leaves the case
    // where the array is populated with a path to nothing, which reads as covered and is not.
    for (const entry of DESCRIPTORS) {
      expect(entry.goldens.length).toBeGreaterThan(0);
      for (const golden of entry.goldens) {
        await expect(access(path.join(WEB_ROOT, golden)), golden).resolves.toBeUndefined();
      }
    }
  });

  it('carries F-03’s selection-bias disclosure on the attention method', () => {
    // §4.4: `limitations[]` is where F-03's disclosure lives, and it "is not optional copy".
    const entry = METHOD_REGISTRY.latest('attention.rank_change');
    expect(entry.limitations.some((line) => /selection bias/i.test(line))).toBe(true);
    expect(entry.limitations.some((line) => /sampling frame/i.test(line))).toBe(true);
  });
});

describe('F05 §4.6 — looking a method up by version', () => {
  const registry = METHOD_REGISTRY;

  it('finds the exact version an artifact recorded', () => {
    expect(registry.get('attention.rank_change', '1.0.0').version).toBe('1.0.0');
  });

  it('returns undefined for a version that no longer exists, rather than the nearest one', () => {
    // Silently replaying against a neighbouring version would report `match` for a calculation
    // nothing can reproduce.
    expect(registry.find('attention.rank_change', '0.9.0')).toBeUndefined();
    expect(() => registry.get('attention.rank_change', '0.9.0')).toThrow(MethodNotRegistered);
  });

  it('orders versions numerically, so 1.10.0 is later than 1.9.0', () => {
    const compute = () => ({ value: null as never });
    const two = new MethodRegistry([
      { ...descriptor({ version: '1.9.0' }), compute },
      { ...descriptor({ version: '1.10.0' }), compute },
    ]);
    expect(two.latest('test.metric').version).toBe('1.10.0');
  });

  it('refuses two definitions of one method version', () => {
    const compute = () => ({ value: null as never });
    expect(
      () => new MethodRegistry([{ ...descriptor(), compute }, { ...descriptor(), compute }]),
    ).toThrow(/Duplicate registry entry/);
  });
});
