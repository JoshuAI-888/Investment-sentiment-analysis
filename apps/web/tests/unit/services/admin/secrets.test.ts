/**
 * F15 §4.2/DoD item 3 — "a key's value is never echoed, not even partially, beyond a
 * fixed-length mask." Grep-style structural checks plus the actual masking behaviour.
 */
import { describe, expect, it } from 'vitest';
import {
  DEPLOYMENT_SECRET_KEYS,
  readDeploymentSecretStatus,
  SECRET_MASK,
} from '@/services/admin/secrets';

describe('readDeploymentSecretStatus — the mask is fixed-length and never the value', () => {
  it('a configured secret renders only the fixed mask, never any part of the real value', () => {
    const longSecret = 'sk-super-secret-value-that-is-quite-long-1234567890';
    const shortSecret = 'ab';
    const rows = readDeploymentSecretStatus({
      [DEPLOYMENT_SECRET_KEYS[0]]: longSecret,
      [DEPLOYMENT_SECRET_KEYS[1]]: shortSecret,
    });

    const long = rows.find((r) => r.key === DEPLOYMENT_SECRET_KEYS[0]);
    const short = rows.find((r) => r.key === DEPLOYMENT_SECRET_KEYS[1]);

    expect(long?.display).toBe(SECRET_MASK);
    expect(short?.display).toBe(SECRET_MASK);
    // The mask's length does not vary with the underlying secret's length either — a variable-
    // length mask would itself leak how long the real value is.
    expect(long?.display.length).toBe(short?.display.length);
    expect(long?.display).not.toContain(longSecret.slice(0, 4));
    expect(long?.display).not.toContain(longSecret.slice(-4));
  });

  it('an unconfigured secret is reported as not configured, never as an empty mask standing in for a value', () => {
    const rows = readDeploymentSecretStatus({});
    for (const row of rows) {
      expect(row.configured).toBe(false);
      expect(row.display).toBe('(not set)');
    }
  });

  it('every catalogued key is reported exactly once', () => {
    const rows = readDeploymentSecretStatus({});
    expect(rows.map((r) => r.key).sort()).toEqual([...DEPLOYMENT_SECRET_KEYS].sort());
  });
});
