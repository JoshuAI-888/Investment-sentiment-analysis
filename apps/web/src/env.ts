/**
 * Environment schema — F01 §4.2.
 *
 * Validated at module load. A missing or invalid key fails the process with a readable
 * list rather than surfacing as `undefined` three layers deeper.
 *
 * **Requiredness is a function of `PROVIDER_MODE`, and that is the point.**
 * `05-TEST-STRATEGY.md` §8 requires CI to run with `PROVIDER_MODE=fixture` and *no provider
 * keys present* — "a test that needs a key to pass is a test that will pass for the wrong
 * reason". A schema with a flat required set would force CI to invent dummy keys, and a
 * dummy key is indistinguishable from a real one at the point where it matters.
 *
 * **This ships the mechanism, not the final key set** (F01 §4.2). Source §6.3 predates D-12
 * and D-13, so it names no Reddit, Substack, X or scorer keys and no budget keys for D-20's
 * global ceiling. F04, F20 and F18 append their own blocks as each lands — see
 * `docs/06-PARALLEL-LANES.md` §4b for the append-only rule that keeps that concurrent-safe.
 */
import { z } from 'zod';

/** A secret read on the client is a secret published. */
if (typeof window !== 'undefined') {
  // The `[server-only:env.ts]` prefix is a contract with `scripts/checks/bundle.ts`, not
  // decoration. In a client bundle `typeof window !== 'undefined'` folds to `true`, so a
  // minifier reduces this whole module to an unconditional throw and drops every key name as
  // dead code — which is the correct runtime outcome and simultaneously blinds a scanner that
  // looks only for key names. This token is what survives, so the tombstone is detectable.
  throw new Error(
    "[server-only:env.ts] env.ts was imported from client code. It carries server-only " +
      "secrets and must never reach a browser bundle. Import it from a server component, a " +
      "route handler or a service instead. (The `no-server-import-in-client` lint rule " +
      "catches this statically.)",
  );
}

/** Named so the live-mode refinement below can compare against the same literal. */
const APP_BASE_URL_DEFAULT = 'http://localhost:3000';

const providerMode = z.enum(['fixture', 'live']);

const modelTransport = z.enum([
  'vercel_gateway',
  'direct_openai',
  'direct_anthropic',
  'direct_google',
  'azure_foundry',
]);

/** `"a@b.com, c@d.com"` → `['a@b.com', 'c@d.com']`, rejecting any entry that is not an email. */
const emailAllowlist = z
  .string()
  .transform((raw) => raw.split(',').map((entry) => entry.trim()).filter((entry) => entry !== ''))
  .pipe(z.array(z.string().email('is not a valid email address')));

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/**
 * Every key from source §6.3 that survived the re-lock, plus `PROVIDER_MODE`.
 *
 * Optional here means "optional *to parse*". What is genuinely required in `live` mode is
 * enforced by the refinement below, so the error message can say which mode made it required.
 */
const shape = {
  PROVIDER_MODE: providerMode.default('fixture'),

  // Infrastructure
  DATABASE_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  APP_BASE_URL: z.string().url().default(APP_BASE_URL_DEFAULT),

  // Providers (D-12 stack; F04 appends Reddit/Substack/X keys when it lands)
  FMP_API_KEY: z.string().min(1).optional(),
  MARKETAUX_API_KEY: z.string().min(1).optional(),
  ALPHA_VANTAGE_API_KEY: z.string().min(1).optional(),
  FRED_API_KEY: z.string().min(1).optional(),
  SEC_USER_AGENT: z.string().min(1).optional(),
  // F04: X API v2 App-only OAuth 2.0 Bearer token (`adapters/x.ts`). In `REQUIRED_IN_LIVE_MODE`
  // below, matching every other adapter with a required credential (`market.ts`,
  // `marketaux.ts`, `fred.ts`, `sec-edgar.ts`) and `ALPHA_VANTAGE_API_KEY` — a key a live
  // deployment must carry, not a key dispatched this week. `ALPHA_VANTAGE_API_KEY` is required
  // in live mode under the identical "not dispatched yet" condition (Wave 4,
  // `FEATURE_CONGRESS`-only). Missing this at boot fails the process with a readable list;
  // missing it mid-run — the only alternative — is an unhandled throw that stops the collector
  // loop, which under D-16 is permanent corpus loss, not a retryable error.
  X_BEARER_TOKEN: z.string().min(1).optional(),

  // Model access (D-06: absent today, which is why Wave 3 is blocked)
  MODEL_TRANSPORT_DEFAULT: modelTransport.default('vercel_gateway'),
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
  AZURE_OPENAI_API_KEY: z.string().min(1).optional(),
  // Optional here only "to parse" — REQUIRED_IN_LIVE_MODE below enforces all three, since an
  // unset route means F10/F11/F12 read `undefined` as a model ID at request time, not at boot.
  AI_MODEL_FAST: z.string().min(1).optional(),
  AI_MODEL_SYNTHESIS: z.string().min(1).optional(),
  AI_MODEL_VERIFY: z.string().min(1).optional(),

  // Scorer (F20 / D-13)
  /**
   * The pinned scorer service's origin — its own deploy target, not a Vercel route (`services/
   * scorer/README.md`). Required in live mode: without it nothing can score, and D-16's
   * forward-only collection means an unscorable backlog is not a degraded feature but a growing
   * one. `services/jobs/scorer-client.ts` took this as a parameter precisely because this key
   * did not exist; it now defaults to this and keeps the parameter for tests.
   */
  SCORER_BASE_URL: z.string().url().optional(),

  // Scheduling (F16a)
  QSTASH_TOKEN: z.string().min(1).optional(),
  QSTASH_CURRENT_SIGNING_KEY: z.string().min(1).optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().min(1).optional(),
  INTERNAL_DISPATCH_SECRET: z.string().min(16).optional(),

  // Auth and mail (F02 — OTP only under D-11)
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  ADMIN_EMAIL_ALLOWLIST: emailAllowlist.default(''),

  // Feature flags
  FEATURE_X: boolish.default('false'),
  FEATURE_STOCKTWITS: boolish.default('false'),
  FEATURE_CONGRESS: boolish.default('false'),
} as const;

