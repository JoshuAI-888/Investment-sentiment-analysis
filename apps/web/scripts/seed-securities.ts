/**
 * Populate the security master for every symbol in `migrations/seed/universe-v1.json`.
 *
 * **The prerequisite `pnpm seed:universe` always had and nobody had run into.**
 * `repositories/universe-seed.ts` resolves each seeded symbol against `security` and refuses the
 * entire seed if even one is missing — correctly, since a partial universe silently changes what
 * every aggregate in the product is computed over. But nothing in the product ever *wrote* to
 * that table: `insertSecurity` was reachable only from the `testing.ts` helpers under
 * `services/`, which every integration test calls before seeding. So the universe seed had only
 * ever run against a database its own test helpers had already populated, and `docs/DEPLOY.md`'s
 * "the only remaining step is executing `pnpm seed:universe`" was wrong on a fresh production
 * database. It failed there on the first real attempt, naming all 100 symbols as missing.
 *
 * **Why the data comes from FMP rather than from the seed file.** `universe-v1.json` carries only
 * `symbol` and `exchange`, while `security.name`, `asset_type` and `currency` are all `not null`.
 * Hand-writing 100 company names would mean guessing on the ones nobody recognises — and this
 * list came from ApeWisdom's most-discussed board, which picks up crypto tickers and misparsed
 * English words alongside equities. A wrong name written here is permanent and silent: every
 * snapshot afterwards is attributed to a company that was never on the board. Fetching real
 * profiles both avoids that and surfaces which tickers do not resolve at all.
 *
 * **The seed file's `exchange` wins over FMP's.** `MEMORY.md` B-21 records that every exchange in
 * `universe-v1.json` was resolved against SEC's own ticker registry rather than guessed, and it
 * is the value `seedUniverse` will look the symbol up by. FMP's `exchangeShortName` is reported
 * as a warning when the two disagree, never silently preferred — a mismatch is worth a human's
 * attention, and taking FMP's value would guarantee the universe seed then fails to resolve.
 *
 * Idempotent: a symbol already present at `(symbol, exchange)` is left exactly as it is.
 */
import { env } from '../src/env';
import { fetchCompanyProfiles } from '../src/adapters/market';
import { marketCollectorWrapperDeps } from '../src/services/market/provider-deps';
import { closePool, getPool } from '../src/repositories/client';
import { findSecurityBySymbol, insertSecurity } from '../src/repositories/security';
import { loadSeedFile } from '../src/repositories/universe-seed';

/** FMP's profile endpoint takes a comma-separated batch; 25 keeps the URL well inside limits. */
const BATCH_SIZE = 25;

async function main(): Promise<void> {
  const seed = await loadSeedFile();
  const db = getPool();

  const wanted = seed.symbols;
  process.stdout.write(`universe seed lists ${wanted.length} symbol(s)\n`);

  const alreadyPresent: string[] = [];
  const toFetch: { symbol: string; exchange: string }[] = [];
  for (const entry of wanted) {
    // `findSecurityBySymbol` returns `null` for absent, not `undefined` — an `=== undefined`
    // check here silently reported every symbol as already present on an empty database, which
    // is why this script was run against a real one before being trusted.
    const existing = await findSecurityBySymbol(entry.symbol, entry.exchange, db);
    if (existing === null) toFetch.push(entry);
    else alreadyPresent.push(`${entry.symbol}@${entry.exchange}`);
  }

  if (toFetch.length === 0) {
    process.stdout.write(`security master already has all ${wanted.length} — nothing to do\n`);
    return;
  }
  process.stdout.write(`${alreadyPresent.length} already present, fetching ${toFetch.length}\n`);

  // The same wrapper deps the market collector uses — this is an FMP call on that vendor's
  // account, and reusing the collector's composition keeps the breaker, rate limiter and cost
  // sink identical rather than inventing a second, subtly different set for a one-shot script.
  const deps = marketCollectorWrapperDeps({ db });

  type Profile = Awaited<ReturnType<typeof fetchCompanyProfiles>> & { ok: true };
  const bySymbol = new Map<string, Profile['data'][number]>();

  for (let index = 0; index < toFetch.length; index += BATCH_SIZE) {
    const batch = toFetch.slice(index, index + BATCH_SIZE);
    const result = await fetchCompanyProfiles(
      {
        symbols: batch.map((entry) => entry.symbol),
        ...(env.FMP_API_KEY === undefined ? {} : { apiKey: env.FMP_API_KEY }),
      },
      env.PROVIDER_MODE,
      deps,
    );
    if (!result.ok) {
      // The whole error, not just its kind: an `upstream` with no status is a different
      // problem from a 403, and a one-shot bootstrap script that hides which one it hit costs
      // a debugging cycle every time.
      throw new Error(
        `FMP profile fetch failed for batch starting ${batch[0]?.symbol ?? '?'}: ` +
          `${JSON.stringify(result.error)}. No securities were written for this batch.`,
      );
    }
    for (const profile of result.data) bySymbol.set(profile.symbol.toUpperCase(), profile);
    process.stdout.write(`  fetched ${result.data.length}/${batch.length} for batch ${index / BATCH_SIZE + 1}\n`);
  }

  const unresolved: string[] = [];
  const exchangeMismatches: string[] = [];
  let inserted = 0;

  for (const entry of toFetch) {
    const profile = bySymbol.get(entry.symbol.toUpperCase());
    if (profile === undefined) {
      unresolved.push(`${entry.symbol}@${entry.exchange}`);
      continue;
    }
    if (profile.exchangeShortName.toUpperCase() !== entry.exchange.toUpperCase()) {
      exchangeMismatches.push(
        `${entry.symbol}: seed says ${entry.exchange}, FMP says ${profile.exchangeShortName}`,
      );
    }
    await insertSecurity(
      {
        symbol: entry.symbol,
        name: profile.companyName,
        // The seed file's exchange, deliberately — see this file's header.
        exchange: entry.exchange,
        assetType: profile.isEtf ? 'etf' : 'equity',
        sector: profile.sector,
        industry: profile.industry,
        cik: profile.cik,
        currency: profile.currency,
        active: true,
        aliases: [],
      },
      db,
    );
    inserted += 1;
  }

  process.stdout.write(`\ninserted ${inserted} security row(s)\n`);

  if (exchangeMismatches.length > 0) {
    process.stdout.write(
      `\n${exchangeMismatches.length} exchange mismatch(es) — seeded with the seed file's value ` +
        `(B-21: resolved against SEC's registry), FMP's value shown for review:\n`,
    );
    for (const line of exchangeMismatches) process.stdout.write(`  ${line}\n`);
  }

  if (unresolved.length > 0) {
    process.stderr.write(
      `\n${unresolved.length} symbol(s) FMP could not resolve:\n  ${unresolved.join('\n  ')}\n\n` +
        'These are seeded universe members with no company behind them, so `pnpm seed:universe` ' +
        'will still refuse the whole seed. That refusal is correct and must not be worked around ' +
        'by dropping them quietly: the 100-symbol universe is a frozen methodological commitment ' +
        '(D-27, D-30) and changing its membership is an owner decision, recorded in MEMORY.md.\n',
    );
    process.exitCode = 3;
  }
}

try {
  await main();
} finally {
  await closePool();
}
