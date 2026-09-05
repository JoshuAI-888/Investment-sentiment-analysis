import type pg from 'pg';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getPool, type Queryable } from '../../../repositories/client';
import { getRniRunById, getRniPlatformSlices } from '../../repositories/runs';
import { getRniSourceById } from '../../repositories/source-items';
import { getRniCitationById } from '../../repositories/claims-narratives';
import { getRniCombinedSummary } from '../../repositories/summaries';
import { canonicalizeRedditUrl } from '../../discovery/reddit-url';
import { canonicalHash } from '../../../calc/canonical';
import { replayPlatformAnalytics, type RniPlatformAnalyticsArtifact } from '../../analytics';
import { replayPlatformFacts, type RniConvergenceArtifact } from '../../convergence';
import {
  rniRadarSecurity,
  rniDimensionKey,
  rniErrorCode,
  type RniCombinedSummary,
} from '../../contracts';
import { RniReadError } from '../errors';

const uuid = z.string().uuid();
const versionId = z.string().regex(/^[1-9]\d*$/u);
const headings = ['Reddit sentiment', 'X sentiment', 'Combined summary'] as const;

export type RniReadOptions = {
  /** Trusted deployment context, never request parameters. */
  environment: string;
  /** Resolve the current approved display policy inside the same read transaction. */
  rightsPolicyVersion: (db: Queryable) => Promise<string>;
  pool?: pg.Pool;
  now?: () => Date;
};

export class ReadDatabase {
  constructor(readonly options: RniReadOptions) {
    z.string().min(1).parse(options.environment);
  }

  async snapshot<T>(read: (store: ReadSnapshot) => Promise<T>): Promise<T> {
    let client: pg.PoolClient;
    try {
      client = await (this.options.pool ?? getPool()).connect();
    } catch {
      throw new RniReadError('PROVIDER_UNAVAILABLE');
    }
    try {
      await client.query('begin isolation level repeatable read read only');
      const policy = z
        .string()
        .min(1)
        .parse(await this.options.rightsPolicyVersion(client));
      const result = await read(new ReadSnapshot(client, this.options.environment, policy));
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      if (error instanceof RniReadError) throw error;
      // SQL, validation and provider-shaped metadata never become display errors.
      throw new RniReadError('CITATION_INVALID');
    } finally {
      client.release();
    }
  }
}

export type UniverseRow = {
  id: string;
  status: string;
  parent_version: string | null;
  selected_count: number;
  source_provider: string | null;
  source_endpoint: string | null;
  source_retrieved_at: Date | null;
  source_payload_hash: string | null;
  provider_call_id: string | null;
  created_at: Date;
};

export class ReadSnapshot {
  constructor(
    readonly db: Queryable,
    readonly environment: string,
    readonly policy: string,
  ) {}

  async run(id: string) {
    if (!uuid.safeParse(id).success) throw new RniReadError('INVALID_REQUEST');
    const { rows } = await this.db.query<{ id: string }>(
      `select r.id from rni_run r join config_version c on c.id = r.config_version
       join universe_version u on u.id = r.universe_version
       where r.id = $1 and c.environment = $2 and u.environment = $2`,
      [id, this.environment],
    );
    if (!rows.length) throw new RniReadError('RUN_NOT_FOUND');
    const run = await getRniRunById(id, this.db);
    if (!run) throw new RniReadError('RUN_NOT_FOUND');
    return run;
  }

  async slices(id: string) {
    await this.run(id);
    const slices = await getRniPlatformSlices(id, this.db);
    if (slices.length !== 2 || new Set(slices.map((s) => s.platform)).size !== 2)
      throw new RniReadError('CONFLICT');
    return slices.map((s) => ({
      ...s,
      errorCode:
        s.errorCode === null
          ? null
          : rniErrorCode.safeParse(s.errorCode).success
            ? s.errorCode
            : 'PROVIDER_UNAVAILABLE',
    }));
  }

