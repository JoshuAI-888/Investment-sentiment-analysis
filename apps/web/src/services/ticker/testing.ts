/**
 * Test-only ticker-page fixture seeding. **Never reachable outside `PROVIDER_MODE=fixture`** —
 * the route that calls this (`app/api/ticker/e2e-seed/route.ts`) 404s in every other mode, the
 * same guard `api/auth/fixture-otp/route.ts` (F02) and `api/dashboard/e2e-seed/route.ts` (F07)
 * already establish.
 *
 * **Why this exists at all.** F09's e2e suite needs a security with real, computable attention/
 * stance/news/price data, a second security genuinely ambiguous across two exchanges, and a
 * third with nothing on record — deterministically, on every run. Building that through real
 * collectors is impossible (none are wired to this environment; F04's social adapters and F08's
 * leaderboard have not merged), so this seeds the stored rows those collectors would eventually
 * write, using the same repository functions `services/ticker/snapshot.ts` reads — the read path
 * itself is exercised for real; only the writing collectors are stood in for.
 */
import { insertSecurity, insertSecurityProfileSnapshot } from '@/repositories/security';
import { insertMarketSnapshot, insertPriceReturnSnapshot } from '@/repositories/market';
import { insertAttentionSnapshot } from '@/repositories/attention';
import { insertEvidenceItem } from '@/repositories/evidence';
import { activateConfigVersion, insertConfigVersion } from '@/repositories/versions';

const AUDIT = { actorId: 'e2e', actorRole: 'test', reason: 'e2e fixture seed', requestId: 'e2e', correlationId: 'e2e' };

async function ensureActiveConfigVersion(): Promise<void> {
  const draft = await insertConfigVersion({
    environment: 'production',
    createdBy: 'e2e',
    changeReason: 'e2e fixture seed',
    checksum: `e2e-${Date.now().toString(36)}`,
  });
  await activateConfigVersion('production', draft.id, AUDIT);
}

