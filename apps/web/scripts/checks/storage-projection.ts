/**
 * Storage projection (F03 §4.5, closing F-07).
 *
 * F-07's arithmetic is what produced the artifact-granularity rule: 100 symbols × 180 sessions
 * = 18,000 artifacts for **one** series, ~30 MB before indexes, for a product that wanted the
 * same treatment for attention, sentiment, composites, technicals, valuation and cost outputs.
 *
 * The ruling made an artifact **one computation invocation**, with a per-point derivation table
 * inside it. This module projects storage under that rule, so the claim is a measured number
 * rather than a remembered argument. **Wave 1's exit gate requires the total under 300 MB.**
 */

/**
 * Bytes per row, before indexes.
 *
 * **The four artifact figures were re-measured in F05** (§2, §5) against real
 * `attention.rank_change` artifacts at the Wave 1 shape of 100 symbols, using `pg_column_size`
 * on Postgres 16. `tests/integration/artifact-storage.test.ts` is the measurement and it fails
 * if any of them becomes an under-estimate again.
 *
 * F-07's originals were estimates — *"deliberately conservative — F-07 used ~150 for narrow
 * rows"* — and two of them were conservative in the wrong direction:
 *
 * | Figure | F-07 estimate | First measured | Re-measured (lane-review finding 5) | Now |
 * |---|---|---|---|---|
 * | `calculationInput` | 200 | 387 | — | 400 |
 * | `calculationStep` | 250 | 316 | 360 | 400 |
 * | `calculationSnapshot` | 900 | 824 | — | 900 (unchanged — see below) |
 * | `seriesPoint` | 60 | 14 | 48 | 60 |
 *
 * An input row is nearly twice the estimate because it is not a narrow row: it carries the
 * provenance §4.8 §3 renders — provider, field, source URL, three timestamps, quality, freshness,
 * licence and redaction class, and a value hash. That provenance is the feature, so its cost is
 * the feature's cost and the projection should have said so from the start.
 *
 * `calculationSnapshot` keeps its 900 rather than dropping to the measured 824: the header
 * carries the resolved assumptions inline, `attention.rank_change` has two of them, and F06's
 * methods have more. The margin is for that, and it is stated rather than assumed.
 *
 * **`calculationStep` and `seriesPoint` were re-measured once more**, because the fixture that
 * produced their first "measured" figures was not representative: `tests/integration/artifact-
 * storage.test.ts`'s series used a handful of small single/double-digit integers, decremented by
 * a constant, over only 28 distinct dates cycled six times across 180 points. pglz compresses
 * that far better than 180 genuinely distinct dates and genuinely irregular, decimal128-precision
 * exact values ever would — the exact shape a real series artifact carries. Fixed to use 180
 * unique calendar dates and a division chain that forces the pinned working precision, which
 * moved `calculationStep` 316 → 360 and `seriesPoint` 14 → 48. Both constants are re-pinned above
 * the new measurement with the same margin discipline as the other two.
 */
export const ROW_BYTES = {
  /** Header plus JSONB result, assumptions and warnings. Series artifacts carry `points`. */
  calculationSnapshot: 900,
  calculationInput: 400,
  calculationStep: 400,
  /** One point inside a series artifact's `points` array — not a row. */
  seriesPoint: 60,
  marketSnapshot: 150,
  attentionSnapshot: 180,
  sentimentSnapshot: 200,
  evidenceItem: 1200,
  priceReturnSnapshot: 180,
} as const;

/** Postgres index overhead, as a multiplier on table bytes. */
export const INDEX_OVERHEAD = 1.4;

export type SeriesMethod = {
  readonly key: string;
  /** One artifact per subject per refresh. */
  readonly subjects: number;
  readonly refreshesPerDay: number;
  /** Points carried inside each artifact — F-07's rule, not one artifact per point. */
  readonly pointsPerArtifact: number;
  readonly inputsPerArtifact: number;
  readonly stepsPerArtifact: number;
};

export type ObservationStream = {
  readonly key: string;
  readonly rowBytes: number;
  readonly rowsPerDay: number;
};

export type ProjectionInput = {
  /** How much history the product holds. */
  readonly historyDays: number;
  /**
   * How long an artifact lives. F-07: "artifacts carry the same 90-day retention as normalized
   * data, plus permanent retention for any artifact referenced by a claim ledger entry, a share
   * grant, or an open issue". Retention, not history, is what sizes the artifact tables.
   */
  readonly artifactRetentionDays: number;
  readonly methods: readonly SeriesMethod[];
  readonly observations: readonly ObservationStream[];
  /**
   * The permanent corpus. §6.8: the normalized social corpus and its derived scores are
   * retained **indefinitely** — "they are the asset, not retained data" — and storage for it is
   * governed by a **growth-rate budget in MB/month, measured, not by a fixed ceiling**.
   *
   * It is therefore reported separately rather than counted against F-07's fixed gate. That is
   * not the projection moving its own goalposts: §6.8 states the different mechanism, and D-33
   * bought Neon Launch specifically to carry it.
   */
  readonly corpus: readonly ObservationStream[];
};

export type LineItem = {
  readonly key: string;
  readonly bytes: number;
  readonly note: string;
  readonly pool: 'artifact' | 'observation' | 'corpus';
};

