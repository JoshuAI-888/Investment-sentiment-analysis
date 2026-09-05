import { z } from 'zod';
import { D } from '../../calc/decimal';
import {
  rniActiveUniverse,
  rniActiveUniverseVersion,
  rniRadarPage,
  rniRadarQuery,
  rniSecurityDetail,
  rniStagedUniversePreview,
  rniStagedUniverseVersion,
  rniUniverseSearchQuery,
  rniUniverseSearchResult,
  rniDimensionKey,
  type RniReadService,
  type RniUniverseReadService,
  type RniRadarQuery,
  type RniUniverseSearchQuery,
  type RniRadarPlatformCell,
  type RniPlatformSlice,
  type RniSecurityDetailDimension,
  type RniCombinedSummary,
} from '../contracts';
import { RniReadError } from './errors';
import {
  ReadDatabase,
  type ReadSnapshot,
  type RniReadOptions,
  type UniverseRow,
} from './repositories/snapshot';

const cursorSchema = z
  .object({ version: z.literal(1), runId: z.string().uuid(), after: z.string().uuid() })
  .strict();
const pending = (slices: readonly RniPlatformSlice[]) =>
  slices.some((s) => ['pending', 'running'].includes(s.status));
const terminalUsable = (slice: RniPlatformSlice) => ['complete', 'partial'].includes(slice.status);

function readCursor(cursor: string | null | undefined, runId: string): string | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error();
    const value = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (value.runId !== runId) throw new Error();
    return value.after;
  } catch {
    throw new RniReadError('INVALID_REQUEST');
  }
}

function emptyDimensions(reason: string): RniSecurityDetailDimension[] {
  return rniDimensionKey.options.map((dimension) => ({
    dimension,
    stance: 'insufficient',
    score: null,
    rationale: reason,
    citationIds: [],
  }));
}

/** Server-only PostgreSQL projection. Construct only behind existing authentication/authz. */
export class PostgresRniReadService implements RniReadService {
  private readonly database: ReadDatabase;
  constructor(private readonly options: RniReadOptions) {
    this.database = new ReadDatabase(options);
  }

  getRun(runId: string) {
    return this.database.snapshot((store) => store.run(runId));
  }
  getPlatformSlices(runId: string) {
    return this.database.snapshot((store) => store.slices(runId));
  }
  getCitation(citationId: string) {
    return this.database.snapshot((store) => store.citation(citationId));
  }
  getEvidence(sourceItemId: string) {
    return this.database.snapshot((store) => store.evidence(sourceItemId));
  }

  async getSecuritySummary(runId: string, securityId: string): Promise<RniCombinedSummary> {
    return this.database.snapshot(async (store) => {
      await this.requireSecurity(store, runId, securityId);
      await store.requireResultVisibility(runId, securityId);
      if (pending(await store.slices(runId))) throw new RniReadError('CONFLICT');
      const summary = await store.publication(runId, securityId);
      if (!summary) throw new RniReadError('CONFLICT');
      return summary;
    });
  }

  async getSecurityDetail(runId: string, securityId: string) {
    return this.database.snapshot(async (store) => {
      const security = await this.requireSecurity(store, runId, securityId);
      const projection = await this.project(store, runId, securityId, await store.slices(runId));
      return rniSecurityDetail.parse({
        runId,
        security,
        reddit: projection.detail.reddit,
        x: projection.detail.x,
      });
    });
  }

  async getRadarPage(input: RniRadarQuery) {
    const parsed = rniRadarQuery.safeParse(input);
    if (!parsed.success) throw new RniReadError('INVALID_REQUEST');
    const query = parsed.data;
    const after = readCursor(query.cursor, query.runId);
    return this.database.snapshot(async (store) => {
      const run = await store.run(query.runId);
      await store.requireResultVisibility(run.id);
      const slices = await store.slices(run.id);
      const securities = await store.securities(run.id);
      // An immutable universe/run scope binds pagination; a forged/outdated cursor is rejected.
      if (after && !securities.some((s) => s.id === after))
        throw new RniReadError('INVALID_REQUEST');
      const candidates = securities.filter((s) => after === null || s.id > after);
      const selected = candidates.slice(0, query.limit);
      const rows = [];
      for (const security of selected) {
        const projection = await this.project(store, run.id, security.id, slices);
        rows.push({ security, ...projection.row });
      }
      const last = selected.at(-1);
      return rniRadarPage.parse({
        run,
        rows,
        nextCursor:
          candidates.length > selected.length && last
            ? Buffer.from(JSON.stringify({ version: 1, runId: run.id, after: last.id })).toString(
                'base64url',
              )
            : null,
      });
    });
  }

