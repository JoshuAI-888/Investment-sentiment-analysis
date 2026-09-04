/**
 * The SEC EDGAR adapter — F04 §4.3, `provider: 'sec_edgar'`.
 *
 * Free, no key — but **SEC blocks generic user agents** (`docs/DEPLOY.md`'s provider table),
 * so a real `SEC_USER_AGENT` (product name and contact address, per SEC's fair-access policy)
 * is a compliance requirement, not an optional header. `fetchCompanySubmissions` takes it as a
 * required-in-practice parameter for the same reason `market.ts`'s `apiKey` is: this module
 * reaches nothing outside `contracts/`, so nothing here reads `env.SEC_USER_AGENT` itself.
 *
 * **Schema confidence note.** `submissionsResponse` below reflects EDGAR's long-stable
 * `submissions/CIK##########.json` shape from public documentation, not a live-verified
 * payload — this session's `WebFetch` was itself blocked by the same generic-agent policy this
 * module works around. F04 §4.4's entitlement probe is exactly the mechanism that confirms a
 * schema like this against a real response before anything depends on it in production.
 */
import { z } from 'zod';
import type { ProviderResult } from '@/contracts/provider';
import { createFetcher } from './fixtures';
import type { WrapperDeps } from './wrapper';
import { callProvider } from './wrapper';

export type CompanySubmissions = {
  cik: string;
  name: string;
  sic: string;
  sicDescription: string;
  tickers: string[];
  exchanges: string[];
  /** One entry per recent filing, already zipped from EDGAR's column-of-arrays shape. */
  recentFilings: {
    accessionNumber: string;
    filingDate: string;
    reportDate: string;
    form: string;
    primaryDocument: string;
  }[];
};

const recentFilingColumns = z.object({
  accessionNumber: z.array(z.string()),
  filingDate: z.array(z.string()),
  reportDate: z.array(z.string()),
  form: z.array(z.string()),
  primaryDocument: z.array(z.string()),
});

const submissionsResponse = z.object({
  cik: z.string().min(1),
  name: z.string().min(1),
  sic: z.string(),
  sicDescription: z.string(),
  tickers: z.array(z.string()),
  exchanges: z.array(z.string()),
  filings: z.object({ recent: recentFilingColumns }),
});

/** `320193` → `0000320193`, the zero-padded form every EDGAR URL requires. */
export function padCik(cik: string): string {
  return cik.padStart(10, '0');
}

export async function fetchCompanySubmissions(
  options: {
    cik: string;
    /** Product name and contact address (SEC's fair-access policy). Required in `live` mode. */
    userAgent?: string;
    cacheTtlMs?: number;
    maxStaleMs?: number;
    /** Extra request headers — contract tests use this to set `x-fixture-case` (`./fixtures.ts`). */
    headers?: Readonly<Record<string, string>>;
  },
  providerMode: 'fixture' | 'live',
  deps: Omit<WrapperDeps, 'fetcher'> & { fixturesRoot?: string },
): Promise<ProviderResult<CompanySubmissions>> {
  if (providerMode === 'live' && (options.userAgent === undefined || options.userAgent === '')) {
    throw new Error(
      'fetchCompanySubmissions: userAgent is required in "live" mode — SEC blocks generic agents',
    );
  }

  const paddedCik = padCik(options.cik);
  const fetcher = createFetcher(providerMode, {
    provider: 'sec_edgar',
    endpoint: 'submissions',
    ...(deps.fixturesRoot === undefined ? {} : { root: deps.fixturesRoot }),
  });

  const result = await callProvider(
    {
      provider: 'sec_edgar',
      operation: 'submissions',
      segments: [paddedCik],
      schema: submissionsResponse,
      request: {
        url: `https://data.sec.gov/submissions/CIK${paddedCik}.json`,
        headers: {
          ...options.headers,
          ...(options.userAgent === undefined ? {} : { 'User-Agent': options.userAgent }),
        },
      },
      // Free (source §4.3's cost-shape table).
      estimatedCostUsd: null,
      ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
      ...(options.maxStaleMs === undefined ? {} : { maxStaleMs: options.maxStaleMs }),
    },
    { ...deps, fetcher },
  );

  if (!result.ok) return result;

  const { filings, ...entity } = result.data;
  const columns = filings.recent;
  const count = columns.accessionNumber.length;
  const recentFilings: CompanySubmissions['recentFilings'] = [];
  for (let i = 0; i < count; i += 1) {
    const accessionNumber = columns.accessionNumber[i];
    const filingDate = columns.filingDate[i];
    const reportDate = columns.reportDate[i];
    const form = columns.form[i];
    const primaryDocument = columns.primaryDocument[i];
    if (
      accessionNumber === undefined ||
      filingDate === undefined ||
      reportDate === undefined ||
      form === undefined ||
      primaryDocument === undefined
    ) {
      continue;
    }
    recentFilings.push({ accessionNumber, filingDate, reportDate, form, primaryDocument });
  }

  return { ok: true, data: { ...entity, recentFilings }, meta: result.meta };
}
