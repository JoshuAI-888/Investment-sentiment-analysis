-- The raw ApeWisdom board, captured verbatim.
--
-- `attention_snapshot` is universe-scoped by construction: `security_id` is `not null` and part
-- of its primary key, so a ticker with no row in the security master cannot be stored there at
-- all. That is correct for the series analytics compute over — every aggregate in the product is
-- defined on the 100-symbol universe (D-27, D-30) — but it means the collector was *discarding*
-- every other row the provider returned, and fetching only the first page besides.
--
-- Under D-16 collection is forward-only with no backfill, and ApeWisdom is free and keyless. A
-- board row not captured today is gone permanently, while a captured row nobody computes over
-- costs storage and nothing else. This table is that capture: the whole board, every stock
-- filter, every page, with the fields exactly as the provider sends them.
--
-- **It does not change what the product computes over.** `attention_snapshot` keeps its meaning
-- and its universe scope; this is a superset alongside it, not a replacement. Promoting a ticker
-- out of here into the universe is still an owner decision under D-27/D-30.
create table attention_board_snapshot (
  -- A surrogate key, because F03's schema-wide invariant is that ticker text is never a primary
  -- or foreign key: a symbol is reassignable, and a reassignment must not silently rewrite the
  -- prior holder's history. That applies here even though most rows resolve to no security —
  -- `ticker` below is raw provider text, a record of what the board said, not an attribution.
  -- `security_id` is the attribution, and it is a surrogate.
  id                           uuid        primary key default gen_random_uuid(),
  source                       text        not null,
  -- Which board. ApeWisdom's own filter slug — 'wallstreetbets', 'stocks', 'all-stocks', ... .
  -- Recorded because mentions on r/wallstreetbets and r/investing are not the same signal, and
  -- without this column two rows from different boards are indistinguishable once stored.
  board                        text        not null,
  ticker                       text        not null,
  -- The provider's own name for the ticker, kept even when it resolves to no security: an
  -- unmatched row is the case this table exists for, and the name is what makes it identifiable
  -- later.
  name                         text        not null,
  -- Resolved against the security master when possible, null when not. Nullable *here* and not
  -- null in `attention_snapshot` is the whole distinction between the two tables.
  security_id                  uuid        null references security (id),
  rank                         integer     not null,
  mentions                     integer     not null,
  upvotes                      integer     null,
  rank_24h_ago                 integer     null,
  mentions_24h_ago             integer     null,
  -- Which page of the board this row came from, and how many there were. Kept so a partial
  -- capture (a run that failed mid-pagination) is visible as such rather than looking like a
  -- board that simply got shorter.
  page                         integer     not null,
  pages_total                  integer     not null,
  provider_methodology_version text        not null,
  observed_at                  timestamptz not null,
  ingested_at                  timestamptz not null default now(),
  raw_hash                     text        not null,
  created_at                   timestamptz not null default now(),

  constraint attention_board_source_check check (source in ('apewisdom')),
  constraint attention_board_rank_positive check (rank > 0),
  constraint attention_board_mentions_nonneg check (mentions >= 0)
);

-- Identity, as a unique index rather than a primary key so no key contains ticker text (above).
-- `ingested_at` is part of it for F22 §4.1's reason: a corrected reading of the same instant is a
-- new row, never an UPDATE the append-only trigger forbids. Telling a genuine *repeat* from a
-- *revision* is the repository's job, by raw_hash, exactly as `insertAttentionSnapshot` does:
-- same identity and same hash is a no-op, same identity and a different hash is a successor.
create unique index attention_board_snapshot_identity_idx
  on attention_board_snapshot (source, board, ticker, observed_at, ingested_at);

-- The dominant read: one board at one instant, in rank order.
create index attention_board_snapshot_board_observed_idx
  on attention_board_snapshot (board, observed_at desc, rank);

-- And: everything ever seen for one ticker, across boards.
create index attention_board_snapshot_ticker_idx
  on attention_board_snapshot (ticker, observed_at desc);

-- Append-only, like every other corpus table (F03 §4.1). A board reading is a fact about a
-- moment; correcting one means recording a later observation, never editing the earlier one.
create trigger attention_board_snapshot_append_only
  before update or delete on attention_board_snapshot
  for each row execute function reject_mutation();

comment on table attention_board_snapshot is
  'The raw provider board, verbatim and unfiltered by the universe. attention_snapshot is the '
  'universe-scoped series analytics read; this is everything the provider returned, including '
  'tickers that resolve to no security. Permanent corpus under D-17.';