  async securities(runId: string) {
    const run = await this.run(runId);
    const { rows } = await this.db.query(
      `select s.id, s.symbol as ticker, s.name as "companyName", s.exchange
       from universe_member m join security s on s.id = m.security_id
       left join rni_run_execution_scope scope on scope.run_id = $2
       where m.universe_version = $1 and m.enabled
         and (scope.scope_kind is distinct from 'manual_ticker' or scope.security_id = s.id)
       order by s.id limit 601`,
      [run.universeVersion, runId],
    );
    if (rows.length > 600) throw new RniReadError('CONFLICT');
    return rows.map((row) => rniRadarSecurity.parse(row));
  }

  async evidence(id: string) {
    if (!uuid.safeParse(id).success) throw new RniReadError('INVALID_REQUEST');
    const { rows } = await this.db.query<{ source_status: string }>(
      `select s.source_status from rni_source_item s where s.id = $1 and exists (
         select 1 from rni_run_observation o join rni_run r on r.id = o.run_id
         join config_version c on c.id = r.config_version
         where o.source_item_id = s.id and c.environment = $2
       )`,
      [id, this.environment],
    );
    if (!rows.length) throw new RniReadError('SOURCE_NOT_FOUND');
    if (rows[0]!.source_status !== 'active') throw new RniReadError('FORBIDDEN');
    const source = await getRniSourceById(id, this.db);
    if (!source) throw new RniReadError('SOURCE_NOT_FOUND');
    if (
      source.rightsPolicyVersion !== this.policy ||
      createHash('sha256').update(source.boundedContent).digest('hex') !== source.contentSha256
    )
      throw new RniReadError('CITATION_INVALID');
    const url = new URL(source.originalUrl);
    if (url.username || url.password || url.port || !['http:', 'https:'].includes(url.protocol))
      throw new RniReadError('CITATION_INVALID');
    if (source.platform === 'reddit') {
      const native = canonicalizeRedditUrl(source.originalUrl);
      if (
        !native ||
        native.canonicalUrl !== source.canonicalUrl ||
        native.externalId !== source.externalId ||
        native.sourceKind !== source.sourceKind
      )
        throw new RniReadError('CITATION_INVALID');
    } else {
      const match = /^\/(?:i\/web|[A-Za-z0-9_]+)\/status\/(\d+)\/?$/u.exec(url.pathname);
      if (
        !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) ||
        !match ||
        match[1] !== source.externalId ||
        source.canonicalUrl !== `https://x.com/i/web/status/${match[1]}`
      )
        throw new RniReadError('CITATION_INVALID');
    }
    // Provider metadata is deliberately not part of the public raw explorer allowlist.
    return { ...source, metadata: {}, providerRequestId: null };
  }

  async citation(id: string) {
    if (!uuid.safeParse(id).success) throw new RniReadError('INVALID_REQUEST');
    const { rows } = await this.db.query(
      `select c.id from rni_claim_citation c
       join rni_evidence_claim claim on claim.id = c.claim_id
       join rni_run_observation o on o.observation_id = claim.observation_id
         and o.security_id = claim.security_id and o.source_item_id = claim.source_item_id
       join rni_run r on r.id = o.run_id join config_version v on v.id = r.config_version
       where c.id = $1 and v.environment = $2 limit 1`,
      [id, this.environment],
    );
    if (!rows.length) throw new RniReadError('CITATION_INVALID');
    const citation = await getRniCitationById(id, this.db);
    if (!citation) throw new RniReadError('CITATION_INVALID');
    const source = await this.evidence(citation.sourceItemId);
    if (
      citation.platform !== source.platform ||
      citation.url !== source.originalUrl ||
      !source.boundedContent.includes(citation.evidenceText)
    )
      throw new RniReadError('CITATION_INVALID');
    return citation;
  }

  async publication(runId: string, securityId: string): Promise<RniCombinedSummary | null> {
    const summary = await getRniCombinedSummary(runId, securityId, this.db);
    if (!summary) return null;
    const { rows: artifacts } = await this.db.query<{ statement_count: number }>(
      `select statement_count from rni_cited_synthesis_artifact
       where id = $1 and run_id = $2 and security_id = $3`,
      [summary.id, runId, securityId],
    );
    if (!artifacts[0]) throw new RniReadError('CITATION_INVALID');
    const { rows } = await this.db.query<{
      ordinal: number;
      heading: (typeof headings)[number];
      section_status: string;
      statement_text: string;
      origin: string;
      citation_ids: string[];
      edges: string[];
    }>(
      `select p.ordinal, p.heading, p.section_status, p.statement_text, p.origin, p.citation_ids,
        coalesce((select jsonb_agg(e.citation_id::text order by e.citation_ordinal)
          from rni_publication_statement_citation e
          join rni_synthesis_citation_role role on role.id = e.citation_role_id
          where e.statement_id = p.id and role.run_id = $2 and role.security_id = $3
            and role.rights_policy_version = $4), '[]'::jsonb) as edges
       from rni_publication_statement p where p.synthesis_id = $1 order by p.ordinal`,
      [summary.id, runId, securityId, this.policy],
    );
    if (
      rows.length !== artifacts[0].statement_count ||
      rows.some(
        (row, i) =>
          row.ordinal !== i ||
          JSON.stringify(row.edges) !== JSON.stringify(row.citation_ids) ||
          (row.origin !== 'coverage_disclosure' && !row.edges.length),
      )
    )
      throw new RniReadError('CITATION_INVALID');
    for (const heading of headings) {
      const statements = rows.filter((row) => row.heading === heading);
      const section = summary.sections.find((s) => s.heading === heading)!;
      const ids = [...new Set(statements.flatMap((row) => row.edges))].sort();
      if (
        !statements.length ||
        section.text !== statements.map((row) => row.statement_text).join(' ') ||
        statements.some((row) => row.section_status !== section.status) ||
        JSON.stringify(ids) !== JSON.stringify([...section.citationIds].sort())
      )
        throw new RniReadError('CITATION_INVALID');
      for (const id of ids) {
        const citation = await this.citation(id);
        if (
          (heading === 'Reddit sentiment' && citation.platform !== 'reddit') ||
          (heading === 'X sentiment' && citation.platform !== 'x')
        )
          throw new RniReadError('CITATION_INVALID');
      }
    }
    return summary;
  }

  async artifacts(runId: string, securityId: string, summaryId?: string) {
    const { rows } = await this.db.query<{
      id: string;
      input_snapshot: RniConvergenceArtifact['inputSnapshot'];
      result_snapshot: RniConvergenceArtifact['result'];
      input_hash: string;
      result_hash: string;
      policy_version: string;
      calculation_code_version: RniConvergenceArtifact['calculationCodeVersion'];
      reddit_analytics_id: string;
      x_analytics_id: string;
    }>(
      `select c.* from rni_convergence_artifact c
       where c.run_id = $1 and c.security_id = $2
         and ($3::uuid is null or exists (select 1 from rni_cited_synthesis_artifact p
           where p.id = $3 and p.convergence_artifact_id = c.id))
       order by c.created_at desc, c.id desc limit 1`,
      [runId, securityId, summaryId ?? null],
    );
    const row = rows[0];
    if (!row) return null;
    const convergence = replayPlatformFacts({
      calculationCodeVersion: row.calculation_code_version,
      policyVersion: row.policy_version,
      inputHash: row.input_hash,
      resultHash: row.result_hash,
      inputSnapshot: row.input_snapshot,
      result: row.result_snapshot,
    });
    for (const platform of ['reddit', 'x'] as const) {
      const fact = convergence.result.platforms[platform];
      if (fact.runId !== runId || fact.securityId !== securityId || fact.platform !== platform)
        throw new RniReadError('CITATION_INVALID');
    }
    const { rows: platforms } = await this.db.query<{
      id: string;
      run_id: string;
      security_id: string;
      platform: 'reddit' | 'x';
      platform_slice_id: string;
      methodology_version: string;
      calculation_code_version: RniPlatformAnalyticsArtifact['calculationCodeVersion'];
      input_hash: string;
      result_hash: string;
      artifact_hash: string;
      input_snapshot: {
        input: RniPlatformAnalyticsArtifact['inputSnapshot'];
        methodology: RniPlatformAnalyticsArtifact['methodologySnapshot'];
      };
      result_snapshot: RniPlatformAnalyticsArtifact['result'];
    }>(`select * from rni_platform_analytics_artifact where id = any($1::uuid[])`, [
      [row.reddit_analytics_id, row.x_analytics_id],
    ]);
    const result = new Map<'reddit' | 'x', RniPlatformAnalyticsArtifact>();
    for (const p of platforms) {
      const artifact = replayPlatformAnalytics({
        runId: p.run_id,
        runSourceSliceId: p.platform_slice_id,
        methodologyVersion: p.methodology_version,
        calculationCodeVersion: p.calculation_code_version,
        inputSetHash: p.input_hash,
        resultHash: p.result_hash,
        inputSnapshot: p.input_snapshot.input,
        methodologySnapshot: p.input_snapshot.methodology,
        result: p.result_snapshot,
      });
      if (
        p.run_id !== runId ||
        p.security_id !== securityId ||
        artifact.inputSnapshot.securityId !== securityId ||
        artifact.inputSnapshot.platform !== p.platform ||
        canonicalHash(artifact) !== p.artifact_hash ||
        convergence.result.platforms[p.platform].analyticsArtifactHash !== p.artifact_hash
      )
        throw new RniReadError('CITATION_INVALID');
      result.set(p.platform, artifact);
    }
    if (result.size !== 2) throw new RniReadError('CITATION_INVALID');
    return { convergence, reddit: result.get('reddit')!, x: result.get('x')! };
  }

  async dimensionCitations(summaryId: string, platform: 'reddit' | 'x') {
    const { rows } = await this.db.query<{
      dimension: unknown;
      citation_id: string;
      source_item_id: string;
    }>(
      `select distinct claim.dimension, role.citation_id, role.source_item_id
       from rni_cited_synthesis_artifact a join rni_synthesis_citation_role role on role.batch_id = a.batch_id
       join rni_convergence_artifact convergence on convergence.id = a.convergence_artifact_id
       join rni_evidence_claim claim on claim.id = role.evidence_claim_id
       where a.id = $1 and role.platform = $2 and role.target_claim_id is null
         and role.analytics_artifact_id = case when $2 = 'reddit' then convergence.reddit_analytics_id else convergence.x_analytics_id end
         and role.rights_policy_version = $3 and claim.dimension is not null`,
      [summaryId, platform, this.policy],
    );
    return rows.map((row) => ({ ...row, dimension: rniDimensionKey.parse(row.dimension) }));
  }

  async sourceCount(runId: string, securityId: string, platform: 'reddit' | 'x') {
    const { rows } = await this.db.query<{ count: string }>(
      `select count(distinct s.id) as count from rni_run_observation o
       join rni_source_item s on s.id = o.source_item_id join rni_run r on r.id = o.run_id
       join rni_observation_semantic_quality q on q.observation_id = o.observation_id
       where o.run_id = $1 and o.security_id = $2 and s.platform = $3
         and q.exclusion_reason is null
         and coalesce(s.published_at, s.observed_at) >= r.window_start
         and coalesce(s.published_at, s.observed_at) < r.window_end`,
      [runId, securityId, platform],
    );
    return z.coerce.number().int().nonnegative().safe().parse(rows[0]!.count);
  }

  async universe(id?: string): Promise<UniverseRow> {
    if (id !== undefined && !versionId.safeParse(id).success)
      throw new RniReadError('INVALID_REQUEST');
    const { rows } = await this.db.query<UniverseRow>(
      `select id, status, parent_version, selected_count, source_provider, source_endpoint,
              source_retrieved_at, source_payload_hash, provider_call_id, created_at
       from universe_version where environment = $1
         and (($2::bigint is null and status = 'active') or id = $2)`,
      [this.environment, id ?? null],
    );
    if (rows.length !== 1) throw new RniReadError('UNIVERSE_SYNC_INVALID');
    return rows[0]!;
  }

  async members(id: string) {
    const { rows } = await this.db.query(
      `select s.id, s.symbol as ticker, s.name as "companyName", s.exchange
       from universe_member m join security s on s.id = m.security_id
       where m.universe_version = $1 and m.enabled order by s.symbol, s.id limit 601`,
      [id],
    );
    if (rows.length > 600) throw new RniReadError('UNIVERSE_SYNC_INVALID');
    return rows.map((row) => rniRadarSecurity.parse(row));
  }
}
