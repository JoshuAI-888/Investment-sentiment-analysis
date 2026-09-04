import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalHash,
  canonicalInstant,
  canonicalize,
  CanonicalizationError,
  computeInputHash,
  computeResultHash,
} from '../../../src/calc/canonical';

const WEB_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('F05 §4.3 — canonicalization is invariant to key order', () => {
  it('hashes two orderings of the same object identically', () => {
    const a = { alpha: '1', beta: '2', gamma: { delta: '3', epsilon: '4' } };
    const b = { gamma: { epsilon: '4', delta: '3' }, beta: '2', alpha: '1' };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('sorts by code unit rather than by locale', () => {
    // A locale-aware sort is the "no locale" clause of §4.3 in one line: `ä` orders before `b`
    // in Swedish and after it in German, so an ICU upgrade would silently change the hash.
    const serialized = canonicalize({ b: '1', ä: '2', a: '3', Z: '4' });
    expect(serialized.indexOf('"Z"')).toBeLessThan(serialized.indexOf('"a"'));
    expect(serialized.indexOf('"b"')).toBeLessThan(serialized.indexOf('"ä"'));
  });

  it('treats an explicitly-undefined key as an absent one', () => {
    expect(canonicalHash({ a: '1', b: undefined })).toBe(canonicalHash({ a: '1' }));
  });

  it('does NOT reorder arrays — order is meaning there', () => {
    // Sorting a step list or a points table would make two different calculations hash alike,
    // which is the one thing a hash must never do.
    expect(canonicalHash(['1', '2'])).not.toBe(canonicalHash(['2', '1']));
  });
});

describe('F05 §4.3 — canonicalization is invariant to decimal representation', () => {
  it('hashes 1.10 and 1.1 identically', () => {
    expect(canonicalHash({ v: '1.10' })).toBe(canonicalHash({ v: '1.1' }));
  });

  it('hashes every spelling of zero identically', () => {
    const target = canonicalHash({ v: '0' });
    for (const spelling of ['0.0', '0.00', '-0', '-0.000']) {
      expect(canonicalHash({ v: spelling }), spelling).toBe(target);
    }
  });

  it('still distinguishes quantities that differ', () => {
    expect(canonicalHash({ v: '1.1' })).not.toBe(canonicalHash({ v: '1.11' }));
  });

  it('tags a decimal-shaped string differently from ordinary text', () => {
    // What this actually shows: `canonicalizeValue` has no schema and no `dataType` to consult
    // — it tags a scalar by what it LOOKS like (decimal grammar, an ISO instant, or neither),
    // uniformly, wherever a string appears. It cannot and does not distinguish "the text '1'"
    // from "the quantity 1", because at this layer both are the same JS string `'1'` with no
    // other information attached (lane-review finding 8 — an earlier version of this test's
    // name claimed the stronger, schema-aware guarantee this module cannot provide).
    //
    // What actually prevents an `identity` input and a `decimal` input from being confused at
    // the artifact level is `dataType` being a SIBLING field inside the same
    // `CalculationInputValue` object being hashed — a different `dataType` string is a different
    // canonical fragment of the *enclosing* object, even when `value` itself ties. See
    // `tests/unit/calc/artifact.test.ts`'s "an identity input and a decimal input with the same
    // numeric-looking text still hash differently" for that guarantee, made explicit.
    expect(canonicalize({ v: '1' })).toContain('d:1');
    expect(canonicalize({ v: 'one' })).toContain('s:');
  });
});

describe('F05 §4.3 — canonicalization is invariant to timezone form', () => {
  it('hashes the same instant written in two zones identically', () => {
    const utc = '2026-08-30T12:15:00Z';
    const eastern = '2026-08-30T08:15:00-04:00';
    expect(canonicalInstant(utc)).toBe(canonicalInstant(eastern));
    expect(canonicalHash({ at: utc })).toBe(canonicalHash({ at: eastern }));
  });

  it('hashes a Date and its ISO string identically', () => {
    const iso = '2026-08-30T12:15:00.250Z';
    expect(canonicalHash({ at: new Date(iso) })).toBe(canonicalHash({ at: iso }));
  });

  it('normalizes to a fixed fractional width', () => {
    expect(canonicalInstant('2026-08-30T12:15:00Z')).toBe('2026-08-30T12:15:00.000000Z');
    expect(canonicalInstant('2026-08-30T12:15:00.25Z')).toBe('2026-08-30T12:15:00.250000Z');
    expect(canonicalInstant('2026-08-30T12:15:00.250000Z')).toBe('2026-08-30T12:15:00.250000Z');
  });

  it('carries microseconds rather than truncating them at milliseconds', () => {
    // JS `Date` truncates past milliseconds. Truncating is how two distinct Postgres
    // observations quietly become one artifact.
    expect(canonicalInstant('2026-08-30T12:15:00.123456Z')).toBe('2026-08-30T12:15:00.123456Z');
    expect(canonicalHash({ at: '2026-08-30T12:15:00.123456Z' })).not.toBe(
      canonicalHash({ at: '2026-08-30T12:15:00.123457Z' }),
    );
  });

  it('refuses a datetime with no offset rather than assuming one', () => {
    expect(() => canonicalInstant('2026-08-30T12:15:00')).toThrow(CanonicalizationError);
    expect(() => canonicalInstant('2026-08-30T12:15:00')).toThrow(/no UTC offset/);
  });

  it('refuses precision finer than the fixed width rather than dropping it', () => {
    expect(() => canonicalInstant('2026-08-30T12:15:00.1234567Z')).toThrow(/finer than/);
    // Trailing zeros beyond the width carry no information, so they are not an error.
    expect(canonicalInstant('2026-08-30T12:15:00.1234500Z')).toBe('2026-08-30T12:15:00.123450Z');
  });

  it('leaves a plain date alone — a date is not an instant', () => {
    expect(canonicalize({ d: '2026-08-30' })).toContain('s:');
  });
});

describe('F05 §4.3 — no floats reach a hash', () => {
  it('refuses a JS number outright', () => {
    expect(() => canonicalize({ v: 1 })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ v: 1 })).toThrow(/decimal strings, never as floats/);
  });

  it('refuses a number nested anywhere and names where it was', () => {
    expect(() => canonicalize({ a: { b: [{ c: 0.1 }] } })).toThrow(/\$\.a\.b\[0\]\.c/);
  });

  it('refuses a bigint too — a second numeric representation invites a third', () => {
    expect(() => canonicalize({ v: 1n })).toThrow(CanonicalizationError);
  });

  it('refuses a function or a symbol', () => {
    expect(() => canonicalize({ v: () => undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ v: Symbol('x') })).toThrow(CanonicalizationError);
  });

  it('accepts null and booleans, and keeps them distinct from their spellings', () => {
    expect(canonicalHash({ v: null })).not.toBe(canonicalHash({ v: 'null' }));
    expect(canonicalHash({ v: true })).not.toBe(canonicalHash({ v: 'true' }));
  });
});

