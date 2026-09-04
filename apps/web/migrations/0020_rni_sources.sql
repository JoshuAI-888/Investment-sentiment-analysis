-- 0020 — RNI source-first evidence persistence.
--
-- One external Reddit post/comment or X post is stored once. Discovery/retrieval attempts and
-- bounded content revisions are append-only children so a retry preserves provenance without
-- copying a whole webpage or silently replacing evidence.

create table rni_source_item (
  id                     uuid        primary key default gen_random_uuid(),
  platform               text        not null,
  source_kind            text        not null,
  external_id            text        null,
  canonical_url          text        not null,
  original_url           text        not null,
  subreddit_or_scope     text        not null,
  author_handle_hash     text        null,
  title                   text        null,
  bounded_content        text        not null,
  content_sha256         text        not null,
  capture_mode           text        not null,
  published_at           timestamptz null,
  discovered_at          timestamptz not null,
  observed_at            timestamptz not null,
  search_query_id        uuid        null,
  provider_request_id    text        null,
  metadata_json          jsonb       not null default '{}'::jsonb,
  rights_policy_version  text        not null,
  created_at             timestamptz not null default now(),

  constraint rni_source_item_id_platform_unique unique (id, platform),
  constraint rni_source_item_platform_check
    check (platform in ('reddit', 'x')),
  constraint rni_source_item_kind_check
    check (source_kind in ('post', 'comment', 'x_post')),
  constraint rni_source_item_platform_kind_check
    check (
      (platform = 'reddit' and source_kind in ('post', 'comment'))
      or (platform = 'x' and source_kind = 'x_post')
    ),
  constraint rni_source_item_external_id_check
    check (external_id is null or length(external_id) > 0),
  constraint rni_source_item_canonical_url_check
    check (canonical_url ~* '^https?://'),
  constraint rni_source_item_original_url_check
    check (original_url ~* '^https?://'),
  constraint rni_source_item_scope_check
    check (length(subreddit_or_scope) > 0),
  constraint rni_source_item_author_hash_check
    check (author_handle_hash is null or author_handle_hash ~ '^[a-f0-9]{64}$'),
  constraint rni_source_item_title_check
    check (title is null or length(title) <= 600),
  constraint rni_source_item_content_check
    check (length(bounded_content) between 1 and 20000),
  constraint rni_source_item_no_page_html_check
    check (bounded_content !~* '<!doctype[[:space:]]+html|<html([[:space:]]|>)'),
  constraint rni_source_item_content_hash_check
    check (content_sha256 ~ '^[a-f0-9]{64}$'),
  constraint rni_source_item_capture_mode_check
    check (capture_mode in ('full_post', 'full_comment', 'excerpt_only')),
  constraint rni_source_item_metadata_object_check
    check (jsonb_typeof(metadata_json) = 'object'),
  constraint rni_source_item_rights_policy_check
    check (length(rights_policy_version) > 0),
  constraint rni_source_item_observation_order_check
    check (observed_at >= discovered_at)
);

-- Provider identity wins when present. Canonical URL remains unique as a second line of defence
-- and is the natural key when a provider does not expose an external object ID.
create unique index rni_source_item_platform_external_id_unique
  on rni_source_item (platform, external_id)
  where external_id is not null;

create unique index rni_source_item_platform_canonical_url_unique
  on rni_source_item (platform, canonical_url);

create table rni_source_retrieval (
  id                    uuid        primary key default gen_random_uuid(),
  source_item_id        uuid        not null,
  platform              text        not null,
  search_query_id       uuid        null,
  provider_request_id   text        null,
  returned_url          text        not null,
  discovered_at         timestamptz not null,
  observed_at           timestamptz not null,
  metadata_json         jsonb       not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),

  constraint rni_source_retrieval_id_source_unique unique (id, source_item_id),
  constraint rni_source_retrieval_source_platform_fk
    foreign key (source_item_id, platform)
    references rni_source_item (id, platform),
  constraint rni_source_retrieval_platform_check check (platform in ('reddit', 'x')),
  constraint rni_source_retrieval_returned_url_check check (returned_url ~* '^https?://'),
  constraint rni_source_retrieval_metadata_object_check
    check (jsonb_typeof(metadata_json) = 'object'),
  constraint rni_source_retrieval_observation_order_check
    check (observed_at >= discovered_at)
);

