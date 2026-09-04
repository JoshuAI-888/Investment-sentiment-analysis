/**
 * Cache and rate keys, source §9.3.
 *
 *   provider:fmp:quote:{symbol}
 *   provider:fmp:history:{symbol}:1d:90
 *   provider:marketaux:news:{symbol}:{window}
 *   provider:apewisdom:all-stocks:{page}
 *   rate:{provider}:{minute_or_day_bucket}
 *
 * §9.3 also lists `provider:linkup:reddit:{symbol}:{hour-bucket}`. **D-12 dropped Linkup**, and
 * Reddit is now reached directly — so that line survives here as the Reddit shape and the
 * `linkup` segment does not exist. It is called out rather than quietly omitted because §9.3
 * is the section someone will check this file against.
 */
import { createHash } from 'node:crypto';
import type { ProviderId } from '@/contracts/provider';

/**
 * Segments are positional, and every one is normalised.
 *
 * A key built from an un-normalised segment is a cache that misses on `AAPL` after storing
 * `aapl`, which reads as a cold cache rather than as a bug — the calls still succeed, the
 * numbers are still right, and the only symptom is a provider bill that is quietly double what
 * it should be. That is a defect the daily-quota providers would surface first, and only after
 * the day's allowance was gone.
 */
function normaliseSegment(segment: string): string {
  return segment.trim().toLowerCase().replaceAll(/\s+/g, '-').replaceAll(':', '_');
}

export function cacheKey(input: {
  provider: ProviderId;
  operation: string;
  segments?: readonly string[];
}): string {
  const parts = ['provider', input.provider, normaliseSegment(input.operation)];
  for (const segment of input.segments ?? []) parts.push(normaliseSegment(segment));
  return parts.join(':');
}

/** `rate:{provider}:{minute_or_day_bucket}` — §9.3's last line. */
export function rateKey(provider: ProviderId, at: Date, granularity: 'minute' | 'day'): string {
  const iso = at.toISOString();
  const bucket = granularity === 'day' ? iso.slice(0, 10) : iso.slice(0, 16);
  return `rate:${provider}:${bucket}`;
}

/** The UTC day a quota allowance belongs to. Providers reset on UTC midnight, not on ours. */
export function utcDayBucket(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * An hour bucket for the social axes, so a poll that runs twice inside one hour reuses the
 * first result. §9.3's Reddit line uses `yyyy-mm-dd-hh`.
 */
export function hourBucket(at: Date): string {
  return at.toISOString().slice(0, 13).replace('T', '-');
}

/**
 * The `request_fingerprint` column in `provider_call_log`. Stable across processes, so the
 * same logical call made by two workers is recognisable as one thing in the log.
 *
 * It hashes only the key, never the request body or headers — a fingerprint that included an
 * API key would put the key in a table that is retained indefinitely and read by the admin UI.
 */
export function requestFingerprint(input: {
  provider: ProviderId;
  operation: string;
  segments?: readonly string[];
}): string {
  return createHash('sha256').update(cacheKey(input)).digest('hex').slice(0, 32);
}