  private async requireSecurity(store: ReadSnapshot, runId: string, securityId: string) {
    if (!z.string().uuid().safeParse(securityId).success) throw new RniReadError('INVALID_REQUEST');
    const security = (await store.securities(runId)).find((s) => s.id === securityId);
    if (!security) throw new RniReadError('INVALID_REQUEST');
    return security;
  }

  private async project(
    store: ReadSnapshot,
    runId: string,
    securityId: string,
    slices: readonly RniPlatformSlice[],
  ) {
    await store.requireResultVisibility(runId, securityId);
    let publication: RniCombinedSummary | null = null;
    let restricted = false;
    if (!pending(slices)) {
      try {
        publication = await store.publication(runId, securityId);
      } catch (error) {
        if (
          !(error instanceof RniReadError) ||
          !['FORBIDDEN', 'CITATION_INVALID', 'SOURCE_NOT_FOUND'].includes(error.code)
        )
          throw error;
        restricted = true;
      }
    }
    const artifacts = await store.artifacts(runId, securityId, publication?.id);
    const now = this.options.now?.() ?? new Date();
    const platform = async (key: 'reddit' | 'x') => {
      const slice = slices.find((s) => s.platform === key)!;
      const analytics = artifacts?.[key];
      const fact = artifacts?.convergence.result.platforms[key];
      const section = publication?.sections.find(
        (s) => s.heading === (key === 'reddit' ? 'Reddit sentiment' : 'X sentiment'),
      );
      const stale =
        analytics &&
        slice.dataThroughAt !== null &&
        D(now.getTime() - Date.parse(slice.dataThroughAt))
          .div(3_600_000)
          .greaterThan(analytics.methodologySnapshot.staleAfterHours);
      const fresh =
        slice.dataThroughAt !== null &&
        !stale &&
        artifacts?.convergence.result.facts.freshness[key] === 'fresh';
      const published =
        terminalUsable(slice) &&
        fresh &&
        section &&
        section.status !== 'insufficient' &&
        section.citationIds.length > 0 &&
        fact &&
        fact.stance !== 'insufficient' &&
        !restricted;
      const reason = restricted
        ? 'Published evidence is no longer displayable; this result is withheld.'
        : stale
          ? 'Saved evidence is stale; refresh is required before publishing a current result.'
          : !terminalUsable(slice)
            ? `${key === 'reddit' ? 'Reddit' : 'X'} is ${slice.status}; no sentiment is published.`
            : !fresh && artifacts
              ? 'Source freshness is unknown; no current sentiment is published.'
              : 'No cited, publishable result is available for this security in this run.';
      const cell: RniRadarPlatformCell = {
        platform: key,
        status: stale && terminalUsable(slice) ? 'partial' : slice.status,
        stance: published ? fact.stance : 'insufficient',
        summary: published ? section.text : reason,
        // The run-wide slice count is never substituted for a per-security count.
        eligibleSourceCount: analytics
          ? z.coerce.number().int().nonnegative().safe().parse(analytics.result.attention)
          : await store.sourceCount(runId, securityId, key),
        coverageDisclosure: slice.coverageDisclosure,
        confidence: published ? (analytics?.result.confidence?.unitScore ?? null) : null,
        lastSuccessfulRefreshAt: slice.lastSuccessfulRefreshAt,
        dataThroughAt: slice.dataThroughAt,
        computedAt: slice.computedAt,
        citationIds: published ? section.citationIds : [],
      };
      let dimensions = emptyDimensions(reason);
      if (published && analytics && publication) {
        const candidates = await store.dimensionCitations(publication.id, key);
        dimensions = await Promise.all(
          rniDimensionKey.options.map(async (dimension) => {
            const metric = analytics.result.sentimentByDimension.find(
              (m) => m.dimension === dimension,
            )!;
            const dimensionFact = fact.dimensions.find((d) => d.dimension === dimension)!;
            const ids = [
              ...new Set(
                candidates
                  .filter(
                    (c) =>
                      c.dimension === dimension && metric.sourceItemIds.includes(c.source_item_id),
                  )
                  .map((c) => c.citation_id),
              ),
            ].sort();
            const completelyCited = metric.sourceItemIds.every((id) =>
              candidates.some((c) => c.dimension === dimension && c.source_item_id === id),
            );
            if (
              metric.status !== 'available' ||
              dimensionFact.stance === 'insufficient' ||
              !ids.length ||
              !completelyCited
            )
              return emptyDimensions('Insufficient cited evidence for this dimension.').find(
                (d) => d.dimension === dimension,
              )!;
            for (const id of ids) await store.citation(id);
            return {
              dimension,
              stance: dimensionFact.stance,
              score: dimensionFact.score,
              rationale: `${key === 'reddit' ? 'Reddit' : 'X'} evidence-weighted ${dimension.replaceAll('_', ' ')} stance is ${dimensionFact.stance}.`,
              citationIds: ids,
            };
          }),
        );
      }
      const { stance: _stance, ...detail } = cell;
      return { cell, detail: { ...detail, dimensions } };
    };
    const reddit = await platform('reddit');
    const x = await platform('x');
    const section = publication?.sections.find((s) => s.heading === 'Combined summary');
    const both = reddit.cell.stance !== 'insufficient' && x.cell.stance !== 'insufficient';
    const one = reddit.cell.stance !== 'insufficient' || x.cell.stance !== 'insufficient';
    const state = pending(slices)
      ? 'pending'
      : !one
        ? 'insufficient'
        : !both
          ? 'partial'
          : (artifacts?.convergence.result.radarState ?? 'insufficient');
    const unchangedPublication = section && both;
    const combined = {
      state,
      summary: unchangedPublication
        ? section.text
        : state === 'partial'
          ? `Partial cross-source result: ${reddit.cell.stance === 'insufficient' ? 'Reddit' : 'X'} has no current publishable conclusion.`
          : pending(slices)
            ? 'Combined summary awaits terminal Reddit and X results.'
            : 'Insufficient current cited evidence for a combined summary.',
      citationIds: unchangedPublication ? section.citationIds : [],
    };
    return {
      row: { reddit: reddit.cell, x: x.cell, combined },
      detail: { reddit: reddit.detail, x: x.detail },
    };
  }
}

