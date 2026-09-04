import {
  rniSecurityMention,
  rniSecurityObservation,
  type RniSecurityMention,
  type RniSecurityObservation,
} from '../contracts';
import { getPool, type Queryable } from '../../repositories/client';

type MentionRow = {
  readonly id: string;
  readonly source_item_id: string;
  readonly security_id: string;
  readonly mention_text: string;
  readonly start_offset: number | null;
  readonly end_offset: number | null;
  readonly resolution_method: string;
  readonly resolution_confidence: string;
  readonly model_run_id: string | null;
};

type ObservationRow = {
  readonly id: string;
  readonly source_item_id: string;
  readonly security_id: string;
  readonly stance: string;
  readonly stance_score: string | null;
  readonly relevance: string;
  readonly claim_summary: string;
  readonly time_horizon: string | null;
  readonly dimension_assignments: unknown;
  readonly classifier_run_id: string;
  readonly prompt_version: string;
  readonly model_id: string;
  readonly input_hash: string;
  readonly created_at: Date | string;
};

const MENTION_COLUMNS = `
  id, source_item_id, security_id, mention_text, start_offset, end_offset,
  resolution_method, resolution_confidence, model_run_id
`;

const OBSERVATION_COLUMNS = `
  id, source_item_id, security_id, stance, stance_score, relevance, claim_summary, time_horizon,
  dimension_assignments, classifier_run_id, prompt_version, model_id, input_hash, created_at
`;

function mentionFromRow(row: MentionRow): RniSecurityMention {
  return rniSecurityMention.parse({
    id: row.id,
    sourceItemId: row.source_item_id,
    securityId: row.security_id,
    mentionText: row.mention_text,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    resolutionMethod: row.resolution_method,
    resolutionConfidence: row.resolution_confidence,
    modelRunId: row.model_run_id,
  });
}

function observationFromRow(row: ObservationRow): RniSecurityObservation {
  return rniSecurityObservation.parse({
    id: row.id,
    sourceItemId: row.source_item_id,
    securityId: row.security_id,
    stance: row.stance,
    stanceScore: row.stance_score,
    relevance: row.relevance,
    claimSummary: row.claim_summary,
    timeHorizon: row.time_horizon,
    dimensions: row.dimension_assignments,
    classifierRunId: row.classifier_run_id,
    promptVersion: row.prompt_version,
    modelId: row.model_id,
    inputHash: row.input_hash,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  });
}

export type RniMentionWrite = {
  readonly mention: RniSecurityMention;
  readonly inserted: boolean;
};

export async function persistRniSecurityMention(
  input: RniSecurityMention,
  db: Queryable = getPool(),
): Promise<RniMentionWrite> {
  const mention = rniSecurityMention.parse(input);
  const { rows } = await db.query<MentionRow>(
    `insert into rni_security_mention (
       id, source_item_id, security_id, mention_text, start_offset, end_offset,
       resolution_method, resolution_confidence, model_run_id
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (source_item_id, security_id) do nothing
     returning ${MENTION_COLUMNS}`,
    [
      mention.id,
      mention.sourceItemId,
      mention.securityId,
      mention.mentionText,
      mention.startOffset,
      mention.endOffset,
      mention.resolutionMethod,
      mention.resolutionConfidence,
      mention.modelRunId,
    ],
  );
  const inserted = rows[0];
  if (inserted !== undefined) return { mention: mentionFromRow(inserted), inserted: true };

  const { rows: existingRows } = await db.query<MentionRow>(
    `select ${MENTION_COLUMNS} from rni_security_mention
      where source_item_id = $1 and security_id = $2`,
    [mention.sourceItemId, mention.securityId],
  );
  const existing = existingRows[0];
  if (existing === undefined) {
    throw new Error('RNI mention upsert found a conflict but could not read the mention');
  }
  return { mention: mentionFromRow(existing), inserted: false };
}

export type RniObservationWrite = {
  readonly observation: RniSecurityObservation;
  readonly inserted: boolean;
};

export async function persistRniSecurityObservation(
  input: RniSecurityObservation,
  db: Queryable = getPool(),
): Promise<RniObservationWrite> {
  const observation = rniSecurityObservation.parse(input);
  const { rows } = await db.query<ObservationRow>(
    `insert into rni_security_observation (
       id, source_item_id, security_id, stance, stance_score, relevance, claim_summary,
       time_horizon, dimension_assignments, classifier_run_id, prompt_version, model_id,
       input_hash, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)
     on conflict (source_item_id, security_id, classifier_run_id) do nothing
     returning ${OBSERVATION_COLUMNS}`,
    [
      observation.id,
      observation.sourceItemId,
      observation.securityId,
      observation.stance,
      observation.stanceScore,
      observation.relevance,
      observation.claimSummary,
      observation.timeHorizon,
      JSON.stringify(observation.dimensions),
      observation.classifierRunId,
      observation.promptVersion,
      observation.modelId,
      observation.inputHash,
      observation.createdAt,
    ],
  );
  const inserted = rows[0];
  if (inserted !== undefined) {
    return { observation: observationFromRow(inserted), inserted: true };
  }

  const { rows: existingRows } = await db.query<ObservationRow>(
    `select ${OBSERVATION_COLUMNS} from rni_security_observation
      where source_item_id = $1 and security_id = $2 and classifier_run_id = $3`,
    [observation.sourceItemId, observation.securityId, observation.classifierRunId],
  );
  const existing = existingRows[0];
  if (existing === undefined) {
    throw new Error('RNI observation upsert found a conflict but could not read the observation');
  }
  return { observation: observationFromRow(existing), inserted: false };
}
