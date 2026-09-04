/**
 * `PROVIDER_MODE=fixture` reads — F04 §4.2.
 *
 * A fixture is a frozen `FetchResponse` committed at
 * `apps/web/fixtures/<provider>/<endpoint>/<case>.json` (`05-TEST-STRATEGY.md` §2). This module
 * is the generic harness that turns a case name into a `Fetcher`; it carries no provider- or
 * endpoint-specific knowledge, since **no adapter exists yet** to define one (`docs/progress/
 * collect.md` — Substack is the next slice). The nine-case matrix per adapter is deferred to
 * that slice; this is only the plumbing it will be built on.
 *
 * **Case selection is out-of-band, not URL-derived.** The wrapper's `Fetcher` type carries a
 * real request — url, method, headers — because that is what a live fetch needs, but a fixture
 * has no URL to route on: two adapters can share an endpoint name against completely different
 * hosts, and a test wants *this exact case*, not whatever a URL pattern happens to match. So the
 * case name travels on the one channel `FetchRequest` already reserves for the caller rather
 * than the wire: the `x-fixture-case` header. It is stripped before a live request is ever
 * built — see `createFetcher` below — so it can never leak onto a real HTTP request.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Fetcher, FetchResponse } from './ports';

export const FIXTURE_CASE_HEADER = 'x-fixture-case';
export const DEFAULT_FIXTURE_CASE = 'success';

/** Repo-relative default. Tests override this to point at a scratch fixture tree. */
export const DEFAULT_FIXTURES_ROOT = join(process.cwd(), 'fixtures');

export class FixtureNotFoundError extends Error {
  constructor(
    public readonly provider: string,
    public readonly endpoint: string,
    public readonly fixtureCase: string,
    public readonly path: string,
  ) {
    super(
      `no fixture recorded for ${provider}/${endpoint}/${fixtureCase} (looked in ${path}). ` +
        'Record one deliberately — see 05-TEST-STRATEGY.md §2 — never invent one inline.',
    );
    this.name = 'FixtureNotFoundError';
  }
}

/** The on-disk shape a fixture file must have. Status and headers are as-recorded, not inferred. */
type FixtureFile = {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
};

function fixturePath(root: string, provider: string, endpoint: string, fixtureCase: string): string {
  return join(root, provider, endpoint, `${fixtureCase}.json`);
}

export async function readFixture(
  provider: string,
  endpoint: string,
  fixtureCase: string,
  root: string = DEFAULT_FIXTURES_ROOT,
): Promise<FetchResponse> {
  const path = fixturePath(root, provider, endpoint, fixtureCase);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    throw new FixtureNotFoundError(provider, endpoint, fixtureCase, path);
  }

  // A malformed fixture file (bad JSON, missing `status`/`body`) is a recording-time mistake,
  // not a case this harness is asked to simulate — that is what the `malformed` *case name*
  // is for, and its body is a well-formed JSON file whose `body` field is unexpected shape.
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as FixtureFile).status !== 'number' ||
    !('body' in parsed)
  ) {
    throw new Error(`${path} is not a valid fixture: expected { status: number, body }`);
  }
  const file = parsed as FixtureFile;
  return {
    status: file.status,
    headers: file.headers ?? {},
    body: file.body,
  };
}

/**
 * Builds a `Fetcher` that never touches the network. `provider` and `endpoint` are fixed per
 * adapter call site, matching how the wrapper already scopes `operation`; the case is read off
 * the request at call time so one fetcher instance can serve every case in the matrix.
 */
export function createFixtureFetcher(options: {
  provider: string;
  endpoint: string;
  root?: string;
}): Fetcher {
  const root = options.root ?? DEFAULT_FIXTURES_ROOT;
  return async (request) => {
    const fixtureCase = request.headers[FIXTURE_CASE_HEADER] ?? DEFAULT_FIXTURE_CASE;
    return readFixture(options.provider, options.endpoint, fixtureCase, root);
  };
}

/** A real `fetch`, stripped of the header fixture mode reserves — see the module doc. */
export function createLiveFetcher(): Fetcher {
  return async (request) => {
    const headers = { ...request.headers };
    delete headers[FIXTURE_CASE_HEADER];
    const response = await fetch(request.url, {
      method: request.method,
      headers,
      signal: request.signal,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      responseHeaders[name] = value;
    });
    return { status: response.status, headers: responseHeaders, body };
  };
}

/**
 * The single place an adapter decides fixture vs. live, so that decision is never duplicated
 * per adapter and never drifts from `env.PROVIDER_MODE` (`05-TEST-STRATEGY.md` §2: fixture is
 * the default in development and the only mode in CI).
 */
export function createFetcher(
  providerMode: 'fixture' | 'live',
  options: { provider: string; endpoint: string; root?: string },
): Fetcher {
  return providerMode === 'live' ? createLiveFetcher() : createFixtureFetcher(options);
}
