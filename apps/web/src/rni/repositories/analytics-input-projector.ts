import { z } from 'zod';

import { canonicalInstant, sha256Hex } from '@/calc/canonical';
import { D } from '@/calc/decimal';
import type { Queryable } from '@/repositories/client';
import {
  RNI_ANALYTICS_CODE_VERSION,
  RNI_CONFIDENCE_COMPONENT_KEYS,
  RNI_CONFIDENCE_PENALTY_KEYS,
  type RniAnalyticsMethodology,
  type RniAnalyticsObservationInput,
  type RniConfidenceComponentKey,
  type RniConfidencePenaltyKey,
  type RniPlatformAnalyticsInput,
} from '@/rni/analytics';
import {
  rniDimensionKey,
  rniSha256,
  rniSignedDecimal,
  rniUnitDecimal,
  type RniPlatform,
} from '@/rni/contracts';
import {
  hashRniWorkerSnapshotValue,
  type RniWorkerManifest,
} from '@/rni/orchestration/worker-manifest';

const nonnegativeDecimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u);
const positiveDecimal = nonnegativeDecimal.refine((value) => !/^0(?:\.0+)?$/u.test(value));
const positiveIntegerDecimal = z.string().regex(/^[1-9]\d*$/u);
const score100 = z
  .string()
  .regex(/^(?:0|[1-9]\d?|100)(?:\.\d+)?$/u)
  .refine((value) => new D(value).lessThanOrEqualTo('100'));

const componentValues = z
  .object(
    Object.fromEntries(RNI_CONFIDENCE_COMPONENT_KEYS.map((key) => [key, rniUnitDecimal])) as Record<
      RniConfidenceComponentKey,
      typeof rniUnitDecimal
    >,
  )
  .strict();

/**
 * Complete E06 methodology authority. Empirical confidence component values, penalties, and
 * stage readiness are deliberately not operator-configurable: they describe one exact
 * run/security/platform result and must come from durable facts rather than a static policy.
 */
export const rniAnalyticsProjectionPolicy = z
  .object({
    codeVersion: z.literal(RNI_ANALYTICS_CODE_VERSION),
    timestampBasis: z.literal('published_at_else_observed_at'),
    memePenalty: rniUnitDecimal,
    halfLifeHours: positiveDecimal,
    lowBaseThreshold: positiveDecimal,
    epsilon: positiveDecimal,
    minimumEffectiveAttention: positiveDecimal,
    minimumIndependentSources: positiveIntegerDecimal,
    winsorLowerPercentile: rniUnitDecimal,
    winsorUpperPercentile: rniUnitDecimal,
    minimumBaselineWindows: positiveIntegerDecimal,
    zScoreDecimalPlaces: z.literal('6'),
    highNarrativeConcentrationThreshold: rniUnitDecimal,
    staleAfterHours: positiveDecimal,
    confidenceWeights: componentValues,
    confidenceBands: z
      .object({
        mediumMinimum: score100,
        highMinimum: score100,
        veryHighMinimum: score100,
      })
      .strict(),
    confidenceCaps: z
      .object({
        singleSourceOrCommunity: score100,
        highNarrativeConcentration: score100,
        partialCoverage: score100,
        staleEvidence: score100,
      })
      .strict(),
    sourceWeights: z.object({ reddit: rniUnitDecimal, x: rniUnitDecimal }).strict(),
    communities: z
      .array(
        z
          .object({
            platform: z.enum(['reddit', 'x']),
            scope: z.string().min(1).max(500),
            analyticalCluster: z.string().min(1).max(500),
            weight: rniUnitDecimal,
          })
          .strict(),
      )
      .min(1)
      .superRefine((values, context) => {
        const identities = values.map(({ platform, scope }) => `${platform}\u0000${scope}`);
        if (new Set(identities).size !== identities.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Community policies must be unique',
          });
        }
        if (identities.some((identity, index) => index > 0 && identities[index - 1]! >= identity)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Community policies must be in canonical platform/scope order',
          });
        }
      }),
  })
  .strict()
  .superRefine((value, context) => {
    const confidenceWeight = RNI_CONFIDENCE_COMPONENT_KEYS.reduce(
      (total, key) => total.plus(value.confidenceWeights[key]),
      new D('0'),
    );
    if (!confidenceWeight.equals('1')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidenceWeights'],
        message: 'Confidence weights must sum exactly to one',
      });
    }
    if (new D(value.winsorLowerPercentile).greaterThanOrEqualTo(value.winsorUpperPercentile)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['winsorUpperPercentile'],
        message: 'Winsor percentiles must be strictly ordered',
      });
    }
    if (new D(value.epsilon).greaterThan(value.lowBaseThreshold)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['epsilon'],
        message: 'Epsilon cannot exceed the low-base threshold',
      });
    }
    if (new D(value.minimumBaselineWindows).lessThan('2')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minimumBaselineWindows'],
        message: 'Sample standard deviation requires at least two baseline windows',
      });
    }
    const medium = new D(value.confidenceBands.mediumMinimum);
    const high = new D(value.confidenceBands.highMinimum);
    const veryHigh = new D(value.confidenceBands.veryHighMinimum);
    if (!medium.lessThan(high) || !high.lessThan(veryHigh)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidenceBands'],
        message: 'Confidence band boundaries must be strictly ordered',
      });
    }
  });

