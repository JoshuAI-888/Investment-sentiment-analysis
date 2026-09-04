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
 * **`baseUrl` is a parameter, not an environment read.** `src/env.ts` has no `SCORER_BASE_URL`
 * yet and belongs to F01's tree, so this lane does not add one. Passing it in also keeps the
 * fixture path honest: in `PROVIDER_MODE=fixture` there is no URL at all and the argument is
 * unused, which is exactly the state CI runs in.
 */
import type { WrapperDeps } from '@/adapters/wrapper';
import type { ScorerId } from '@/adapters/scorer';
import { postScoreBatch, SCORER_TIMEOUT_MS } from '@/adapters/scorer';
import type { ScoreBatchPort } from './scoring-worker';

export type ScoreBatchPortOptions = {
  providerMode: 'fixture' | 'live';
  /** Required in live mode. `postScoreBatch` throws without it rather than calling a stub host. */
  baseUrl?: string;
  timeoutMs?: number;
  /** In fixture mode, carries `x-fixture-case`; in live mode the wrapper strips it. */
  headers?: Readonly<Record<string, string>>;
};

export function createScoreBatchPort(
  options: ScoreBatchPortOptions,
  deps: Omit<WrapperDeps, 'fetcher'> & { fixturesRoot?: string },
): ScoreBatchPort {
  return async (items) =>
    postScoreBatch(
      {
        items: items.map((item) => ({
          itemId: item.itemId,
          text: item.text,
          kind: item.kind satisfies ScorerId,
        })),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        timeoutMs: options.timeoutMs ?? SCORER_TIMEOUT_MS,
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      },
      options.providerMode,
      deps,
    );
}
