/**
 * F15 §4.2/DoD item 3 — "a key's value is never echoed, not even partially, beyond a
 * fixed-length mask." `MASK` is a single constant string, the same length regardless of the
 * real value's length or content, so the mask itself cannot leak how long a secret is.
 *
 * This module never imports `@/env` at the top level — `env.ts` throws if imported from a
 * client bundle by design (F01 §4.2), and importing it here would make every importer of this
 * (safe, server-only) module transitively carry that trap. Callers pass the raw
 * `process.env`-shaped record they already hold server-side.
 */

/** Deliberately opaque and fixed-length. Never derived from the real value. */
export const SECRET_MASK = '••••••••';

export type DeploymentKeyStatus = {
  readonly key: string;
  readonly configured: boolean;
  /** Always `SECRET_MASK` when `configured`; never the real value or any prefix/suffix of it. */
  readonly display: string;
};

/**
 * The deployment key catalogue F15 §4.2's table names as "displayed with status, masked, and
 * read-only" — never editable from the browser. Kept in this file (not `@/env`) so the list is
 * reviewable without touching the env schema, and additive: a future key lands here without
 * this file needing to know its shape, only its name.
 */
export const DEPLOYMENT_SECRET_KEYS = [
  'DATABASE_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'FMP_API_KEY',
  'MARKETAUX_API_KEY',
  'ALPHA_VANTAGE_API_KEY',
  'FRED_API_KEY',
  'X_BEARER_TOKEN',
  'AI_GATEWAY_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'INTERNAL_DISPATCH_SECRET',
  'RESEND_API_KEY',
  'BETTER_AUTH_SECRET',
] as const;

export type DeploymentSecretKey = (typeof DEPLOYMENT_SECRET_KEYS)[number];

/**
 * Non-secret deployment keys — displayed for real (they carry no credential), so an operator can
 * see *what* is configured without the masked catalogue implying every deployment key is a
 * secret. `ADMIN_EMAIL_ALLOWLIST` is deliberately excluded even though it isn't a credential:
 * echoing it back would hand a browser session the exact string D-28 already treats as a
 * denial-of-service handle.
 */
export const DEPLOYMENT_PLAIN_KEYS = [
  'PROVIDER_MODE',
  'APP_BASE_URL',
  'MODEL_TRANSPORT_DEFAULT',
  'FEATURE_X',
  'FEATURE_STOCKTWITS',
  'FEATURE_CONGRESS',
] as const;

/** Reads status only — `configured` — never the value, for every key in the secret catalogue. */
export function readDeploymentSecretStatus(
  source: Record<string, string | undefined>,
): DeploymentKeyStatus[] {
  return DEPLOYMENT_SECRET_KEYS.map((key) => {
    const value = source[key];
    const configured = value !== undefined && value !== '';
    return { key, configured, display: configured ? SECRET_MASK : '(not set)' };
  });
}

export type DeploymentPlainValue = { readonly key: string; readonly value: string | null };

/** Plain (non-secret) deployment settings, read for real — nothing here is a credential. */
export function readDeploymentPlainValues(
  source: Record<string, string | undefined>,
): DeploymentPlainValue[] {
  return DEPLOYMENT_PLAIN_KEYS.map((key) => ({ key, value: source[key] ?? null }));
}
