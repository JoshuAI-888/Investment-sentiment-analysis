-- 0001 — conventions, F03 §4.1.
--
-- These are binding on every migration that follows and are stated here once so that a later
-- migration adding a column has somewhere to be checked against.
--
--   * Surrogate keys only. `security.id` is a uuid. **Ticker text is never a primary or
--     foreign key anywhere** — a symbol is reassignable, and a reassignment must not silently
--     rewrite the history attributed to the company that used to hold it.
--   * Bitemporal: every snapshot table carries `observed_at` (when the fact was true) and
--     `ingested_at` (when we learned it). Both timestamptz, both UTC.
--   * `numeric`, never float, for anything a user sees. IEEE 754 rounding in a published
--     number is a defect nobody can see in review.
--   * Append-only is enforced in the database (0009), not in application code.

create extension if not exists "pgcrypto";

-- Bitemporal columns are added by hand per table rather than by inheritance so that each
-- table's primary key can name them; Postgres table inheritance does not carry constraints.

-- Every enumerated value in this schema is a `text` column with a check constraint rather than
-- a Postgres enum type. Adding a value to a Postgres enum is a migration that cannot run inside
-- a transaction with other DDL on older servers, and D-15/D-16 have already added values to two
-- of these once. A check constraint is altered like any other constraint.

comment on extension "pgcrypto" is
  'gen_random_uuid() for surrogate keys. F03 §4.1: surrogate keys only, ticker text is never a key.';
