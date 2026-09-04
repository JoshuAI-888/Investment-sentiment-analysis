-- 0022 — RNI claims, citations, themes, narratives and comparative relationships.
--
-- Every semantic object remains attached to persisted source evidence. Claim/narrative vectors
-- are intentionally not declared here until CR-DATA-003 resolves the binding pgvector conflict.

alter table rni_security_observation
  add constraint rni_security_observation_id_source_security_unique
  unique (id, source_item_id, security_id);

create table rni_evidence_claim (
  id                  uuid        primary key default gen_random_uuid(),
  source_item_id      uuid        not null references rni_source_item (id),
  security_id         uuid        null references security (id),
  observation_id      uuid        null,
  claim_text          text        not null,
  claim_type          text        not null,
  epistemic_status    text        not null,
  support_start       integer     null,
  support_end         integer     null,
  extractor_run_id    uuid        not null,
  input_hash          text        not null,
  created_at          timestamptz not null,

  constraint rni_evidence_claim_observation_fk
    foreign key (observation_id, source_item_id, security_id)
    references rni_security_observation (id, source_item_id, security_id),
  constraint rni_evidence_claim_observation_security_check
    check (observation_id is null or security_id is not null),
  constraint rni_evidence_claim_text_check check (length(claim_text) between 1 and 2000),
  constraint rni_evidence_claim_type_check check (
    claim_type in ('fact_assertion', 'opinion', 'forecast', 'position', 'question', 'joke')
  ),
  constraint rni_evidence_claim_epistemic_status_check check (
    epistemic_status in (
      'source_claim', 'verified_fact', 'analytical_inference', 'unverified', 'contradicted'
    )
  ),
  constraint rni_evidence_claim_support_offsets_check check (
    (support_start is null or support_start >= 0)
    and (support_end is null or support_end > 0)
    and (support_start is null or support_end is null or support_end > support_start)
  ),
  constraint rni_evidence_claim_input_hash_check check (input_hash ~ '^[a-f0-9]{64}$'),
  constraint rni_evidence_claim_identity_unique
    unique (source_item_id, security_id, input_hash)
);

create table rni_claim_citation (
  id              uuid        primary key default gen_random_uuid(),
  claim_id        uuid        not null references rni_evidence_claim (id),
  source_item_id  uuid        not null references rni_source_item (id),
  evidence_text   text        not null,
  created_at      timestamptz not null default now(),

  constraint rni_claim_citation_evidence_text_check
    check (length(evidence_text) between 1 and 2000),
  constraint rni_claim_citation_identity_unique
    unique (claim_id, source_item_id, evidence_text)
);

create table rni_theme_definition (
  id                uuid        primary key default gen_random_uuid(),
  taxonomy_version  text        not null,
  stable_key        text        not null,
  name              text        not null,
  description       text        not null,
  parent_stable_key text        null,
  enabled           boolean     not null default true,
  created_at        timestamptz not null default now(),

  constraint rni_theme_definition_version_key_unique unique (taxonomy_version, stable_key),
  constraint rni_theme_definition_version_check check (length(taxonomy_version) > 0),
  constraint rni_theme_definition_key_check check (length(stable_key) > 0),
  constraint rni_theme_definition_name_check check (length(name) > 0),
  constraint rni_theme_definition_description_check check (length(description) > 0)
);

create table rni_observation_theme (
  observation_id            uuid         not null references rni_security_observation (id),
  theme_definition_id       uuid         not null references rni_theme_definition (id),
  classification_confidence numeric(5,4) not null,
  theme_stance              text         not null,
  theme_score               numeric(5,4) null,
  created_at                timestamptz  not null default now(),

  primary key (observation_id, theme_definition_id),
  constraint rni_observation_theme_confidence_check
    check (classification_confidence between 0 and 1),
  constraint rni_observation_theme_stance_check check (
    theme_stance in (
      'strong_bearish', 'bearish', 'neutral', 'bullish', 'strong_bullish', 'insufficient'
    )
  ),
  constraint rni_observation_theme_score_check
    check (theme_score is null or theme_score between -1 and 1)
);