export type Projection = {
  readonly lines: readonly LineItem[];
  /** Counted against F-07's 300 MB gate: artifacts and normalized observations, with indexes. */
  readonly gatedMb: number;
  /** Reported against §6.8's growth-rate budget instead. */
  readonly corpusMbPerMonth: number;
  readonly corpusMbAtHistoryEnd: number;
};

const MB = 1024 * 1024;

export function project(input: ProjectionInput): Projection {
  const lines: LineItem[] = [];

  for (const method of input.methods) {
    const artifacts = method.subjects * method.refreshesPerDay * input.artifactRetentionDays;
    const bytes =
      artifacts *
      (ROW_BYTES.calculationSnapshot +
        method.pointsPerArtifact * ROW_BYTES.seriesPoint +
        method.inputsPerArtifact * ROW_BYTES.calculationInput +
        method.stepsPerArtifact * ROW_BYTES.calculationStep);

    lines.push({
      pool: 'artifact',
      key: `artifact:${method.key}`,
      bytes,
      note: `${artifacts.toLocaleString()} live artifacts (${method.refreshesPerDay}/day × ${method.subjects} subjects × ${input.artifactRetentionDays} d) × (header + ${method.pointsPerArtifact} pts + ${method.inputsPerArtifact} in + ${method.stepsPerArtifact} steps)`,
    });
  }

  for (const stream of input.observations) {
    const rows = stream.rowsPerDay * input.artifactRetentionDays;
    lines.push({
      pool: 'observation',
      key: `observation:${stream.key}`,
      bytes: rows * stream.rowBytes,
      note: `${rows.toLocaleString()} rows × ${stream.rowBytes} B (${input.artifactRetentionDays} d retention)`,
    });
  }

  for (const stream of input.corpus) {
    const rows = stream.rowsPerDay * input.historyDays;
    lines.push({
      pool: 'corpus',
      key: `corpus:${stream.key}`,
      bytes: rows * stream.rowBytes,
      note: `${rows.toLocaleString()} rows × ${stream.rowBytes} B (permanent, §6.8)`,
    });
  }

  const sum = (pool: LineItem['pool']) =>
    lines.filter((line) => line.pool === pool).reduce((total, line) => total + line.bytes, 0);

  const gatedBytes = (sum('artifact') + sum('observation')) * INDEX_OVERHEAD;
  const corpusBytes = sum('corpus') * INDEX_OVERHEAD;
  const corpusPerDay = input.corpus.reduce(
    (total, stream) => total + stream.rowsPerDay * stream.rowBytes,
    0,
  );

  return {
    lines,
    gatedMb: gatedBytes / MB,
    corpusMbAtHistoryEnd: corpusBytes / MB,
    corpusMbPerMonth: (corpusPerDay * 30 * INDEX_OVERHEAD) / MB,
  };
}

/**
 * The Wave 1 shape: 100 symbols (D-27), 180 days of history, 90-day artifact retention (F-07),
 * the D-12 source stack.
 *
 * **The refresh cadences below are assumptions, not specification.** No feature spec fixes them
 * yet — F16's five-minute dispatcher cadence is the dispatcher's, not each job's. They are the
 * dominant term in the result, so the script prints its sensitivity to them.
 */
export const WAVE_1_PROJECTION: ProjectionInput = {
  historyDays: 180,
  artifactRetentionDays: 90,
  methods: [
    // A 180-point return series is ONE artifact, recomputed daily. This single line is the whole
    // of F-07's ruling: under the old "artifact per rendered chart point" reading it would be
    // 100 × 180 × 180 artifacts rather than 100 × 90.
    { key: 'price_return_series', subjects: 100, refreshesPerDay: 1, pointsPerArtifact: 180, inputsPerArtifact: 4, stepsPerArtifact: 6 },
    { key: 'attention_rank_change', subjects: 100, refreshesPerDay: 2, pointsPerArtifact: 0, inputsPerArtifact: 4, stepsPerArtifact: 5 },
    { key: 'sentiment_shrunk', subjects: 100, refreshesPerDay: 4, pointsPerArtifact: 0, inputsPerArtifact: 6, stepsPerArtifact: 8 },
    { key: 'market_composite', subjects: 1, refreshesPerDay: 4, pointsPerArtifact: 0, inputsPerArtifact: 8, stepsPerArtifact: 10 },
    { key: 'sector_composite', subjects: 11, refreshesPerDay: 4, pointsPerArtifact: 0, inputsPerArtifact: 6, stepsPerArtifact: 8 },
  ],
  observations: [
    { key: 'market_snapshot', rowBytes: ROW_BYTES.marketSnapshot, rowsPerDay: 100 },
    { key: 'price_return_snapshot', rowBytes: ROW_BYTES.priceReturnSnapshot, rowsPerDay: 400 },
    { key: 'attention_snapshot', rowBytes: ROW_BYTES.attentionSnapshot, rowsPerDay: 200 },
    { key: 'sentiment_snapshot', rowBytes: ROW_BYTES.sentimentSnapshot, rowsPerDay: 448 },
  ],
  corpus: [
    // D-16 forward-only, §6.8 permanent. D-33 projected 120–180 MB/month and bought Neon Launch
    // for it; this line is the check on that number, not a competitor to the 300 MB gate.
    { key: 'evidence_item', rowBytes: ROW_BYTES.evidenceItem, rowsPerDay: 2_000 },
  ],
};

/** F03 §4.5 / Wave 1 exit gate. */
export const GATE_MB = 300;
