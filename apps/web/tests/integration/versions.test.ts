import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import {
  activateConfigVersion,
  activateUniverseVersion,
  findActiveConfigVersion,
  findActiveUniverseVersion,
  insertConfigVersion,
  insertUniverseVersion,
  listUniverseMembers,
} from '../../src/repositories/versions';
import { closePool, getPool } from '../../src/repositories/client';

const url = databaseUrl();

const AUDIT = {
  actorId: 'owner',
  actorRole: 'admin',
  reason: 'test activation',
  requestId: 'req-1',
  correlationId: 'corr-1',
};

describe.skipIf(url === undefined)('F03 §4.3 — one active version, activated transactionally', () => {
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

  async function draftConfig(reason = 'initial') {
    return insertConfigVersion({
      environment: 'test',
      createdBy: 'owner',
      changeReason: reason,
      checksum: `sum-${reason}`,
    });
  }

  it('activates a draft and records the audit event', async () => {
    const draft = await draftConfig();
    const activated = await activateConfigVersion('test', draft.id, AUDIT);

    expect(activated.status).toBe('active');
    expect(activated.activatedAt).not.toBeNull();

    const { rows } = await pool.query<{ action: string; object_id: string }>(
      `select action, object_id from audit_event where object_type = 'config_version'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('activate');
    expect(rows[0]?.object_id).toBe(draft.id);
  });

  it('supersedes the previous version rather than leaving two active', async () => {
    const first = await draftConfig('first');
    await activateConfigVersion('test', first.id, AUDIT);
    const second = await draftConfig('second');
    await activateConfigVersion('test', second.id, AUDIT);

    const active = await findActiveConfigVersion('test');
    expect(active?.id).toBe(second.id);

    const { rows } = await pool.query<{ count: string }>(
      `select count(*)::text as count from config_version where environment = 'test' and status = 'active'`,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('refuses a second active version at the database level', async () => {
    // The partial unique index is the guarantee, not the application logic above it.
    const first = await draftConfig('first');
    await activateConfigVersion('test', first.id, AUDIT);

    await expect(
      pool.query(
        `insert into config_version (environment, status, created_by, change_reason, checksum)
         values ('test', 'active', 'owner', 'sneaky', 'x')`,
      ),
    ).rejects.toThrow(/config_version_single_active/);
  });

  it('leaves the previous version active when activation fails', async () => {
    // F03 §4.3: "a failed activation leaves the previous version active". The failure here is
    // a version that is already superseded — activating it would resurrect configuration that
    // artifacts have recorded as retired.
    const first = await draftConfig('first');
    await activateConfigVersion('test', first.id, AUDIT);
    const second = await draftConfig('second');
    await activateConfigVersion('test', second.id, AUDIT);

    await expect(activateConfigVersion('test', first.id, AUDIT)).rejects.toThrow(
      /not a draft or staged version/,
    );

    const active = await findActiveConfigVersion('test');
    expect(active?.id).toBe(second.id);
  });

  it('isolates environments from one another', async () => {
    const test = await draftConfig('test-env');
    await activateConfigVersion('test', test.id, AUDIT);

    const other = await insertConfigVersion({
      environment: 'staging',
      createdBy: 'owner',
      changeReason: 'staging',
      checksum: 'sum-staging',
    });
    await activateConfigVersion('staging', other.id, AUDIT);

    expect((await findActiveConfigVersion('test'))?.id).toBe(test.id);
    expect((await findActiveConfigVersion('staging'))?.id).toBe(other.id);
  });

  describe('universe versions', () => {
    async function seedSecurities(count: number): Promise<string[]> {
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const { rows } = await pool.query<{ id: string }>(
          `insert into security (symbol, name, exchange, asset_type, currency)
           values ($1, $2, 'NASDAQ', 'equity', 'USD') returning id`,
          [`SYM${index}`, `Company ${index}`],
        );
        const id = rows[0]?.id;
        if (id !== undefined) ids.push(id);
      }
      return ids;
    }

    it('materialises membership at activation', async () => {
      const config = await draftConfig();
      await activateConfigVersion('test', config.id, AUDIT);
      const securities = await seedSecurities(3);
      const version = await insertUniverseVersion({
        environment: 'test',
        configVersion: config.id,
        createdBy: 'owner',
        changeReason: 'seed',
      });

      await activateUniverseVersion(
        'test',
        version.id,
        securities.map((securityId) => ({ securityId, addedBy: 'owner', selectionSource: 'seed' })),
        AUDIT,
      );

      const members = await listUniverseMembers(version.id);
      expect(members.sort()).toEqual([...securities].sort());
      expect((await findActiveUniverseVersion('test'))?.selectedCount).toBe(3);
    });

    it('does not let a later catalogue change alter a historical universe', async () => {
      // ADR-015's load-bearing clause. Membership is materialised, so deactivating a security
      // afterwards leaves the historical version exactly as it was.
      const config = await draftConfig();
      await activateConfigVersion('test', config.id, AUDIT);
      const securities = await seedSecurities(2);
      const version = await insertUniverseVersion({
        environment: 'test',
        configVersion: config.id,
        createdBy: 'owner',
        changeReason: 'seed',
      });
      await activateUniverseVersion(
        'test',
        version.id,
        securities.map((securityId) => ({ securityId, addedBy: 'owner', selectionSource: 'seed' })),
        AUDIT,
      );

      await pool.query('update security set active = false where id = $1', [securities[0]]);

      expect((await listUniverseMembers(version.id)).sort()).toEqual([...securities].sort());
    });

    it('refuses more than universe.max_symbols', async () => {
      const config = await draftConfig();
      await activateConfigVersion('test', config.id, AUDIT);
      const version = await insertUniverseVersion({
        environment: 'test',
        configVersion: config.id,
        createdBy: 'owner',
        changeReason: 'seed',
      });

      const tooMany = Array.from({ length: 601 }, (_, index) => ({
        securityId: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
        addedBy: 'owner',
        selectionSource: 'seed',
      }));

      await expect(activateUniverseVersion('test', version.id, tooMany, AUDIT)).rejects.toThrow(
        /max_symbols/,
      );
    });

    it('refuses a selected_count above the ceiling at the database level too', async () => {
      const config = await draftConfig();
      await activateConfigVersion('test', config.id, AUDIT);
      await expect(
        pool.query(
          `insert into universe_version (environment, config_version, status, selected_count, created_by, change_reason)
           values ('test', $1, 'draft', 601, 'owner', 'sneaky')`,
          [config.id],
        ),
      ).rejects.toThrow(/max_symbols/);
    });
  });
});