create unique index rni_source_retrieval_delivery_unique
  on rni_source_retrieval (
    source_item_id,
    coalesce(search_query_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(provider_request_id, ''),
    observed_at
  );

create index rni_source_retrieval_source_observed_idx
  on rni_source_retrieval (source_item_id, observed_at desc, created_at desc);

create table rni_source_content_version (
  id                    uuid        primary key default gen_random_uuid(),
  source_item_id        uuid        not null references rni_source_item (id),
  source_retrieval_id   uuid        not null,
  prior_version_id      uuid        null,
  bounded_content       text        not null,
  content_sha256        text        not null,
  capture_mode          text        not null,
  created_at            timestamptz not null default now(),

  constraint rni_source_content_id_source_unique unique (id, source_item_id),
  constraint rni_source_content_retrieval_fk
    foreign key (source_retrieval_id, source_item_id)
    references rni_source_retrieval (id, source_item_id),
  constraint rni_source_content_prior_fk
    foreign key (prior_version_id, source_item_id)
    references rni_source_content_version (id, source_item_id),
  constraint rni_source_content_text_check
    check (length(bounded_content) between 1 and 20000),
  constraint rni_source_content_no_page_html_check
    check (bounded_content !~* '<!doctype[[:space:]]+html|<html([[:space:]]|>)'),
  constraint rni_source_content_hash_check
    check (content_sha256 ~ '^[a-f0-9]{64}$'),
  constraint rni_source_content_capture_mode_check
    check (capture_mode in ('full_post', 'full_comment', 'excerpt_only')),
  constraint rni_source_content_identity_unique unique (source_item_id, content_sha256)
);

create index rni_source_content_source_created_idx
  on rni_source_content_version (source_item_id, created_at desc, id desc);

create trigger rni_source_item_append_only
  before update or delete on rni_source_item
  for each row execute function reject_mutation();

create trigger rni_source_retrieval_append_only
  before update or delete on rni_source_retrieval
  for each row execute function reject_mutation();

create trigger rni_source_content_append_only
  before update or delete on rni_source_content_version
  for each row execute function reject_mutation();

comment on table rni_source_item is
  'Canonical RNI source identity and first bounded evidence capture. One source can later support many securities; no source-level stance is stored here.';

comment on table rni_source_retrieval is
  'Append-only discovery provenance. Repeated queries preserve their returned URL, request/query IDs, observation time and bounded metadata.';

comment on table rni_source_content_version is
  'Append-only bounded evidence revisions. Different content hashes create linked versions; full webpage HTML is prohibited.';

create table rni_event_outbox (
  id                    uuid        primary key default gen_random_uuid(),
  event_key             text        not null unique,
  event_type            text        not null,
  source_item_id        uuid        not null references rni_source_item (id),
  source_retrieval_id   uuid        not null,
  content_version_id    uuid        not null,
  payload_json          jsonb       not null,
  publish_attempts      integer     not null default 0,
  published_at          timestamptz null,
  last_error            text        null,
  created_at            timestamptz not null default now(),

  constraint rni_event_outbox_retrieval_fk
    foreign key (source_retrieval_id, source_item_id)
    references rni_source_retrieval (id, source_item_id),
  constraint rni_event_outbox_content_fk
    foreign key (content_version_id, source_item_id)
    references rni_source_content_version (id, source_item_id),
  constraint rni_event_outbox_type_check check (event_type = 'rni.source_persisted.v1'),
  constraint rni_event_outbox_payload_object_check check (jsonb_typeof(payload_json) = 'object'),
  constraint rni_event_outbox_payload_source_check
    check (payload_json ->> 'sourceItemId' = source_item_id::text),
  constraint rni_event_outbox_payload_retrieval_check
    check (payload_json ->> 'retrievalId' = source_retrieval_id::text),
  constraint rni_event_outbox_payload_content_check
    check (payload_json ->> 'contentVersionId' = content_version_id::text),
  constraint rni_event_outbox_publish_attempts_check check (publish_attempts >= 0),
  constraint rni_event_outbox_content_event_unique unique (event_type, content_version_id)
);

create index rni_event_outbox_pending_idx
  on rni_event_outbox (created_at, id)
  where published_at is null;

create trigger rni_event_outbox_content_immutable
  before update or delete on rni_event_outbox
  for each row execute function reject_content_mutation(
    'publish_attempts', 'published_at', 'last_error'
  );

comment on table rni_event_outbox is
  'Transactional source-persisted events containing IDs only. Queue relays cannot observe an event without its committed source/retrieval/content lineage.';

alter table rni_source_item
  add column source_status text not null default 'active',
  add column tombstoned_at timestamptz null,
  add column tombstone_reason text null,
  add constraint rni_source_item_status_check
    check (source_status in ('active', 'deleted', 'unavailable', 'restricted', 'tombstoned')),
  add constraint rni_source_item_tombstone_fields_check check (
    (source_status = 'active' and tombstoned_at is null and tombstone_reason is null)
    or (
      source_status <> 'active'
      and tombstoned_at is not null
      and tombstone_reason is not null
      and length(tombstone_reason) > 0
    )
  );

drop trigger rni_source_item_append_only on rni_source_item;

create or replace function rni_source_status_transition_valid() returns trigger
language plpgsql as $$
begin
  if old.source_status <> 'active' and new.source_status is distinct from old.source_status then
    raise exception 'RNI source tombstone status is terminal; create a successor record for new evidence'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger rni_source_item_status_transition
  before update on rni_source_item
  for each row execute function rni_source_status_transition_valid();

create trigger rni_source_item_content_immutable
  before update or delete on rni_source_item
  for each row execute function reject_content_mutation(
    'source_status', 'tombstoned_at', 'tombstone_reason'
  );

create table rni_rejected_discovery (
  id                     uuid        primary key default gen_random_uuid(),
  platform               text        not null,
  returned_url           text        null,
  canonical_url          text        null,
  search_query_id        uuid        null,
  provider_request_id    text        null,
  rejection_reason       text        not null,
  discovery_fingerprint  text        not null unique,
  metadata_json          jsonb       not null default '{}'::jsonb,
  observed_at            timestamptz not null,
  created_at             timestamptz not null default now(),

  constraint rni_rejected_discovery_platform_check check (platform in ('reddit', 'x')),
  constraint rni_rejected_discovery_returned_url_check
    check (returned_url is null or returned_url ~* '^https?://'),
  constraint rni_rejected_discovery_canonical_url_check
    check (canonical_url is null or canonical_url ~* '^https?://'),
  constraint rni_rejected_discovery_reason_check check (
    rejection_reason in (
      'missing_url',
      'invalid_url',
      'invalid_scope',
      'whole_page_html',
      'content_unavailable',
      'terms_blocked',
      'unsupported_source'
    )
  ),
  constraint rni_rejected_discovery_fingerprint_check
    check (discovery_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint rni_rejected_discovery_metadata_object_check
    check (jsonb_typeof(metadata_json) = 'object'),
  constraint rni_rejected_discovery_no_page_html_check
    check (metadata_json::text !~* '<!doctype[[:space:]]+html|<html([[:space:]]|>)')
);

create index rni_rejected_discovery_observed_idx
  on rni_rejected_discovery (observed_at desc, id desc);

create trigger rni_rejected_discovery_append_only
  before update or delete on rni_rejected_discovery
  for each row execute function reject_mutation();

comment on table rni_rejected_discovery is
  'Audit-only rejected discovery metadata. It has no bounded-content or page-payload column, so rejected whole pages cannot enter the evidence corpus.';
