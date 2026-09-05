import type pg from 'pg';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getPool, type Queryable } from '../../../repositories/client';
import { getRniRunById, getRniPlatformSlices } from '../../repositories/runs';
import { getRniSourceById } from '../../repositories/source-items';
import { getRniCitationById } from '../../repositories/claims-narratives';
import { canonicalizeRedditUrl } from '../../discovery/reddit-url';
import { canonicalHash, canonicalInstant } from '../../../calc/canonical';
import { D, exact } from '../../../calc/decimal';
import { replayCitedSynthesis, type RniCitedSynthesisArtifact } from '../../agents';
import { PostgresRniSynthesisEvidenceReader } from '../../repositories/cited-synthesis-reader';
import { replayPlatformAnalytics, type RniPlatformAnalyticsArtifact } from '../../analytics';
import { replayPlatformFacts, type RniConvergenceArtifact } from '../../convergence';
import {
  rniRadarSecurity,
  rniDimensionKey,
  rniErrorCode,
  rniCombinedSummary,
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
  private readonly artifactCache = new Map<string, ReturnType<ReadSnapshot['loadArtifacts']>>();
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
    const { rows: scopes } = await this.db.query<{
      scope_kind: string;
      security_id: string | null;
    }>('select scope_kind, security_id from rni_run_execution_scope where run_id = $1', [runId]);
    const scope = scopes[0];
    if (
      scopes.length !== 1 ||
      !scope ||
      (scope.scope_kind === 'manual_ticker'
        ? run.trigger !== 'manual' || !uuid.safeParse(scope.security_id).success
        : scope.scope_kind !== 'full_universe' || scope.security_id !== null)
    )
      throw new RniReadError('CONFLICT');
    const { rows } = await this.db.query(
      `select s.id, s.symbol as ticker, s.name as "companyName", s.exchange
       from universe_member m join security s on s.id = m.security_id
       where m.universe_version = $1 and m.enabled
         and ($2::uuid is null or $2 = s.id)
       order by s.id limit 601`,
      [run.universeVersion, scope.security_id],
    );
    if (
      rows.length > 600 ||
      rows.length === 0 ||
      (scope.scope_kind === 'manual_ticker' && rows.length !== 1)
    )
      throw new RniReadError('CONFLICT');
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
    const summaries = await this.db.query(
      `select id, run_id as "runId", security_id as "securityId", status, sections,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"
        from rni_combined_summary where run_id = $1 and security_id = $2`,
      [runId, securityId],
    );
    if (!summaries.rows.length) return null;
    if (summaries.rows.length !== 1) throw new RniReadError('CITATION_INVALID');
    const summary = rniCombinedSummary.parse(summaries.rows[0]);
    const { rows: artifacts } = await this.db.query<{
      statement_count: number;
      batch_id: string;
      convergence_artifact_id: string;
      verifier_invocation_id: string;
      challenger_invocation_id: string;
      calculation_code_version: RniCitedSynthesisArtifact['calculationCodeVersion'];
      policy_version: string;
      input_hash: string;
      result_hash: string;
      verification_input_hash: string;
      challenger_input_hash: string;
      request_snapshot: RniCitedSynthesisArtifact['requestSnapshot'];
      model_input_snapshot: RniCitedSynthesisArtifact['modelInputSnapshot'];
      verification_output_snapshot: RniCitedSynthesisArtifact['verificationOutputSnapshot'];
      challenger_output_snapshot: RniCitedSynthesisArtifact['challengerOutputSnapshot'];
      result_snapshot: RniCitedSynthesisArtifact['result'];
      created_at: string;
    }>(
      `select *, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at from rni_cited_synthesis_artifact
       where id = $1 and run_id = $2 and security_id = $3`,
      [summary.id, runId, securityId],
    );
    const a = artifacts[0];
    if (!a) throw new RniReadError('CITATION_INVALID');
    const artifact: RniCitedSynthesisArtifact = {
      calculationCodeVersion: a.calculation_code_version,
      policyVersion: a.policy_version,
      inputHash: a.input_hash,
      resultHash: a.result_hash,
      verificationInputHash: a.verification_input_hash,
      challengerInputHash: a.challenger_input_hash,
      requestSnapshot: a.request_snapshot,
      modelInputSnapshot: a.model_input_snapshot,
      verificationOutputSnapshot: a.verification_output_snapshot,
      challengerOutputSnapshot: a.challenger_output_snapshot,
      result: a.result_snapshot,
    };
    const reader = new PostgresRniSynthesisEvidenceReader(
      { batchId: a.batch_id, runId, securityId },
      async () => this.policy,
      this.db,
    );
    let accepted: RniCitedSynthesisArtifact;
    try {
      accepted = await replayCitedSynthesis(artifact, reader);
      const components = await this.artifacts(runId, securityId, summary.id);
      if (
        !components ||
        canonicalHash(components.convergence) !==
          canonicalHash(accepted.requestSnapshot.convergenceArtifact) ||
        canonicalHash(accepted) !== canonicalHash(artifact) ||
        canonicalHash(accepted.result.summary) !== canonicalHash(summary) ||
        canonicalInstant(a.created_at) !== canonicalInstant(accepted.requestSnapshot.createdAt) ||
        accepted.requestSnapshot.verificationInvocation.modelRunId !== a.verifier_invocation_id ||
        accepted.requestSnapshot.challengerInvocation.modelRunId !== a.challenger_invocation_id
      )
        throw new Error('Crossed publication');
      await this.publicationOutputs(a.batch_id, a.convergence_artifact_id, accepted);
    } catch {
      throw new RniReadError('CITATION_INVALID');
    }
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
      rows.length !== a.statement_count ||
      rows.length !== accepted.result.statements.length ||
      rows.some(
        (row, i) =>
          row.ordinal !== i ||
          canonicalHash({
            heading: row.heading,
            origin: row.origin,
            text: row.statement_text,
            citationIds: row.citation_ids,
          }) !== canonicalHash(accepted.result.statements[i]) ||
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
    return accepted.result.summary;
  }

  private async publicationOutputs(
    batchId: string,
    convergenceId: string,
    artifact: RniCitedSynthesisArtifact,
  ) {
    const batches = await this.db.query<{
      ordered_citation_ids: unknown;
      reddit_platform_citation_ids: unknown;
      x_platform_citation_ids: unknown;
    }>('select * from rni_synthesis_batch where id = $1', [batchId]);
    const batch = batches.rows[0];
    const request = artifact.requestSnapshot;
    if (
      !batch ||
      canonicalHash(batch.ordered_citation_ids) !== canonicalHash(request.citationIds) ||
      canonicalHash(batch.reddit_platform_citation_ids) !==
        canonicalHash(request.platformCitationIds.reddit) ||
      canonicalHash(batch.x_platform_citation_ids) !== canonicalHash(request.platformCitationIds.x)
    )
      throw new Error('Crossed batch manifest');
    const { rows } = await this.db.query<{
      id: string;
      stage: string;
      status: string;
      input_hash: string;
      output_hash: string | null;
      prepared_snapshot: unknown;
      terminal_metadata: unknown;
    }>('select * from rni_synthesis_model_invocation where batch_id = $1 order by stage', [
      batchId,
    ]);
    const eligible = artifact.modelInputSnapshot.claimInputs.some(({ claim }) => {
      const facts = artifact.modelInputSnapshot.convergenceFacts;
      const platform = facts.platforms[claim.platform];
      return (
        ['complete', 'partial'].includes(platform.status) &&
        platform.stance !== 'insufficient' &&
        facts.facts.freshness[claim.platform] === 'fresh'
      );
    });
    const verified = artifact.verificationOutputSnapshot.some((v) => v.verdict !== 'unverified');
    if (rows.length !== 2) throw new Error('Missing invocation');
    let preparationIdentity: string | undefined;
    for (const row of rows) {
      const verifier = row.stage === 'verification';
      const input = verifier
        ? artifact.modelInputSnapshot
        : {
            ...artifact.modelInputSnapshot,
            invocation: artifact.requestSnapshot.challengerInvocation,
            verification: artifact.verificationOutputSnapshot,
          };
      const output = verifier
        ? artifact.verificationOutputSnapshot
        : artifact.challengerOutputSnapshot;
      const skipped = !eligible || (!verifier && !verified);
      // D-RNI-28: accepted plans must contain the final hydrated model input.
      // The envelope is preparation identity; only its modelInput is the input hash.
      const prepared = z
        .object({
          descriptor: z.unknown(),
          idempotencyIdentityHash: z.string().regex(/^[a-f0-9]{64}$/u),
          createdAt: z.string(),
          convergenceArtifactId: uuid,
          convergenceArtifactHash: z.string(),
          summaryId: uuid,
          modelInput: z.unknown(),
        })
        .strict()
        .parse(row.prepared_snapshot);
      if (
        !Object.hasOwn(prepared, 'modelInput') ||
        canonicalHash(prepared.descriptor) !== canonicalHash(input.invocation) ||
        prepared.summaryId !== request.summaryId ||
        prepared.convergenceArtifactId !== convergenceId ||
        prepared.convergenceArtifactHash !== canonicalHash(request.convergenceArtifact) ||
        canonicalInstant(prepared.createdAt) !== canonicalInstant(request.createdAt) ||
        (preparationIdentity !== undefined &&
          preparationIdentity !== prepared.idempotencyIdentityHash)
      )
        throw new Error('Crossed preparation identity');
      preparationIdentity = prepared.idempotencyIdentityHash;
      const metadata = z
        .object({
          outcome: z.literal('succeeded'),
          responseId: z.unknown().optional(),
          usage: z.unknown().optional(),
          latencyMs: z.unknown().optional(),
          costUsd: z.unknown().optional(),
        })
        .strict();
      if (
        row.id !== input.invocation.modelRunId ||
        row.input_hash !== canonicalHash(input) ||
        canonicalHash(prepared.modelInput) !== canonicalHash(input) ||
        row.status !== (skipped ? 'skipped' : 'succeeded') ||
        row.output_hash !== (skipped ? null : canonicalHash(output)) ||
        (skipped
          ? canonicalHash(row.terminal_metadata) !==
            canonicalHash({
              outcome: 'skipped',
              reason: !eligible ? 'no_eligible_claims' : 'no_verified_assessments',
            })
          : !metadata.safeParse(row.terminal_metadata).success)
      )
        throw new Error('Crossed invocation output');
    }
    const assessments = await this.db.query(
      `select claim_id as "claimId", verdict, supporting_citation_ids as "supportingCitationIds",
        contradicting_citation_ids as "contradictingCitationIds", assessment_hash from rni_catalyst_assessment
        where batch_id = $1 order by claim_id`,
      [batchId],
    );
    const values = assessments.rows.map(({ assessment_hash, ...value }) => {
      if (assessment_hash !== canonicalHash(value)) throw new Error('Crossed assessment hash');
      return value;
    });
    if (
      canonicalHash(values) !==
      canonicalHash(
        [...artifact.verificationOutputSnapshot].sort((a, b) => a.claimId.localeCompare(b.claimId)),
      )
    )
      throw new Error('Crossed assessment');
    const selections = await this.db.query<{
      verdict: string;
      challengedClaimId: string | null;
      citationIds: string[];
      selection_hash: string;
    }>(
      `select verdict, challenged_claim_id as "challengedClaimId", citation_ids as "citationIds", selection_hash
      from rni_challenger_selection where batch_id = $1`,
      [batchId],
    );
    const selection = selections.rows[0];
    if (selections.rows.length !== 1 || !selection) throw new Error('Missing challenger');
    const { selection_hash, ...value } = selection;
    if (
      canonicalHash(value) !== canonicalHash(artifact.challengerOutputSnapshot) ||
      selection_hash !== canonicalHash(value)
    )
      throw new Error('Crossed challenger');
  }

  artifacts(runId: string, securityId: string, summaryId?: string) {
    const key = `${runId}:${securityId}:${summaryId ?? ''}`;
    let result = this.artifactCache.get(key);
    if (!result) {
      result = this.loadArtifacts(runId, securityId, summaryId);
      this.artifactCache.set(key, result);
    }
    return result;
  }

  private async loadArtifacts(runId: string, securityId: string, summaryId?: string) {
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
      await this.requireProjection(convergence.inputSnapshot[p.platform], artifact);
      result.set(p.platform, artifact);
    }
    if (result.size !== 2) throw new RniReadError('CITATION_INVALID');
    if (
      canonicalHash(result.get('reddit')!.methodologySnapshot) !==
      canonicalHash(result.get('x')!.methodologySnapshot)
    )
      throw new RniReadError('CITATION_INVALID');
    return { convergence, reddit: result.get('reddit')!, x: result.get('x')! };
  }

  private async requireProjection(
    fact: RniConvergenceArtifact['inputSnapshot']['reddit'],
    artifact: RniPlatformAnalyticsArtifact,
  ) {
    const bad = () => {
      throw new RniReadError('CITATION_INVALID');
    };
    const { rows: slices } = await this.db.query<{
      id: string;
      run_id: string;
      platform: string;
      data_through_at: string | null;
    }>(
      `select id, run_id, platform, to_char(data_through_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as data_through_at
        from rni_platform_slice where id = $1`,
      [artifact.runSourceSliceId],
    );
    const slice = slices[0];
    if (
      !slice ||
      slice.run_id !== fact.runId ||
      slice.platform !== fact.platform ||
      fact.runSourceSliceId !== artifact.runSourceSliceId ||
      fact.methodologyVersion !== artifact.methodologyVersion ||
      canonicalInstant(fact.windowStart) !==
        canonicalInstant(artifact.inputSnapshot.current.windowStart) ||
      canonicalInstant(fact.windowEnd) !==
        canonicalInstant(artifact.inputSnapshot.current.windowEnd) ||
      fact.status !== artifact.inputSnapshot.sliceStatus ||
      fact.effectiveAttention !== artifact.result.effectiveAttention ||
      (fact.dataThroughAt === null
        ? slice.data_through_at !== null
        : canonicalInstant(fact.dataThroughAt) !== slice.data_through_at) ||
      fact.dimensions.length !== artifact.result.sentimentByDimension.length ||
      fact.dimensions.some((d, i) => {
        const metric = artifact.result.sentimentByDimension[i];
        if (!metric || d.dimension !== metric.dimension || d.score !== metric.meanDirection)
          return true;
        return d.score === null
          ? d.stance !== 'insufficient'
          : D(d.score).isZero()
            ? d.stance !== 'neutral'
            : D(d.score).isNegative()
              ? !['bearish', 'strong_bearish'].includes(d.stance)
              : !['bullish', 'strong_bullish'].includes(d.stance);
      })
    )
      bad();
    const traces = artifact.result.weightTrace.filter((t) => D(t.weight).greaterThan(0));
    const sources = traces.map((t) => t.sourceItemId).sort();
    const { rows } = await this.db.query<{ source_item_id: string; stance_score: string | null }>(
      `select m.source_item_id, o.stance_score::text from rni_run_observation m
       join rni_security_observation o on o.id=m.observation_id and o.source_item_id=m.source_item_id and o.security_id=m.security_id
       join rni_source_item s on s.id=m.source_item_id
       where m.run_id=$1 and m.security_id=$2 and s.platform=$3 and m.source_item_id=any($4::uuid[]) order by m.source_item_id`,
      [fact.runId, fact.securityId, fact.platform, sources],
    );
    if (canonicalHash(rows.map((r) => r.source_item_id)) !== canonicalHash(sources)) bad();
    const scores = new Map(rows.map((r) => [r.source_item_id, r.stance_score]));
    const eligible = traces.filter((t) => scores.get(t.sourceItemId) != null);
    const weight = eligible.reduce((sum, t) => sum.plus(t.weight), D(0));
    const groups = new Map(
      artifact.inputSnapshot.current.observations.map((o) => [o.sourceItemId, o.duplicateGroupKey]),
    );
    const count = new Set(eligible.map((t) => groups.get(t.sourceItemId))).size;
    const sufficient =
      weight.greaterThan(0) &&
      weight.greaterThanOrEqualTo(artifact.methodologySnapshot.minimumEffectiveAttention) &&
      D(count).greaterThanOrEqualTo(artifact.methodologySnapshot.minimumIndependentSources);
    const score = sufficient
      ? exact(
          eligible
            .reduce((sum, t) => sum.plus(D(t.weight).times(scores.get(t.sourceItemId)!)), D(0))
            .div(weight),
        )
      : null;
    const stance =
      score === null
        ? 'insufficient'
        : D(score).isZero()
          ? 'neutral'
          : D(score).isNegative()
            ? 'bearish'
            : 'bullish';
    if (fact.stanceScore !== score || fact.stance !== stance) bad();
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
         and s.source_status = 'active' and s.rights_policy_version = $4
         and coalesce(s.published_at, s.observed_at) >= r.window_start
         and coalesce(s.published_at, s.observed_at) < r.window_end`,
      [runId, securityId, platform, this.policy],
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
