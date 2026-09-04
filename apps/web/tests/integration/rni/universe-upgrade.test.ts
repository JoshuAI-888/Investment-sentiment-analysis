import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { UNIVERSE_MAX_SYMBOLS, universeVersion } from '../../../src/contracts/config';
import { loadMigrations } from '../../../src/repositories/migrate';
import { databaseUrl, makePool, resetSchema } from '../helpers/db';

const url = databaseUrl();
const WEB_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const UPGRADE_PATH = path.join(WEB_ROOT, 'migrations/0024_rni_universe_upgrade.sql');

const BASE_VERSION = {
  id: '1',
  environment: 'test',
  configVersion: '1',
  status: 'active' as const,
  parentVersion: null,
  selectionQuery: null,
  impactPreview: {},
  sourceProvider: null,
  sourceEndpoint: null,
  sourceRetrievedAt: null,
  sourcePayloadHash: null,
  providerCallId: null,
  createdBy: 'owner',
  changeReason: 'FMP S&P 500 snapshot',
  createdAt: new Date(),
  activatedAt: new Date(),
  approvedBy: null,
};

describe('D-RNI-06 — universe contract ceiling', () => {
  it('accepts 600 members and rejects 601', () => {
    expect(UNIVERSE_MAX_SYMBOLS).toBe(600);
    expect(universeVersion.safeParse({ ...BASE_VERSION, selectedCount: 600 }).success).toBe(true);
    expect(universeVersion.safeParse({ ...BASE_VERSION, selectedCount: 601 }).success).toBe(false);
  });
});

describe.skipIf(url === undefined)('I05 — forward RNI universe migration', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = makePool();
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function applyPreUpgradeMigrations(): Promise<void> {
    await pool.query('drop schema public cascade; create schema public;');
    const migrations = await loadMigrations();
    for (const migration of migrations.filter(({ filename }) => filename < '0024_')) {
      await pool.query(migration.sql);
    }
  }

  async function insertConfig(): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into config_version
         (environment, status, created_by, change_reason, checksum, activated_at)
       values ('test', 'active', 'owner', 'bootstrap', 'sum', now())
       returning id`,
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('config_version insert returned no row');
    return id;
  }

  async function expectCeiling(configVersion: string): Promise<void> {
    await expect(
      pool.query(
        `insert into universe_version
           (environment, config_version, status, selected_count, created_by, change_reason)
         values ('test', $1, 'draft', 600, 'owner', 'valid S&P 500 snapshot')`,
        [configVersion],
      ),
    ).resolves.toBeDefined();

    await expect(
      pool.query(
        `insert into universe_version
           (environment, config_version, status, selected_count, created_by, change_reason)
         values ('test', $1, 'draft', 601, 'owner', 'invalid oversized snapshot')`,
        [configVersion],
      ),
    ).rejects.toThrow(/universe_version_max_symbols_check/);
  }

  it('upgrades an existing 100-member active universe without rewriting it', async () => {
    await applyPreUpgradeMigrations();
    const configVersion = await insertConfig();
    const { rows } = await pool.query<{ id: string }>(
      `insert into universe_version
         (environment, config_version, status, selected_count, created_by, change_reason, activated_at)
       values ('test', $1, 'active', 100, 'seed', 'historical seed', now())
       returning id`,
      [configVersion],
    );
    const historicalId = rows[0]?.id;

    await pool.query(await readFile(UPGRADE_PATH, 'utf8'));

    const { rows: historical } = await pool.query<{
      id: string;
      status: string;
      selected_count: number;
      source_provider: string | null;
    }>(
      `select id, status, selected_count, source_provider
         from universe_version
        where id = $1`,
      [historicalId],
    );
    expect(historical[0]).toEqual({
      id: historicalId,
      status: 'active',
      selected_count: 100,
      source_provider: null,
    });
    await expectCeiling(configVersion);
  });

  it('applies cleanly with the complete migration set and exposes FMP lineage columns', async () => {
    await resetSchema(pool);
    const configVersion = await insertConfig();

    const { rows } = await pool.query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name in ('universe_version', 'universe_member')
          and column_name = any($1)
        order by column_name`,
      [[
        'approved_by',
        'constituent_first_added_at',
        'provider_call_id',
        'provider_company_name',
        'provider_symbol',
        'source_endpoint',
        'source_payload_hash',
        'source_provider',
        'source_retrieved_at',
      ]],
    );
    expect(rows.map(({ column_name }) => column_name)).toEqual([
      'approved_by',
      'constituent_first_added_at',
      'provider_call_id',
      'provider_company_name',
      'provider_symbol',
      'source_endpoint',
      'source_payload_hash',
      'source_provider',
      'source_retrieved_at',
    ]);
    await expectCeiling(configVersion);

    const { rows: securities } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('NVDA', 'NVIDIA Corporation', 'NASDAQ', 'equity', 'USD')
       returning id`,
    );
    const { rows: versions } = await pool.query<{ id: string }>(
      `insert into universe_version
         (environment, config_version, status, selected_count, created_by, change_reason)
       values ('test', $1, 'draft', 1, 'owner', 'FMP candidate')
       returning id`,
      [configVersion],
    );
    await expect(
      pool.query(
        `insert into universe_member
           (universe_version, security_id, added_by, selection_source)
         values ($1, $2, 'sync', 'fmp_sp500')`,
        [versions[0]?.id, securities[0]?.id],
      ),
    ).rejects.toThrow(/universe_member_fmp_lineage_check/);
    await expect(
      pool.query(
        `insert into universe_member
           (universe_version, security_id, added_by, selection_source,
            provider_symbol, provider_company_name)
         values ($1, $2, 'sync', 'fmp_sp500', 'NVDA', 'NVIDIA Corporation')`,
        [versions[0]?.id, securities[0]?.id],
      ),
    ).resolves.toBeDefined();
  });
});