function version(row: UniverseRow, staged = false) {
  const fmp = row.source_provider === 'fmp';
  if (
    (staged && !fmp) ||
    (fmp && (row.source_endpoint !== '/stable/sp500-constituent' || !row.provider_call_id))
  )
    throw new RniReadError('UNIVERSE_SYNC_INVALID');
  const value = {
    id: row.id,
    status: row.status,
    parentVersion: row.parent_version,
    securityCount: row.selected_count,
    source: fmp ? 'fmp_sp500_constituent' : 'legacy_seed',
    retrievedAt: row.source_retrieved_at?.toISOString() ?? null,
    payloadSha256: row.source_payload_hash,
    createdAt: row.created_at.toISOString(),
  };
  if (!fmp && row.source_provider !== null && row.source_provider !== 'legacy_seed')
    throw new RniReadError('UNIVERSE_SYNC_INVALID');
  return staged ? rniStagedUniverseVersion.parse(value) : rniActiveUniverseVersion.parse(value);
}

export class PostgresRniUniverseReadService implements RniUniverseReadService {
  private readonly database: ReadDatabase;
  constructor(options: RniReadOptions) {
    this.database = new ReadDatabase(options);
  }
  private async active(store: ReadSnapshot) {
    const row = await store.universe();
    const members = await store.members(row.id);
    if (
      members.length !== row.selected_count ||
      new Set(members.map((m) => m.ticker)).size !== members.length
    )
      throw new RniReadError('UNIVERSE_SYNC_INVALID');
    const result = rniActiveUniverse.parse({
      version: version(row),
      defaultSecurity: members.find((m) => m.ticker === 'NVDA'),
    });
    return { ...result, members };
  }
  getActiveUniverse() {
    return this.database.snapshot(async (store) => {
      const { members: _members, ...active } = await this.active(store);
      return active;
    });
  }
  searchActiveUniverse(input: RniUniverseSearchQuery) {
    const parsed = rniUniverseSearchQuery.safeParse(input);
    if (!parsed.success) throw new RniReadError('INVALID_REQUEST');
    return this.database.snapshot(async (store) => {
      const active = await this.active(store);
      const query = parsed.data.query.toLowerCase();
      const matches = active.members.filter(
        (m) =>
          m.ticker.toLowerCase().includes(query) || m.companyName.toLowerCase().includes(query),
      );
      return rniUniverseSearchResult.parse({
        version: active.version,
        query: parsed.data.query,
        members: matches.slice(0, parsed.data.limit),
        hasMore: matches.length > parsed.data.limit,
      });
    });
  }
  getStagedUniversePreview(id: string) {
    return this.database.snapshot(async (store) => {
      const active = await this.active(store);
      const row = await store.universe(id);
      const staged = version(row, true);
      const members = await store.members(id);
      if (
        members.length !== staged.securityCount ||
        !members.some((m) => m.ticker === 'NVDA') ||
        new Set(members.map((m) => m.ticker)).size !== members.length
      )
        throw new RniReadError('UNIVERSE_SYNC_INVALID');
      const activeIds = new Set(active.members.map((m) => m.id));
      const stagedIds = new Set(members.map((m) => m.id));
      return rniStagedUniversePreview.parse({
        activeVersion: active.version,
        stagedVersion: staged,
        added: members.filter((m) => !activeIds.has(m.id)),
        removed: active.members.filter((m) => !stagedIds.has(m.id)),
      });
    });
  }
}
