/**
 * F17 §4.1 — the versioned architecture manifest.
 *
 * *"Topology comes from a versioned manifest. Active values come from a public-safe projection
 * of the live configuration, model routes and provider policy."* This file is the **topology**
 * half: the shape of the pipeline, which providers and jobs sit at which stage, the PoV/target
 * component split, the glossary, and the honestly-disclosed gaps between what the provider and
 * job **contracts** name and what is actually **wired** today.
 *
 * What this file is *not*: a place to restate a live number. Every provider id and job key below
 * is a value imported from the module that actually defines it — `contracts/provider.ts`'s
 * `providerId` enum, and the three job-key constants `services/jobs/collectors.ts` and
 * `services/jobs/trigger.ts` already export — never a re-typed string literal. Renaming a job key
 * at its one real definition changes what this file exports too, which is what makes
 * `tests/unit/services/architecture/reconciliation.test.ts`'s drift check meaningful rather than
 * a check on itself. Method formulas, assumptions and limitations are **never** duplicated here —
 * the Formulas tab and the calculation catalogue read `analytics/registry.ts` directly, through
 * `services/calculations.ts`'s `METHOD_REGISTRY`.
 *
 * `providerId`/job-key imports below reach into `contracts/` and (transitively, through the two
 * named constants) into `services/jobs/` — COLLECT's own module. Both are **reads**: nothing here
 * writes to, or duplicates the arithmetic of, a file this lane does not own (`CLAUDE.md`).
 */
import { z } from 'zod';
import { providerId, type ProviderId } from '@/contracts/provider';
import { ATTENTION_POLL_JOB_KEY, MARKET_DATA_POLL_JOB_KEY } from '@/services/jobs/collectors';
import { X_SAMPLING_WINDOW_JOB_KEY } from '@/services/jobs/trigger';
import { MODEL_TASKS } from '@/services/llm/ports';
import { SCORER_IDS } from '@/adapters/scorer';

// ── Schema ─────────────────────────────────────────────────────────────────────────────────────

export const pipelineStageSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  providers: z.array(providerId),
  jobKeys: z.array(z.string()),
});
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

export const componentStatusSchema = z.enum(['deployed', 'target_only']);
export type ComponentStatus = z.infer<typeof componentStatusSchema>;

export const architectureComponentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  status: componentStatusSchema,
});
export type ArchitectureComponent = z.infer<typeof architectureComponentSchema>;

export const jobTopologySchema = z.object({
  jobKey: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  providers: z.array(providerId),
  wired: z.boolean(),
});
export type JobTopology = z.infer<typeof jobTopologySchema>;

export const modelTaskTopologySchema = z.object({
  task: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
});
export type ModelTaskTopology = z.infer<typeof modelTaskTopologySchema>;

export const unwiredProviderSchema = z.object({
  provider: providerId,
  reason: z.string().min(1),
});
export type UnwiredProvider = z.infer<typeof unwiredProviderSchema>;

export const glossaryTermSchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
});
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;

export const opportunitySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  trigger: z.string().min(1),
});
export type Opportunity = z.infer<typeof opportunitySchema>;

export const architectureManifestSchema = z.object({
  /** Bumped whenever the topology below changes shape — not on every prose edit. */
  manifestVersion: z.string().min(1),
  pipeline: z.array(pipelineStageSchema).min(1),
  povComponents: z.array(architectureComponentSchema).min(1),
  targetComponents: z.array(architectureComponentSchema).min(1),
  jobs: z.array(jobTopologySchema).min(1),
  modelTasks: z.array(modelTaskTopologySchema),
  knownUnwiredProviders: z.array(unwiredProviderSchema),
  glossary: z.array(glossaryTermSchema).min(1),
  opportunities: z.array(opportunitySchema).min(1),
  noBacktestStatement: z.string().min(1),
  scorerIdentityVocabulary: z.array(z.string().min(1)).min(1),
});
export type ArchitectureManifest = z.infer<typeof architectureManifestSchema>;

// ── Topology data ──────────────────────────────────────────────────────────────────────────────

