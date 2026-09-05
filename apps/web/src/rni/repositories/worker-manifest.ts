import { z } from 'zod';

import { canonicalInstant } from '@/calc/canonical';
import { getPool, type Queryable } from '@/repositories/client';
import {
  RNI_WORKER_MANIFEST_TASKS,
  RNI_WORKER_MANIFEST_VERSION,
  canonicalizeRniWorkerManifestMembers,
  canonicalizeRniWorkerSnapshotValue,
  hashRniWorkerManifest,
  hashRniWorkerManifestMembers,
  hashRniWorkerSnapshotValue,
  parseRniWorkerManifest,
  rniWorkerManifestMember,
  type RniCanonicalJsonValue,
  type RniWorkerManifest,
  type RniWorkerManifestMember,
} from '@/rni/orchestration/worker-manifest';

const CONFIG_AUTHORITY_KINDS = [
  'source_configuration',
  'reddit_queries',
  'x_queries',
  'rights_policy',
  'ambiguity',
  'taxonomy',
  'classification',
  'analytics',
  'convergence',
  'budget',
] as const;
const GLOBAL_AUTHORITY_KINDS = ['prompt', 'build'] as const;
const AUTHORITY_KINDS = [...CONFIG_AUTHORITY_KINDS, ...GLOBAL_AUTHORITY_KINDS] as const;

const authorityKind = z.enum(AUTHORITY_KINDS);
const exactText = z
  .string()
  .min(1)
  .max(1000)
  .refine((value) => value === value.trim(), 'Text must not have surrounding whitespace');
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const canonicalUuid = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), 'UUIDs must be canonical lowercase text');
const positiveBigintText = z.string().regex(/^[1-9][0-9]*$/u);

const promptAuthority = z
  .object({
    version: exactText,
    contentHash: digest,
    inputSchemaVersion: exactText,
    inputSchemaHash: digest,
    outputSchemaVersion: exactText,
    outputSchemaHash: digest,
    toolVersion: exactText,
    toolHash: digest,
  })
  .strict();

const buildAuthority = z
  .object({
    deploymentId: exactText,
    commitSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
    artifactHash: digest,
    sourceAdapterVersions: z.object({ reddit: exactText, x: exactText }).strict(),
    semanticCodeVersion: exactText,
    analyticsCodeVersion: exactText,
    convergenceCodeVersion: exactText,
    citedSynthesisCodeVersion: exactText,
  })
  .strict();

export type RniWorkerManifestTask = (typeof RNI_WORKER_MANIFEST_TASKS)[number];
export type RniWorkerManifestAuthorityKind = (typeof AUTHORITY_KINDS)[number];
type ManifestRoute = RniWorkerManifest['modelRoutes'][number];
type ManifestPrompt = ManifestRoute['prompt'];
type ManifestSnapshot = RniWorkerManifest['source']['configuration'];
type ManifestBuild = RniWorkerManifest['build'];

export type RniWorkerManifestAuthorityReference = {
  readonly authorityKind: RniWorkerManifestAuthorityKind;
  readonly authorityKey: string;
  readonly version: string;
  readonly snapshotHash: string;
  readonly value: Readonly<Record<string, RniCanonicalJsonValue>>;
  readonly configBound: boolean;
};

export type RniWorkerManifestAuthoritySet = {
  readonly source: RniWorkerManifest['source'];
  readonly policies: RniWorkerManifest['policies'];
  readonly prompts: Readonly<Record<RniWorkerManifestTask, ManifestPrompt>>;
  readonly build: ManifestBuild;
  readonly references: readonly RniWorkerManifestAuthorityReference[];
};

export type RniWorkerBuildEnvironment = {
  readonly deploymentId: string;
  readonly commitSha: string;
  readonly artifactHash: string;
};

export type PersistRniWorkerManifestAuthorityInput = {
  readonly authorityKind: RniWorkerManifestAuthorityKind;
  readonly authorityKey: string;
  readonly version: string;
  readonly snapshotHash: string;
  readonly value: Readonly<Record<string, RniCanonicalJsonValue>>;
};

export type BindRniWorkerConfigAuthorityInput = {
  readonly configVersion: string;
  readonly authorityKind: (typeof CONFIG_AUTHORITY_KINDS)[number];
  readonly version: string;
  readonly snapshotHash: string;
};

