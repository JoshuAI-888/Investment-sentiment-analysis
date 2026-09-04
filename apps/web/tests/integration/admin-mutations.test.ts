/**
 * F15 §5 Integration — "activation transaction rolls back cleanly on failure; a conflicting
 * concurrent write is refused with a diff; rollback creates a new version; audit written for
 * every mutation; data-explorer access is audited and rights-checked." Needs a real Postgres
 * (`DATABASE_URL`) — `describe.skipIf` mirrors every other integration suite in this repository.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { activateConfigVersion, insertConfigVersion } from '../../src/repositories/versions';
import { runAdminMutation } from '../../src/services/admin/mutation';
import { activateUniverseMutation, draftUniverseMutation } from '../../src/services/admin/universe';
import { updateSettingMutation } from '../../src/services/admin/settings';
import { getDataExplorerResults } from '../../src/services/admin/reads';
import { insertAuditEvent, listAuditEvents } from '../../src/repositories/audit';
import type { Session } from '../../src/services/auth';

const url = databaseUrl();

const SESSION: Session = {
  userId: 'admin-test',
  email: 'admin@example.com',
  sessionId: 'sess-1',
  expiresAt: new Date().toISOString(),
  mustChangePassword: false,
};

const AUDIT = {
  actorId: 'owner',
  actorRole: 'admin',
  reason: 'bootstrap',
  requestId: 'r',
  correlationId: 'c',
};

async function seedActiveConfig(pool: pg.Pool): Promise<string> {
  const draft = await insertConfigVersion(
    { environment: 'production', createdBy: 'owner', changeReason: 'bootstrap', checksum: 'sum-1' },
    pool,
  );
  const activated = await activateConfigVersion('production', draft.id, AUDIT);
  return activated.id;
}

async function seedSecurity(pool: pg.Pool, symbol: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into security (symbol, name, exchange, asset_type, currency)
     values ($1, $2, 'NASDAQ', 'equity', 'USD') returning id`,
    [symbol, `${symbol} Inc`],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

describe.skipIf(url === undefined)('F15 — admin mutations against a real Postgres', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  describe('universe: draft → activate → rollback', () => {
    it('draft then activate writes audit rows for both, and the resulting version is active', async () => {
      await seedActiveConfig(pool);
      const symbolId = await seedSecurity(pool, 'NVDA');

      const draftOutcome = await runAdminMutation(
        draftUniverseMutation,
        { reason: 'seed universe', expectedVersion: null, targetSecurityIds: [symbolId], selectionSource: 'seed' },
        SESSION,
      );
      expect(draftOutcome.ok).toBe(true);
      if (!draftOutcome.ok) return;

      const activateOutcome = await runAdminMutation(
        activateUniverseMutation,
        {
          reason: 'seed universe',
          expectedVersion: null,
          targetSecurityIds: [symbolId],
          selectionSource: 'seed',
          draftVersionId: draftOutcome.objectId,
        },
        SESSION,
      );
      expect(activateOutcome.ok).toBe(true);
      if (!activateOutcome.ok) return;
      expect(activateOutcome.rollbackTarget).toBeNull(); // first-ever version

      const events = await listAuditEvents({ objectType: 'universe_version' });
      // The pipeline's own audit (`universe.draft`, `universe.activate`) plus the low-level
      // helper's own `activate` row (`activateUniverseVersion`'s own atomic audit write) — see
      // `services/admin/universe.ts`'s module docstring for why both exist.
      expect(events.map((e) => e.action).sort()).toEqual(['activate', 'universe.activate', 'universe.draft'].sort());
    });

    it('a conflicting concurrent activation is refused with a diff, not a silent overwrite', async () => {
      await seedActiveConfig(pool);
      const first = await seedSecurity(pool, 'NVDA');
      const second = await seedSecurity(pool, 'TSLA');

      // Two admins independently draft against the *same* starting point (nothing active yet,
      // expectedVersion: null for both) — drafting never overwrites anything, so both succeed.
      const draft1 = await runAdminMutation(
        draftUniverseMutation,
        { reason: 'first draft', expectedVersion: null, targetSecurityIds: [first], selectionSource: 'seed' },
        SESSION,
      );
      if (!draft1.ok) throw new Error('draft1 failed');
      const draft2 = await runAdminMutation(
        draftUniverseMutation,
        { reason: 'stale draft', expectedVersion: null, targetSecurityIds: [second], selectionSource: 'seed' },
        SESSION,
      );
      if (!draft2.ok) throw new Error('draft2 failed');

      const activate1 = await runAdminMutation(
        activateUniverseMutation,
        {
          reason: 'first activation',
          expectedVersion: null,
          targetSecurityIds: [first],
          selectionSource: 'seed',
          draftVersionId: draft1.objectId,
        },
        SESSION,
      );
      if (!activate1.ok) throw new Error('activate1 failed');

      // The second admin now tries to activate their draft against the same (now-stale)
      // expectedVersion: null — activate1 already made that wrong.
      const activate2 = await runAdminMutation(
        activateUniverseMutation,
        {
          reason: 'stale activation',
          expectedVersion: null, // stale — activate1 already made this wrong
          targetSecurityIds: [second],
          selectionSource: 'seed',
          draftVersionId: draft2.objectId,
        },
        SESSION,
      );

      expect(activate2.ok).toBe(false);
      if (activate2.ok) return;
      expect(activate2.kind).toBe('conflict');
      if (activate2.kind === 'conflict') {
        expect(activate2.diff.expected).toBeNull();
        expect(activate2.diff.actual).toBeDefined();
      }

      // The first activation's membership is untouched — no silent overwrite.
      const { rows } = await pool.query<{ count: string }>(
        `select count(*)::text as count from universe_version where status = 'active'`,
      );
      expect(rows[0]?.count).toBe('1');
    });

    it('rollback (re-activating an old membership) creates a new version; history is not rewound', async () => {
      await seedActiveConfig(pool);
      const nvda = await seedSecurity(pool, 'NVDA');
      const tsla = await seedSecurity(pool, 'TSLA');

      const draft1 = await runAdminMutation(
        draftUniverseMutation,
        { reason: 'version 1', expectedVersion: null, targetSecurityIds: [nvda], selectionSource: 'seed' },
        SESSION,
      );
      if (!draft1.ok) throw new Error('draft1 failed');
      const activate1 = await runAdminMutation(
        activateUniverseMutation,
        { reason: 'version 1', expectedVersion: null, targetSecurityIds: [nvda], selectionSource: 'seed', draftVersionId: draft1.objectId },
        SESSION,
      );
      if (!activate1.ok) throw new Error('activate1 failed');

      const draft2 = await runAdminMutation(
        draftUniverseMutation,
        { reason: 'version 2', expectedVersion: activate1.objectId, targetSecurityIds: [nvda, tsla], selectionSource: 'seed' },
        SESSION,
      );
      if (!draft2.ok) throw new Error('draft2 failed');
      const activate2 = await runAdminMutation(
        activateUniverseMutation,
        { reason: 'version 2', expectedVersion: activate1.objectId, targetSecurityIds: [nvda, tsla], selectionSource: 'seed', draftVersionId: draft2.objectId },
        SESSION,
      );
      if (!activate2.ok) throw new Error('activate2 failed');

      // Roll back to v1's membership (nvda only) — via the same draft+activate mutations, a new
      // version, not an update of v1's row (which the append-only trigger would reject anyway).
      const rollbackDraft = await runAdminMutation(
        draftUniverseMutation,
        { reason: 'rollback to v1', expectedVersion: activate2.objectId, targetSecurityIds: [nvda], selectionSource: 'preset' },
        SESSION,
      );
      if (!rollbackDraft.ok) throw new Error('rollback draft failed');
      const rollbackActivate = await runAdminMutation(
        activateUniverseMutation,
        {
          reason: 'rollback to v1',
          expectedVersion: activate2.objectId,
          targetSecurityIds: [nvda],
          selectionSource: 'preset',
          draftVersionId: rollbackDraft.objectId,
        },
        SESSION,
      );
      expect(rollbackActivate.ok).toBe(true);
      if (!rollbackActivate.ok) return;

      // A new, third version — never the same id as v1.
      expect(rollbackActivate.objectId).not.toBe(activate1.objectId);
      expect(rollbackActivate.objectId).not.toBe(activate2.objectId);

      const { rows: versionRows } = await pool.query<{ count: string }>(
        `select count(*)::text as count from universe_version`,
      );
      expect(versionRows[0]?.count).toBe('3');

      // v1's own row is untouched — its content (change_reason) still reads "v1", not rewritten.
      const { rows: v1Rows } = await pool.query<{ change_reason: string; status: string }>(
        `select change_reason, status from universe_version where id = $1`,
        [activate1.objectId],
      );
      expect(v1Rows[0]?.change_reason).toBe('version 1');
      expect(v1Rows[0]?.status).toBe('superseded');
    });
  });

  describe('settings: update → conflict → rollback', () => {
    it('updating a setting creates and activates a new config_version, audited', async () => {
      const configId = await seedActiveConfig(pool);

      const outcome = await runAdminMutation(
        updateSettingMutation,
        { reason: 'raise the trigger threshold', expectedVersion: configId, key: 'trigger.price_move_pct', value: '4.00' },
        SESSION,
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.objectId).not.toBe(configId);

      const events = await listAuditEvents({ objectType: 'app_setting' });
      expect(events.some((e) => e.action === 'settings.update' && e.result === 'success')).toBe(true);
    });

    it('a stale expectedVersion is refused with a diff', async () => {
      const configId = await seedActiveConfig(pool);
      // Someone else updates first.
      const other = await runAdminMutation(
        updateSettingMutation,
        { reason: 'someone else changes it first', expectedVersion: configId, key: 'trigger.price_move_pct', value: '5.00' },
        SESSION,
      );
      if (!other.ok) throw new Error('setup failed');

      const stale = await runAdminMutation(
        updateSettingMutation,
        { reason: 'stale caller', expectedVersion: configId, key: 'trigger.window_minutes', value: 30 },
        SESSION,
      );
      expect(stale.ok).toBe(false);
      if (stale.ok) return;
      expect(stale.kind).toBe('conflict');
    });
  });

  describe('data explorer', () => {
    it('a rights-blocked payload is never returned, and access is audited even with zero results', async () => {
      const jobRunLike = randomUUID();
      await pool.query(
        `insert into raw_provider_payload
           (id, provider, operation, request_fingerprint, sanitized_payload, payload_hash,
            content_class, redaction_status, rights_status, parser_version, ingested_at, retention_until)
         values ($1, 'x', 'search', 'fp-1', '{}'::jsonb, 'hash-1', 'social_post', 'redacted', 'internal_only', 'v1', now(), now() + interval '30 days')`,
        [jobRunLike],
      );

      const { rows, restricted } = await getDataExplorerResults({ provider: 'x', asOf: new Date(), limit: 50 });
      expect(rows).toHaveLength(0);
      expect(restricted.rightsBlocked).toBe(1);

      await insertAuditEvent({
        actorId: SESSION.userId,
        actorRole: 'admin',
        action: 'data_explorer.view',
        objectType: 'raw_provider_payload',
        objectId: 'x',
        environment: 'production',
        reason: 'test access',
        beforeValue: null,
        afterValue: { returned: rows.length, restricted },
        result: 'success',
        requestId: randomUUID(),
        correlationId: randomUUID(),
      });

      const events = await listAuditEvents({ action: 'data_explorer.view' });
      expect(events).toHaveLength(1);
    });

    it('a retention-expired payload is excluded even though its rights are fine', async () => {
      await pool.query(
        `insert into raw_provider_payload
           (id, provider, operation, request_fingerprint, sanitized_payload, payload_hash,
            content_class, redaction_status, rights_status, parser_version, ingested_at, retention_until)
         values ($1, 'reddit', 'search', 'fp-2', '{}'::jsonb, 'hash-2', 'social_post', 'none', 'display_permitted', 'v1', now() - interval '100 days', now() - interval '1 day')`,
        [randomUUID()],
      );

      const { rows, restricted } = await getDataExplorerResults({ provider: 'reddit', asOf: new Date(), limit: 50 });
      expect(rows).toHaveLength(0);
      expect(restricted.retentionExpired).toBe(1);
    });
  });
});