export type RniAnalyticsProjectionPolicy = z.infer<typeof rniAnalyticsProjectionPolicy>;

export type RniPlatformAnalyticsProjection = {
  readonly input: RniPlatformAnalyticsInput;
  readonly methodology: RniAnalyticsMethodology;
};

type ProjectionContextRow = {
  readonly run_id: string;
  readonly run_manifest_hash: string;
  readonly config_version: string;
  readonly universe_version: string;
  readonly prompt_version: string;
  readonly ai_route: string;
  readonly window_start: Date | string;
  readonly window_end: Date | string;
  readonly comparison_start: Date | string | null;
  readonly comparison_end: Date | string | null;
  readonly current_duration_days: string;
  readonly comparison_duration_days: string | null;
  readonly slice_id: string;
  readonly slice_status: string;
  readonly analytics_version: string;
  readonly analytics_snapshot_hash: string;
  readonly analytics_value: unknown;
  readonly taxonomy_version: string;
  readonly taxonomy_snapshot_hash: string;
  readonly rights_policy_version: string;
  readonly rights_policy_snapshot_hash: string;
  readonly rights_policy_value: unknown;
};

type NarrativeProjection = {
  readonly id: string;
  readonly independent: boolean;
};

type ObservationRow = {
  readonly run_id: string;
  readonly security_id: string;
  readonly platform: string;
  readonly source_item_id: string;
  readonly bounded_content: string;
  readonly content_sha256: string;
  readonly source_status: string;
  readonly rights_policy_version: string;
  readonly subreddit_or_scope: string;
  readonly author_handle_hash: string | null;
  readonly published_at: Date | string | null;
  readonly observed_at: Date | string;
  readonly mention_id: string;
  readonly mention_security_id: string;
  readonly resolution_confidence: string;
  readonly observation_id: string;
  readonly observation_security_id: string;
  readonly dimension_assignments: unknown;
  readonly information_value: string;
  readonly evidence_quality: string;
  readonly assertion_strength: string;
  readonly sarcasm_probability: string;
  readonly spam_probability: string;
  readonly meme_probability: string;
  readonly exclusion_reason: string | null;
  readonly content_version_id: string;
  readonly retrieval_id: string;
  readonly retrieval_source_item_id: string;
  readonly workflow_run_manifest_hash: string;
  readonly workflow_platform: string;
  readonly membership_semantic_output_hash: string;
  readonly workflow_semantic_output_hash: string;
  readonly theme_versions: unknown;
  readonly narratives: unknown;
};

const dimensions = z
  .array(
    z
      .object({
        dimension: rniDimensionKey,
        score: rniSignedDecimal.nullable(),
      })
      .passthrough(),
  )
  .length(4)
  .superRefine((values, context) => {
    const keys = values.map(({ dimension }) => dimension);
    if (
      new Set(keys).size !== rniDimensionKey.options.length ||
      !rniDimensionKey.options.every((key) => keys.includes(key))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Stored observation must contain every frozen dimension exactly once',
      });
    }
  });