export type RniWorkerManifestRepositoryErrorCode =
  | 'AUTHORITY_MISSING'
  | 'BUILD_ENV_MISSING'
  | 'CONFLICT'
  | 'MANIFEST_CORRUPT'
  | 'MANIFEST_NOT_FOUND';

/** Stable, non-provider error codes keep configuration or database detail out of worker logs. */
export class RniWorkerManifestRepositoryError extends Error {
  constructor(readonly code: RniWorkerManifestRepositoryErrorCode) {
    super(code);
    this.name = 'RniWorkerManifestRepositoryError';
  }
}

const requiredEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string => {
  const value = environment[key];
  if (value === undefined || value.length === 0 || value !== value.trim()) {
    throw new RniWorkerManifestRepositoryError('BUILD_ENV_MISSING');
  }
  return value;
};

/** Build identity is deployment-owned. No local/default identity may become effect authority. */
export function readRniWorkerBuildEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RniWorkerBuildEnvironment {
  const parsed = z
    .object({
      deploymentId: exactText,
      commitSha: buildAuthority.shape.commitSha,
      artifactHash: digest,
    })
    .safeParse({
      deploymentId: requiredEnvironment(environment, 'RNI_DEPLOYMENT_ID'),
      commitSha: requiredEnvironment(environment, 'RNI_COMMIT_SHA'),
      artifactHash: requiredEnvironment(environment, 'RNI_ARTIFACT_SHA256'),
    });
  if (!parsed.success) throw new RniWorkerManifestRepositoryError('BUILD_ENV_MISSING');
  return parsed.data;
}

type AuthorityRow = {
  authority_kind: string;
  authority_key: string;
  version: string;
  snapshot_hash: string;
  value: unknown;
  config_bound?: boolean;
};

const asCanonicalObject = (value: unknown): Readonly<Record<string, RniCanonicalJsonValue>> => {
  canonicalizeRniWorkerSnapshotValue(value);
  return value as Readonly<Record<string, RniCanonicalJsonValue>>;
};

const parseAuthorityRow = (row: AuthorityRow): RniWorkerManifestAuthorityReference => {
  const identity = z
    .object({
      authorityKind,
      authorityKey: exactText,
      version: exactText,
      snapshotHash: digest,
    })
    .strict()
    .safeParse({
      authorityKind: row.authority_kind,
      authorityKey: row.authority_key,
      version: row.version,
      snapshotHash: row.snapshot_hash,
    });
  if (!identity.success) throw new RniWorkerManifestRepositoryError('AUTHORITY_MISSING');
  let value: Readonly<Record<string, RniCanonicalJsonValue>>;
  try {
    value = asCanonicalObject(row.value);
  } catch {
    throw new RniWorkerManifestRepositoryError('AUTHORITY_MISSING');
  }
  if (hashRniWorkerSnapshotValue(value) !== identity.data.snapshotHash) {
    throw new RniWorkerManifestRepositoryError('AUTHORITY_MISSING');
  }
  return {
    ...identity.data,
    value,
    configBound: row.config_bound === true,
  };
};

/**
 * Low-level, transaction-bound write for an already reviewed authority. Approval and audit live
 * above this repository; this function derives nothing and will not overwrite a crossed version.
 */
export async function persistRniWorkerManifestAuthority(
  input: PersistRniWorkerManifestAuthorityInput,
  db: Queryable,
): Promise<'inserted' | 'duplicate'> {
  const parsed = {
    authorityKind: authorityKind.parse(input.authorityKind),
    authorityKey: exactText.parse(input.authorityKey),
    version: exactText.parse(input.version),
    snapshotHash: digest.parse(input.snapshotHash),
    value: asCanonicalObject(input.value),
  };
  if (hashRniWorkerSnapshotValue(parsed.value) !== parsed.snapshotHash) {
    throw new RniWorkerManifestRepositoryError('CONFLICT');
  }
  const inserted = await db.query(
    `insert into rni_worker_manifest_authority (
       authority_kind,authority_key,version,snapshot_hash,value
     ) values ($1,$2,$3,$4,$5) on conflict (authority_kind,authority_key,version) do nothing`,
    [
      parsed.authorityKind,
      parsed.authorityKey,
      parsed.version,
      parsed.snapshotHash,
      JSON.stringify(parsed.value),
    ],
  );
  if (inserted.rowCount === 1) return 'inserted';
  const existing = await db.query<AuthorityRow>(
    `select authority_kind,authority_key,version,snapshot_hash,value,false as config_bound
       from rni_worker_manifest_authority
      where authority_kind=$1 and authority_key=$2 and version=$3`,
    [parsed.authorityKind, parsed.authorityKey, parsed.version],
  );
  try {
    const row = parseAuthorityRow(existing.rows[0]!);
    if (
      row.snapshotHash !== parsed.snapshotHash ||
      canonicalizeRniWorkerSnapshotValue(row.value) !==
        canonicalizeRniWorkerSnapshotValue(parsed.value)
    ) {
      throw new RniWorkerManifestRepositoryError('CONFLICT');
    }
  } catch {
    throw new RniWorkerManifestRepositoryError('CONFLICT');
  }
  return 'duplicate';
}

