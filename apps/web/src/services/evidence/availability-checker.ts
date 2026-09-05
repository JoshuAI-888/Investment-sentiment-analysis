/**
 * The availability checker — F10 §4.6 (F-19). "A low-frequency job re-checks stored evidence
 * URLs with a HEAD request and updates `availability` and `last_checked_at`. It never re-fetches
 * content into the record, never repairs a snippet, and never invalidates a completed run."
 *
 * **This module has no repository write to call.** `repositories/evidence.ts` has
 * `insertEvidenceItem` and `evidenceForSecurity` — nothing that updates `availability` or
 * `last_checked_at` on an existing row. **Reported under this lane's `CONTRACTS` line**: a
 * `updateEvidenceAvailability(id, { availability, lastCheckedAt })` repository function is needed
 * before this checker can actually persist anything; this module is deliberately written against
 * an injected `persist` port so its decision logic is fully built and tested now, and wiring the
 * real write is a small, isolated follow-up once that function exists.
 *
 * The `head`-only requester interface is what makes "never re-fetches content" a structural
 * property rather than a discipline: there is no method on `AvailabilityHeadRequester` that could
 * return a body.
 */
import type { z } from 'zod';
import type { availability } from '@/contracts/evidence';

type Availability = z.infer<typeof availability>;

export type AvailabilityCheckTarget = {
  readonly id: string;
  readonly sourceUrl: string | null;
};

export type HeadOutcome =
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'network_error' };

export interface AvailabilityHeadRequester {
  head(url: string, options: { readonly timeoutMs: number }): Promise<HeadOutcome>;
}

export type AvailabilityCheckResult = {
  readonly id: string;
  readonly availability: Availability;
  readonly lastCheckedAt: Date;
};

/** F09/F-19's real HEAD requester — a plain `fetch` with `method: 'HEAD'`, never `GET`. */
export class FetchHeadRequester implements AvailabilityHeadRequester {
  async head(url: string, options: { readonly timeoutMs: number }): Promise<HeadOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
      return { kind: 'status', status: response.status };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return { kind: 'timeout' };
      return { kind: 'network_error' };
    } finally {
      clearTimeout(timer);
    }
  }
}

function availabilityFromHead(outcome: HeadOutcome): Availability {
  if (outcome.kind === 'timeout' || outcome.kind === 'network_error') return 'unreachable';
  const { status } = outcome;
  if (status >= 200 && status < 300) return 'available';
  if (status === 404 || status === 410) return 'removed';
  if (status === 401 || status === 402 || status === 403) return 'paywalled';
  return 'unreachable';
}

export type CheckAvailabilityOptions = {
  readonly timeoutMs?: number;
  readonly now?: () => Date;
};

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Pure decision logic: given targets and a requester, decides each target's new `availability`
 * and `lastCheckedAt`. Never touches `snippet`, `title`, or any other field — the return type
 * itself only carries the two fields F-19 says this job may change. A target with no `sourceUrl`
 * is skipped entirely (nothing to HEAD, so its state is left for the caller to leave unchanged).
 */
export async function checkAvailability(
  targets: readonly AvailabilityCheckTarget[],
  requester: AvailabilityHeadRequester,
  options: CheckAvailabilityOptions = {},
): Promise<readonly AvailabilityCheckResult[]> {
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const results: AvailabilityCheckResult[] = [];
  for (const target of targets) {
    if (target.sourceUrl === null) continue;
    const outcome = await requester.head(target.sourceUrl, { timeoutMs });
    results.push({ id: target.id, availability: availabilityFromHead(outcome), lastCheckedAt: now() });
  }
  return results;
}

export type AvailabilityCheckJobDeps = {
  readonly loadTargets: () => Promise<readonly AvailabilityCheckTarget[]>;
  readonly persist: (results: readonly AvailabilityCheckResult[]) => Promise<void>;
  readonly requester: AvailabilityHeadRequester;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
};

/**
 * The job shape a future `job_definition` row (F16a's dispatcher, per
 * `02-ARCHITECTURE-CONTRACTS.md` §7) would invoke on a low-frequency schedule. `loadTargets` and
 * `persist` are ports rather than direct repository calls for the reason in the module docstring
 * — neither repository function exists yet.
 */
export async function runAvailabilityCheckJob(deps: AvailabilityCheckJobDeps): Promise<{ readonly checked: number }> {
  const targets = await deps.loadTargets();
  const results = await checkAvailability(targets, deps.requester, {
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  if (results.length > 0) await deps.persist(results);
  return { checked: results.length };
}