const themeVersions = z.array(z.string().min(1));
const narratives = z.array(z.object({ id: z.string().uuid(), independent: z.boolean() }).strict());

const instant = (value: Date | string): string =>
  canonicalInstant(value instanceof Date ? value.toISOString() : value);

function reject(reason: string): never {
  throw new Error(`RNI analytics input projection rejected ${reason}`);
}

function requireContextMatchesManifest(
  row: ProjectionContextRow,
  manifest: RniWorkerManifest,
  runManifestHash: string,
): RniAnalyticsProjectionPolicy {
  if (
    row.run_id !== manifest.runId ||
    row.run_manifest_hash !== runManifestHash ||
    row.config_version !== manifest.configuration.version ||
    row.universe_version !== manifest.universe.version ||
    row.prompt_version !== manifest.configuration.promptSetVersion ||
    row.ai_route !== manifest.configuration.aiRoute ||
    instant(row.window_start) !== canonicalInstant(manifest.windows.windowStart) ||
    instant(row.window_end) !== canonicalInstant(manifest.windows.windowEnd) ||
    (row.comparison_start === null ? null : instant(row.comparison_start)) !==
      (manifest.windows.comparisonStart === null
        ? null
        : canonicalInstant(manifest.windows.comparisonStart)) ||
    (row.comparison_end === null ? null : instant(row.comparison_end)) !==
      (manifest.windows.comparisonEnd === null
        ? null
        : canonicalInstant(manifest.windows.comparisonEnd)) ||
    row.analytics_version !== manifest.policies.analytics.version ||
    row.analytics_snapshot_hash !== manifest.policies.analytics.snapshotHash ||
    row.taxonomy_version !== manifest.policies.taxonomy.version ||
    row.taxonomy_snapshot_hash !== manifest.policies.taxonomy.snapshotHash ||
    row.rights_policy_version !== manifest.source.rightsPolicy.version ||
    row.rights_policy_snapshot_hash !== manifest.source.rightsPolicy.snapshotHash ||
    hashRniWorkerSnapshotValue(row.analytics_value) !== row.analytics_snapshot_hash ||
    hashRniWorkerSnapshotValue(manifest.policies.analytics.value) !== row.analytics_snapshot_hash ||
    hashRniWorkerSnapshotValue(row.rights_policy_value) !== row.rights_policy_snapshot_hash ||
    hashRniWorkerSnapshotValue(manifest.source.rightsPolicy.value) !==
      row.rights_policy_snapshot_hash
  ) {
    reject('crossed run, manifest, configuration, window, or policy authority');
  }
  const policy = rniAnalyticsProjectionPolicy.safeParse(row.analytics_value);
  if (!policy.success) reject('incomplete immutable analytics authority');
  if (
    policy.data.codeVersion !== manifest.build.analyticsCodeVersion ||
    policy.data.codeVersion !== RNI_ANALYTICS_CODE_VERSION
  ) {
    reject('analytics code version differs from the admitted build');
  }
  return policy.data;
}

function methodologyFrom(
  version: string,
  policy: RniAnalyticsProjectionPolicy,
): RniAnalyticsMethodology {
  return {
    version,
    codeVersion: policy.codeVersion,
    timestampBasis: policy.timestampBasis,
    memePenalty: policy.memePenalty,
    halfLifeHours: policy.halfLifeHours,
    lowBaseThreshold: policy.lowBaseThreshold,
    epsilon: policy.epsilon,
    minimumEffectiveAttention: policy.minimumEffectiveAttention,
    minimumIndependentSources: policy.minimumIndependentSources,
    winsorLowerPercentile: policy.winsorLowerPercentile,
    winsorUpperPercentile: policy.winsorUpperPercentile,
    minimumBaselineWindows: policy.minimumBaselineWindows,
    zScoreDecimalPlaces: policy.zScoreDecimalPlaces,
    highNarrativeConcentrationThreshold: policy.highNarrativeConcentrationThreshold,
    staleAfterHours: policy.staleAfterHours,
    confidenceWeights: policy.confidenceWeights,
    confidenceBands: policy.confidenceBands,
    confidenceCaps: policy.confidenceCaps,
  };
}

