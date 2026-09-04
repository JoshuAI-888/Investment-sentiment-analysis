-- 0002 — the security master and the market/price/valuation snapshots.

-- ── security ────────────────────────────────────────────────────────────────────────────────
-- Source §7.2 names the key `security_id`. It is `id` here, qualified by the table name at
-- every call site, and every referencing column is `security_id`.
create table security (
  id                uuid primary key default gen_random_uuid(),
  symbol            text        not null,
  name              text        not null,
  exchange          text        not null,
  asset_type        text        not null,
  sector            text        null,
  industry          text        null,
  cik               text        null,
  currency          text        not null,
  active            boolean     not null default true,
  aliases           jsonb       not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint security_symbol_exchange_unique unique (symbol, exchange),
  constraint security_asset_type_check check (asset_type in ('equity', 'etf'))
);

comment on column security.symbol is
  'An attribute, never a key. A ticker is reassignable: BRK.B today is not necessarily BRK.B in five years, and a reassignment must not re-attribute the prior holder''s history.';

-- ── security_profile_snapshot ───────────────────────────────────────────────────────────────
create table security_profile_snapshot (
  security_id           uuid        not null references security (id),
  provider              text        not null,
  market_cap            numeric     null,
  market_cap_currency   text        null,
  sector_raw            text        null,
  industry_raw          text        null,
  sector_canonical      text        null,
  industry_canonical    text        null,
  eligibility_state     text        not null,
  eligibility_reasons   jsonb       not null default '[]'::jsonb,
  observed_at           timestamptz not null,
  ingested_at           timestamptz not null default now(),
  raw_hash              text        not null,
  created_at            timestamptz not null default now(),

  primary key (security_id, provider, observed_at),
  constraint security_profile_eligibility_check check (
    eligibility_state in ('ready', 'partial', 'unsupported', 'rights_blocked', 'inactive')
  )
);

-- ── market_snapshot ─────────────────────────────────────────────────────────────────────────
create table market_snapshot (
  security_id     uuid        not null references security (id),
  price           numeric     not null,
  change_percent  numeric     null,
  session         text        not null,
  provider        text        not null,
  observed_at     timestamptz not null,
  ingested_at     timestamptz not null default now(),
  raw_hash        text        not null,
  created_at      timestamptz not null default now(),

  primary key (security_id, provider, observed_at),
  constraint market_snapshot_session_check check (
    session in ('premarket', 'regular', 'afterhours', 'closed', 'eod')
  )
);

-- ── price_return_snapshot ───────────────────────────────────────────────────────────────────
create table price_return_snapshot (
  security_id            uuid        not null references security (id),
  as_of_date             date        not null,
  horizon_calendar_days  integer     not null,
  as_of_price            numeric     not null,
  as_of_price_date       date        not null,
  baseline_price         numeric     not null,
  baseline_price_date    date        not null,
  total_return           numeric     null,
  adjustment_status      text        not null,
  quality_status         text        not null,
  provider               text        not null,
  method_version         text        not null,
  computed_at            timestamptz not null default now(),
  created_at             timestamptz not null default now(),

  primary key (security_id, as_of_date, horizon_calendar_days, provider, method_version),
  constraint price_return_adjustment_check check (
    adjustment_status in ('adjusted', 'unadjusted', 'unknown')
  ),
  constraint price_return_horizon_check check (horizon_calendar_days in (7, 30, 90, 180))
);

comment on column price_return_snapshot.adjustment_status is
  'unknown is a real state and is not the same as unadjusted. A return computed from prices whose adjustment status we cannot establish is reported as such, not silently labelled adjusted.';

-- ── valuation_snapshot ──────────────────────────────────────────────────────────────────────
-- ADR-018 is deferred under D-19, so nothing writes this table in Waves 1–5. The table exists
-- because F03 owns the schema baseline and a table added later is a migration against a
-- populated database.
create table valuation_snapshot (
  id                    uuid        primary key default gen_random_uuid(),
  security_id           uuid        not null references security (id),
  as_of_date            date        not null,
  price                 numeric     not null,
  price_observed_at     timestamptz not null,
  currency              text        not null,
  status                text        not null,
  model_low             numeric     null,
  model_mid             numeric     null,
  model_high            numeric     null,
  low_gap               numeric     null,
  mid_gap               numeric     null,
  high_gap              numeric     null,
  confidence            numeric     null,
  eligible_method_count integer     not null default 0,
  eligible_peer_count   integer     not null default 0,
  method_outputs        jsonb       not null default '{}'::jsonb,
  assumptions           jsonb       not null default '{}'::jsonb,
  input_lineage         jsonb       not null default '{}'::jsonb,
  analyst_target        jsonb       null,
  config_version        bigint      not null,
  method_version        text        not null,
  computed_at           timestamptz not null default now(),
  expires_at            timestamptz null,
  created_at            timestamptz not null default now(),

  constraint valuation_snapshot_identity_unique
    unique (security_id, as_of_date, config_version, method_version),
  constraint valuation_status_check check (
    status in ('undervalued', 'overvalued', 'uncertain', 'insufficient_data', 'not_applicable')
  )
);

-- ── attention_snapshot ──────────────────────────────────────────────────────────────────────
create table attention_snapshot (
  security_id                  uuid        not null references security (id),
  source                       text        not null,
  rank                         integer     null,
  rank_prior                   integer     null,
  mentions                     integer     not null,
  mentions_prior               integer     null,
  engagement                   integer     null,
  window_hours                 integer     not null,
  coverage_class               text        not null,
  -- F-05: the provider does not version its own methodology, so we record the one we observed.
  -- Rank change across a boundary is suppressed, never computed (R-03).
  provider_methodology_version text        not null,
  observed_at                  timestamptz not null,
  ingested_at                  timestamptz not null default now(),
  raw_hash                     text        not null,
  created_at                   timestamptz not null default now(),

  primary key (security_id, source, observed_at),
  constraint attention_source_check check (
    source in ('apewisdom', 'reddit', 'x', 'substack', 'stocktwits')
  ),
  constraint attention_coverage_class_check check (
    coverage_class in ('pov_index', 'licensed_sample', 'licensed_full')
  )
);

comment on column attention_snapshot.provider_methodology_version is
  'F-05 / R-03. ApeWisdom scans a selected subreddit set and does not version that choice. A change to it silently changes the meaning of the series, so the observed methodology is pinned per snapshot and a rank change across a boundary is not_applicable rather than a number.';
