import type pg from 'pg';
import { rniSourceItem, type RniSourceItem } from '../contracts';
import { getPool, withTransaction, type Queryable } from '../../repositories/client';

type SourceRow = {
  readonly id: string;
  readonly platform: string;
  readonly source_kind: string;
  readonly external_id: string | null;
  readonly canonical_url: string;
  readonly original_url: string;
  readonly subreddit_or_scope: string;
  readonly author_handle_hash: string | null;
  readonly title: string | null;
  readonly bounded_content: string;
  readonly content_sha256: string;
  readonly capture_mode: string;
  readonly published_at: Date | string | null;
  readonly discovered_at: Date | string;
  readonly observed_at: Date | string;
  readonly search_query_id: string | null;
  readonly provider_request_id: string | null;
  readonly metadata_json: unknown;
  readonly rights_policy_version: string;
  readonly created_at: Date | string;
};

const SOURCE_COLUMNS = `
  id, platform, source_kind, external_id, canonical_url, original_url, subreddit_or_scope,
  author_handle_hash, title, bounded_content, content_sha256, capture_mode, published_at,
  discovered_at, observed_at, search_query_id, provider_request_id, metadata_json,
  rights_policy_version, created_at
`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function sourceFromRow(row: SourceRow): RniSourceItem {
  return rniSourceItem.parse({
    id: row.id,
    platform: row.platform,
    sourceKind: row.source_kind,
    externalId: row.external_id,
    canonicalUrl: row.canonical_url,
    originalUrl: row.original_url,
    subredditOrScope: row.subreddit_or_scope,
    authorHandleHash: row.author_handle_hash,
    title: row.title,
    boundedContent: row.bounded_content,
    contentSha256: row.content_sha256,
    captureMode: row.capture_mode,
    publishedAt: row.published_at === null ? null : iso(row.published_at),
    discoveredAt: iso(row.discovered_at),
    observedAt: iso(row.observed_at),
    searchQueryId: row.search_query_id,
    providerRequestId: row.provider_request_id,
    metadata: row.metadata_json,
    rightsPolicyVersion: row.rights_policy_version,
    createdAt: iso(row.created_at),
  });
}

export type RniSourcePersistenceResult = {
  readonly source: RniSourceItem;
  readonly sourceInserted: boolean;
  readonly retrievalId: string;
  readonly retrievalInserted: boolean;
  readonly contentVersionId: string;
  readonly contentVersionInserted: boolean;
  readonly outboxEventId: string;
  readonly outboxInserted: boolean;
};

async function findByIdentity(source: RniSourceItem, db: Queryable): Promise<SourceRow> {
  const identityClause =
    source.externalId === null
      ? 'platform = $1 and canonical_url = $2'
      : 'platform = $1 and (external_id = $2 or canonical_url = $3)';
  const values =
    source.externalId === null
      ? [source.platform, source.canonicalUrl]
      : [source.platform, source.externalId, source.canonicalUrl];
  const { rows } = await db.query<SourceRow>(
    `select ${SOURCE_COLUMNS} from rni_source_item where ${identityClause}
     order by case when external_id = $2 then 0 else 1 end, created_at, id limit 1`,
    values,
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('RNI source upsert found a conflict but could not read the committed source');
  }
  return row;
}

async function insertOrReadSource(
  source: RniSourceItem,
  db: Queryable,
): Promise<{ readonly row: SourceRow; readonly inserted: boolean }> {
  const { rows } = await db.query<SourceRow>(
    `insert into rni_source_item (
       id, platform, source_kind, external_id, canonical_url, original_url, subreddit_or_scope,
       author_handle_hash, title, bounded_content, content_sha256, capture_mode, published_at,
       discovered_at, observed_at, search_query_id, provider_request_id, metadata_json,
       rights_policy_version, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
       $18::jsonb, $19, $20
     ) on conflict do nothing
     returning ${SOURCE_COLUMNS}`,
    [
      source.id,
      source.platform,
      source.sourceKind,
      source.externalId,
      source.canonicalUrl,
      source.originalUrl,
      source.subredditOrScope,
      source.authorHandleHash,
      source.title,
      source.boundedContent,
      source.contentSha256,
      source.captureMode,
      source.publishedAt,
      source.discoveredAt,
      source.observedAt,
      source.searchQueryId,
      source.providerRequestId,
      JSON.stringify(source.metadata),
      source.rightsPolicyVersion,
      source.createdAt,
    ],
  );
  const inserted = rows[0];
  return inserted === undefined
    ? { row: await findByIdentity(source, db), inserted: false }
    : { row: inserted, inserted: true };
}

async function insertOrReadRetrieval(
  sourceId: string,
  source: RniSourceItem,
  db: Queryable,
): Promise<{ readonly id: string; readonly inserted: boolean }> {
  const values = [
    sourceId,
    source.platform,
    source.searchQueryId,
    source.providerRequestId,
    source.originalUrl,
    source.discoveredAt,
    source.observedAt,
    JSON.stringify(source.metadata),
    source.createdAt,
  ];
  const { rows } = await db.query<{ id: string }>(
    `insert into rni_source_retrieval (
       source_item_id, platform, search_query_id, provider_request_id, returned_url,
       discovered_at, observed_at, metadata_json, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     on conflict do nothing returning id`,
    values,
  );
  const inserted = rows[0];
  if (inserted !== undefined) return { id: inserted.id, inserted: true };

  const { rows: existingRows } = await db.query<{ id: string }>(
    `select id from rni_source_retrieval
      where source_item_id = $1
        and search_query_id is not distinct from $2
        and provider_request_id is not distinct from $3
        and observed_at = $4
      order by created_at, id limit 1`,
    [sourceId, source.searchQueryId, source.providerRequestId, source.observedAt],
  );
  const existing = existingRows[0];
  if (existing === undefined) {
    throw new Error('RNI retrieval upsert found a conflict but could not read the retrieval');
  }
  return { id: existing.id, inserted: false };
}