/** A unique-enough symbol per call, so a re-run of the suite does not collide with a prior one. */
function uniqueSymbol(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

export type SeedFullResult = { readonly symbol: string };

/**
 * A security with real attention, stance (including one unreachable Reddit item), news and
 * price-return data — everything but the technical/regime methods, which abstain
 * `not_applicable` under this schema's unadjusted closes regardless of how much history exists
 * (see `services/ticker/inputs.ts`'s own doc comment).
 */
export async function seedFullTicker(): Promise<SeedFullResult> {
  const symbol = uniqueSymbol('E2EF');
  const security = await insertSecurity({
    symbol,
    name: 'E2E Fixture Corp',
    exchange: 'NYSE',
    assetType: 'equity',
    sector: 'Consumer',
    industry: null,
    cik: null,
    currency: 'USD',
    active: true,
    // Workaround for a real, already-reported bug in `insertSecurity` (`repositories/
    // security.ts`, SPINE-owned) — `services/dashboard/ensure-securities.ts` (F07) found and
    // documents it in full: `insertClause` passes a JS array straight through as a query
    // parameter with no JSON serialization, so node-postgres renders it as a Postgres
    // array-literal string, not JSON, and a `jsonb` column reads it back wrong (or rejects it
    // outright for a non-empty array). Passing the JSON text directly is the narrowest fix
    // reachable from this lane (`repositories/` is not this lane's to edit); every seed here
    // only ever needs an empty list.
    aliases: '[]' as unknown as string[],
  });
  await ensureActiveConfigVersion();

  const observedAt = new Date();
  const ingestedAt = observedAt;

  await insertMarketSnapshot({
    securityId: security.id,
    price: '42.00',
    changePercent: '3.50',
    session: 'eod',
    provider: 'fmp',
    observedAt,
    ingestedAt,
    rawHash: 'e2e-market-1',
  });

  // Round-1 lane-review finding 4: without a price_return_snapshot row, buildDivergence always
  // returns `available: false` ("no 7-day return on record") — the divergence panel's own
  // e2e case could never actually exercise the `available: true` path, only assert past a
  // count-0 guard that made its own assertion unreachable.
  const baselineDate = new Date(observedAt.getTime() - 7 * 24 * 60 * 60 * 1000);
  await insertPriceReturnSnapshot({
    securityId: security.id,
    asOfDate: observedAt.toISOString().slice(0, 10),
    horizonCalendarDays: 7,
    asOfPrice: '42.00',
    asOfPriceDate: observedAt.toISOString().slice(0, 10),
    baselinePrice: '35.00',
    baselinePriceDate: baselineDate.toISOString().slice(0, 10),
    totalReturn: '0.20',
    adjustmentStatus: 'adjusted',
    qualityStatus: 'ok',
    provider: 'fmp',
    methodVersion: 'price-return-v1',
    computedAt: ingestedAt,
  });

  await insertAttentionSnapshot({
    securityId: security.id,
    // Round-1 lane-review finding 7: matches `snapshot.ts`'s real read filter (F08's collector
    // writes 'apewisdom', not 'reddit' — see that file's comment).
    source: 'apewisdom',
    rank: 5,
    rankPrior: 20,
    mentions: 200,
    mentionsPrior: 100,
    engagement: 900,
    windowHours: 24,
    coverageClass: 'pov_index',
    providerMethodologyVersion: 'e2e-v1',
    observedAt,
    ingestedAt,
    rawHash: 'e2e-attention-1',
  });

  // 5 classified, available Reddit items — enough for a real (not abstained) stance.
  for (let i = 0; i < 5; i += 1) {
    await insertEvidenceItem({
      securityId: security.id,
      evidenceType: 'social_result',
      provider: 'reddit',
      title: `E2E fixture Reddit post #${String(i)}`,
      snippet: 'the stored snippet as retrieved, for the e2e fixture',
      sourceUrl: `https://reddit.example/e2e/${String(i)}`,
      publisher: null,
      authorRef: null,
      stanceLabel: 'bullish',
      stanceScore: '0.80',
      relevanceScore: '0.90',
      publishedAt: observedAt,
      availableAt: observedAt,
      ingestedAt,
      lastCheckedAt: observedAt,
      availability: 'available',
      licenseClass: 'own_collected',
      coverageClass: 'licensed_sample',
      rawHash: `e2e-reddit-${String(i)}`,
      metadata: {},
    });
  }

  // One unreachable Reddit item — F-19's honest, non-blank marker (§4.3).
  await insertEvidenceItem({
    securityId: security.id,
    evidenceType: 'social_result',
    provider: 'reddit',
    title: 'E2E fixture Reddit post, now unreachable',
    snippet: 'the stored snippet as retrieved, before the source went dark',
    sourceUrl: 'https://reddit.example/e2e/gone',
    publisher: null,
    authorRef: null,
    stanceLabel: 'bearish',
    stanceScore: '0.60',
    relevanceScore: '0.70',
    publishedAt: observedAt,
    availableAt: observedAt,
    ingestedAt,
    lastCheckedAt: observedAt,
    availability: 'unreachable',
    licenseClass: 'own_collected',
    coverageClass: 'licensed_sample',
    rawHash: 'e2e-reddit-unreachable',
    metadata: {},
  });

  // 3 classified news items — exactly `min_articles`.
  for (let i = 0; i < 3; i += 1) {
    await insertEvidenceItem({
      securityId: security.id,
      evidenceType: 'news',
      provider: 'marketaux',
      title: `E2E fixture news article #${String(i)}`,
      snippet: 'the stored news snippet as retrieved',
      sourceUrl: `https://news.example/e2e/${String(i)}`,
      publisher: 'E2E Wire',
      authorRef: null,
      stanceLabel: 'bullish',
      stanceScore: '0.70',
      relevanceScore: '0.85',
      publishedAt: observedAt,
      availableAt: observedAt,
      ingestedAt,
      lastCheckedAt: null,
      availability: 'available',
      licenseClass: 'provider_terms',
      coverageClass: 'licensed_sample',
      rawHash: `e2e-news-${String(i)}`,
      metadata: {},
    });
  }

  return { symbol };
}

export type SeedAmbiguousResult = { readonly symbol: string };

/** Two active securities sharing one symbol on two exchanges — F09 §4.1's refused case. */
export async function seedAmbiguousTicker(): Promise<SeedAmbiguousResult> {
  const symbol = uniqueSymbol('E2ED');
  for (const exchange of ['NYSE', 'NASDAQ']) {
    await insertSecurity({
      symbol,
      name: 'E2E Ambiguous Corp',
      exchange,
      assetType: 'equity',
      sector: null,
      industry: null,
      cik: null,
      currency: 'USD',
      active: true,
      aliases: '[]' as unknown as string[],
    });
  }
  return { symbol };
}

export type SeedEmptyResult = { readonly symbol: string };

/** An ETF with nothing else on record — F09 §7 review step 4's "load an ETF ... confirm legible". */
export async function seedEmptyTicker(): Promise<SeedEmptyResult> {
  const symbol = uniqueSymbol('E2EE');
  await insertSecurity({
    symbol,
    name: 'E2E Empty ETF',
    exchange: 'NYSE',
    assetType: 'etf',
    sector: null,
    industry: null,
    cik: null,
    currency: 'USD',
    active: true,
    aliases: '[]' as unknown as string[],
  });
  return { symbol };
}

export type SeedIneligibleResult = { readonly symbol: string };

/** A security marked `unsupported` — F09 §4.1's other refused case. */
export async function seedIneligibleTicker(): Promise<SeedIneligibleResult> {
  const symbol = uniqueSymbol('E2EI');
  const security = await insertSecurity({
    symbol,
    name: 'E2E Ineligible Corp',
    exchange: 'NYSE',
    assetType: 'equity',
    sector: null,
    industry: null,
    cik: null,
    currency: 'USD',
    active: true,
    aliases: '[]' as unknown as string[],
  });
  await insertSecurityProfileSnapshot({
    securityId: security.id,
    provider: 'fmp',
    eligibilityState: 'unsupported',
    // jsonb — repositories/security.ts's `insertSecurityProfileSnapshot` does no JSON encoding
    // of its own (unlike `evidence.ts`'s `insertEvidenceItem`, which does), so a raw JS array
    // here would be serialized as a Postgres array literal, not JSON, by the driver.
    eligibilityReasons: JSON.stringify(['e2e fixture']),
    observedAt: new Date(),
    rawHash: 'e2e-ineligible',
  });
  return { symbol };
}