/** Bind an already persisted config authority while its configuration is still a draft. */
export async function bindRniWorkerConfigAuthority(
  input: BindRniWorkerConfigAuthorityInput,
  db: Queryable,
): Promise<'inserted' | 'duplicate'> {
  const parsed = {
    configVersion: positiveBigintText.parse(input.configVersion),
    authorityKind: z.enum(CONFIG_AUTHORITY_KINDS).parse(input.authorityKind),
    version: exactText.parse(input.version),
    snapshotHash: digest.parse(input.snapshotHash),
  };
  const inserted = await db.query(
    `insert into rni_worker_config_authority (
       config_version,authority_kind,authority_key,version,snapshot_hash
     ) values ($1,$2,'default',$3,$4)
     on conflict (config_version,authority_kind,authority_key) do nothing`,
    [parsed.configVersion, parsed.authorityKind, parsed.version, parsed.snapshotHash],
  );
  if (inserted.rowCount === 1) return 'inserted';
  const existing = await db.query<{ version: string; snapshot_hash: string }>(
    `select version,snapshot_hash from rni_worker_config_authority
      where config_version=$1 and authority_kind=$2 and authority_key='default'`,
    [parsed.configVersion, parsed.authorityKind],
  );
  if (
    existing.rows.length !== 1 ||
    existing.rows[0]!.version !== parsed.version ||
    existing.rows[0]!.snapshot_hash !== parsed.snapshotHash
  ) {
    throw new RniWorkerManifestRepositoryError('CONFLICT');
  }
  return 'duplicate';
}

/** Lock and prove the explicit operator target before any authority definition is persisted. */
export async function assertDraftRniWorkerConfigAuthorityTarget(
  configVersion: string,
  db: Queryable,
): Promise<void> {
  const parsedVersion = positiveBigintText.parse(configVersion);
  const config = await db.query<{ id: string; status: string }>(
    `select config.id::text as id,config.status
       from config_version config
       join rni_ai_config ai on ai.config_version=config.id
      where config.id=$1
      for update of config`,
    [parsedVersion],
  );
  if (
    config.rows.length !== 1 ||
    config.rows[0]!.id !== parsedVersion ||
    config.rows[0]!.status !== 'draft'
  ) {
    throw new RniWorkerManifestRepositoryError('CONFLICT');
  }
}

const authorityIdentity = (reference: RniWorkerManifestAuthorityReference): string =>
  [reference.authorityKind, reference.authorityKey].join('\u0000');

const exactAuthoritySet = (
  rows: readonly AuthorityRow[],
  expectedIdentities: readonly string[],
  requireConfigBinding: boolean,
): readonly RniWorkerManifestAuthorityReference[] => {
  const references = rows.map(parseAuthorityRow);
  const identities = references.map(authorityIdentity);
  if (
    references.length !== expectedIdentities.length ||
    new Set(identities).size !== expectedIdentities.length ||
    expectedIdentities.some((identity) => !identities.includes(identity)) ||
    (requireConfigBinding && references.some(({ configBound }) => !configBound))
  ) {
    throw new RniWorkerManifestRepositoryError('AUTHORITY_MISSING');
  }
  return references;
};

const snapshotFrom = (
  references: readonly RniWorkerManifestAuthorityReference[],
  kind: (typeof CONFIG_AUTHORITY_KINDS)[number],
): ManifestSnapshot => {
  const reference = references.find(
    (candidate) => candidate.authorityKind === kind && candidate.authorityKey === 'default',
  );
  if (reference === undefined) throw new RniWorkerManifestRepositoryError('AUTHORITY_MISSING');
  return {
    version: reference.version,
    snapshotHash: reference.snapshotHash,
    value: reference.value,
  };
};

