-- 0011 — the bitemporal tables gain `ingested_at` in their primary keys (F22 §4.1).
--
-- **A defect F22 exposed in F03's schema, inherited from source §7.2.**
--
-- §7.2 specifies `PRIMARY KEY(security_id, provider, observed_at)` for `market_snapshot`, and
-- the same shape for the other snapshot tables. F22 §4.1 says: *"Never overwrite; insert a
-- successor."*
--
-- **Those two cannot both hold.** With `ingested_at` outside the key, a revision of the same
-- observation — a provider correcting a close, a re-fetch that returns a different value —
-- collides with the row it revises. The only way to store it is an UPDATE, which is exactly
-- what §4.1 forbids and exactly what destroys the point-in-time property: the earlier value
-- disappears, and an as-of read for a date before the correction returns the corrected number.
-- A backtest built on that sees a price nobody could have acted on.
--
-- The failure is silent in the direction that matters. Nothing errors; the row is simply gone,
-- and every later read is confidently wrong.
--
-- This was found by a test fixture that tried to store two facts about the same instant with
-- different `ingested_at` values — which is not an exotic case, it is the ordinary shape of a
-- corrected observation.

alter table market_snapshot drop constraint market_snapshot_pkey;
alter table market_snapshot
  add constraint market_snapshot_pkey
  primary key (security_id, provider, observed_at, ingested_at);

alter table attention_snapshot drop constraint attention_snapshot_pkey;
alter table attention_snapshot
  add constraint attention_snapshot_pkey
  primary key (security_id, source, observed_at, ingested_at);

alter table sentiment_snapshot drop constraint sentiment_snapshot_pkey;
alter table sentiment_snapshot
  add constraint sentiment_snapshot_pkey
  primary key (subject_type, subject_id, source_type, observed_at, ingested_at);

alter table security_profile_snapshot drop constraint security_profile_snapshot_pkey;
alter table security_profile_snapshot
  add constraint security_profile_snapshot_pkey
  primary key (security_id, provider, observed_at, ingested_at);

-- The index every as-of read wants: bound both columns, ordered by knowability.
-- §8's second risk row — "bitemporal queries are slow as the corpus grows" — names
-- `(subject, observed_at, ingested_at)` as the mitigation.
create index market_snapshot_asof_idx
  on market_snapshot (security_id, observed_at desc, ingested_at desc);
create index attention_snapshot_asof_idx
  on attention_snapshot (security_id, observed_at desc, ingested_at desc);
create index sentiment_snapshot_asof_idx
  on sentiment_snapshot (subject_type, subject_id, observed_at desc, ingested_at desc);
create index evidence_item_asof_idx
  on evidence_item (security_id, available_at desc, ingested_at desc);

comment on constraint market_snapshot_pkey on market_snapshot is
  'F22 §4.1. `ingested_at` is part of the key because a bitemporal table must be able to hold a revision of an observation alongside the original. Without it, a correction can only be stored by overwriting — which deletes the value that was actually knowable at the time.';
