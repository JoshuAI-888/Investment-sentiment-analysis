/**
 * The error taxonomy: every way a provider call can fail, mapped onto `ProviderError`.
 *
 * Classification is separated from the retry decision on purpose. A 403 and a 503 are both
 * "the request failed", and the only thing that stops one of them being retried forever is
 * that *what kind of failure it is* is decided once, by data, in one place. `retry.ts` then
 * reads that classification and never re-derives it from the status code.
 */
import type { ProviderError, ProviderId } from '@/contracts/provider';

/**
 * Statuses that mean the account, not the moment (source §9.4: *"caused by input or
 * entitlement: no retry"*).
 *
 * 401 and 403 become `entitlement` because that is what F04 §4.4's probe is looking for and
 * what `provider-entitlements.md` records. 400 and 404 are equally un-retryable but are *not*
 * entitlement failures — calling them so would put "the symbol does not exist" in the report
 * as a denied endpoint and send someone to renegotiate a subscription over a typo.
 */
const ENTITLEMENT_STATUSES: ReadonlySet<number> = new Set([401, 403]);
const CLIENT_FAULT_STATUSES: ReadonlySet<number> = new Set([400, 404, 405, 409, 410, 422]);

/** The transient set from source §9.4. 408 arrives as a timeout, not an upstream failure. */
export const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/** Marks an aborted request so `classify` can tell a deadline from a socket failure. */
export class RequestTimeout extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`provider request exceeded its ${timeoutMs}ms deadline`);
    this.name = 'RequestTimeout';
  }
}

/**
 * `Retry-After` is seconds or an HTTP date (RFC 9110 §10.2.3). Both forms appear in the wild;
 * a provider that sends a date and gets parsed as `NaN` would otherwise retry immediately and
 * be rate-limited again, which looks exactly like the provider being broken.
 */
export function parseRetryAfter(header: string | undefined, now: Date): number | null {
  if (header === undefined) return null;
  const trimmed = header.trim();
  if (trimmed === '') return null;

  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return null;
  return Math.max(0, asDate - now.getTime());
}

export function classifyStatus(input: {
  status: number;
  endpoint: string;
  retryAfterMs: number | null;
}): ProviderError | null {
  const { status, endpoint, retryAfterMs } = input;

  if (status >= 200 && status < 300) return null;
  if (ENTITLEMENT_STATUSES.has(status)) return { kind: 'entitlement', endpoint, status };
  if (status === 429) return { kind: 'rate_limit', retryAfterMs: retryAfterMs ?? 0 };
  if (status === 408) return { kind: 'timeout' };
  if (CLIENT_FAULT_STATUSES.has(status)) return { kind: 'upstream', status };
  return { kind: 'upstream', status };
}

/** Anything thrown by the fetcher — a socket reset, a DNS failure, an abort. */
export function classifyThrown(thrown: unknown): ProviderError {
  if (thrown instanceof RequestTimeout) return { kind: 'timeout' };
  if (thrown instanceof Error && (thrown.name === 'AbortError' || thrown.name === 'TimeoutError')) {
    return { kind: 'timeout' };
  }
  return { kind: 'upstream', status: 0 };
}

/**
 * The `error_class` written to `provider_call_log`. Stable strings, because F18's degradation
 * view and the breaker-trip count both group by this column, and a label that changes shape
 * between releases silently splits a series in two.
 */
export function errorClass(error: ProviderError): string {
  switch (error.kind) {
    case 'upstream':
      return `upstream_${error.status}`;
    case 'budget_denied':
      return `budget_denied_${error.scope}`;
    default:
      return error.kind;
  }
}

export function describeError(provider: ProviderId, error: ProviderError): string {
  switch (error.kind) {
    case 'entitlement':
      return `${provider} refused ${error.endpoint} with ${error.status} — an entitlement failure, never retried`;
    case 'quota':
      return `${provider} quota exhausted${error.resetAt === null ? '' : `, resets ${error.resetAt}`}`;
    case 'rate_limit':
      return `${provider} rate-limited, retry after ${error.retryAfterMs}ms`;
    case 'timeout':
      return `${provider} exceeded its deadline`;
    case 'upstream':
      return `${provider} returned ${error.status}`;
    case 'contract':
      return `${provider} response failed its schema: ${error.issues.join('; ')}`;
    case 'budget_denied':
      return `${provider} denied by the ${error.scope} budget before dispatch`;
    case 'circuit_open':
      return `${provider} circuit open since ${error.openedAt}; the request was not sent`;
  }
}
