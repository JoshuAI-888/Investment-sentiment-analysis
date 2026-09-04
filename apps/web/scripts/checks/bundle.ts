import type { Finding } from './types';

/**
 * check:bundle — F01 §4.4.
 *
 * Builds and asserts that no provider SDK, database client or secret-bearing module appears
 * in a client chunk. F01 §7 step 3 is the manual version of this; a script is the version
 * that runs on every PR.
 *
 * The patterns are deliberately specific. A bare `pg` or `signal` matches minified output
 * constantly, and a check that cries wolf is a check someone disables.
 */
export type Chunk = { readonly path: string; readonly content: string };

type Banned = { readonly label: string; readonly pattern: RegExp; readonly why: string };

const SECRET_KEYS = [
  'DATABASE_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'FMP_API_KEY',
  'MARKETAUX_API_KEY',
  'ALPHA_VANTAGE_API_KEY',
  'FRED_API_KEY',
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

const BANNED: readonly Banned[] = [
  {
    // Module identity, not payload. A server-only module's runtime guard folds to an
    // unconditional throw in a client bundle, and the minifier then drops everything after
    // it — including the key names the patterns below look for. Without this row the check
    // reports "pass" on precisely the leak the guard caught, and would keep reporting pass
    // for as long as it took someone to delete the guard as browser-dead code.
    label: 'a server-only module',
    pattern: /\[server-only:[^\]]+\]/,
    why: 'carries a server-only guard and has been bundled for the browser. Even where the minifier stripped its contents, the import edge is real: the module is one refactor away from shipping its values.',
  },
  ...SECRET_KEYS.map((key) => ({
    label: key,
    pattern: new RegExp(`\\b${key}\\b`),
    why: 'is a server-only environment key. Its presence in a client chunk means env.ts reached the browser bundle — the value ships with it.',
  })),
  {
    label: 'postgres:// connection string',
    pattern: /postgres(?:ql)?:\/\//,
    why: 'is a database connection string. It carries credentials and it is now public.',
  },
  {
    label: '@neondatabase/serverless',
    pattern: /@neondatabase\/serverless/,
    why: 'is a database client. A client chunk that can talk to the database is a database exposed to every visitor.',
  },
  {
    label: 'node-postgres',
    pattern: /node_modules\/pg\/|require\(["']pg["']\)/,
    why: 'is a database client and must never be reachable from the browser.',
  },
  {
    label: 'ioredis',
    pattern: /\bioredis\b/,
    why: 'is a Redis client. Redis holds dispatch locks and rate-limit state; neither is client business.',
  },
  {
    label: '@anthropic-ai/sdk',
    pattern: /@anthropic-ai\/sdk/,
    why: 'is a model SDK. Model access is billed per call and authenticated with a server key.',
  },
  {
    label: 'openai SDK',
    pattern: /node_modules\/openai\/|from ?["']openai["']/,
    why: 'is a model SDK. Model access is billed per call and authenticated with a server key.',
  },
  {
    label: 'resend SDK',
    pattern: /node_modules\/resend\//,
    why: 'is the mail SDK. It sends the OTP; a client able to send OTPs is an auth bypass.',
  },
];

export function scanChunks(chunks: readonly Chunk[]): Finding[] {
  const findings: Finding[] = [];

  for (const chunk of chunks) {
    for (const banned of BANNED) {
      if (!banned.pattern.test(chunk.content)) continue;
      findings.push({
        check: 'bundle',
        where: `${chunk.path} — ${banned.label}`,
        message: `${banned.label} ${banned.why}`,
      });
    }
  }

  return findings;
}