export type LoadRniWorkerManifestAuthoritiesInput = {
  readonly configVersion: string;
  readonly promptVersions: Readonly<Record<RniWorkerManifestTask, string>>;
  readonly buildEnvironment: RniWorkerBuildEnvironment;
};

/** Resolve only immutable, pre-approved rows. This function never seeds or repairs authority. */
export async function loadRniWorkerManifestAuthorities(
  input: LoadRniWorkerManifestAuthoritiesInput,
  db: Queryable,
): Promise<RniWorkerManifestAuthoritySet> {
  positiveBigintText.parse(input.configVersion);
  const configRows = await db.query<AuthorityRow>(
    `select authority.authority_kind,authority.authority_key,authority.version,
            authority.snapshot_hash,authority.value,true as config_bound
       from rni_worker_config_authority binding
       join config_version config
         on config.id=binding.config_version and config.status='active'
       join rni_worker_manifest_authority authority
         on authority.authority_kind=binding.authority_kind
        and authority.authority_key=binding.authority_key
        and authority.version=binding.version
        and authority.snapshot_hash=binding.snapshot_hash
      where binding.config_version=$1
      order by authority.authority_kind,authority.authority_key`,
    [input.configVersion],
  );
  const configReferences = exactAuthoritySet(
    configRows.rows,
    CONFIG_AUTHORITY_KINDS.map((kind) => `${kind}\u0000default`),
    true,
  );

  const requestedPrompts = RNI_WORKER_MANIFEST_TASKS.map((task) => ({
    authorityKey: task,
    version: exactText.parse(input.promptVersions[task]),
  }));
  const promptRows = await db.query<AuthorityRow>(
    `select authority.authority_kind,authority.authority_key,authority.version,
            authority.snapshot_hash,authority.value,false as config_bound
       from jsonb_to_recordset($1::jsonb)
         as requested(authority_key text,version text)
       join rni_worker_manifest_authority authority
         on authority.authority_kind='prompt'
        and authority.authority_key=requested.authority_key
        and authority.version=requested.version
      order by authority.authority_key`,
    [
      JSON.stringify(
        requestedPrompts.map(({ authorityKey, version }) => ({
          authority_key: authorityKey,
          version,
        })),
      ),
    ],
  );
  const promptReferences = exactAuthoritySet(
    promptRows.rows,
    RNI_WORKER_MANIFEST_TASKS.map((task) => `prompt\u0000${task}`),
    false,
  );

  const buildRows = await db.query<AuthorityRow>(
    `select authority_kind,authority_key,version,snapshot_hash,value,false as config_bound
       from rni_worker_manifest_authority
      where authority_kind='build' and authority_key='default' and version=$1`,
    [exactText.parse(input.buildEnvironment.deploymentId)],
  );
  const buildReferences = exactAuthoritySet(buildRows.rows, ['build\u0000default'], false);

  const prompts = Object.fromEntries(
    promptReferences.map((reference) => {
      const parsed = promptAuthority.safeParse(reference.value);
      if (!parsed.success || parsed.data.version !== reference.version) {
        throw new RniWorkerManifestRepositoryError('AUTHORITY_MISSING');
      }
      return [reference.authorityKey, parsed.data];
    }),
  ) as Record<RniWorkerManifestTask, ManifestPrompt>;
  const build = buildAuthority.safeParse(buildReferences[0]!.value);
  if (
    !build.success ||
    build.data.deploymentId !== input.buildEnvironment.deploymentId ||
    build.data.commitSha !== input.buildEnvironment.commitSha ||
    build.data.artifactHash !== input.buildEnvironment.artifactHash
  ) {
    throw new RniWorkerManifestRepositoryError('AUTHORITY_MISSING');
  }

  return {
    source: {
      configuration: snapshotFrom(configReferences, 'source_configuration'),
      redditQueries: snapshotFrom(configReferences, 'reddit_queries'),
      xQueries: snapshotFrom(configReferences, 'x_queries'),
      rightsPolicy: snapshotFrom(configReferences, 'rights_policy'),
    },
    policies: {
      ambiguity: snapshotFrom(configReferences, 'ambiguity'),
      taxonomy: snapshotFrom(configReferences, 'taxonomy'),
      classification: snapshotFrom(configReferences, 'classification'),
      analytics: snapshotFrom(configReferences, 'analytics'),
      convergence: snapshotFrom(configReferences, 'convergence'),
      budget: snapshotFrom(configReferences, 'budget'),
    },
    prompts,
    build: build.data,
    references: [...configReferences, ...promptReferences, ...buildReferences],
  };
}

