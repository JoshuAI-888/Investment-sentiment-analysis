import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { ProviderMeta } from '../../../src/contracts/provider';
import {
  fmpSecurityMasterSnapshot,
  importFmpSecurityMasterSnapshot,
  listActiveSecurities,
} from '../../../src/repositories/security';
import {
  claimUniverseSyncCommand,
  completeUniverseSyncCommand,
  failUniverseSyncCommand,
  insertUniverseProviderCall,
  stageFmpUniverseVersion,
  waitForUniverseSyncCommand,
} from '../../../src/repositories/versions';
import { closePool, getPool } from '../../../src/repositories/client';
import { synchronizeFmpUniverse, type FmpUniverseSyncDeps } from '../../../src/rni/universe/sync';
import { databaseUrl, makePool, resetSchema } from '../helpers/db';

const url = databaseUrl();
const META: ProviderMeta = {
  provider: 'fmp',
  endpoint: 'sp500_constituent',
  requestedAt: '2026-09-05T00:00:00.000Z',
  latencyMs: 25,
  cache: 'miss',
  quotaRemaining: null,
  costUsd: null,
  payloadRef: null,
};

describe.skipIf(url === undefined)('I06R2 — durable universe command and security bootstrap', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  it('imports a clean 501-security master and replays sync keys without duplicate fetches', async () => {
    const profiles = Array.from({ length: 501 }, (_, index) => ({
      symbol: index === 0 ? 'NVDA' : `T${String(index).padStart(3, '0')}`,
      name: index === 0 ? 'NVIDIA Corporation' : `Company ${index}`,
      exchange: 'NASDAQ',
      sector: index === 0 ? 'Technology' : null,
      industry: index === 0 ? 'Semiconductors' : null,
      cik: index === 0 ? '0001045810' : null,
      currency: 'USD',
    }));
    const snapshot = fmpSecurityMasterSnapshot.parse({
      source: 'fmp_profile_export',
      sourceEndpoint: '/stable/profile',
      retrievedAt: META.requestedAt,
      payloadSha256: createHash('sha256').update(JSON.stringify(profiles)).digest('hex'),
      securities: profiles,
    });
    const imported = await importFmpSecurityMasterSnapshot(
      {
        environment: 'test',
        actorId: 'joshuai',
        idempotencyKey: 'security-bootstrap-1',
        correlationId: 'corr-bootstrap-1',
        snapshot,
      },
      pool,
    );
    const replayedImport = await importFmpSecurityMasterSnapshot(
      {
        environment: 'test',
        actorId: 'joshuai',
        idempotencyKey: 'security-bootstrap-2',
        correlationId: 'corr-bootstrap-2',
        snapshot,
      },
      pool,
    );
    expect(imported).toMatchObject({ importedCount: 501, reusedCount: 0, replayed: false });
    expect(replayedImport).toEqual({ ...imported, replayed: true });
    expect(await listActiveSecurities(pool)).toHaveLength(501);
    const { rows: importedMembers } = await pool.query<{
      provider_symbol: string;
      source_ordinal: number;
    }>(
      `select provider_symbol, source_ordinal
         from rni_security_master_import_member
        where import_id = $1
        order by source_ordinal`,
      [imported.importId],
    );
    expect(importedMembers).toHaveLength(501);
    expect(importedMembers[0]).toEqual({ provider_symbol: 'NVDA', source_ordinal: 0 });
    const { rows: importAudits } = await pool.query<{ action: string }>(
      `select action from audit_event
        where object_type = 'rni_security_master_import'
        order by occurred_at`,
    );
    expect(importAudits).toEqual([{ action: 'import' }, { action: 'replay' }]);

    const { rows: configs } = await pool.query<{ id: string }>(
      `insert into config_version
         (environment, status, created_by, change_reason, checksum, activated_at)
       values ('test', 'active', 'owner', 'bootstrap', 'sum', now())
       returning id`,
    );
    await pool.query(
      `insert into universe_version
         (environment, config_version, status, selected_count, created_by, change_reason, activated_at)
       values ('test', $1, 'active', 0, 'seed', 'empty clean parent', now())`,
      [configs[0]!.id],
    );

    const constituents = profiles.map((profile) => ({
      symbol: profile.symbol,
      name: profile.name,
      dateFirstAdded: '2020-01-01',
    }));
    let constituentPayloadHash = 'b'.repeat(64);
    const fetchConstituents = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 75));
      const providerCallId = await insertUniverseProviderCall(
        {
          operation: 'sp500_constituent',
          requestFingerprint: `fixture-${constituentPayloadHash}`,
          statusCode: 200,
          latencyMs: 25,
          cacheStatus: 'miss',
          itemsReturned: 501,
          estimatedCostUsd: '0',
          startedAt: new Date(META.requestedAt),
          errorClass: null,
        },
        pool,
      );
      return {
        ok: true as const,
        data: { constituents, payloadSha256: constituentPayloadHash },
        meta: META,
        providerCallId,
      };
    });
    const deps: FmpUniverseSyncDeps = {
      claimCommand: (command) => claimUniverseSyncCommand(command),
      waitForCommand: (command) => waitForUniverseSyncCommand(command),
      completeCommand: (command) => completeUniverseSyncCommand(command),
      failCommand: (command) => failUniverseSyncCommand(command),
      fetchConstituents,
      listSecurities: () => listActiveSecurities(pool),
      stage: (input) => stageFmpUniverseVersion(input),
    };
    const command = {
      environment: 'test',
      actorId: 'joshuai',
      idempotencyKey: 'universe-sync-1',
      correlationId: 'corr-sync-1',
    };
    const [first, concurrentReplay] = await Promise.all([
      synchronizeFmpUniverse(command, deps),
      synchronizeFmpUniverse(command, deps),
    ]);
    expect(first).toEqual(concurrentReplay);
    expect(first).toMatchObject({ ok: true, staged: { memberCount: 501, reused: false } });
    expect(fetchConstituents).toHaveBeenCalledOnce();

    const laterReplay = await synchronizeFmpUniverse(command, deps);
    expect(laterReplay).toEqual(first);
    expect(fetchConstituents).toHaveBeenCalledOnce();

    const hashReuseCommand = {
      ...command,
      idempotencyKey: 'universe-sync-2',
      correlationId: 'corr-sync-2',
    };
    const hashReuse = await synchronizeFmpUniverse(hashReuseCommand, deps);
    expect(hashReuse).toMatchObject({ ok: true, staged: { reused: true } });
    expect(fetchConstituents).toHaveBeenCalledTimes(2);

    constituentPayloadHash = 'c'.repeat(64);
    const boundReplay = await synchronizeFmpUniverse(hashReuseCommand, deps);
    expect(boundReplay).toEqual(hashReuse);
    expect(fetchConstituents).toHaveBeenCalledTimes(2);

    const { rows: commandRows } = await pool.query<{
      idempotency_key: string;
      status: string;
      universe_version: string;
    }>(
      `select idempotency_key, status, universe_version
         from rni_universe_sync_command
        order by idempotency_key`,
    );
    expect(commandRows).toHaveLength(2);
    expect(commandRows.map(({ status }) => status)).toEqual(['completed', 'completed']);
    expect(commandRows[0]?.universe_version).toBe(commandRows[1]?.universe_version);
    const { rows: audits } = await pool.query<{ action: string }>(
      `select action from audit_event
        where object_type = 'rni_universe_sync_command'
        order by occurred_at`,
    );
    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining(['request', 'complete', 'replay']),
    );
  });

  it('persists and replays an audited provider failure without another provider call', async () => {
    const fetchConstituents = vi.fn(async () => {
      const providerCallId = await insertUniverseProviderCall(
        {
          operation: 'sp500_constituent',
          requestFingerprint: 'fixture-entitlement-failure',
          statusCode: 403,
          latencyMs: 25,
          cacheStatus: 'miss',
          itemsReturned: null,
          estimatedCostUsd: '0',
          startedAt: new Date(META.requestedAt),
          errorClass: 'entitlement',
        },
        pool,
      );
      return {
        ok: false as const,
        error: { kind: 'entitlement' as const, endpoint: 'sp500_constituent', status: 403 },
        meta: META,
        providerCallId,
      };
    });
    const deps: FmpUniverseSyncDeps = {
      claimCommand: (command) => claimUniverseSyncCommand(command),
      waitForCommand: (command) => waitForUniverseSyncCommand(command),
      completeCommand: (command) => completeUniverseSyncCommand(command),
      failCommand: (command) => failUniverseSyncCommand(command),
      fetchConstituents,
      listSecurities: async () => {
        throw new Error('provider failure must not read the security master');
      },
      stage: async () => {
        throw new Error('provider failure must not stage a universe');
      },
    };
    const command = {
      environment: 'test',
      actorId: 'joshuai',
      idempotencyKey: 'universe-sync-provider-failure',
      correlationId: 'corr-sync-provider-failure',
    };

    const first = await synchronizeFmpUniverse(command, deps);
    const replay = await synchronizeFmpUniverse(command, deps);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({ ok: false, kind: 'provider' });
    expect(fetchConstituents).toHaveBeenCalledOnce();
    const { rows: commandRows } = await pool.query<{
      status: string;
      provider_call_id: string | null;
    }>(
      `select status, provider_call_id
         from rni_universe_sync_command
        where environment = 'test' and idempotency_key = 'universe-sync-provider-failure'`,
    );
    expect(commandRows[0]).toMatchObject({ status: 'completed' });
    expect(commandRows[0]?.provider_call_id).not.toBeNull();
    const { rows: audits } = await pool.query<{ action: string; result: string }>(
      `select action, result from audit_event
        where object_type = 'rni_universe_sync_command'
          and object_id = 'test:universe-sync-provider-failure'
        order by occurred_at`,
    );
    expect(audits).toEqual([
      { action: 'request', result: 'success' },
      { action: 'complete', result: 'failure' },
      { action: 'replay', result: 'success' },
    ]);
  });

  it('binds and audits an unexpected post-fetch failure and never refetches its key', async () => {
    const payloadSha256 = 'd'.repeat(64);
    const fetchConstituents = vi.fn(async () => {
      const providerCallId = await insertUniverseProviderCall(
        {
          operation: 'sp500_constituent',
          requestFingerprint: 'fixture-post-fetch-failure',
          statusCode: 200,
          latencyMs: 25,
          cacheStatus: 'miss',
          itemsReturned: 501,
          estimatedCostUsd: '0',
          startedAt: new Date(META.requestedAt),
          errorClass: null,
        },
        pool,
      );
      return {
        ok: true as const,
        data: { constituents: [], payloadSha256 },
        meta: META,
        providerCallId,
      };
    });
    const deps: FmpUniverseSyncDeps = {
      claimCommand: (command) => claimUniverseSyncCommand(command),
      waitForCommand: (command) => waitForUniverseSyncCommand(command),
      completeCommand: (command) => completeUniverseSyncCommand(command),
      failCommand: (command) => failUniverseSyncCommand(command),
      fetchConstituents,
      listSecurities: async () => {
        throw new Error('security master unavailable');
      },
      stage: async () => {
        throw new Error('must not stage');
      },
    };
    const command = {
      environment: 'test',
      actorId: 'joshuai',
      idempotencyKey: 'universe-sync-post-fetch-failure',
      correlationId: 'corr-sync-post-fetch-failure',
    };

    await expect(synchronizeFmpUniverse(command, deps)).rejects.toThrow(
      'security master unavailable',
    );
    await expect(synchronizeFmpUniverse(command, deps)).rejects.toThrow(
      'Prior FMP universe synchronization failed: security master unavailable',
    );
    expect(fetchConstituents).toHaveBeenCalledOnce();
    const { rows: commandRows } = await pool.query<{
      status: string;
      provider_call_id: string | null;
      source_payload_hash: string | null;
    }>(
      `select status, provider_call_id, source_payload_hash
         from rni_universe_sync_command
        where environment = 'test' and idempotency_key = 'universe-sync-post-fetch-failure'`,
    );
    expect(commandRows[0]).toMatchObject({ status: 'failed', source_payload_hash: payloadSha256 });
    expect(commandRows[0]?.provider_call_id).not.toBeNull();
    const { rows: audits } = await pool.query<{ action: string; result: string }>(
      `select action, result from audit_event
        where object_type = 'rni_universe_sync_command'
          and object_id = 'test:universe-sync-post-fetch-failure'
        order by occurred_at`,
    );
    expect(audits).toEqual([
      { action: 'request', result: 'success' },
      { action: 'fail', result: 'failure' },
      { action: 'replay', result: 'failure' },
    ]);
  });
});
