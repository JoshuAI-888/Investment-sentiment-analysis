import { describe, expect, it } from 'vitest';
import { parseEnv, envSchema } from '@/env';

/** A complete, valid live-mode environment. Every negative case below removes one key from it. */
const VALID_LIVE: Record<string, string> = {
  PROVIDER_MODE: 'live',
  DATABASE_URL: 'postgres://user:pw@localhost:5432/app',
  UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'token',
  APP_BASE_URL: 'https://app.example.com',
  FMP_API_KEY: 'fmp',
  MARKETAUX_API_KEY: 'marketaux',
  ALPHA_VANTAGE_API_KEY: 'av',
  FRED_API_KEY: 'fred',
  SEC_USER_AGENT: 'BareboneSocialSentiment contact@example.com',
  X_BEARER_TOKEN: 'x-bearer',
  MODEL_TRANSPORT_DEFAULT: 'vercel_gateway',
  AI_GATEWAY_API_KEY: 'gateway',
  OPENAI_API_KEY: 'openai',
  AI_MODEL_FAST: 'openai/gpt-5-mini',
  AI_MODEL_SYNTHESIS: 'anthropic/claude-opus-5',
  AI_MODEL_VERIFY: 'openai/gpt-5.2',
  QSTASH_TOKEN: 'qstash',
  QSTASH_CURRENT_SIGNING_KEY: 'current',
  QSTASH_NEXT_SIGNING_KEY: 'next',
  INTERNAL_DISPATCH_SECRET: 'a-secret-at-least-16-chars',
  RESEND_API_KEY: 'resend',
  RESEND_FROM: 'welcome@accounts.example.com',
  BETTER_AUTH_SECRET: 'another-secret-16-chars',
  ADMIN_EMAIL_ALLOWLIST: 'owner@example.com',
};

/**
 * The keys the refinement makes required in live mode. `ADMIN_EMAIL_ALLOWLIST` and the
 * transport key are covered by their own cases below because their failure mode differs.
 */
const REQUIRED_IN_LIVE_MODE = [
  'DATABASE_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'FMP_API_KEY',
  'MARKETAUX_API_KEY',
  'ALPHA_VANTAGE_API_KEY',
  'FRED_API_KEY',
  'SEC_USER_AGENT',
  'X_BEARER_TOKEN',
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'INTERNAL_DISPATCH_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'BETTER_AUTH_SECRET',
  'AI_MODEL_FAST',
  'AI_MODEL_SYNTHESIS',
  'AI_MODEL_VERIFY',
  'OPENAI_API_KEY',
] as const;

describe('env schema', () => {
  it('accepts a valid live set', () => {
    const result = parseEnv(VALID_LIVE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.PROVIDER_MODE).toBe('live');
    expect(result.env.ADMIN_EMAIL_ALLOWLIST).toEqual(['owner@example.com']);
  });

  it('accepts an entirely empty environment in fixture mode', () => {
    // 05-TEST-STRATEGY.md §8: CI runs with PROVIDER_MODE=fixture and no provider keys present.
    // If this ever fails, CI has to invent dummy keys, and a dummy key is indistinguishable
    // from a real one at the point where it matters.
    const result = parseEnv({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.PROVIDER_MODE).toBe('fixture');
    expect(result.env.FEATURE_X).toBe(false);
    expect(result.env.AI_GATEWAY_BASE_URL).toBe('https://ai-gateway.vercel.sh/v1');
  });

  it('accepts an explicit AI Gateway base URL for a controlled compatible endpoint', () => {
    const result = parseEnv({
      ...VALID_LIVE,
      AI_GATEWAY_BASE_URL: 'https://gateway.example.com/v1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.AI_GATEWAY_BASE_URL).toBe('https://gateway.example.com/v1');
  });

  it.each(REQUIRED_IN_LIVE_MODE)('rejects a missing %s by name', (key) => {
    const raw = { ...VALID_LIVE };
    delete raw[key];

    const result = parseEnv(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    // Named, not just "invalid input" — the message is the fix list.
    expect(result.error.issues.some((issue) => issue.path[0] === key)).toBe(true);
    expect(result.message).toContain(key);
  });

  it('rejects a malformed ADMIN_EMAIL_ALLOWLIST', () => {
    const result = parseEnv({ ...VALID_LIVE, ADMIN_EMAIL_ALLOWLIST: 'owner@example.com,not-an-email' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('ADMIN_EMAIL_ALLOWLIST');
    expect(result.message).toContain('not a valid email address');
  });

  it('rejects an empty ADMIN_EMAIL_ALLOWLIST in live mode', () => {
    // D-11: there is one account, seeded from this list. An empty list in live mode is a
    // deployment with no way in.
    const result = parseEnv({ ...VALID_LIVE, ADMIN_EMAIL_ALLOWLIST: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('ADMIN_EMAIL_ALLOWLIST');
  });

  it('parses a multi-entry allowlist and trims whitespace', () => {
    const result = parseEnv({ ...VALID_LIVE, ADMIN_EMAIL_ALLOWLIST: ' a@example.com , b@example.com ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.ADMIN_EMAIL_ALLOWLIST).toEqual(['a@example.com', 'b@example.com']);
  });

  it('requires the key belonging to the selected model transport', () => {
    const raw: Record<string, string> = { ...VALID_LIVE, MODEL_TRANSPORT_DEFAULT: 'direct_anthropic' };
    delete raw['AI_GATEWAY_API_KEY'];

    const result = parseEnv(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('ANTHROPIC_API_KEY');
    expect(result.message).toContain('MODEL_TRANSPORT_DEFAULT=direct_anthropic');
  });

  it('requires an endpoint as well as a key for azure_foundry', () => {
    const result = parseEnv({
      ...VALID_LIVE,
      MODEL_TRANSPORT_DEFAULT: 'azure_foundry',
      AZURE_OPENAI_API_KEY: 'azure',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('AZURE_OPENAI_ENDPOINT');
  });

  it('rejects an unknown PROVIDER_MODE', () => {
    const result = parseEnv({ PROVIDER_MODE: 'staging' });
    expect(result.ok).toBe(false);
  });

  it('rejects a DATABASE_URL that is not a URL', () => {
    const result = parseEnv({ ...VALID_LIVE, DATABASE_URL: 'localhost' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('DATABASE_URL');
  });

  it('reports every missing key at once rather than the first', () => {
    // A schema that stops at the first failure turns one deploy into fifteen.
    const result = parseEnv({ PROVIDER_MODE: 'live' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const key of REQUIRED_IN_LIVE_MODE) {
      expect(result.message).toContain(key);
    }
  });

  it('exposes no key carrying a NEXT_PUBLIC_ prefix', () => {
    // F01 §4.2: server-only keys must be unreachable from client code, and the prefix is
    // the one mistake that makes a secret reachable without any import at all.
    const keys = Object.keys(envSchema._def.schema.shape);
    expect(keys.filter((key) => key.startsWith('NEXT_PUBLIC_'))).toEqual([]);
  });
});
