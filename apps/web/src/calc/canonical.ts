/**
 * Canonical serialization and hashing (F05 §4.3).
 *
 * > `inputHash` = SHA-256 over a canonical serialization of `{inputs, assumptions, methodId,
 * > methodVersion}`: keys sorted, decimals in a fixed exact form, timestamps in UTC ISO-8601
 * > with fixed precision, no floats, no locale. `resultHash` = SHA-256 over `result.exact`.
 *
 * Everything in this module exists to remove a degree of freedom. Two artifacts computed from
 * the same facts must hash the same on any machine, in any process, under any key insertion
 * order and any timezone — otherwise `replay()` reports `result_mismatch` for reasons that have
 * nothing to do with the code changing, and the one alarm this feature installs becomes noise
 * that gets muted.
 *
 * The design rule is therefore: **anything ambiguous throws rather than picking a
 * representation.** A silent choice here is a hash that reproduces until the day it does not.
 */
import { createHash } from 'node:crypto';
import { exact, isDecimalString } from './decimal';

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(
      `${message}\n` +
        'Canonicalization refuses rather than guessing: a representation chosen implicitly is a ' +
        'hash that reproduces until the platform changes its mind (F05 §4.3).',
    );
    this.name = 'CanonicalizationError';
  }
}

/**
 * An ISO-8601 instant: date, time, optional seconds, optional fraction, **required** offset.
 * The offset is required because a datetime without one names no instant — it names a wall
 * clock, and which instant that was depends on where the reader is standing.
 */
const ISO_INSTANT =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/** The same shape with the offset missing — matched only so it can be rejected by name. */
const ISO_NAIVE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?$/;

/** Postgres `timestamptz` resolution. Fixed, so the same instant always yields the same text. */
const FRACTION_DIGITS = 6;
/** What JS `Date` carries natively, and what it truncates past. */
const MILLIS_DIGITS = 3;
/** The digits `Date` drops: `FRACTION_DIGITS - MILLIS_DIGITS`, written out rather than computed
 *  because arithmetic on a numeric literal is a lint failure in this layer — correctly, since
 *  the exception for "just index maths" is the one that widens until the rule means nothing. */
const TAIL_DIGITS = 3;

/**
 * `2026-08-30T08:15:00-04:00` and `2026-08-30T12:15:00Z` are the same instant and produce the
 * same text. Sub-millisecond digits are carried through by string surgery rather than dropped:
 * JS `Date` truncates at milliseconds, and truncating is how two distinct observations quietly
 * become one.
 */
export function canonicalInstant(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new CanonicalizationError('An Invalid Date cannot be canonicalized.');
    }
    return padFraction(value.toISOString());
  }

  const match = ISO_INSTANT.exec(value);
  if (match === null) {
    if (ISO_NAIVE.test(value)) {
      throw new CanonicalizationError(
        `"${value}" is a datetime with no UTC offset. It names a wall clock, not an instant, ` +
          'so there is no single UTC form for it to canonicalize to.',
      );
    }
    throw new CanonicalizationError(`"${value}" is not an ISO-8601 instant.`);
  }

  const fraction = match[3] ?? '';
  if (fraction.length > FRACTION_DIGITS && /[1-9]/.test(fraction.slice(FRACTION_DIGITS))) {
    throw new CanonicalizationError(
      `"${value}" carries precision finer than ${FRACTION_DIGITS} fractional digits. Canonical ` +
        'form is fixed at microseconds (Postgres `timestamptz` resolution); silently truncating ' +
        'would collapse two distinct observations onto one hash.',
    );
  }

  // `new Date(iso)` applies the offset for us. It truncates the fraction at milliseconds, so
  // digits 4–6 are re-attached below from the source text.
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new CanonicalizationError(`"${value}" is syntactically ISO-8601 but not a real instant.`);
  }

  const millis = parsed.toISOString();
  const tail = fraction.slice(MILLIS_DIGITS, FRACTION_DIGITS).padEnd(TAIL_DIGITS, '0');
  return `${millis.slice(0, -1)}${tail}Z`;
}

/** `...123Z` → `...123000Z`. Widens a millisecond ISO string to the fixed fraction width. */
function padFraction(millisIso: string): string {
  return `${millisIso.slice(0, -1)}${''.padEnd(TAIL_DIGITS, '0')}Z`;
}