/** Required only when `PROVIDER_MODE=live`. In fixture mode none of this is reachable. */
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
  'SCORER_BASE_URL',
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
] as const;

/** The key each transport cannot operate without. */
const TRANSPORT_KEY: Record<z.infer<typeof modelTransport>, keyof typeof shape> = {
  vercel_gateway: 'AI_GATEWAY_API_KEY',
  direct_openai: 'OPENAI_API_KEY',
  direct_anthropic: 'ANTHROPIC_API_KEY',
  direct_google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  azure_foundry: 'AZURE_OPENAI_API_KEY',
};

export const envSchema = z.object(shape).superRefine((value, ctx) => {
  if (value.PROVIDER_MODE !== 'live') return;

  for (const key of REQUIRED_IN_LIVE_MODE) {
    if (value[key] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'is required when PROVIDER_MODE=live',
      });
    }
  }

  // `APP_BASE_URL` cannot go in REQUIRED_IN_LIVE_MODE: it carries a default, so it is never
  // `undefined` and that check would never fire. The real failure is subtler than absence —
  // `/api/cron/dispatch` builds its expected URL from this value and compares it against the
  // `sub` claim QStash signs. A production deploy that never sets it keeps the localhost
  // default, every real delivery mismatches, and the dispatcher 401s every QStash message
  // forever while looking perfectly healthy. That is precisely the silent-stall the heartbeat
  // exists to catch, and under D-16 each missed tick is corpus that cannot be recovered — so
  // it is worth failing at boot, loudly, instead.
  if (value.APP_BASE_URL === APP_BASE_URL_DEFAULT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['APP_BASE_URL'],
      message:
        `is still the development default (${APP_BASE_URL_DEFAULT}) with PROVIDER_MODE=live. ` +
        'It must be the real deployment origin: /api/cron/dispatch compares it against the ' +
        "`sub` claim QStash signs, so a wrong value 401s every scheduled dispatch silently",
    });
  }

  if (value.ADMIN_EMAIL_ALLOWLIST.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ADMIN_EMAIL_ALLOWLIST'],
      message:
        'is required when PROVIDER_MODE=live — under D-11 there is one account and it is seeded from this list',
    });
  }

  const transportKey = TRANSPORT_KEY[value.MODEL_TRANSPORT_DEFAULT];
  if (value[transportKey] === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [transportKey],
      message: `is required when MODEL_TRANSPORT_DEFAULT=${value.MODEL_TRANSPORT_DEFAULT}`,
    });
  }

  if (value.MODEL_TRANSPORT_DEFAULT === 'azure_foundry' && value.AZURE_OPENAI_ENDPOINT === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AZURE_OPENAI_ENDPOINT'],
      message: 'is required when MODEL_TRANSPORT_DEFAULT=azure_foundry',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/** The readable list. One line per key, so the fix is the diff of this output against `.env`. */
export function formatEnvErrors(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    return `  ${key} — ${issue.message}`;
  });
  return [
    'Environment validation failed. The following keys are missing or invalid:',
    ...lines,
    '',
    'CI and local development run with PROVIDER_MODE=fixture, which requires none of the',
    'provider keys. Set PROVIDER_MODE=live only where the real keys are present.',
  ].join('\n');
}

export type ParseResult =
  | { readonly ok: true; readonly env: Env }
  | { readonly ok: false; readonly message: string; readonly error: z.ZodError };

/** Pure. The singleton below is the only thing that exits the process. */
export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined>): ParseResult {
  const result = envSchema.safeParse(raw);
  if (result.success) return { ok: true, env: result.data };
  return { ok: false, message: formatEnvErrors(result.error), error: result.error };
}

function loadEnv(): Env {
  const result = parseEnv(process.env);
  if (result.ok) return result.env;
  // Fail fast and loudly: a process that starts with a half-valid environment fails later,
  // somewhere else, as a symptom that does not name its cause.
  throw new Error(result.message);
}

export const env: Env = loadEnv();