export type RniWorkerManifestAssemblyInput = Omit<
  RniWorkerManifest,
  'source' | 'policies' | 'modelRoutes' | 'build' | 'memberCount' | 'memberSetHash'
> & {
  readonly modelRoutes: readonly Omit<ManifestRoute, 'prompt'>[];
  readonly members: readonly RniWorkerManifestMember[];
};

/** Deterministically combines relational admission inputs with the exact approved authorities. */
export function assembleRniWorkerManifest(
  input: RniWorkerManifestAssemblyInput,
  authorities: RniWorkerManifestAuthoritySet,
): { readonly manifest: RniWorkerManifest; readonly runManifestHash: string } {
  const parsed = parseRniWorkerManifest({
    ...input,
    source: authorities.source,
    policies: authorities.policies,
    modelRoutes: input.modelRoutes.map((route) => ({
      ...route,
      prompt: authorities.prompts[route.task],
    })),
    build: authorities.build,
    memberCount: input.members.length,
    memberSetHash: hashRniWorkerManifestMembers(input.members),
  });
  return { manifest: parsed, runManifestHash: hashRniWorkerManifest(parsed) };
}

const snapshotReference = (
  authorityKindValue: (typeof CONFIG_AUTHORITY_KINDS)[number],
  snapshot: ManifestSnapshot,
): RniWorkerManifestAuthorityReference => ({
  authorityKind: authorityKindValue,
  authorityKey: 'default',
  version: snapshot.version,
  snapshotHash: snapshot.snapshotHash,
  value: snapshot.value,
  configBound: true,
});

/** Complete normalized relational link set expected by Migration 0024. */
export function authorityReferencesForRniWorkerManifest(
  input: unknown,
): readonly RniWorkerManifestAuthorityReference[] {
  const manifest = parseRniWorkerManifest(input);
  return [
    snapshotReference('source_configuration', manifest.source.configuration),
    snapshotReference('reddit_queries', manifest.source.redditQueries),
    snapshotReference('x_queries', manifest.source.xQueries),
    snapshotReference('rights_policy', manifest.source.rightsPolicy),
    snapshotReference('ambiguity', manifest.policies.ambiguity),
    snapshotReference('taxonomy', manifest.policies.taxonomy),
    snapshotReference('classification', manifest.policies.classification),
    snapshotReference('analytics', manifest.policies.analytics),
    snapshotReference('convergence', manifest.policies.convergence),
    snapshotReference('budget', manifest.policies.budget),
    ...manifest.modelRoutes.map((route) => ({
      authorityKind: 'prompt' as const,
      authorityKey: route.task,
      version: route.prompt.version,
      snapshotHash: hashRniWorkerSnapshotValue(route.prompt),
      value: route.prompt,
      configBound: false,
    })),
    {
      authorityKind: 'build' as const,
      authorityKey: 'default',
      version: manifest.build.deploymentId,
      snapshotHash: hashRniWorkerSnapshotValue(manifest.build),
      value: manifest.build,
      configBound: false,
    },
  ];
}

const assertAuthoritiesMatch = (
  actualRows: readonly AuthorityRow[],
  expected: readonly RniWorkerManifestAuthorityReference[],
): void => {
  const actual = exactAuthoritySet(actualRows, expected.map(authorityIdentity), false);
  for (const reference of expected) {
    const row = actual.find(
      (candidate) => authorityIdentity(candidate) === authorityIdentity(reference),
    );
    if (
      row === undefined ||
      row.version !== reference.version ||
      row.snapshotHash !== reference.snapshotHash ||
      (reference.configBound && !row.configBound) ||
      canonicalizeRniWorkerSnapshotValue(row.value) !==
        canonicalizeRniWorkerSnapshotValue(reference.value)
    ) {
      throw new RniWorkerManifestRepositoryError('AUTHORITY_MISSING');
    }
  }
};