create table rni_narrative (
  id                        uuid        primary key default gen_random_uuid(),
  run_id                    uuid        not null,
  security_id               uuid        null references security (id),
  canonical_thesis          text        not null,
  direction                 text        not null,
  horizon                   text        null,
  status                    text        not null,
  adjudicator_run_id        uuid        not null,
  first_source_at           timestamptz null,
  last_source_at            timestamptz null,
  independent_source_count  integer     not null default 0,
  raw_repetition_count      integer     not null default 0,
  input_hash                text        not null,
  created_at                timestamptz not null,

  constraint rni_narrative_thesis_check check (length(canonical_thesis) between 1 and 2000),
  constraint rni_narrative_direction_check check (
    direction in (
      'strong_bearish', 'bearish', 'neutral', 'bullish', 'strong_bullish', 'insufficient'
    )
  ),
  constraint rni_narrative_status_check
    check (status in ('candidate', 'active', 'fading', 'resurgent', 'rejected')),
  constraint rni_narrative_source_count_check check (independent_source_count >= 0),
  constraint rni_narrative_repetition_count_check check (raw_repetition_count >= 0),
  constraint rni_narrative_source_time_check
    check (first_source_at is null or last_source_at is null or last_source_at >= first_source_at),
  constraint rni_narrative_input_hash_check check (input_hash ~ '^[a-f0-9]{64}$')
);

create unique index rni_narrative_identity_unique
  on rni_narrative (
    run_id,
    coalesce(security_id, '00000000-0000-0000-0000-000000000000'::uuid),
    input_hash
  );

create table rni_narrative_membership (
  narrative_id          uuid         not null references rni_narrative (id),
  claim_id              uuid         not null references rni_evidence_claim (id),
  similarity            numeric(5,4) not null,
  membership_confidence numeric(5,4) not null,
  is_independent        boolean      not null,
  duplicate_group_hash  text         null,
  adjudication_reason   text         not null,
  created_at            timestamptz  not null default now(),

  primary key (narrative_id, claim_id),
  constraint rni_narrative_membership_similarity_check check (similarity between -1 and 1),
  constraint rni_narrative_membership_confidence_check
    check (membership_confidence between 0 and 1),
  constraint rni_narrative_membership_reason_check check (length(adjudication_reason) > 0)
);

create table rni_comparative_relation (
  id                    uuid        primary key default gen_random_uuid(),
  source_item_id        uuid        not null references rni_source_item (id),
  subject_security_id   uuid        not null,
  relation              text        not null,
  object_security_id    uuid        not null,
  evidence_text         text        not null,
  created_at            timestamptz not null default now(),

  constraint rni_comparative_relation_subject_mention_fk
    foreign key (source_item_id, subject_security_id)
    references rni_security_mention (source_item_id, security_id),
  constraint rni_comparative_relation_object_mention_fk
    foreign key (source_item_id, object_security_id)
    references rni_security_mention (source_item_id, security_id),
  constraint rni_comparative_relation_distinct_security_check
    check (subject_security_id <> object_security_id),
  constraint rni_comparative_relation_type_check
    check (relation in ('preferred_over', 'less_preferred_than', 'similar_to', 'contrasts_with')),
  constraint rni_comparative_relation_evidence_check
    check (length(evidence_text) between 1 and 2000),
  constraint rni_comparative_relation_identity_unique
    unique (source_item_id, subject_security_id, relation, object_security_id)
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'rni_evidence_claim',
    'rni_claim_citation',
    'rni_theme_definition',
    'rni_observation_theme',
    'rni_narrative',
    'rni_narrative_membership',
    'rni_comparative_relation'
  ]
  loop
    execute format(
      'create trigger %I_append_only before update or delete on %I
         for each row execute function reject_mutation()',
      table_name, table_name
    );
  end loop;
end;
$$;

comment on table rni_claim_citation is
  'Every citation is a foreign-key edge from a claim to a persisted source item; dangling prose evidence cannot be stored.';

comment on table rni_narrative_membership is
  'Narratives reference atomic persisted claims. Similarity is a candidate signal and never substitutes for adjudication.';
