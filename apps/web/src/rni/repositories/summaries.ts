import { rniCombinedSummary, type RniCombinedSummary } from '../contracts';
import { getPool, type Queryable } from '../../repositories/client';

type SummaryRow = {
  readonly id: string;
  readonly run_id: string;
  readonly security_id: string;
  readonly status: string;
  readonly sections: unknown;
  readonly created_at: Date | string;
};

const SUMMARY_COLUMNS = 'id, run_id, security_id, status, sections, created_at';

function summaryFromRow(row: SummaryRow): RniCombinedSummary {
  return rniCombinedSummary.parse({
    id: row.id,
    runId: row.run_id,
    securityId: row.security_id,
    status: row.status,
    sections: row.sections,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  });
}

export type RniCombinedSummaryWrite = {
  readonly summary: RniCombinedSummary;
  readonly inserted: boolean;
};

export async function persistRniCombinedSummary(
  input: RniCombinedSummary,
  db: Queryable = getPool(),
): Promise<RniCombinedSummaryWrite> {
  const summary = rniCombinedSummary.parse(input);
  const { rows } = await db.query<SummaryRow>(
    `insert into rni_combined_summary (
       id, run_id, security_id, reddit_platform_slice_id, x_platform_slice_id, status,
       sections, created_at
     )
     select $1, $2, $3, reddit.id, x_slice.id, $4, $5::jsonb, $6
       from rni_platform_slice reddit
       join rni_platform_slice x_slice on x_slice.run_id = reddit.run_id
      where reddit.run_id = $2 and reddit.platform = 'reddit' and x_slice.platform = 'x'
     on conflict (run_id, security_id) do nothing
     returning ${SUMMARY_COLUMNS}`,
    [
      summary.id,
      summary.runId,
      summary.securityId,
      summary.status,
      JSON.stringify(summary.sections),
      summary.createdAt,
    ],
  );
  const inserted = rows[0];
  if (inserted !== undefined) return { summary: summaryFromRow(inserted), inserted: true };

  const { rows: existingRows } = await db.query<SummaryRow>(
    `select ${SUMMARY_COLUMNS} from rni_combined_summary
      where run_id = $1 and security_id = $2`,
    [summary.runId, summary.securityId],
  );
  const existing = existingRows[0];
  if (existing === undefined) {
    throw new Error('RNI combined summary requires persisted Reddit and X slices for its run');
  }
  return { summary: summaryFromRow(existing), inserted: false };
}

export async function getRniCombinedSummary(
  runId: string,
  securityId: string,
  db: Queryable = getPool(),
): Promise<RniCombinedSummary | undefined> {
  const { rows } = await db.query<SummaryRow>(
    `select ${SUMMARY_COLUMNS} from rni_combined_summary
      where run_id = $1 and security_id = $2`,
    [runId, securityId],
  );
  return rows[0] === undefined ? undefined : summaryFromRow(rows[0]);
}