async function assertAuthoritiesPersisted(
  manifest: RniWorkerManifest,
  expected: readonly RniWorkerManifestAuthorityReference[],
  db: Queryable,
): Promise<void> {
  const requested = expected.map((reference) => ({
    authority_kind: reference.authorityKind,
    authority_key: reference.authorityKey,
    version: reference.version,
    snapshot_hash: reference.snapshotHash,
    config_bound: reference.configBound,
  }));
  const rows = await db.query<AuthorityRow>(
    `select authority.authority_kind,authority.authority_key,authority.version,
            authority.snapshot_hash,authority.value,
            (binding.config_version is not null) as config_bound
       from jsonb_to_recordset($1::jsonb) as requested(
         authority_kind text,authority_key text,version text,snapshot_hash text,config_bound boolean
       )
       join rni_worker_manifest_authority authority
         on authority.authority_kind=requested.authority_kind
        and authority.authority_key=requested.authority_key
        and authority.version=requested.version
        and authority.snapshot_hash=requested.snapshot_hash
       left join rni_worker_config_authority binding
         on requested.config_bound
        and binding.config_version=$2
        and binding.authority_kind=authority.authority_kind
        and binding.authority_key=authority.authority_key
        and binding.version=authority.version
        and binding.snapshot_hash=authority.snapshot_hash
      order by authority.authority_kind,authority.authority_key`,
    [JSON.stringify(requested), manifest.configuration.version],
  );
  assertAuthoritiesMatch(rows.rows, expected);
}

type ManifestHeaderRow = {
  run_id: string;
  manifest_version: string;
  environment: string;
  partition: string;
  job_run_id: string;
  plan_hash: string;
  run_manifest_hash: string;
  member_set_version: string;
  member_set_hash: string;
  member_count: number;
  config_version: string;
  universe_version: string;
  scope_kind: string;
  selected_security_id: string | null;
  accepted_at: string;
  deadline: string;
  manifest: unknown;
};

type ManifestMemberRow = {
  ordinal: number;
  security_id: string;
  ticker: string;
  company_name: string;
  exchange: string;
  asset_type: string;
  currency: string;
  aliases: unknown;
  selection_source: string;
  provider_symbol: string;
  provider_company_name: string;
  constituent_first_added_at: string | null;
};

const iso = (value: string): string => canonicalInstant(value);

const memberFromRow = (row: ManifestMemberRow): RniWorkerManifestMember =>
  rniWorkerManifestMember.parse({
    ordinal: row.ordinal,
    securityId: row.security_id,
    ticker: row.ticker,
    companyName: row.company_name,
    exchange: row.exchange,
    assetType: row.asset_type,
    currency: row.currency,
    aliases: row.aliases,
    selectionSource: row.selection_source,
    providerSymbol: row.provider_symbol,
    providerCompanyName: row.provider_company_name,
    constituentFirstAddedAt:
      row.constituent_first_added_at === null ? null : iso(row.constituent_first_added_at),
  });

const assertHeaderMatches = (
  row: ManifestHeaderRow,
  manifest: RniWorkerManifest,
  expectedHash: string,
): void => {
  const selectedSecurityId =
    manifest.scope.kind === 'manual_ticker' ? manifest.scope.selectedSecurityId : null;
  if (
    row.run_id !== manifest.runId ||
    row.manifest_version !== RNI_WORKER_MANIFEST_VERSION ||
    row.environment !== manifest.environment ||
    row.partition !== manifest.partition ||
    row.job_run_id !== manifest.jobRunId ||
    row.plan_hash !== manifest.planHash ||
    row.run_manifest_hash !== expectedHash ||
    row.member_set_version !== 'rni-worker-member-set-v1' ||
    row.member_set_hash !== manifest.memberSetHash ||
    row.member_count !== manifest.memberCount ||
    row.config_version !== manifest.configuration.version ||
    row.universe_version !== manifest.universe.version ||
    row.scope_kind !== manifest.scope.kind ||
    row.selected_security_id !== selectedSecurityId ||
    iso(row.accepted_at) !== canonicalInstant(manifest.acceptedAt) ||
    iso(row.deadline) !== canonicalInstant(manifest.deadline)
  ) {
    throw new RniWorkerManifestRepositoryError('MANIFEST_CORRUPT');
  }
};

/**
 * Exact worker read. Workers must supply the delivery's run+manifest hash and must never rebuild
 * from whichever configuration is active when a queue delivery happens to arrive.
 */