describe('F05 §4.3 — hash stability across process restarts', () => {
  const payload = {
    methodId: 'attention.rank_change',
    methodVersion: '1.0.0',
    inputs: [
      { key: 'rank_now', value: '4', observedAt: '2026-08-30T12:15:00-00:00' },
      { key: 'rank_24h_ago', value: '11.0', observedAt: new Date('2026-08-29T12:15:00Z') },
    ],
    assumptions: { minMentions: '25' },
  };

  it('is a pure function of its argument within this process', () => {
    expect(computeInputHash(payload)).toBe(computeInputHash(payload));
  });

  it('produces the same digest in a fresh Node process', () => {
    // The risk §8 names: "hash instability across Node versions". A hash that depends on
    // anything process-local — an iteration order, a cached ICU table, a warmed-up JIT — is a
    // hash that reports `result_mismatch` for reasons that have nothing to do with the code.
    const script = `
      import { computeInputHash } from ${JSON.stringify(`${WEB_ROOT}src/calc/canonical.ts`)};
      const payload = ${JSON.stringify({
        ...payload,
        inputs: [payload.inputs[0], { ...payload.inputs[1], observedAt: '2026-08-29T12:15:00Z' }],
      })};
      process.stdout.write(computeInputHash(payload));
    `;
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      { encoding: 'utf8', cwd: WEB_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(out.trim()).toBe(computeInputHash(payload));
  });

  it('pins the digest of a known payload, so a change to the algorithm is visible in a diff', () => {
    // Not an assertion about the *value* — an assertion that the value is not free to move
    // quietly. Every artifact ever persisted depends on this function staying still.
    expect(computeInputHash(payload)).toBe(
      '3e6f44ccc5c618cff7566c37ec4b1b69e2557545fdd693787811810f9bc5185c',
    );
  });
});

describe('F05 §4.3 — the two hashes', () => {
  it('puts the method identity inside the input hash', () => {
    // The same numbers put through a different method are a different calculation.
    const base = { methodId: 'a.b', methodVersion: '1.0.0', inputs: ['1'], assumptions: {} };
    expect(computeInputHash(base)).not.toBe(computeInputHash({ ...base, methodId: 'a.c' }));
    expect(computeInputHash(base)).not.toBe(computeInputHash({ ...base, methodVersion: '1.0.1' }));
  });

  it('hashes the result over the exact value, never the display value', () => {
    expect(computeResultHash('7.000000001')).not.toBe(computeResultHash('7.00'));
    expect(computeResultHash('7.10')).toBe(computeResultHash('7.1'));
  });
});
