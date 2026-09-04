-- 0000 — the migration ledger itself. Applied before anything else.
create table if not exists schema_migration (
  filename    text        primary key,
  checksum    text        not null,
  applied_at  timestamptz not null default now()
);

comment on table schema_migration is
  'The checksum is stored so an edited migration is detected rather than silently skipped — a migration file changed after it has been applied somewhere is a schema drift nobody sees until the environments disagree.';
