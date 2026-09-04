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
  insertAndBindUniverseProviderCall,
  insertUniverseProviderCall,
  stageAndCompleteFmpUniverseCommand,
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

function makeProfiles() {
  return Array.from({ length: 501 }, (_, index) => ({
    symbol: index === 0 ? 'NVDA' : `T${String(index).padStart(3, '0')}`,
    name: index === 0 ? 'NVIDIA Corporation' : `Company ${index}`,
    exchange: 'NASDAQ',
    sector: index === 0 ? 'Technology' : null,
    industry: index === 0 ? 'Semiconductors' : null,
    cik: index === 0 ? '0001045810' : null,
    currency: 'USD',
  }));
}

function makeSnapshot(profiles = makeProfiles()) {
  return fmpSecurityMasterSnapshot.parse({
    source: 'fmp_profile_export',
    sourceEndpoint: '/stable/profile',
    retrievedAt: META.requestedAt,
    payloadSha256: createHash('sha256').update(JSON.stringify(profiles)).digest('hex'),
    securities: profiles,
  });
}

describe.skipIf(url === undefined)(
  'I06R2/R3 — durable universe command and security bootstrap',
  () => {
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
      const profiles = makeProfiles();
      const snapshot = makeSnapshot(profiles);
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
      let releaseProvider!: () => void;
      const providerGate = new Promise<void>((resolve) => {
        releaseProvider = resolve;
      });
      const fetchConstituents = vi.fn(async () => {
        await providerGate;
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
        completeCommand: (command) => completeUniverseSyncCommand(command),
        failCommand: (command) => failUniverseSyncCommand(command),
        fetchConstituents,
        listSecurities: () => listActiveSecurities(pool),
        stageAndComplete: (input) => stageAndCompleteFmpUniverseCommand(input),
      };
      const command = {
        environment: 'test',
        actorId: 'joshuai',
        idempotencyKey: 'universe-sync-1',
        correlationId: 'corr-sync-1',
      };
      const firstPromise = synchronizeFmpUniverse(command, deps);
      await vi.waitFor(() => expect(fetchConstituents).toHaveBeenCalledOnce());
      const concurrentReplay = await synchronizeFmpUniverse(command, deps);
      expect(concurrentReplay).toMatchObject({ ok: false, kind: 'in_progress' });
      releaseProvider();
      const first = await firstPromise;
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

    it('reuses compatible identities and keeps import lineage append-only', async () => {
      const reversed = makeProfiles().reverse();
      const imported = await importFmpSecurityMasterSnapshot(
        {
          environment: 'test',
          actorId: 'joshuai',
          idempotencyKey: 'security-bootstrap-reordered',
          correlationId: 'corr-bootstrap-reordered',
          snapshot: makeSnapshot(reversed),
        },
        pool,
      );

      expect(imported).toMatchObject({ importedCount: 0, reusedCount: 501, replayed: false });
      const { rows: members } = await pool.query<{ count: string }>(
        `select count(*)::text as count
         from rni_security_master_import_member
        where import_id = $1`,
        [imported.importId],
      );
      expect(members[0]?.count).toBe('501');
      await expect(
        pool.query(`update rni_security_master_import set imported_by = 'other' where id = $1`, [
          imported.importId,
        ]),
      ).rejects.toThrow(/append-only/u);
      await expect(
        pool.query(
          `update rni_security_master_import_member
            set provider_company_name = 'Other'
          where import_id = $1 and provider_symbol = 'NVDA'`,
          [imported.importId],
        ),
      ).rejects.toThrow(/append-only/u);
      await expect(
        pool.query(
          `delete from rni_security_master_import_member
          where import_id = $1 and provider_symbol = 'NVDA'`,
          [imported.importId],
        ),
      ).rejects.toThrow(/append-only/u);
      await expect(
        pool.query('delete from rni_security_master_import where id = $1', [imported.importId]),
      ).rejects.toThrow(/append-only/u);
    });

    it('rolls back the complete bootstrap on CIK or exchange ambiguity', async () => {
      const conflicts = [
        [
          { ...makeProfiles()[1]!, symbol: 'NEWCIK', name: 'New CIK Rollback Security' },
          { ...makeProfiles()[0]!, cik: '9999999999' },
          ...makeProfiles().slice(2),
        ],
        [
          { ...makeProfiles()[1]!, symbol: 'NEWEX', name: 'New Exchange Rollback Security' },
          { ...makeProfiles()[0]!, exchange: 'NYSE' },
          ...makeProfiles().slice(2),
        ],
      ];

      for (const [index, profiles] of conflicts.entries()) {
        const snapshot = makeSnapshot(profiles);
        const idempotencyKey = `security-bootstrap-conflict-${index}`;
        await expect(
          importFmpSecurityMasterSnapshot(
            {
              environment: 'test',
              actorId: 'joshuai',
              idempotencyKey,
              correlationId: `corr-bootstrap-conflict-${index}`,
              snapshot,
            },
            pool,
          ),
        ).rejects.toThrow(index === 0 ? /conflicting CIK identity/u : /different exchange/u);
        const { rows } = await pool.query<{ count: string }>(
          `select count(*)::text as count
           from rni_security_master_import
          where source_payload_hash = $1`,
          [snapshot.payloadSha256],
        );
        expect(rows[0]?.count).toBe('0');
        const { rows: insertedSecurities } = await pool.query<{ count: string }>(
          `select count(*)::text as count from security where symbol = $1`,
          [profiles[0]!.symbol],
        );
        expect(insertedSecurities[0]?.count).toBe('0');
        const { rows: members } = await pool.query<{ count: string }>(
          `select count(*)::text as count
             from rni_security_master_import_member member
             join rni_security_master_import import on import.id = member.import_id
            where import.source_payload_hash = $1`,
          [snapshot.payloadSha256],
        );
        expect(members[0]?.count).toBe('0');
        const { rows: audits } = await pool.query<{ count: string }>(
          `select count(*)::text as count
             from audit_event
            where object_type = 'rni_security_master_import' and request_id = $1`,
          [idempotencyKey],
        );
        expect(audits[0]?.count).toBe('0');
      }
      expect(await listActiveSecurities(pool)).toHaveLength(501);
    });

    it('persists invalid-snapshot lineage and replays it without a version or refetch', async () => {
      const constituents = makeProfiles()
        .slice(0, 500)
        .map(({ symbol, name }) => ({ symbol, name, dateFirstAdded: '2020-01-01' }));
      const payloadSha256 = 'e'.repeat(64);
      const fetchConstituents = vi.fn(async () => {
        const providerCallId = await insertUniverseProviderCall(
          {
            operation: 'sp500_constituent',
            requestFingerprint: 'fixture-invalid-snapshot',
            statusCode: 200,
            latencyMs: 25,
            cacheStatus: 'miss',
            itemsReturned: 500,
            estimatedCostUsd: '0',
            startedAt: new Date(META.requestedAt),
            errorClass: null,
          },
          pool,
        );
        return {
          ok: true as const,
          data: { constituents, payloadSha256 },
          meta: META,
          providerCallId,
        };
      });
      const deps: FmpUniverseSyncDeps = {
        claimCommand: (command) => claimUniverseSyncCommand(command),
        completeCommand: (command) => completeUniverseSyncCommand(command),
        failCommand: (command) => failUniverseSyncCommand(command),
        fetchConstituents,
        listSecurities: () => listActiveSecurities(pool),
        stageAndComplete: (input) => stageAndCompleteFmpUniverseCommand(input),
      };
      const command = {
        environment: 'test',
        actorId: 'joshuai',
        idempotencyKey: 'universe-sync-invalid',
        correlationId: 'corr-sync-invalid',
      };

      const first = await synchronizeFmpUniverse(command, deps);
      const replay = await synchronizeFmpUniverse(command, deps);

      expect(first).toEqual(replay);
      expect(first).toMatchObject({
        ok: false,
        kind: 'invalid_snapshot',
        issues: [{ code: 'partial_payload', count: 500 }],
      });
      expect(fetchConstituents).toHaveBeenCalledOnce();
      const { rows: commands } = await pool.query<{
        status: string;
        provider_call_id: string | null;
        source_payload_hash: string | null;
        universe_version: string | null;
      }>(
        `select status, provider_call_id, source_payload_hash, universe_version
         from rni_universe_sync_command
        where environment = 'test' and idempotency_key = 'universe-sync-invalid'`,
      );
      expect(commands[0]).toMatchObject({
        status: 'completed',
        source_payload_hash: payloadSha256,
        universe_version: null,
      });
      expect(commands[0]?.provider_call_id).not.toBeNull();
      const { rows: audits } = await pool.query<{ action: string; result: string }>(
        `select action, result from audit_event
        where object_type = 'rni_universe_sync_command'
          and object_id = 'test:universe-sync-invalid'
        order by occurred_at`,
      );
      expect(audits).toEqual([
        { action: 'request', result: 'success' },
        { action: 'complete', result: 'failure' },
        { action: 'replay', result: 'success' },
      ]);
    });

    it('terminalizes an abandoned pre-fetch claim without redispatching FMP', async () => {
      const command = {
        environment: 'test',
        actorId: 'joshuai',
        idempotencyKey: 'universe-sync-abandoned',
        correlationId: 'corr-sync-abandoned',
      };
      await expect(claimUniverseSyncCommand(command)).resolves.toEqual({ state: 'claimed' });
      await pool.query(
        `update rni_universe_sync_command
          set lease_expires_at = now() - interval '1 second'
        where environment = $1 and idempotency_key = $2`,
        [command.environment, command.idempotencyKey],
      );
      const fetchConstituents = vi.fn(async () => {
        throw new Error('an abandoned command must not redispatch FMP');
      });
      const deps: FmpUniverseSyncDeps = {
        claimCommand: (claim) => claimUniverseSyncCommand(claim),
        completeCommand: (completion) => completeUniverseSyncCommand(completion),
        failCommand: (failure) => failUniverseSyncCommand(failure),
        fetchConstituents,
        listSecurities: () => listActiveSecurities(pool),
        stageAndComplete: (input) => stageAndCompleteFmpUniverseCommand(input),
      };

      const result = await synchronizeFmpUniverse(command, deps);

      expect(result).toEqual({
        ok: false,
        kind: 'command_failed',
        errorCode: 'UNIVERSE_SYNC_COMMAND_ABANDONED',
      });
      expect(fetchConstituents).not.toHaveBeenCalled();
      const { rows: commandRows } = await pool.query<{
        status: string;
        error_message: string | null;
        lease_expires_at: Date | null;
      }>(
        `select status, error_message, lease_expires_at
         from rni_universe_sync_command
        where environment = 'test' and idempotency_key = 'universe-sync-abandoned'`,
      );
      expect(commandRows[0]).toMatchObject({
        status: 'failed',
        error_message: 'UNIVERSE_SYNC_COMMAND_ABANDONED',
        lease_expires_at: null,
      });
      const { rows: audits } = await pool.query<{ action: string; result: string }>(
        `select action, result from audit_event
        where object_type = 'rni_universe_sync_command'
          and object_id = 'test:universe-sync-abandoned'
        order by occurred_at`,
      );
      expect(audits).toHaveLength(3);
      expect(audits).toEqual(
        expect.arrayContaining([
          { action: 'request', result: 'success' },
          { action: 'fail', result: 'failure' },
          { action: 'replay', result: 'failure' },
        ]),
      );
    });

    it('retains a persisted provider call when a post-dispatch command is abandoned', async () => {
      const command = {
        environment: 'test',
        actorId: 'joshuai',
        idempotencyKey: 'universe-sync-abandoned-after-dispatch',
        correlationId: 'corr-sync-abandoned-after-dispatch',
      };
      await expect(claimUniverseSyncCommand(command)).resolves.toEqual({ state: 'claimed' });
      const providerCallId = await insertAndBindUniverseProviderCall({
        command,
        call: {
          operation: 'sp500_constituent',
          requestFingerprint: 'fixture-abandoned-after-dispatch',
          statusCode: 200,
          latencyMs: 25,
          cacheStatus: 'miss',
          itemsReturned: 501,
          estimatedCostUsd: '0',
          startedAt: new Date(META.requestedAt),
          errorClass: null,
        },
      });
      await pool.query(
        `update rni_universe_sync_command
            set lease_expires_at = now() - interval '1 second'
          where environment = $1 and idempotency_key = $2`,
        [command.environment, command.idempotencyKey],
      );
      const fetchConstituents = vi.fn(async () => {
        throw new Error('an abandoned post-dispatch command must not redispatch FMP');
      });
      const result = await synchronizeFmpUniverse(command, {
        claimCommand: (claim) => claimUniverseSyncCommand(claim),
        completeCommand: (completion) => completeUniverseSyncCommand(completion),
        failCommand: (failure) => failUniverseSyncCommand(failure),
        fetchConstituents,
        listSecurities: () => listActiveSecurities(pool),
        stageAndComplete: (stageInput) => stageAndCompleteFmpUniverseCommand(stageInput),
      });

      expect(result).toEqual({
        ok: false,
        kind: 'command_failed',
        errorCode: 'UNIVERSE_SYNC_COMMAND_ABANDONED',
      });
      expect(fetchConstituents).not.toHaveBeenCalled();
      const { rows: commands } = await pool.query<{
        status: string;
        provider_call_id: string | null;
      }>(
        `select status, provider_call_id
           from rni_universe_sync_command
          where environment = $1 and idempotency_key = $2`,
        [command.environment, command.idempotencyKey],
      );
      expect(commands[0]).toEqual({ status: 'failed', provider_call_id: providerCallId });
      const { rows: calls } = await pool.query<{ id: string }>(
        `select id from provider_call_log where id = $1`,
        [providerCallId],
      );
      expect(calls).toEqual([{ id: providerCallId }]);
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
        completeCommand: (command) => completeUniverseSyncCommand(command),
        failCommand: (command) => failUniverseSyncCommand(command),
        fetchConstituents,
        listSecurities: async () => {
          throw new Error('provider failure must not read the security master');
        },
        stageAndComplete: async () => {
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
        completeCommand: (command) => completeUniverseSyncCommand(command),
        failCommand: (command) => failUniverseSyncCommand(command),
        fetchConstituents,
        listSecurities: async () => {
          throw new Error('security master unavailable');
        },
        stageAndComplete: async () => {
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
      await expect(synchronizeFmpUniverse(command, deps)).resolves.toEqual({
        ok: false,
        kind: 'command_failed',
        errorCode: 'security master unavailable',
      });
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
      expect(commandRows[0]).toMatchObject({
        status: 'failed',
        source_payload_hash: payloadSha256,
      });
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

    it('rolls staging back when terminal command persistence fails in the shared transaction', async () => {
      await pool.query(`
      create function rni_test_reject_command_complete() returns trigger
      language plpgsql as $$
      begin
        if new.object_type = 'rni_universe_sync_command' and new.action = 'complete' then
          raise exception 'forced command completion failure';
        end if;
        return new;
      end;
      $$;
      create trigger rni_test_reject_command_complete
        before insert on audit_event
        for each row execute function rni_test_reject_command_complete();
    `);
      const profiles = makeProfiles();
      const payloadSha256 = 'f'.repeat(64);
      const fetchConstituents = vi.fn(async () => {
        const providerCallId = await insertUniverseProviderCall(
          {
            operation: 'sp500_constituent',
            requestFingerprint: 'fixture-atomic-completion-failure',
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
          data: {
            constituents: profiles.map(({ symbol, name }) => ({
              symbol,
              name,
              dateFirstAdded: '2020-01-01',
            })),
            payloadSha256,
          },
          meta: META,
          providerCallId,
        };
      });
      const deps: FmpUniverseSyncDeps = {
        claimCommand: (command) => claimUniverseSyncCommand(command),
        completeCommand: (completion) => completeUniverseSyncCommand(completion),
        failCommand: (failure) => failUniverseSyncCommand(failure),
        fetchConstituents,
        listSecurities: () => listActiveSecurities(pool),
        stageAndComplete: (input) => stageAndCompleteFmpUniverseCommand(input),
      };
      const command = {
        environment: 'test',
        actorId: 'joshuai',
        idempotencyKey: 'universe-sync-atomic-failure',
        correlationId: 'corr-sync-atomic-failure',
      };

      try {
        await expect(synchronizeFmpUniverse(command, deps)).rejects.toThrow(
          'forced command completion failure',
        );
      } finally {
        await pool.query(
          'drop trigger rni_test_reject_command_complete on audit_event; drop function rni_test_reject_command_complete()',
        );
      }

      const { rows: staged } = await pool.query<{ count: string }>(
        `select count(*)::text as count from universe_version where source_payload_hash = $1`,
        [payloadSha256],
      );
      expect(staged[0]?.count).toBe('0');
      const { rows: commands } = await pool.query<{
        status: string;
        provider_call_id: string | null;
        source_payload_hash: string | null;
        universe_version: string | null;
      }>(
        `select status, provider_call_id, source_payload_hash, universe_version
         from rni_universe_sync_command
        where environment = 'test' and idempotency_key = 'universe-sync-atomic-failure'`,
      );
      expect(commands[0]).toMatchObject({
        status: 'failed',
        source_payload_hash: payloadSha256,
        universe_version: null,
      });
      expect(commands[0]?.provider_call_id).not.toBeNull();
    });
  },
);
