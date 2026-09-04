/**
 * How a rendered value addresses its artifact (F05 §4.7, §4.8).
 *
 * Kept out of the `.tsx` files so it is importable — and testable — without a JSX transform.
 * The addressing rule is F-07's, and it is the reason a 180-point series is one artifact: a
 * chart point is `{calculationId, pointIndex}`, and the Inspector resolves it.
 */

export function inspectorHref(calculationId: string, pointIndex?: number): string {
  return pointIndex === undefined
    ? `/calculations/${encodeURIComponent(calculationId)}`
    : `/calculations/${encodeURIComponent(calculationId)}?point=${pointIndex}`;
}

/** `?point=3`. Anything that is not a non-negative integer is ignored rather than guessed at. */
export function parsePointIndex(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

/** The seven sections of §4.8, in order. The Inspector renders all of them, for every method. */
export const INSPECTOR_SECTIONS = [
  'summary',
  'formula',
  'inputs',
  'trace',
  'precision',
  'assumptions',
  'validation',
] as const;

export type InspectorSection = (typeof INSPECTOR_SECTIONS)[number];