export async function loadRniWorkerManifest(
  runId: string,
  runManifestHash: string,
  db: Queryable,
): Promise<RniWorkerManifest> {
  canonicalUuid.parse(runId);
  digest.parse(runManifestHash);
  const header = await db.query<ManifestHeaderRow>(
    `select run_id,manifest_version,environment,partition,job_run_id,plan_hash,
            run_manifest_hash,member_set_version,member_set_hash,member_count,
            config_version::text,universe_version::text,scope_kind,selected_security_id,
            to_char(accepted_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as accepted_at,
            to_char(deadline at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as deadline,manifest
       from rni_worker_run_manifest
      where run_id=$1 and run_manifest_hash=$2`,
    [runId, runManifestHash],
  );
  const row = header.rows[0];
  if (row === undefined) throw new RniWorkerManifestRepositoryError('MANIFEST_NOT_FOUND');
  let manifest: RniWorkerManifest;
  try {
    manifest = parseRniWorkerManifest(row.manifest);
    if (hashRniWorkerManifest(manifest) !== runManifestHash) {
      throw new RniWorkerManifestRepositoryError('MANIFEST_CORRUPT');
    }
    assertHeaderMatches(row, manifest, runManifestHash);
  } catch (error) {
    if (error instanceof RniWorkerManifestRepositoryError) throw error;
    throw new RniWorkerManifestRepositoryError('MANIFEST_CORRUPT');
  }

  const memberRows = await db.query<ManifestMemberRow>(
    `select ordinal,security_id,ticker,company_name,exchange,asset_type,currency,aliases,
            selection_source,provider_symbol,provider_company_name,
            case when constituent_first_added_at is null then null else
              to_char(constituent_first_added_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as constituent_first_added_at
       from rni_worker_run_manifest_member where run_id=$1 order by ordinal`,
    [runId],
  );
  let storedMembers: readonly RniWorkerManifestMember[];
  try {
    storedMembers = memberRows.rows.map(memberFromRow);
    if (
      storedMembers.length !== manifest.memberCount ||
      canonicalizeRniWorkerManifestMembers(storedMembers) !==
        canonicalizeRniWorkerManifestMembers(manifest.members)
    ) {
      throw new RniWorkerManifestRepositoryError('MANIFEST_CORRUPT');
    }
  } catch (error) {
    if (error instanceof RniWorkerManifestRepositoryError) throw error;
    throw new RniWorkerManifestRepositoryError('MANIFEST_CORRUPT');
  }

  const authorityRows = await db.query<AuthorityRow>(
    `select authority.authority_kind,authority.authority_key,authority.version,
            authority.snapshot_hash,authority.value,
            (binding.config_version is not null) as config_bound
       from rni_worker_run_manifest_authority link
       join rni_worker_manifest_authority authority
         on authority.authority_kind=link.authority_kind
        and authority.authority_key=link.authority_key
        and authority.version=link.version
        and authority.snapshot_hash=link.snapshot_hash
       left join rni_worker_config_authority binding
         on binding.config_version=$2
        and binding.authority_kind=authority.authority_kind
        and binding.authority_key=authority.authority_key
        and binding.version=authority.version
        and binding.snapshot_hash=authority.snapshot_hash
      where link.run_id=$1
      order by authority.authority_kind,authority.authority_key`,
    [runId, manifest.configuration.version],
  );
  try {
    assertAuthoritiesMatch(authorityRows.rows, authorityReferencesForRniWorkerManifest(manifest));
  } catch {
    throw new RniWorkerManifestRepositoryError('MANIFEST_CORRUPT');
  }
  return manifest;
}

export type RniWorkerManifestPersistence = {
  readonly disposition: 'inserted' | 'duplicate';
  readonly runId: string;
  readonly runManifestHash: string;
};

/**
 * Persist the header, normalized members and authority links through the caller's transaction.
 * The caller must have inserted the matching v2 execution in that same transaction; Migration
 * 0024 validates the complete graph at commit. This method never inserts authority definitions.
 */
