import { describe, expect, it, vi } from 'vitest';
import type { Queryable } from '@/repositories/client';
import {
  findLatestRniRunId,
  findLatestStagedUniverseId,
  findRunSecurityByTicker,
} from '@/rni/read-model';

function dbWith(rows: readonly unknown[]): Queryable {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as Queryable;
}

describe('RNI live read selection', () => {
  it('returns honest empty selections when no run or staged universe exists', async () => {
    const db = dbWith([]);
    await expect(findLatestRniRunId('test', db)).resolves.toBeNull();
    await expect(findLatestStagedUniverseId('test', db)).resolves.toBeNull();
  });

  it('returns environment-bound run and staged identities without numeric coercion', async () => {
    await expect(
      findLatestRniRunId('test', dbWith([{ id: '00000000-0000-4000-8000-000000000001' }])),
    ).resolves.toBe('00000000-0000-4000-8000-000000000001');
    await expect(findLatestStagedUniverseId('test', dbWith([{ id: '9007199254740993' }]))).resolves.toBe(
      '9007199254740993',
    );
  });

  it('resolves a ticker through its frozen run scope and rejects malformed identities', async () => {
    const security = {
      id: '00000000-0000-4000-8000-000000000003',
      ticker: 'NVDA',
      companyName: 'NVIDIA Corporation',
      exchange: 'NASDAQ',
    };
    await expect(
      findRunSecurityByTicker(
        '00000000-0000-4000-8000-000000000001',
        'NVDA',
        'test',
        dbWith([security]),
      ),
    ).resolves.toEqual(security);
    await expect(findRunSecurityByTicker('not-a-run', 'NVDA', 'test', dbWith([]))).rejects.toThrow(
      'INVALID_REQUEST',
    );
    await expect(
      findRunSecurityByTicker(
        '00000000-0000-4000-8000-000000000001',
        'NVDA;DROP',
        'test',
        dbWith([]),
      ),
    ).rejects.toThrow('INVALID_REQUEST');
  });

  it('fails closed if a supposedly unique run/ticker projection returns duplicates', async () => {
    const duplicate = {
      id: '00000000-0000-4000-8000-000000000003',
      ticker: 'NVDA',
      companyName: 'NVIDIA Corporation',
      exchange: 'NASDAQ',
    };
    await expect(
      findRunSecurityByTicker(
        '00000000-0000-4000-8000-000000000001',
        'NVDA',
        'test',
        dbWith([duplicate, duplicate]),
      ),
    ).rejects.toThrow('CONFLICT');
  });
});
