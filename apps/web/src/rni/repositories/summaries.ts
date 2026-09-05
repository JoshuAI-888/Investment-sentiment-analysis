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
  _db: Queryable = getPool(),
): Promise<RniCombinedSummaryWrite> {
  rniCombinedSummary.parse(input);
  throw new Error(
    'RNI standalone combined-summary writes are retired; use the atomic cited-synthesis persistence adapter',
  );
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