/**
 * Every `providerId` the collector-side product actually calls somewhere, by adapter or by a
 * cost/trigger tag that names the vendor directly (`services/market/collector.ts`'s
 * `MARKET_DATA_PROVIDER = 'fmp'` is the one case where the wrapper's own `provider` tag —
 * `'market'` — and the underlying vendor's own id diverge; both are real and both are wired).
 * `reddit` is deliberately absent — see `KNOWN_UNWIRED_PROVIDERS` below.
 *
 * This list is verified against the live source tree, not asserted from memory —
 * `tests/unit/services/architecture/reconciliation.test.ts` greps `src/adapters/**` and
 * `src/services/**` for every `provider: '...'` / `_PROVIDER = '...'` literal and fails if this
 * array and that scan ever disagree, in either direction.
 */
export const WIRED_PROVIDERS: readonly ProviderId[] = [
  'apewisdom',
  'fred',
  'market',
  'fmp',
  'marketaux',
  'scorer',
  'sec_edgar',
  'substack',
  'x',
];

export const KNOWN_UNWIRED_PROVIDERS: readonly UnwiredProvider[] = providerId.options
  .filter((id) => !WIRED_PROVIDERS.includes(id))
  .map((id) => ({
    provider: id,
    reason:
      id === 'reddit'
        ? "D-39 (docs/MEMORY.md): the owner ruled out Reddit-Data-API sourcing for this product entirely. RNI's separate OpenAI Web Search path is the only Reddit channel this repository has; F04 does not build a Reddit adapter here. 'reddit' stays in the shared provider contract because the vocabulary is shared, but no adapter under src/adapters/ implements it for this surface."
        : `Named in the provider contract (contracts/provider.ts) but no adapter or cost/trigger call site names it yet.`,
  }));

export const PIPELINE: readonly PipelineStage[] = [
  {
    id: 'collect',
    label: 'Collect',
    description:
      'Provider adapters poll each source on its own cadence (D-15: broad and continuous on the free sources, X spent only when the price trigger fires). Every adapter call returns a typed ProviderResult — success or a named failure kind — and none of them throws for an expected condition, so one provider outage never stops the loop for the others.',
    providers: ['apewisdom', 'market', 'fmp', 'marketaux', 'sec_edgar', 'fred', 'substack', 'x'],
    jobKeys: [MARKET_DATA_POLL_JOB_KEY, ATTENTION_POLL_JOB_KEY, X_SAMPLING_WINDOW_JOB_KEY],
  },
  {
    id: 'raw_store',
    label: 'Raw item store',
    description:
      'Collected payloads land here before scoring. D-13 rule 1: collection never depends on the scorer, so a scorer outage produces an unscored backlog here, never lost data — recoverable precisely because full bodies are retained (D-17).',
    providers: [],
    jobKeys: [],
  },
  {
    id: 'scoring_queue',
    label: 'Scoring queue',
    description:
      'Text items awaiting a stance classification queue here (F20). The queue is never blocked by scorer availability and never silently substitutes another method for a missing score (D-13 rule 2) — an outage renders an honest abstention, not a number from elsewhere.',
    providers: ['scorer'],
    jobKeys: [],
  },
  {
    id: 'pinned_scorer',
    label: 'Pinned scorer service',
    description:
      'An out-of-process, decoupled service (breaking the platform\'s general "no Python service" rule, narrowly and by name — D-13). Every score carries the scorer id and a `<hf-repo>@<40-hex-commit-sha>` identity; the service refuses to boot against a tag or branch name. See the Models tab for the identity vocabulary this product is built around.',
    providers: ['scorer'],
    jobKeys: [],
  },
  {
    id: 'scored_corpus',
    label: 'Scored corpus',
    description:
      'The permanent asset (D-17): normalized items and their derived scores are never subject to the standard-retention delete path, and this differs by design from the raw provider payloads and superseded calculation artifacts that do age out.',
    providers: [],
    jobKeys: [],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    description:
      'Pure, decimal-only functions bound to a registry descriptor (F05 §4.4). No I/O, no floats — the two invariants a raw JS `number` or an import with a side effect would each break, and the reason `analytics/` and `calc/` import only `contracts/`.',
    providers: [],
    jobKeys: [],
  },
  {
    id: 'artifact',
    label: 'Calculation artifact',
    description:
      'Every computed value is written once as an immutable, replayable `CalculationArtifact` (F03/F05) — inputs, steps, assumptions and the result, hashed and never edited in place. A number without one is a defect the `check:calc-coverage` gate exists to catch before it ships.',
    providers: [],
    jobKeys: [],
  },
  {
    id: 'surfaces',
    label: 'Inspector and product surfaces',
    description:
      'The dashboard, the leaderboard, the ticker detail page, the admin control plane and this Explorer all render values through `InspectableMetric`, which cannot render a number with no `calculationId` to resolve. "How this was calculated" opens the same Inspector everywhere.',
    providers: [],
    jobKeys: [],
  },
];

