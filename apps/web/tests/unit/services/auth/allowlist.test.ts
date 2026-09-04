import { describe, expect, it } from 'vitest';
import { isAccountCreationAllowed, isAllowlisted, normalizeEmail } from '@/services/auth/allowlist';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Joshua@Example.com  ')).toBe('joshua@example.com');
  });

  it('strips dots from the Gmail local part', () => {
    expect(normalizeEmail('joshua.fang@gmail.com')).toBe('joshuafang@gmail.com');
  });

  it('drops everything after a plus tag on Gmail', () => {
    expect(normalizeEmail('joshuafang+otp@gmail.com')).toBe('joshuafang@gmail.com');
  });

  it('combines dot-stripping and plus-tag dropping', () => {
    expect(normalizeEmail('Joshua.Fang+test@GMAIL.com')).toBe('joshuafang@gmail.com');
  });

  it('treats googlemail.com the same as gmail.com', () => {
    expect(normalizeEmail('joshua.fang@googlemail.com')).toBe('joshuafang@gmail.com');
  });

  it('does NOT fold dots or plus tags on a non-Gmail domain', () => {
    expect(normalizeEmail('joshua.fang+work@example.com')).toBe('joshua.fang+work@example.com');
  });

  it('leaves a value with no @ unchanged apart from case and trim', () => {
    expect(normalizeEmail('  NotAnEmail  ')).toBe('notanemail');
  });
});

describe('isAllowlisted', () => {
  const allowlist = ['joshuaifang@gmail.com'];

  it('matches the exact allowlisted address', () => {
    expect(isAllowlisted('joshuaifang@gmail.com', allowlist)).toBe(true);
  });

  it('matches a dotted/plussed/cased variant of the allowlisted Gmail address', () => {
    expect(isAllowlisted('Joshua.iFang+sign-in@GMAIL.com', allowlist)).toBe(true);
  });

  it('rejects an address not on the allowlist', () => {
    expect(isAllowlisted('attacker@example.com', allowlist)).toBe(false);
  });

  it('rejects a near-miss of the allowlisted address', () => {
    expect(isAllowlisted('joshuafang@gmail.com', allowlist)).toBe(false);
  });

  it('rejects everything against an empty allowlist', () => {
    expect(isAllowlisted('joshuaifang@gmail.com', [])).toBe(false);
  });
});

describe('isAccountCreationAllowed', () => {
  const allowlist = ['joshuaifang@gmail.com'];

  it('live mode: allows the allowlisted address', () => {
    expect(isAccountCreationAllowed('live', 'joshuaifang@gmail.com', allowlist)).toBe(true);
  });

  it('live mode: refuses an address not on the allowlist', () => {
    expect(isAccountCreationAllowed('live', 'attacker@example.com', allowlist)).toBe(false);
  });

  it('fixture mode: allows any address, allowlisted or not — the e2e test seam requireAdmin() needs', () => {
    expect(isAccountCreationAllowed('fixture', 'attacker@example.com', allowlist)).toBe(true);
    expect(isAccountCreationAllowed('fixture', 'attacker@example.com', [])).toBe(true);
  });
});
