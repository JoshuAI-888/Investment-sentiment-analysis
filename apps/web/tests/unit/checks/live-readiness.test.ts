import { describe, expect, it } from 'vitest';
import { checkLiveReadiness, parseDotenv } from '../../../scripts/checks/live-readiness';

/** Every key `REQUIRED_IN_LIVE_MODE` names, plus the allowlist and the default transport's key. */
const COMPLETE_LIVE_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://user:pw@host/db',
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'token',
  FMP_API_KEY: 'k',
  MARKETAUX_API_KEY: 'k',
  ALPHA_VANTAGE_API_KEY: 'k',
  FRED_API_KEY: 'k',
  SEC_USER_AGENT: 'someone@example.com',
  X_BEARER_TOKEN: 'k',
  QSTASH_TOKEN: 'k',
  QSTASH_CURRENT_SIGNING_KEY: 'k',
  QSTASH_NEXT_SIGNING_KEY: 'k',
  INTERNAL_DISPATCH_SECRET: '0123456789abcdef0123456789abcdef',
  RESEND_API_KEY: 'k',
  RESEND_FROM: 'radar@example.com',
  BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  AI_MODEL_FAST: 'model-fast',
  AI_MODEL_SYNTHESIS: 'model-synthesis',
  AI_MODEL_VERIFY: 'model-verify',
  AI_GATEWAY_API_KEY: 'k',
  ADMIN_EMAIL_ALLOWLIST: 'owner@example.com',
};

describe('check:live-readiness', () => {
  it('passes on a complete live environment', () => {
    expect(checkLiveReadiness(COMPLETE_LIVE_ENV)).toEqual({ ok: true });
  });

  // CAN FAIL — the whole point of the check.
  it('names exactly the key that is missing', () => {
    const { FRED_API_KEY: _omitted, ...incomplete } = COMPLETE_LIVE_ENV;
    const report = checkLiveReadiness(incomplete);
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.missingKeys).toEqual(['FRED_API_KEY']);
  });

  it('reports every missing key at once, not just the first', () => {
    const { FRED_API_KEY: _a, RESEND_FROM: _b, ...incomplete } = COMPLETE_LIVE_ENV;
    const report = checkLiveReadiness(incomplete);
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.missingKeys).toEqual(['FRED_API_KEY', 'RESEND_FROM']);
  });

  it('catches an empty ADMIN_EMAIL_ALLOWLIST, not just an absent one', () => {
    // The gap that shipped to production once already: the variable existed and was blank, so
    // no operator could sign in while everything else looked configured.
    const report = checkLiveReadiness({ ...COMPLETE_LIVE_ENV, ADMIN_EMAIL_ALLOWLIST: '' });
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.missingKeys).toContain('ADMIN_EMAIL_ALLOWLIST');
  });

  it('requires the key belonging to the chosen transport, not the default one', () => {
    const { AI_GATEWAY_API_KEY: _gateway, ...withoutGateway } = COMPLETE_LIVE_ENV;
    const report = checkLiveReadiness({ ...withoutGateway, MODEL_TRANSPORT_DEFAULT: 'direct_openai' });
    expect(report.ok).toBe(false);
    if (report.ok) return;
    // Switching transport must move the requirement, not merely add one.
    expect(report.missingKeys).toEqual(['OPENAI_API_KEY']);
  });

  // A fixture-mode file must not pass trivially — that would answer a question nobody asked.
  it('ignores the source PROVIDER_MODE and always asks the live question', () => {
    const report = checkLiveReadiness({ PROVIDER_MODE: 'fixture' });
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.missingKeys).toContain('DATABASE_URL');
  });

  it('catches a malformed value, not only an absent one', () => {
    const report = checkLiveReadiness({ ...COMPLETE_LIVE_ENV, DATABASE_URL: 'not-a-url' });
    expect(report.ok).toBe(false);
    if (report.ok) return;
    expect(report.missingKeys).toEqual(['DATABASE_URL']);
  });
});

describe('parseDotenv', () => {
  it('reads plain assignments and strips both quote styles', () => {
    expect(parseDotenv('A=1\nB="two"\nC=\'three\'')).toEqual({ A: '1', B: 'two', C: 'three' });
  });

  it('keeps a = inside a value — connection strings and tokens carry them', () => {
    expect(parseDotenv('DATABASE_URL=postgres://u:p@h/db?sslmode=require')).toEqual({
      DATABASE_URL: 'postgres://u:p@h/db?sslmode=require',
    });
  });

  it('skips comments, blank lines and a leading export', () => {
    expect(parseDotenv('# note\n\nexport A=1\n')).toEqual({ A: '1' });
  });

  it('ignores a line with no key', () => {
    expect(parseDotenv('=novalue\ngarbage\nA=1')).toEqual({ A: '1' });
  });
});
