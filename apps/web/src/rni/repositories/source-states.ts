import { getPool, type Queryable } from '../../repositories/client';

export type RniTerminalSourceStatus = 'deleted' | 'unavailable' | 'restricted' | 'tombstoned';

export type RniSourceTombstone = {
  readonly sourceItemId: string;
  readonly status: RniTerminalSourceStatus;
  readonly tombstonedAt: string;
  readonly reason: string;
};

export async function tombstoneRniSource(
  sourceItemId: string,
  status: RniTerminalSourceStatus,
  reason: string,
  tombstonedAt: string,
  db: Queryable = getPool(),
): Promise<RniSourceTombstone> {
  if (reason.trim() === '') throw new Error('RNI source tombstone reason is required');
  const { rows } = await db.query<{
    id: string;
    source_status: RniTerminalSourceStatus;
    tombstoned_at: Date | string;
    tombstone_reason: string;
  }>(
    `update rni_source_item
        set source_status = $2, tombstoned_at = $3, tombstone_reason = $4
      where id = $1 and source_status = 'active'
      returning id, source_status, tombstoned_at, tombstone_reason`,
    [sourceItemId, status, tombstonedAt, reason],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('RNI source is missing or already in a terminal tombstone state');
  }
  return {
    sourceItemId: row.id,
    status: row.source_status,
    tombstonedAt:
      row.tombstoned_at instanceof Date
        ? row.tombstoned_at.toISOString()
        : new Date(row.tombstoned_at).toISOString(),
    reason: row.tombstone_reason,
  };
}

export type RniRejectedDiscoveryReason =
  | 'missing_url'
  | 'invalid_url'
  | 'invalid_scope'
  | 'whole_page_html'
  | 'content_unavailable'
  | 'terms_blocked'
  | 'unsupported_source';

export type RniRejectedDiscoveryInput = {
  readonly id: string;
  readonly platform: 'reddit' | 'x';
  readonly returnedUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly searchQueryId: string | null;
  readonly providerRequestId: string | null;
  readonly rejectionReason: RniRejectedDiscoveryReason;
  readonly discoveryFingerprint: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly observedAt: string;
  readonly createdAt: string;
};

export type RniRejectedDiscoveryWrite = { readonly id: string; readonly inserted: boolean };

export async function recordRniRejectedDiscovery(
  input: RniRejectedDiscoveryInput,
  db: Queryable = getPool(),
): Promise<RniRejectedDiscoveryWrite> {
  const serializedMetadata = JSON.stringify(input.metadata);
  if (/<!doctype\s+html|<html(?:\s|>)/iu.test(serializedMetadata)) {
    throw new Error('Whole-page HTML is not valid rejected-discovery metadata');
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into rni_rejected_discovery (
       id, platform, returned_url, canonical_url, search_query_id, provider_request_id,
       rejection_reason, discovery_fingerprint, metadata_json, observed_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
     on conflict (discovery_fingerprint) do nothing returning id`,
    [
      input.id,
      input.platform,
      input.returnedUrl,
      input.canonicalUrl,
      input.searchQueryId,
      input.providerRequestId,
      input.rejectionReason,
      input.discoveryFingerprint,
      serializedMetadata,
      input.observedAt,
      input.createdAt,
    ],
  );
  const inserted = rows[0];
  if (inserted !== undefined) return { id: inserted.id, inserted: true };

  const { rows: existingRows } = await db.query<{ id: string }>(
    'select id from rni_rejected_discovery where discovery_fingerprint = $1',
    [input.discoveryFingerprint],
  );
  const existing = existingRows[0];
  if (existing === undefined) throw new Error('RNI rejected discovery could not read its conflict');
  return { id: existing.id, inserted: false };
}