/** True for a string this module will normalize as an instant rather than as literal text. */
export function looksLikeInstant(value: string): boolean {
  return ISO_INSTANT.test(value) || ISO_NAIVE.test(value);
}

/**
 * The canonical form of one value.
 *
 * Every scalar is tagged (`d:`, `t:`, `s:`, `b:`) by what it LOOKS like — decimal grammar, an
 * ISO instant, or neither — so that `"one"` and a genuine decimal-shaped string never collide.
 *
 * **This is shape-based, not schema-based, and cannot be otherwise here.** This function has no
 * `CalculationInputValue` to consult — it recurses over whatever plain value it is handed — so
 * it cannot distinguish "the text `'1'`" from "the quantity `1`" when both arrive as the
 * identical JS string `'1'`. What actually keeps an `identity` input and a `decimal` input from
 * colliding at the artifact level is that `dataType` is a sibling field inside the same object
 * this function is recursing over: a different `dataType` string is a different canonical
 * fragment of the *enclosing* object, even where the two `value` fields tie (lane-review
 * finding 8; see `tests/unit/calc/artifact.test.ts`'s test for that guarantee made explicit).
 */
function canonicalizeValue(value: unknown, path: string): string {
  if (value === null) return 'null';

  if (typeof value === 'number') {
    throw new CanonicalizationError(
      `A JS number reached canonicalization at ${path} (${String(value)}). Values cross this ` +
        'boundary as decimal strings, never as floats, including through JSON ' +
        '(02-ARCHITECTURE-CONTRACTS.md §4.2).',
    );
  }

  if (typeof value === 'bigint') {
    throw new CanonicalizationError(
      `A bigint reached canonicalization at ${path}. It is exact, but it is not a decimal ` +
        'string, and admitting a second numeric representation is how a third one gets added.',
    );
  }

  if (typeof value === 'boolean') return value ? 'b:true' : 'b:false';

  if (value instanceof Date) return `t:${canonicalInstant(value)}`;

  if (typeof value === 'string') {
    if (looksLikeInstant(value)) return `t:${canonicalInstant(value)}`;
    // `1.10` and `1.1` are the same quantity; the canonical exact form collapses them.
    if (isDecimalString(value)) return `d:${exact(value)}`;
    return `s:${JSON.stringify(value)}`;
  }

  if (Array.isArray(value)) {
    // Array order is meaning, not incidental ordering, so it is preserved. Sorting a step list
    // or a points table would make two different calculations hash alike.
    return `[${value.map((item, index) => canonicalizeValue(item, `${path}[${index}]`)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // `undefined` is absence. A key present with an undefined value and a key that is absent
      // describe the same fact, and must therefore hash the same.
      .filter(([, item]) => item !== undefined)
      // Code-unit ordering, not `localeCompare` — a locale-aware sort is exactly the "no locale"
      // clause of §4.3, and it differs between ICU builds.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeValue(item, `${path}.${key}`)}`)
      .join(',')}}`;
  }

  throw new CanonicalizationError(
    `${typeof value} is not canonicalizable (at ${path}). Only null, booleans, strings, Dates, ` +
      'arrays and plain objects are — a function or a symbol has no stable serialization.',
  );
}

/** The canonical serialization of a value: deterministic bytes for deterministic facts. */
export function canonicalize(value: unknown): string {
  return canonicalizeValue(value, '$');
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 over the canonical form. The single hashing entry point. */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

/**
 * `inputHash`, exactly as §4.3 defines it.
 *
 * `methodId` and `methodVersion` are inside the hash rather than beside it: the same numbers put
 * through a different method are a different calculation, and a hash that ignored the method
 * would call them equal.
 */
export function computeInputHash(payload: {
  readonly methodId: string;
  readonly methodVersion: string;
  readonly inputs: unknown;
  readonly assumptions: unknown;
}): string {
  return canonicalHash({
    methodId: payload.methodId,
    methodVersion: payload.methodVersion,
    inputs: payload.inputs,
    assumptions: payload.assumptions,
  });
}

/** `resultHash` = SHA-256 over `result.exact` (§4.3). Over the exact value, never the display. */
export function computeResultHash(resultExact: string): string {
  return canonicalHash({ exact: resultExact });
}