export const JOBS: readonly JobTopology[] = [
  {
    jobKey: MARKET_DATA_POLL_JOB_KEY,
    label: 'Market data poll',
    description:
      "Polls FMP Starter's daily bars (D-31: no new market-data vendor). This is also D-15's trigger — a large enough daily move opens an X-sampling window for that name.",
    providers: ['market', 'fmp'],
    wired: true,
  },
  {
    jobKey: ATTENTION_POLL_JOB_KEY,
    label: 'Attention poll',
    description:
      "Polls the ApeWisdom board (D-30) that both selects and ranks the 100-symbol universe. Because the same instrument selects and ranks, attention level is not independently interpretable — only rank change is (see the Formulas tab's limitations for attention.rank_change).",
    providers: ['apewisdom'],
    wired: true,
  },
  {
    jobKey: X_SAMPLING_WINDOW_JOB_KEY,
    label: 'X sampling window',
    description:
      "D-15's trigger-dispatched job: a real dispatch path exists (eligibility check, budget refusal, idempotency), seeded disabled. Its handler is a stub — no live X fetch runs yet — and D-32's X read ceiling starts at zero regardless, so this is dormant by two independent, deliberate controls, not by omission.",
    providers: ['x'],
    wired: false,
  },
];

/** The scorer identity vocabulary (D-13) — `src/adapters/scorer.ts`'s own `SCORER_IDS`, imported
 * directly rather than retyped, so a scorer id added there appears here automatically. */
export const SCORER_IDENTITY_VOCABULARY: readonly string[] = [...SCORER_IDS];

export const MODEL_TASK_TOPOLOGY: readonly ModelTaskTopology[] = MODEL_TASKS.map((task) => ({
  task,
  label: task === 'relevance' ? 'Relevance filtering' : 'Entity collision disambiguation',
  description:
    task === 'relevance'
      ? "D-21: is a collected item actually about the ticker it was matched to, before it ever reaches a stance score. Never the stance classification itself — that is the pinned scorer's job (D-13), kept off this route on purpose."
      : "D-21: resolves a ticker collision (a symbol that means more than one company, or a company known by more than one name) before an item is attributed to a security.",
}));

export const POV_COMPONENTS: readonly ArchitectureComponent[] = [
  {
    id: 'web_app',
    label: 'Next.js web application',
    description:
      'The dashboard, leaderboard, ticker detail, admin control plane and this Explorer. The render boundary D-10 keeps authoritative: the §6.4 disclosure is emitted here, and prose failing verification is withheld here.',
    status: 'deployed',
  },
  {
    id: 'postgres',
    label: 'Versioned Postgres store',
    description:
      'Config and universe versions, calculation artifacts, audit events. Append-only enforced by the database itself on every table §4.1 of the architecture contracts names — not merely by application discipline.',
    status: 'deployed',
  },
  {
    id: 'job_dispatch',
    label: 'Job dispatch (Redis + QStash)',
    description:
      'F16a: the single execution path every scheduled or triggered refresh goes through, with an idempotency key and a lock on every claim.',
    status: 'deployed',
  },
  {
    id: 'provider_adapters',
    label: 'Provider adapters',
    description:
      'Wrapped, typed calls to every wired provider (see the pipeline diagram) — none throws for an expected failure, so one outage never stops the collector loop for the others.',
    status: 'deployed',
  },
  {
    id: 'pinned_scorer_service',
    label: 'Pinned scorer service',
    description:
      'FinBERT and Twitter-RoBERTa, pinned to verified commit SHAs, served from a container built and exercised in CI (`services/scorer/Dockerfile`, pip-installed with no network reachable at test time). Whether this container is currently reachable from the live web deployment is an operational fact this manifest does not assert — see the Opportunities tab.',
    status: 'deployed',
  },
];

