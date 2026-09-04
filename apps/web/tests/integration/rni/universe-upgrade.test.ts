import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { UNIVERSE_MAX_SYMBOLS, universeVersion } from '../../../src/contracts/config';
import { loadMigrations } from '../../../src/repositories/migrate';
import {
  insertUniverseProviderCall,
  stageFmpUniverseVersion,
} from '../../../src/repositories/versions';
import { databaseUrl, makePool, resetSchema } from '../helpers/db';
import { closePool, getPool } from '../../../src/repositories/client';

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
    if (url !== undefined) getPool(url);
  });

  afterAll(async () => {
    await closePool();
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

  it('stages 501 resolved members idempotently without changing the active universe', async () => {
    await resetSchema(pool);
    const configVersion = await insertConfig();
    const { rows: existing } = await pool.query<{ id: string }>(
      `insert into universe_version
         (environment, config_version, status, selected_count, created_by, change_reason, activated_at)
       values ('test', $1, 'active', 1, 'seed', 'historical active universe', now())
       returning id`,
      [configVersion],
    );
    const activeId = existing[0]?.id;

    const { rows: securities } = await pool.query<{ id: string; symbol: string; name: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       select case when n = 1 then 'NVDA' else 'T' || lpad(n::text, 3, '0') end,
              case when n = 1 then 'NVIDIA Corporation' else 'Company ' || n::text end,
              'NASDAQ', 'equity', 'USD'
         from generate_series(1, 501) as n
       returning id, symbol, name`,
    );
    const providerCallId = await insertUniverseProviderCall(
      {
        operation: 'sp500_constituent',
        requestFingerprint: 'fixture-fingerprint',
        statusCode: 200,
        latencyMs: 10,
        cacheStatus: 'miss',
        itemsReturned: 501,
        estimatedCostUsd: '0',
        startedAt: new Date('2026-09-05T00:00:00.000Z'),
        errorClass: null,
      },
      pool,
    );
    const input = {
      environment: 'test',
      sourceRetrievedAt: '2026-09-05T00:00:00.000Z',
      sourcePayloadHash: 'b'.repeat(64),
      providerCallId,
      members: securities.map((security) => ({
        securityId: security.id,
        providerSymbol: security.symbol,
        providerCompanyName: security.name,
        constituentFirstAddedAt: '2020-01-01T00:00:00.000Z',
      })),
      actorId: 'joshuai',
      requestId: 'sync-1',
      correlationId: 'corr-1',
    };

    const first = await stageFmpUniverseVersion(input);
    const replay = await stageFmpUniverseVersion({ ...input, requestId: 'sync-2' });
    const sameRequestDifferentPayload = await stageFmpUniverseVersion({
      ...input,
      sourcePayloadHash: 'c'.repeat(64),
    });

    expect(first).toMatchObject({ memberCount: 501, reused: false });
    expect(replay).toMatchObject({ memberCount: 501, reused: true });
    expect(replay.version.id).toBe(first.version.id);
    expect(sameRequestDifferentPayload).toMatchObject({ reused: true });
    expect(sameRequestDifferentPayload.version.id).toBe(first.version.id);
    const { rows: active } = await pool.query<{ id: string }>(
      `select id from universe_version where environment = 'test' and status = 'active'`,
    );
    expect(active[0]?.id).toBe(activeId);
    const { rows: counts } = await pool.query<{ versions: string; members: string; audits: string }>(
      `select
         (select count(*) from universe_version)::text as versions,
         (select count(*) from universe_member where universe_version = $1)::text as members,
         (select count(*) from audit_event where object_id = $1::text and action = 'stage')::text as audits`,
      [first.version.id],
    );
    expect(counts[0]).toEqual({ versions: '2', members: '501', audits: '1' });
  });
});
