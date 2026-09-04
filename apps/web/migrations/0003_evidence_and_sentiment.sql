-- 0003 — the evidence corpus and the sentiment aggregates.

-- ── evidence_item ───────────────────────────────────────────────────────────────────────────
create table evidence_item (
  id               uuid        primary key default gen_random_uuid(),
  security_id      uuid        null references security (id),
  evidence_type    text        not null,
  provider         text        not null,
  title            text        not null,
  snippet          text        null,
  source_url       text        null,
  publisher        text        null,
  author_ref       text        null,
  stance_label     text        null,
  stance_score     numeric     null,
  relevance_score  numeric     null,
  published_at     timestamptz null,
  available_at     timestamptz not null,
  ingested_at      timestamptz not null default now(),
  -- F-19: an unreachable source is labelled, never repaired and never invalidating.
  last_checked_at  timestamptz null,
  availability     text        not null default 'available',
  license_class    text        not null,
  coverage_class   text        not null,
  raw_hash         text        not null,
  metadata         jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),

  constraint evidence_type_check check (
    evidence_type in ('news', 'social_result', 'filing', 'macro', 'provider_fact')
  ),
  constraint evidence_stance_label_check check (
    stance_label is null or stance_label in ('bullish', 'bearish', 'neutral')
  ),
  constraint evidence_availability_check check (
    availability in ('available', 'unreachable', 'removed', 'paywalled', 'unchecked')
  )
);

comment on column evidence_item.author_ref is
  'Hashed or pseudonymous only, and only where the provider agreement permits storing it at all. See docs/provider-rights.md.';

comment on column evidence_item.availability is
  'F-19 / R-17. An item that has become unreachable keeps its snippet as retrieved and is labelled. It is never re-fetched into a different value and never treated as invalidating the claim it supported at the time.';

comment on column evidence_item.metadata is
  'When an item is classified, metadata.classifier carries model_id, immutable model_revision, tokenizer_revision, route, raw_logits, raw_model_confidence, calibration_version, final_confidence, escalated, escalation_reasons, latency_ms and evaluator_version. A prior prediction is never overwritten when the model changes — F20 §4.4 writes a successor.';

create index evidence_item_security_available_idx
  on evidence_item (security_id, available_at desc);

-- ── sentiment_snapshot ──────────────────────────────────────────────────────────────────────
create table sentiment_snapshot (
  subject_type    text        not null,
  subject_id      text        not null,
  source_type     text        not null,
  raw_score       numeric     not null,
  shrunk_score    numeric     not null,
  -- R-01: renamed from `confidence`. What this measures is whether the sample was big enough
  -- to say anything, not how sure a model was.
  sample_adequacy numeric     not null,
  sample_size     integer     not null,
  positive_count  integer     not null default 0,
  neutral_count   integer     not null default 0,
  negative_count  integer     not null default 0,
  unclear_count   integer     not null default 0,
  method_version  text        not null,
  observed_at     timestamptz not null,
  ingested_at     timestamptz not null default now(),
  expires_at      timestamptz null,
  created_at      timestamptz not null default now(),

  primary key (subject_type, subject_id, source_type, observed_at),
  constraint sentiment_subject_type_check check (
    subject_type in ('security', 'sector_proxy', 'market')
  ),
  constraint sentiment_source_type_check check (
    source_type in ('news', 'sampled_social', 'composite')
  ),
  constraint sentiment_counts_sum_check check (
    positive_count + neutral_count + negative_count + unclear_count = sample_size
  )
);

comment on column sentiment_snapshot.sample_adequacy is
  'R-01, closing F-03. The old name `confidence` invited reading a small-sample warning as a model-certainty score. The output is "stance of sampled snippets" and the selection bias is disclosed on the page, not just in the registry.';

comment on column sentiment_snapshot.subject_id is
  'Text because the subject may be a sector proxy or the market, neither of which has a security row. Where subject_type = security this holds a security.id rendered as text — never a ticker.';