async function insertOrReadContentVersion(
  sourceId: string,
  retrievalId: string,
  source: RniSourceItem,
  db: Queryable,
): Promise<{ readonly id: string; readonly inserted: boolean }> {
  const { rows: priorRows } = await db.query<{ id: string }>(
    `select id from rni_source_content_version
      where source_item_id = $1
      order by created_at desc, id desc limit 1`,
    [sourceId],
  );
  const priorVersionId = priorRows[0]?.id ?? null;
  const { rows } = await db.query<{ id: string }>(
    `insert into rni_source_content_version (
       source_item_id, source_retrieval_id, prior_version_id, bounded_content, content_sha256,
       capture_mode, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (source_item_id, content_sha256) do nothing returning id`,
    [
      sourceId,
      retrievalId,
      priorVersionId,
      source.boundedContent,
      source.contentSha256,
      source.captureMode,
      source.createdAt,
    ],
  );
  const inserted = rows[0];
  if (inserted !== undefined) return { id: inserted.id, inserted: true };

  const { rows: existingRows } = await db.query<{ id: string }>(
    `select id from rni_source_content_version
      where source_item_id = $1 and content_sha256 = $2`,
    [sourceId, source.contentSha256],
  );
  const existing = existingRows[0];
  if (existing === undefined) {
    throw new Error('RNI content upsert found a conflict but could not read the content version');
  }
  return { id: existing.id, inserted: false };
}

async function insertOrReadOutboxEvent(
  sourceId: string,
  retrievalId: string,
  contentVersionId: string,
  createdAt: string,
  db: Queryable,
): Promise<{ readonly id: string; readonly inserted: boolean }> {
  const eventType = 'rni.source_persisted.v1';
  const eventKey = `${eventType}:${contentVersionId}`;
  const payload = { sourceItemId: sourceId, retrievalId, contentVersionId };
  const { rows } = await db.query<{ id: string }>(
    `insert into rni_event_outbox (
       event_key, event_type, source_item_id, source_retrieval_id, content_version_id,
       payload_json, created_at
     ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)
     on conflict (event_type, content_version_id) do nothing returning id`,
    [
      eventKey,
      eventType,
      sourceId,
      retrievalId,
      contentVersionId,
      JSON.stringify(payload),
      createdAt,
    ],
  );
  const inserted = rows[0];
  if (inserted !== undefined) return { id: inserted.id, inserted: true };

  const { rows: existingRows } = await db.query<{ id: string }>(
    'select id from rni_event_outbox where event_type = $1 and content_version_id = $2',
    [eventType, contentVersionId],
  );
  const existing = existingRows[0];
  if (existing === undefined) throw new Error('RNI outbox upsert could not read its conflict');
  return { id: existing.id, inserted: false };
}

/**
 * Commits canonical source identity, discovery provenance, and bounded content in one transaction.
 * The returned source ID is not observable until all three writes have committed successfully.
 */
export async function persistRniSource(
  input: RniSourceItem,
  pool: pg.Pool = getPool(),
): Promise<RniSourcePersistenceResult> {
  const source = rniSourceItem.parse(input);
  return withTransaction(async (tx) => {
    const persistedSource = await insertOrReadSource(source, tx);
    const retrieval = await insertOrReadRetrieval(persistedSource.row.id, source, tx);
    const content = await insertOrReadContentVersion(
      persistedSource.row.id,
      retrieval.id,
      source,
      tx,
    );
    const outbox = await insertOrReadOutboxEvent(
      persistedSource.row.id,
      retrieval.id,
      content.id,
      source.createdAt,
      tx,
    );
    return {
      source: sourceFromRow(persistedSource.row),
      sourceInserted: persistedSource.inserted,
      retrievalId: retrieval.id,
      retrievalInserted: retrieval.inserted,
      contentVersionId: content.id,
      contentVersionInserted: content.inserted,
      outboxEventId: outbox.id,
      outboxInserted: outbox.inserted,
    };
  }, pool);
}

export type RniPendingOutboxEvent = {
  readonly id: string;
  readonly eventType: 'rni.source_persisted.v1';
  readonly sourceItemId: string;
  readonly retrievalId: string;
  readonly contentVersionId: string;
  readonly createdAt: string;
};

export async function pendingRniOutboxEvents(
  limit: number,
  db: Queryable = getPool(),
): Promise<readonly RniPendingOutboxEvent[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('RNI outbox limit must be an integer from 1 to 100');
  }
  const { rows } = await db.query<{
    id: string;
    event_type: 'rni.source_persisted.v1';
    source_item_id: string;
    source_retrieval_id: string;
    content_version_id: string;
    created_at: Date | string;
  }>(
    `select id, event_type, source_item_id, source_retrieval_id, content_version_id, created_at
       from rni_event_outbox
      where published_at is null
      order by created_at, id
      limit $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    sourceItemId: row.source_item_id,
    retrievalId: row.source_retrieval_id,
    contentVersionId: row.content_version_id,
    createdAt: iso(row.created_at),
  }));
}

export async function getRniSourceById(
  sourceItemId: string,
  db: Queryable = getPool(),
): Promise<RniSourceItem | undefined> {
  const { rows } = await db.query<SourceRow>(
    `select ${SOURCE_COLUMNS} from rni_source_item where id = $1`,
    [sourceItemId],
  );
  const row = rows[0];
  return row === undefined ? undefined : sourceFromRow(row);
}