export const TARGET_COMPONENTS: readonly ArchitectureComponent[] = [
  {
    id: 'reddit_channel',
    label: 'A Reddit collection channel for this product',
    description:
      "This surface has none (D-39). RNI's OpenAI Web Search path covers Reddit for the repository as a whole, but that is a separate surface with a separate cold start — not something this product's collector calls.",
    status: 'target_only',
  },
  {
    id: 'substack_collector_service',
    label: 'A persisted Substack collector',
    description:
      "F04's Substack adapter is merged; nothing yet persists a scheduled poll of it the way market data and the attention board are persisted (F16a's own disclosed gap). Substack RSS is read as needed, not on a recorded cadence.",
    status: 'target_only',
  },
  {
    id: 'x_sampling_live',
    label: 'A live X-sampling collector',
    description:
      "The trigger-dispatch mechanism is real (job x_sampling_window); the fetch behind it is a stub, and D-32's zero X-read ceiling means it is not fundable yet even once built.",
    status: 'target_only',
  },
  {
    id: 'scorer_identity_query_path',
    label: 'A queryable record of which pinned scorer produced a given score',
    description:
      'D-13 requires every score to carry `scorer_id` and `scorer_version`; the pin itself is enforced at the scorer service\'s own boot (`services/scorer/pinning.py`). Nothing in this application\'s database yet stores that identity per scored item in a form this Explorer, or any admin surface, can query — see the Models tab.',
    status: 'target_only',
  },
  {
    id: 'config_version_bootstrap',
    label: 'A production config-version bootstrap path',
    description:
      "No code path in this repository has ever created a production `config_version` row (migration `0014`'s own disclosed finding). Every versioned table that depends on one — including job definitions — is consequently unseeded in production until this exists.",
    status: 'target_only',
  },
  {
    id: 'return_predictivity_backtest',
    label: 'A point-in-time-correct return-predictivity backtest',
    description:
      "D-09's promotion path: a metric may use predictive language only once a PIT-correct backtest with a published information coefficient, Newey–West t-statistic and momentum-residual IC stands behind it, versioned and linked from the Inspector. See the Assumptions tab — this does not exist yet, for any metric.",
    status: 'target_only',
  },
];

export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    term: 'attention',
    definition:
      'How much a security is being discussed on the one board this product ranks from (ApeWisdom), relative to the other securities on that board — not how much it is discussed anywhere, and not a measure independent of the instrument that selected the tracked universe in the first place (D-30). Rank change is the interpretable half; level is not.',
  },
  {
    term: 'sampled stance',
    definition:
      'The direction and confidence a pinned classifier assigns to a bounded sample of collected items for one platform axis, shrunk toward zero by how much material was actually available (n_eff). It describes what was said in the sample this product saw, not what a population believes, and it is never blended across platforms into one number (D-14).',
  },
  {
    term: 'sample adequacy',
    definition:
      "How much material was available to compute a metric — the item count against the method's `min_items`/`display_floor` bounds — not how likely the resulting value is to be correct. A high-adequacy stance score can still be wrong; a low-adequacy one is not automatically less true, only less measured.",
  },
  {
    term: 'abstention',
    definition:
      "A method's deliberate refusal to produce a number when its own eligibility rules are not met (below a sample floor, a stale window, a methodology change between two comparable observations). Rendered as an explicit reason, never as a zero or a blank — a measured zero and an abstained metric look identical to a reader unless the difference is stated.",
  },
  {
    term: 'divergence state',
    definition:
      'A categorical read of whether attention, sampled stance and price direction agree or disagree for a security, aggregated from three already-classified inputs. Causality is unproven in every state it can return, stated on every artifact this method produces.',
  },
  {
    term: 'coverage floor',
    definition:
      'The date collection began for an axis, written once per axis and never moved. Every historical view built on that axis carries "coverage begins {date}" rather than silently implying a longer history than the collector actually has (D-16).',
  },
];