function observationFrom(
  row: ObservationRow,
  request: {
    readonly runId: string;
    readonly runManifestHash: string;
    readonly securityId: string;
    readonly platform: RniPlatform;
    readonly rightsPolicyVersion: string;
  },
  policy: RniAnalyticsProjectionPolicy,
  duplicateGroupSize: number,
  taxonomyVersion: string,
): RniAnalyticsObservationInput {
  if (
    row.run_id !== request.runId ||
    row.security_id !== request.securityId ||
    row.observation_security_id !== request.securityId ||
    row.mention_security_id !== request.securityId ||
    row.platform !== request.platform ||
    row.source_status !== 'active' ||
    row.rights_policy_version !== request.rightsPolicyVersion ||
    row.retrieval_source_item_id !== row.source_item_id ||
    row.workflow_run_manifest_hash !== request.runManifestHash ||
    row.workflow_platform !== request.platform ||
    row.workflow_semantic_output_hash !== row.membership_semantic_output_hash ||
    sha256Hex(row.bounded_content) !== row.content_sha256
  ) {
    reject('crossed or content-drifted observation lineage');
  }
  rniSha256.parse(row.content_sha256);
  rniUnitDecimal.parse(row.resolution_confidence);
  const parsedThemes = themeVersions.parse(row.theme_versions);
  if (parsedThemes.some((version) => version !== taxonomyVersion)) {
    reject('theme assignment outside the admitted taxonomy');
  }
  const parsedNarratives = narratives.parse(row.narratives) as readonly NarrativeProjection[];
  if (parsedNarratives.length > 1) {
    reject('one source observation maps to multiple analytics narrative identities');
  }
  const community = policy.communities.find(
    ({ platform, scope }) => platform === request.platform && scope === row.subreddit_or_scope,
  );
  if (community === undefined) reject('source scope absent from the admitted analytics authority');
  const assignments = dimensions.parse(row.dimension_assignments);
  return {
    sourceItemId: row.source_item_id,
    mentionIds: [row.mention_id],
    platform: request.platform,
    securityId: request.securityId,
    communityOrScope: row.subreddit_or_scope,
    analyticalCluster: community.analyticalCluster,
    authorHash: row.author_handle_hash,
    narrativeId: parsedNarratives[0]?.id ?? null,
    independentNarrative: parsedNarratives[0]?.independent ?? false,
    duplicateGroupKey: row.content_sha256,
    duplicateGroupSize: String(duplicateGroupSize),
    dimensions: rniDimensionKey.options.map((dimension) => ({
      dimension,
      score: assignments.find((candidate) => candidate.dimension === dimension)!.score,
    })),
    informationValue: rniUnitDecimal.parse(row.information_value),
    evidenceQuality: rniUnitDecimal.parse(row.evidence_quality),
    assertionStrength: rniUnitDecimal.parse(row.assertion_strength),
    sarcasmProbability: rniUnitDecimal.parse(row.sarcasm_probability),
    spamProbability: rniUnitDecimal.parse(row.spam_probability),
    memeProbability: rniUnitDecimal.parse(row.meme_probability),
    sourceWeight: policy.sourceWeights[request.platform],
    communityWeight: community.weight,
    publishedAt: row.published_at === null ? null : instant(row.published_at),
    observedAt: instant(row.observed_at),
    exclusionReason: z
      .enum(['off_topic', 'spam', 'unresolved_context'])
      .nullable()
      .parse(row.exclusion_reason),
  };
}

const inWindow = (value: string, start: string, end: string): boolean =>
  value >= start && value < end;

const unavailableConfidenceComponents = (): Readonly<
  Record<RniConfidenceComponentKey, string>
