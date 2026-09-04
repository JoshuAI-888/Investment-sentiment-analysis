import { describe, expect, it } from 'vitest';
import { resolveAssumptions } from '../../../src/calc/assumptions';
import { descriptor } from './fixtures';

const entry = descriptor({ id: 'attention.rank_change' });

const valueOf = (result: ReturnType<typeof resolveAssumptions>, key: string) =>
  result.assumptions.find((a) => a.key === key);

describe('F05 §4.5 — the precedence chain, in the documented order', () => {
  it('falls back to the official default when nothing overrides it', () => {
    const resolved = resolveAssumptions({ descriptor: entry, scenario: 'personal' });
    expect(valueOf(resolved, 'min_mentions')).toMatchObject({
      value: '25',
      source: 'official_default',
      officialValue: '25',
      editable: true,
    });
  });

  it('an account default outranks the official default', () => {
    const resolved = resolveAssumptions({
      descriptor: entry,
      scenario: 'personal',
      accountDefaults: { min_mentions: '40' },
    });
    expect(valueOf(resolved, 'min_mentions')).toMatchObject({
      value: '40',
      source: 'account_default',
      officialValue: '25',
    });
  });

  it('a subject override outranks an account default', () => {
    const resolved = resolveAssumptions({
      descriptor: entry,
      scenario: 'personal',
      accountDefaults: { min_mentions: '40' },
      subjectOverrides: { min_mentions: '60' },
    });
    expect(valueOf(resolved, 'min_mentions')).toMatchObject({
      value: '60',
      source: 'subject_override',
    });
  });

  it('keeps the official value beside the override, so both can be shown', () => {
    // §4.8 §6: the Inspector renders official values *and* the resolved ones. "40" alone tells a
    // reader nothing about whether they departed from the official run.
    const resolved = resolveAssumptions({
      descriptor: entry,
      scenario: 'personal',
      subjectOverrides: { min_mentions: '40' },
    });
    expect(valueOf(resolved, 'min_mentions')?.officialValue).toBe('25');
  });

  // CAN FAIL — §4.5's first clause.
  it('an official scenario ignores personal assumptions entirely', () => {
    const resolved = resolveAssumptions({
      descriptor: entry,
      scenario: 'official',
      accountDefaults: { min_mentions: '40' },
      subjectOverrides: { min_mentions: '60' },
    });
    expect(valueOf(resolved, 'min_mentions')?.value).toBe('25');
    expect(valueOf(resolved, 'min_mentions')?.source).toBe('official_default');
    // Not "applied then discarded" — not consulted. Nothing is even reported as rejected,
    // because nothing was offered to the resolution in the first place.
    expect(resolved.rejections).toEqual([]);
  });

  it('a non-editable parameter is a code invariant no user layer can reach', () => {
    // §6's top line: "code-level invariants and safety allowlists (never overridable)".
    const resolved = resolveAssumptions({
      descriptor: entry,
      scenario: 'personal',
      subjectOverrides: { board_size: '5' },
    });
    expect(valueOf(resolved, 'board_size')).toMatchObject({
      value: '100',
      source: 'code_invariant',
      editable: false,
    });
    expect(resolved.rejections.map((r) => r.reason)).toContain('not_registered');
  });

  it('reports an out-of-bounds override rather than clamping it silently', () => {
    const resolved = resolveAssumptions({
      descriptor: entry,
      scenario: 'personal',
      accountDefaults: { min_mentions: '99999' },
    });
    expect(valueOf(resolved, 'min_mentions')?.value).toBe('25');
    expect(resolved.rejections).toHaveLength(1);
    expect(resolved.rejections[0]?.reason).toBe('above_max');
  });

  it('reports an override naming a parameter the method does not have', () => {
    // Dropping it silently renders a personal result identical to the official one with no
    // explanation, which reads as "your setting made no difference".
    const resolved = resolveAssumptions({
      descriptor: entry,
      scenario: 'personal',
      accountDefaults: { colour: '3' },
    });
    expect(resolved.rejections).toHaveLength(1);
    expect(resolved.rejections[0]?.message).toMatch(/not an assumption of/);
  });

  it('an invalid subject override does not un-apply a valid account default', () => {
    const resolved = resolveAssumptions({
      descriptor: entry,
      scenario: 'personal',
      accountDefaults: { min_mentions: '40' },
      subjectOverrides: { min_mentions: '99999' },
    });
    expect(valueOf(resolved, 'min_mentions')?.value).toBe('40');
    expect(valueOf(resolved, 'min_mentions')?.source).toBe('account_default');
  });

  it('resolves every assumption the registry declares, in a stable order', () => {
    // Stable order is a hashing requirement (§4.3), not a cosmetic one: two resolutions of the
    // same facts have to produce the same bytes.
    const a = resolveAssumptions({ descriptor: entry, scenario: 'official' });
    const b = resolveAssumptions({
      descriptor: descriptor({
        id: 'attention.rank_change',
        officialAssumptions: { board_size: '100', min_mentions: '25' },
      }),
      scenario: 'official',
    });
    expect(a.assumptions.map((x) => x.key)).toEqual(['board_size', 'min_mentions']);
    expect(a.assumptions.map((x) => x.key)).toEqual(b.assumptions.map((x) => x.key));
  });

  it('carries the bounds through, so the Inspector can render them', () => {
    const resolved = resolveAssumptions({ descriptor: entry, scenario: 'personal' });
    expect(valueOf(resolved, 'min_mentions')).toMatchObject({ min: '1', max: '1000' });
    expect(valueOf(resolved, 'board_size')).toMatchObject({ min: null, max: null });
  });
});