export const OPPORTUNITIES: readonly Opportunity[] = [
  {
    id: 'reddit_gap',
    label: 'No Reddit collection channel in this product',
    description:
      "social.stance_reddit is a fully registered, computable method with its own goldens — it has no live Reddit collector to feed it in this product (D-39). It stays registered because the formula and its disclosures are real; the input pipeline is the gap.",
    trigger: 'The owner reverses D-39, or a future decision routes RNI\'s Reddit corpus into this product\'s scoring path.',
  },
  {
    id: 'substack_persistence_gap',
    label: 'Substack collection is not on a recorded cadence',
    description: 'See the Target tab — F16a\'s own disclosed gap.',
    trigger: 'A COLLECT lane builds a persisted Substack poll analogous to market_data_poll/attention_poll.',
  },
  {
    id: 'x_sampling_stub',
    label: 'X sampling has a dispatch path and no fetch behind it',
    description: 'See the Target tab.',
    trigger: 'D-32\'s X read ceiling moves off zero on real trigger evidence, and COLLECT builds the fetch.',
  },
  {
    id: 'scorer_identity_not_queryable',
    label: "No queryable record of which pinned scorer produced a given score",
    description:
      'See the Target tab. Concretely: this is why the Models tab cannot show the currently observed pinned commit SHA — showing one without a real query behind it would be exactly the kind of hand-typed value this feature exists to prevent.',
    trigger: 'A repository function is added over the scored-item store, keyed on scorer_id/scorer_version.',
  },
  {
    id: 'config_version_bootstrap_gap',
    label: 'No production config-version bootstrap path',
    description: 'See the Target tab — this also means job_definition rows have never been seeded in production (migration 0014).',
    trigger: 'SPINE builds a config-version bootstrap script or migration.',
  },
  {
    id: 'no_backtest',
    label: 'No return-predictivity backtest exists for any metric',
    description: 'See the Assumptions tab, stated there directly per this feature\'s own requirement.',
    trigger: "D-09's promotion path, roughly twelve months after the collector's start date (D-16) — a 2027 milestone.",
  },
];

export const NO_BACKTEST_STATEMENT =
  'No metric in this product has been tested against historical returns, and no point-in-time-correct ' +
  "backtest exists for any of them. D-09's promotion path — the only way a metric may carry predictive " +
  "language — requires a published information coefficient, a Newey–West t-statistic and a momentum-" +
  "residual IC, versioned and linked from the Inspector, computed over a corpus this collector has not " +
  "yet accrued (D-16 is forward-only, with no backfill). Every value on every tab of this product, " +
  'including this Explorer\'s own worked examples, describes what is currently observable and nothing more.';

export const MANIFEST_VERSION = '1.0.0';

export const ARCHITECTURE_MANIFEST: ArchitectureManifest = architectureManifestSchema.parse({
  manifestVersion: MANIFEST_VERSION,
  pipeline: PIPELINE,
  povComponents: POV_COMPONENTS,
  targetComponents: TARGET_COMPONENTS,
  jobs: JOBS,
  modelTasks: MODEL_TASK_TOPOLOGY,
  knownUnwiredProviders: KNOWN_UNWIRED_PROVIDERS,
  glossary: GLOSSARY,
  opportunities: OPPORTUNITIES,
  noBacktestStatement: NO_BACKTEST_STATEMENT,
  scorerIdentityVocabulary: SCORER_IDENTITY_VOCABULARY,
});