export async function persistRniWorkerManifest(
  input: unknown,
  db: Queryable,
): Promise<RniWorkerManifestPersistence> {
  const manifest = parseRniWorkerManifest(input);
  positiveBigintText.parse(manifest.configuration.version);
  positiveBigintText.parse(manifest.universe.version);
  const runManifestHash = hashRniWorkerManifest(manifest);
  const references = authorityReferencesForRniWorkerManifest(manifest);
  await assertAuthoritiesPersisted(manifest, references, db);

  const inserted = await db.query<{ run_id: string }>(
    `insert into rni_worker_run_manifest (
       run_id,manifest_version,environment,partition,job_run_id,plan_hash,run_manifest_hash,
       member_set_version,member_set_hash,member_count,config_version,universe_version,
       scope_kind,selected_security_id,accepted_at,deadline,manifest
     ) values ($1,$2,$3,$4,$5,$6,$7,'rni-worker-member-set-v1',$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (run_id) do nothing returning run_id`,
    [
      manifest.runId,
      manifest.version,
      manifest.environment,
      manifest.partition,
      manifest.jobRunId,
      manifest.planHash,
      runManifestHash,
      manifest.memberSetHash,
      manifest.memberCount,
      manifest.configuration.version,
      manifest.universe.version,
      manifest.scope.kind,
      manifest.scope.kind === 'manual_ticker' ? manifest.scope.selectedSecurityId : null,
      manifest.acceptedAt,
      manifest.deadline,
      JSON.stringify(manifest),
    ],
  );
  if (inserted.rowCount !== 1) {
    try {
      await loadRniWorkerManifest(manifest.runId, runManifestHash, db);
      return { disposition: 'duplicate', runId: manifest.runId, runManifestHash };
    } catch {
      throw new RniWorkerManifestRepositoryError('CONFLICT');
    }
  }

  await db.query(
    `insert into rni_worker_run_manifest_authority (
       run_id,authority_kind,authority_key,version,snapshot_hash
     ) select $1,authority_kind,authority_key,version,snapshot_hash
         from jsonb_to_recordset($2::jsonb) as authority(
           authority_kind text,authority_key text,version text,snapshot_hash text
         )`,
    [
      manifest.runId,
      JSON.stringify(
        references.map((reference) => ({
          authority_kind: reference.authorityKind,
          authority_key: reference.authorityKey,
          version: reference.version,
          snapshot_hash: reference.snapshotHash,
        })),
      ),
    ],
  );
  await db.query(
    `insert into rni_worker_run_manifest_member (
       run_id,universe_version,ordinal,security_id,ticker,company_name,exchange,asset_type,
       currency,aliases,selection_source,provider_symbol,provider_company_name,
       constituent_first_added_at
     ) select $1,$2,member.ordinal,member.security_id,member.ticker,member.company_name,
              member.exchange,member.asset_type,member.currency,member.aliases,
              member.selection_source,member.provider_symbol,member.provider_company_name,
              member.constituent_first_added_at
         from jsonb_to_recordset($3::jsonb) as member(
           ordinal integer,security_id uuid,ticker text,company_name text,exchange text,
           asset_type text,currency text,aliases jsonb,selection_source text,
           provider_symbol text,provider_company_name text,constituent_first_added_at timestamptz
         )`,
    [
      manifest.runId,
      manifest.universe.version,
      JSON.stringify(
        manifest.members.map((member) => ({
          ordinal: member.ordinal,
          security_id: member.securityId,
          ticker: member.ticker,
          company_name: member.companyName,
          exchange: member.exchange,
          asset_type: member.assetType,
          currency: member.currency,
          aliases: member.aliases,
          selection_source: member.selectionSource,
          provider_symbol: member.providerSymbol,
          provider_company_name: member.providerCompanyName,
          constituent_first_added_at: member.constituentFirstAddedAt,
        })),
      ),
    ],
  );
  return { disposition: 'inserted', runId: manifest.runId, runManifestHash };
}

export class PostgresRniWorkerManifestRepository {
  constructor(private readonly db: Queryable = getPool()) {}

  load(runId: string, runManifestHash: string): Promise<RniWorkerManifest> {
    return loadRniWorkerManifest(runId, runManifestHash, this.db);
  }

  persist(manifest: unknown): Promise<RniWorkerManifestPersistence> {
    return persistRniWorkerManifest(manifest, this.db);
  }

  loadAuthorities(
    input: LoadRniWorkerManifestAuthoritiesInput,
  ): Promise<RniWorkerManifestAuthoritySet> {
    return loadRniWorkerManifestAuthorities(input, this.db);
  }

  persistAuthority(
    input: PersistRniWorkerManifestAuthorityInput,
  ): Promise<'inserted' | 'duplicate'> {
    return persistRniWorkerManifestAuthority(input, this.db);
  }

  bindConfigAuthority(input: BindRniWorkerConfigAuthorityInput): Promise<'inserted' | 'duplicate'> {
    return bindRniWorkerConfigAuthority(input, this.db);
  }
}
