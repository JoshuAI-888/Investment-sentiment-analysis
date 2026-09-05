-- 0014 — Better Auth's own tables (F02 §4.1).
--
-- `services/auth/instance.ts` has run against a real `pg.Pool` in `live` mode since F02 merged,
-- but this file never existed: `user`/`session`/`account`/`verification` were only ever created
-- by Better Auth's in-process `memoryAdapter` under `PROVIDER_MODE=fixture`, which is what every
-- unit, integration and e2e suite runs under (F02's own contract note to SPINE, recorded in
-- `instance.ts`'s module docstring). Nothing in the test suite ever ran against a live Postgres
-- pool, so a live deployment failing every auth query with `relation "user" does not exist`
-- (42P01) shipped without anything catching it.
--
-- Columns taken from `@better-auth/core`'s own `buildAuthTables` (`dist/db/get-tables.mjs` in
-- the installed `better-auth@1.7.2`, matching `package.json`'s pinned version exactly), not from
-- `pnpm dlx @better-auth/cli generate` — that CLI's latest release (1.5.0-beta) still bundles its
-- own internal `better-auth@1.4.21` copy to do the actual introspection/generation regardless of
-- which version this project has installed, and 1.4.21's `account` table predates the `issuer`
-- column added later. Confirmed against the real 1.7.2 runtime by actually running
-- `signInEmail`/`provisionSeedAccountIfEligible` against a freshly migrated database, not by
-- reading source alone: the CLI's version produced `relation "account" column "issuer" does not
-- exist` (42703) as soon as a real insert happened, which is what caught the drift. Includes
-- `mustChangePassword` (D-38's `additionalFields` on `user`). Identifiers are camelCase and
-- double-quoted throughout because better-auth's Kysely queries reference them that way; this is
-- the one migration in this directory that intentionally does not follow 0001's snake_case
-- convention, because the table owner is better-auth itself, not this codebase's schema.
--
-- Deliberately excluded from 0001's bitemporal/decimal conventions: these are Better Auth's own
-- managed tables (credentials, sessions, tokens), not domain data this codebase models.
create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null,
  "image" text,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null default current_timestamp,
  "mustChangePassword" boolean not null
);

create table "session" (
  "id" text not null primary key,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

create table "account" (
  "id" text not null primary key,
  "issuer" text not null,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null
);

create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null default current_timestamp
);

create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create unique index "account_issuer_accountId_idx" on "account" ("issuer", "accountId");
create index "verification_identifier_idx" on "verification" ("identifier");

comment on table "user" is
  'Better Auth-owned (F02 §4.1). "mustChangePassword" is D-38''s seeded-welcome1 flag — input: false in instance.ts, written only via seed-account.ts''s internalAdapter calls.';
