import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { ReadDatabase } from '../../../../src/rni/read-model/repositories/snapshot';

describe('read snapshot safety', () => {
  const setup = () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const client = { query, release };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as pg.Pool;
    const rightsPolicyVersion = vi.fn().mockResolvedValue('rights-v1');
    return {
      client,
      pool,
      query,
      release,
      rightsPolicyVersion,
      database: new ReadDatabase({ pool, environment: 'test', rightsPolicyVersion }),
    };
  };

  it('resolves current rights and all reads in one repeatable read-only transaction', async () => {
    const s = setup();
    expect(
      await s.database.snapshot(async (store) => {
        expect(store.db).toBe(s.client);
        expect(store.policy).toBe('rights-v1');
        return 'result';
      }),
    ).toBe('result');
    expect(s.rightsPolicyVersion).toHaveBeenCalledWith(s.client);
    expect(s.query.mock.calls.map((c) => c[0])).toEqual([
      'begin isolation level repeatable read read only',
      'commit',
    ]);
    expect(s.release).toHaveBeenCalledOnce();
  });

  it('sanitizes database connection errors and rollback failures', async () => {
    const s = setup();
    vi.mocked(s.pool.connect).mockRejectedValueOnce(new Error('postgresql://private-secret'));
    await expect(s.database.snapshot(async () => null)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'PROVIDER_UNAVAILABLE',
    });
    s.query.mockRejectedValueOnce(new Error('secret query'));
    s.query.mockRejectedValueOnce(new Error('secret rollback'));
    await expect(s.database.snapshot(async () => null)).rejects.toMatchObject({
      code: 'CITATION_INVALID',
      message: 'CITATION_INVALID',
    });
    expect(s.release).toHaveBeenCalledOnce();
  });

  it('rejects malformed identifiers without executing a data query', async () => {
    const s = setup();
    await expect(s.database.snapshot((store) => store.run("' OR true"))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(s.query.mock.calls.map((c) => c[0])).toEqual([
      'begin isolation level repeatable read read only',
      'rollback',
    ]);
  });
});
