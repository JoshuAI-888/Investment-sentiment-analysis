/**
 * The composition root for the scorer: turns `adapters/scorer.ts` into the `ScoreBatchPort` the
 * worker consumes.
 *
 * This is the only file in `services/jobs/` that knows the scorer is reached over HTTP. The
 * worker takes the port, so its outage, re-score and ordering tests run against a fake with no
 * network at all — and this file is what makes the *same* worker run against the real wrapper,
 * with its budget gate, breaker, rate limiter and call log, in an integration test and in
 * production.
 *
 * **`baseUrl` stays a parameter, and now falls back to `env.SCORER_BASE_URL`.** This file used
 * to note that `src/env.ts` had no such key and that this lane would not add one to F01's tree;
 * the key exists as of the Render deploy, and the fallback is what lets a real deployment reach
 * a real scorer without every call site threading a URL. It remains a *parameter* because the
 * fixture path depends on that: in `PROVIDER_MODE=fixture` there is no URL at all and the
 * argument is unused, which is exactly the state CI runs in, and a test that wants a stub host
 * must be able to say so without setting a process-wide variable.
 */
import { env } from '@/env';
import type { WrapperDeps } from '@/adapters/wrapper';
import type { ScorerId } from '@/adapters/scorer';
import { postScoreBatch, SCORER_TIMEOUT_MS } from '@/adapters/scorer';
import type { ScoreBatchPort } from './scoring-worker';

export type ScoreBatchPortOptions = {
  providerMode: 'fixture' | 'live';
  /**
   * Defaults to `env.SCORER_BASE_URL`, which is required in live mode. `postScoreBatch` throws
   * without a URL rather than calling a stub host.
   */
  baseUrl?: string;
  timeoutMs?: number;
  /** In fixture mode, carries `x-fixture-case`; in live mode the wrapper strips it. */
  headers?: Readonly<Record<string, string>>;
};

export function createScoreBatchPort(
  options: ScoreBatchPortOptions,
  deps: Omit<WrapperDeps, 'fetcher'> & { fixturesRoot?: string },
): ScoreBatchPort {
  const resolvedBaseUrl = options.baseUrl ?? env.SCORER_BASE_URL;
  return async (items) =>
    postScoreBatch(
      {
        items: items.map((item) => ({
          itemId: item.itemId,
          text: item.text,
          kind: item.kind satisfies ScorerId,
        })),
        ...(resolvedBaseUrl === undefined ? {} : { baseUrl: resolvedBaseUrl }),
        timeoutMs: options.timeoutMs ?? SCORER_TIMEOUT_MS,
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      },
      options.providerMode,
      deps,
    );
}