> =>
  Object.fromEntries(RNI_CONFIDENCE_COMPONENT_KEYS.map((key) => [key, '0'])) as Record<
    RniConfidenceComponentKey,
    string
  >;

const unavailableConfidencePenalties = (): Readonly<Record<RniConfidencePenaltyKey, string>> =>
  Object.fromEntries(RNI_CONFIDENCE_PENALTY_KEYS.map((key) => [key, '0'])) as Record<
    RniConfidencePenaltyKey,
    string
  >;

/**
 * Projects only committed, exact run/source/security/platform lineage. The caller supplies the
 * already-loaded immutable worker manifest and a Queryable bound to its transaction/connection.
 */
export async function projectRniPlatformAnalyticsInput(
  request: {
    readonly manifest: RniWorkerManifest;
    readonly runManifestHash: string;
    readonly platform: RniPlatform;
    readonly securityId: string;
  },
  db: Queryable,
): Promise<RniPlatformAnalyticsProjection> {
  rniSha256.parse(request.runManifestHash);
  if (!request.manifest.members.some(({ securityId }) => securityId === request.securityId)) {
    reject('security outside the admitted member set');
  }
  const contextResult = await db.query<ProjectionContextRow>(
    `select run.id as run_id, manifest.run_manifest_hash, run.config_version::text,
            run.universe_version::text, run.prompt_version, run.ai_route,
            to_char(run.window_start at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as window_start,
            to_char(run.window_end at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as window_end,
            case when run.comparison_start is null then null else
              to_char(run.comparison_start at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as comparison_start,
            case when run.comparison_end is null then null else
              to_char(run.comparison_end at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as comparison_end,
            (extract(epoch from (run.window_end-run.window_start))/86400)::numeric::text
              as current_duration_days,
            case when run.comparison_start is null then null else
              (extract(epoch from (run.comparison_end-run.comparison_start))/86400)::numeric::text
            end as comparison_duration_days,
            slice.id as slice_id, slice.status as slice_status,
            analytics.version as analytics_version,
            analytics.snapshot_hash as analytics_snapshot_hash,
            analytics.value as analytics_value,
            taxonomy.version as taxonomy_version,
            taxonomy.snapshot_hash as taxonomy_snapshot_hash,
            rights.version as rights_policy_version,
            rights.snapshot_hash as rights_policy_snapshot_hash,
            rights.value as rights_policy_value
       from rni_run run
       join rni_worker_run_manifest manifest
         on manifest.run_id=run.id and manifest.run_manifest_hash=$2
       join rni_platform_slice slice on slice.run_id=run.id and slice.platform=$3
       join rni_worker_run_manifest_authority analytics_link
         on analytics_link.run_id=run.id and analytics_link.authority_kind='analytics'
        and analytics_link.authority_key='default'
       join rni_worker_manifest_authority analytics
         on analytics.authority_kind=analytics_link.authority_kind
        and analytics.authority_key=analytics_link.authority_key
        and analytics.version=analytics_link.version
        and analytics.snapshot_hash=analytics_link.snapshot_hash
       join rni_worker_run_manifest_authority taxonomy_link
         on taxonomy_link.run_id=run.id and taxonomy_link.authority_kind='taxonomy'
        and taxonomy_link.authority_key='default'
       join rni_worker_manifest_authority taxonomy
         on taxonomy.authority_kind=taxonomy_link.authority_kind
        and taxonomy.authority_key=taxonomy_link.authority_key
        and taxonomy.version=taxonomy_link.version
        and taxonomy.snapshot_hash=taxonomy_link.snapshot_hash
       join rni_worker_run_manifest_authority rights_link
         on rights_link.run_id=run.id and rights_link.authority_kind='rights_policy'
        and rights_link.authority_key='default'
       join rni_worker_manifest_authority rights
         on rights.authority_kind=rights_link.authority_kind
        and rights.authority_key=rights_link.authority_key
        and rights.version=rights_link.version
        and rights.snapshot_hash=rights_link.snapshot_hash
      where run.id=$1`,
    [request.manifest.runId, request.runManifestHash, request.platform],
  );
  const context = contextResult.rows[0];
  if (context === undefined || contextResult.rows.length !== 1) reject('missing exact run context');
  const policy = requireContextMatchesManifest(context, request.manifest, request.runManifestHash);
  const sliceStatus = z
    .enum(['complete', 'partial', 'failed', 'unavailable'])
    .safeParse(context.slice_status);
  if (!sliceStatus.success) reject('nonterminal platform slice');

  const observationResult = await db.query<ObservationRow>(
    `select membership.run_id, membership.security_id, source.platform,
            source.id as source_item_id, source.bounded_content, source.content_sha256,
            source.source_status, source.rights_policy_version,
            source.subreddit_or_scope, source.author_handle_hash,
            case when source.published_at is null then null else
              to_char(source.published_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as published_at,
            to_char(source.observed_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as observed_at,
            mention.id as mention_id,
            mention.security_id as mention_security_id,
            mention.resolution_confidence::text as resolution_confidence,
            observation.id as observation_id,
            observation.security_id as observation_security_id,
            observation.dimension_assignments,
            quality.information_value::text, quality.evidence_quality::text,
            quality.assertion_strength::text, quality.sarcasm_probability::text,
            quality.spam_probability::text, quality.meme_probability::text,
            quality.exclusion_reason, content.id as content_version_id,
            retrieval.id as retrieval_id, retrieval.source_item_id as retrieval_source_item_id,
            workflow.run_manifest_hash as workflow_run_manifest_hash,
            workflow.platform as workflow_platform,
            membership.semantic_output_hash as membership_semantic_output_hash,
            checkpoint.output_manifest #>> '{semanticOutputHash}' as workflow_semantic_output_hash,
            coalesce((select jsonb_agg(distinct theme.taxonomy_version order by theme.taxonomy_version)
                        from rni_observation_theme assignment
                        join rni_theme_definition theme on theme.id=assignment.theme_definition_id
                       where assignment.observation_id=observation.id), '[]'::jsonb) as theme_versions,
            coalesce((select jsonb_agg(jsonb_build_object(
                                  'id', candidates.id, 'independent', candidates.independent
                                ) order by candidates.id)
                        from (select narrative.id, bool_or(member.is_independent) as independent
                                from rni_evidence_claim claim
                                join rni_narrative_membership member on member.claim_id=claim.id
                                join rni_narrative narrative on narrative.id=member.narrative_id
                               where claim.observation_id=observation.id
                                 and narrative.run_id=membership.run_id
                                 and narrative.security_id=membership.security_id
                                 and narrative.status <> 'rejected'
                               group by narrative.id) candidates), '[]'::jsonb) as narratives
       from rni_run_observation membership
       join rni_security_observation observation
         on observation.id=membership.observation_id
        and observation.source_item_id=membership.source_item_id
        and observation.security_id=membership.security_id
       join rni_source_item source on source.id=membership.source_item_id
       join rni_security_mention mention
         on mention.source_item_id=membership.source_item_id
        and mention.security_id=membership.security_id
       join rni_observation_semantic_quality quality
         on quality.observation_id=observation.id
        and quality.source_item_id=membership.source_item_id
        and quality.security_id=membership.security_id
       join rni_source_workflow_delivery workflow
         on workflow.run_id=membership.run_id and workflow.platform=source.platform
        and workflow.source_item_id=source.id and workflow.stage='interpret_source'
        and workflow.run_manifest_hash=$4
       join rni_source_workflow_checkpoint checkpoint
         on checkpoint.delivery_id=workflow.id and checkpoint.status='completed'
        and checkpoint.output_manifest #>> '{semanticOutputHash}'=membership.semantic_output_hash
       join rni_source_content_version content
         on content.id=workflow.content_version_id and content.source_item_id=source.id
        and content.content_sha256=source.content_sha256
       join rni_source_retrieval retrieval
         on retrieval.id=content.source_retrieval_id and retrieval.source_item_id=source.id
      where membership.run_id=$1 and membership.security_id=$2 and source.platform=$3
        and source.rights_policy_version=$5
      order by source.id`,
    [
      request.manifest.runId,
      request.securityId,
      request.platform,
      request.runManifestHash,
      request.manifest.source.rightsPolicy.version,
    ],
  );

  if (
    (sliceStatus.data === 'failed' || sliceStatus.data === 'unavailable') &&
    observationResult.rows.length !== 0
  ) {
    reject('failed or unavailable slice with durable analytics evidence');
  }
  const eligibleRows = observationResult.rows.filter((row) => {
    const exclusionReason = z
      .enum(['off_topic', 'spam', 'unresolved_context'])
      .nullable()
      .parse(row.exclusion_reason);
    return exclusionReason === null;
  });
  const groupSizes = new Map<string, number>();
  for (const row of eligibleRows) {
    groupSizes.set(row.content_sha256, (groupSizes.get(row.content_sha256) ?? 0) + 1);
  }
  const projected = eligibleRows.map((row) =>
    observationFrom(
      row,
      {
        runId: request.manifest.runId,
        runManifestHash: request.runManifestHash,
        securityId: request.securityId,
        platform: request.platform,
        rightsPolicyVersion: request.manifest.source.rightsPolicy.version,
      },
      policy,
      groupSizes.get(row.content_sha256)!,
      context.taxonomy_version,
    ),
  );
  const currentStart = canonicalInstant(request.manifest.windows.windowStart);
  const currentEnd = canonicalInstant(request.manifest.windows.windowEnd);
  const comparisonStart =
    request.manifest.windows.comparisonStart === null
      ? null
      : canonicalInstant(request.manifest.windows.comparisonStart);
  const comparisonEnd =
    request.manifest.windows.comparisonEnd === null
      ? null
      : canonicalInstant(request.manifest.windows.comparisonEnd);
  const current: RniAnalyticsObservationInput[] = [];
  const comparison: RniAnalyticsObservationInput[] = [];
  for (const observation of projected) {
    const eligibleAt = observation.publishedAt ?? observation.observedAt;
    if (inWindow(eligibleAt, currentStart, currentEnd)) current.push(observation);
    else if (
      comparisonStart !== null &&
      comparisonEnd !== null &&
      inWindow(eligibleAt, comparisonStart, comparisonEnd)
    ) {
      comparison.push(observation);
    } else {
      reject('run observation outside the admitted current/comparison windows');
    }
  }
  const input: RniPlatformAnalyticsInput = {
    runId: request.manifest.runId,
    runSourceSliceId: context.slice_id,
    platform: request.platform,
    securityId: request.securityId,
    sliceStatus: sliceStatus.data,
    current: {
      windowStart: currentStart,
      windowEnd: currentEnd,
      durationDays: positiveDecimal.parse(context.current_duration_days),
      observations: current,
    },
    comparison:
      sliceStatus.data === 'failed' ||
      sliceStatus.data === 'unavailable' ||
      comparisonStart === null ||
      comparisonEnd === null
        ? null
        : {
            windowStart: comparisonStart,
            windowEnd: comparisonEnd,
            durationDays: positiveDecimal.parse(context.comparison_duration_days),
            observations: comparison,
          },
    // Historical baseline artifacts do not yet have a manifest-bound selector. Empty is honest:
    // the analytics engine emits insufficient_baseline instead of manufacturing normality.
    baseline: [],
    // The frozen contract defines the component meanings, but no owner-approved formula maps the
    // durable rows above to their numeric values or penalties. Model calibration additionally
    // needs a manifest-bound eval slice, while catalyst/contradiction facts are persisted by E08
    // after E06. Until those authorities and facts exist, use canonical unused zero snapshots and
    // keep confidence unavailable instead of copying one operator value to every member.
    confidenceComponents: unavailableConfidenceComponents(),
    confidencePenalties: unavailableConfidencePenalties(),
    confidenceReadiness:
      sliceStatus.data === 'failed' || sliceStatus.data === 'unavailable'
        ? { narrativeStageTerminal: true, catalystStageTerminal: true }
        : { narrativeStageTerminal: false, catalystStageTerminal: false },
  };
  return { input, methodology: methodologyFrom(context.analytics_version, policy) };
}
