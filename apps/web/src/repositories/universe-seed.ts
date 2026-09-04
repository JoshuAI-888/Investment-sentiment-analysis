/**
 * The idempotent universe seed (F03 §4.4).
 *
 * **The rule that matters is the negative one:** a redeployment must never reinsert a symbol an
 * administrator removed. That is achieved by seeding only when the environment has *zero*
 * universe versions — not by checking whether each symbol is present, which would resurrect
 * every removal on the next deploy.
 *
 * D-27/D-30 set the list: the 100 most-discussed on Reddit, ranked via ApeWisdom. The list
 * itself is `DEPLOY.md` MT-07 and is owner-provided; this module refuses to invent one.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { UNIVERSE_MAX_SYMBOLS } from '../contracts/config';
import { getPool, withTransaction, type Queryable } from './client';

const SEED_FILE = fileURLToPath(new URL('../../migrations/seed/universe-v1.json', import.meta.url));

export const universeSeedFile = z.object({
  /** The date the ranking was pulled. A methodological commitment, not a convenience (MT-07). */
  seededAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date'),
  basis: z.string().min(1),
  symbols: z
    .array(z.object({ symbol: z.string().min(1), exchange: z.string().min(1) }))
    .min(1)
    .max(UNIVERSE_MAX_SYMBOLS),
});
export type UniverseSeedFile = z.infer<typeof universeSeedFile>;

export class SeedListMissing extends Error {
  constructor(file: string) {
    super(
      `No universe seed list at ${file}. This is DEPLOY.md MT-07: the count and basis are decided (100 most-discussed on Reddit via ApeWisdom, D-27/D-30) but the ranking has not been pulled. ` +
        'Seeding an invented list would put a universe nobody chose under every metric in the product, and D-16 makes the collection that follows unrepeatable.',
    );
    this.name = 'SeedListMissing';
  }
}

export async function loadSeedFile(file: string = SEED_FILE): Promise<UniverseSeedFile> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new SeedListMissing(path.relative(process.cwd(), file));
  }
  return universeSeedFile.parse(JSON.parse(raw));
}

export type SeedOutcome =
  | { readonly seeded: true; readonly universeVersion: string; readonly memberCount: number }
  | { readonly seeded: false; readonly reason: 'already_seeded'; readonly existingVersions: number };

/**
 * Resolves each symbol against the security master, failing on a missing or ambiguous one, and
 * creates universe version 1 transactionally. Exits without mutation if any universe version
 * already exists.
 */
export async function seedUniverse(
  environment: string,
  seed: UniverseSeedFile,
  db: Queryable = getPool(),
): Promise<SeedOutcome> {
  const { rows: existing } = await db.query<{ count: string }>(
    'select count(*)::text as count from universe_version where environment = $1',
    [environment],
  );
  const existingVersions = Number(existing[0]?.count ?? '0');

  if (existingVersions > 0) {
    return { seeded: false, reason: 'already_seeded', existingVersions };
  }

  const resolved: string[] = [];
  const missing: string[] = [];
  const ambiguous: string[] = [];

  for (const entry of seed.symbols) {
    const { rows } = await db.query<{ id: string }>(
      `select id from security where symbol = $1 and exchange = $2 and active = true`,
      [entry.symbol, entry.exchange],
    );
    if (rows.length === 0) missing.push(`${entry.symbol}@${entry.exchange}`);
    else if (rows.length > 1) ambiguous.push(`${entry.symbol}@${entry.exchange}`);
    else if (rows[0] !== undefined) resolved.push(rows[0].id);
  }

  if (missing.length > 0 || ambiguous.length > 0) {
    throw new Error(
      `Universe seed cannot resolve every symbol against the security master. ` +
        `Missing: ${missing.join(', ') || 'none'}. Ambiguous: ${ambiguous.join(', ') || 'none'}. ` +
        'Seeding a partial universe silently changes what every aggregate in the product is computed over.',
    );
  }

  return withTransaction(async (tx) => {
    const { rows: config } = await tx.query<{ id: string }>(
      `select id from config_version where environment = $1 and status = 'active'`,
      [environment],
    );
    const configVersion = config[0]?.id;
    if (configVersion === undefined) {
      throw new Error(
        `No active config_version in ${environment}. A universe version references the configuration it was selected under; seeding without one leaves every artifact unable to say what it was computed against.`,
      );
    }

    const { rows: version } = await tx.query<{ id: string }>(
      `insert into universe_version
         (environment, config_version, status, selected_count, created_by, change_reason, activated_at)
       values ($1, $2, 'active', $3, 'seed', $4, now())
       returning id`,
      [
        environment,
        configVersion,
        resolved.length,
        `Seed v1 — ${seed.basis}, ranking pulled ${seed.seededAt} (MT-07, D-30)`,
      ],
    );
    const universeVersion = version[0]?.id;
    if (universeVersion === undefined) throw new Error('universe_version insert returned no row');

    for (const securityId of resolved) {
      await tx.query(
        `insert into universe_member (universe_version, security_id, added_by, selection_source)
         values ($1, $2, 'seed', 'seed')`,
        [universeVersion, securityId],
      );
    }

    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason, result,
          request_id, correlation_id, after_value)
       values ('seed', 'system', 'seed', 'universe_version', $1, $2, $3, 'success', 'seed', 'seed', $4)`,
      [
        universeVersion,
        environment,
        `Seed v1 — ${seed.basis}, ranking pulled ${seed.seededAt}`,
        JSON.stringify({ seededAt: seed.seededAt, basis: seed.basis, count: resolved.length }),
      ],
    );

    return { seeded: true, universeVersion, memberCount: resolved.length };
  });
}
