/**
 * F18 §4.3 — the degraded-state catalogue. For every provider this codebase actually sources
 * from: a defined behaviour, a user-visible state, a severity, and a runbook entry.
 *
 * **The Reddit row is corrected, not reproduced.** `F18-cost-degradation.md` §4.3's own table
 * still lists "Reddit Data API" as the highest-severity row ("the attention axis has no
 * backfill"). That table predates `docs/MEMORY.md` D-39 (2026-09-05): the legacy product does
 * not source Reddit from its Data API at all any more — "for reddit we are not going to source
 * data from its data API. RNI stream replaces this," given twice by the owner. There is no
 * Reddit provider left in this codebase's legacy product to degrade, so there is no Reddit row
 * here. (RNI's own OpenAI-Web-Search Reddit path is out of this feature's scope — `docs/rni/**`
 * — and has its own degradation story, not this one's.)
 *
 * **The ApeWisdom row is also corrected against a first draft of this table, caught during this
 * feature's own e2e gate rather than by review.** D-12/D-30 demoted ApeWisdom to an independent
 * *cross-check* — a ruling that describes a world where the Reddit Data API is the primary
 * attention source. D-39 (2026-09-05) discarded that source for the legacy product entirely, and
 * `services/attention/collector.ts` — "the attention snapshot collector — F08 §4.1... persists an
 * `attention_snapshot` per active symbol per run" — is unambiguous that ApeWisdom is what it
 * actually calls. **ApeWisdom is, today, this codebase's only running attention collector**, not
 * a discretionary cross-check, so an outage here is D-16 permanent corpus loss exactly like the
 * market-data and Substack rows, not the low-severity "cross-check unavailable" a stale reading
 * of D-12/D-30 alone would suggest.
 *
 * **The severity rule** (spec's own words, kept verbatim because it is the one sentence that
 * actually explains the column): *"an outage that costs latency is recoverable and low-severity;
 * an outage that costs corpus is permanent and is the most serious event this system can
 * experience."* Under D-16's forward-only collection, only the collectors that actually write the
 * permanent social/market corpus (market data, ApeWisdom's attention collector, the F20 scorer
 * queue) can lose corpus by going down; every enrichment source can only go stale or unavailable,
 * which is recoverable the moment it comes back.
 *
 * This module is data, deliberately inert (no I/O, no provider knowledge) — the single source of
 * truth `/admin/data-sources` (this feature) renders and the chaos suite (`tests/chaos/`) asserts
 * against, so the two can never quietly disagree about what a given outage is supposed to do.
 */

export type DegradationSeverity = 'critical' | 'high' | 'medium' | 'low';

export type ProviderDegradationEntry = {
  readonly provider: string;
  /** What actually happens in the system when this provider is unavailable. */
  readonly behavior: string;
  /** What a person using the product sees — never a blank page, never invented content. */
  readonly userVisibleState: string;
  readonly severity: DegradationSeverity;
  /** The disclosed reasoning the severity column encodes (F18 §4.3's own rule). */
  readonly severityReason: string;
  /** What an operator does about it, in order. */
  readonly runbook: readonly string[];
};

/** Highest-to-lowest for the table's default sort — matches the spec's own ordering intent. */
export const SEVERITY_ORDER: Readonly<Record<DegradationSeverity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const CORPUS_LOSS_REASON =
  'D-16: collection is forward-only with no backfill. An outage here is not latency — it is a permanent gap in the one asset this product cannot re-acquire.';
const LATENCY_ONLY_REASON =
  'Recoverable the moment the provider returns. Nothing this outage would have produced is lost — only delayed.';

export const DEGRADATION_CATALOGUE: readonly ProviderDegradationEntry[] = [
  {
    provider: 'Substack',
    behavior:
      'The curated-publication RSS collector cannot poll. The Substack stance/news frame goes stale rather than empty — the last successfully collected item stays displayed with its own age.',
    userVisibleState:
      'The Substack sampling frame shows its existing content with an explicit "stale since {ts}" age label. The Reddit-cross-check-free attention axis and the X frame are unaffected — they are separate frames per D-14 and never renormalize to cover for it.',
    severity: 'critical',
    severityReason: CORPUS_LOSS_REASON,
    runbook: [
      'Check the Substack RSS collector job (`market_data_poll`-adjacent job rows in `/admin/jobs`) for consecutive failures.',
      'Confirm the publication list still resolves (a publication moving off Substack, or changing its feed URL, silently zeroes that one source).',
      'Record a `CoverageGap` for the outage window once diagnosed — never quietly resume with a gap in the corpus unrecorded.',
    ],
  },
  {
    provider: 'Market data (FMP)',
    behavior:
      'D-15\'s price trigger is blind — no daily-bar close means no spike can be detected, so no X sampling window opens for the outage window. `market/provider-deps.ts`\'s own poll gate is permanently permissive by design (F16a §4.1b), because gating the one input that detects a spike would be self-defeating.',
    userVisibleState:
      'The price axis panel and market/sector composites show the last good quote with an explicit stale timestamp. The trigger frame for any ticker shows no window opened, never a fabricated "quiet" reading — a delayed feed is never substituted and labelled as the live trigger input.',
    severity: 'critical',
    severityReason: CORPUS_LOSS_REASON,
    runbook: [
      'Check FMP\'s status page and this deployment\'s daily rate/quota usage first — a 403 here is never retried automatically (F18 §4.3\'s own rule).',
      'Confirm the outage window in `market_data_poll`\'s job run history; record a `CoverageGap` once confirmed.',
      'If the outage spans a trading day, the day\'s trigger evaluation for every symbol is lost, not degraded — treat as corpus loss, not latency.',
    ],
  },
  {
    provider: 'F20 scorer',
    behavior:
      'Stance scoring abstains with a reason (D-13 — never a silent substitution from another method). Items queue in the raw store and are scored on recovery, because collection and scoring are decoupled precisely so a scorer outage costs latency, not corpus.',
    userVisibleState:
      'Any stance panel for an item scored during the outage shows "No stance — scorer unavailable since {ts}," never a number from a different method standing in.',
    severity: 'high',
    severityReason:
      'Latency, not corpus loss — D-13\'s architecture exists specifically so a scorer outage cannot become the D-16 failure mode. Ranked below the two truly permanent-loss rows for exactly that reason, not because it is unimportant.',
    runbook: [
      'Check the scorer service\'s own CI/deploy lane and its health endpoint.',
      'Confirm the scoring queue is growing, not silently dropping — a queue that grows during an outage and drains after is the expected, correct behaviour.',
      'Do not manually substitute a hosted-LLM score for the backlog outside the D-13 §4.2 "capacity fallback" hook, and never in place — only as a successor artifact.',
    ],
  },
  {
    provider: 'X',
    behavior:
      'The triggered sampling window for the outage period is empty. Reddit (RNI-sourced, out of this row\'s scope) and Substack frames are unaffected — D-14\'s three frames never renormalize to cover for one another.',
    userVisibleState:
      'The X sampling frame discloses that the window opened but returned nothing, or that the trigger did not fire during the outage — never silently blank, and never implying "no discussion" when the true state is "no data collected."',
    severity: 'medium',
    severityReason: LATENCY_ONLY_REASON,
    runbook: [
      'Confirm whether the outage is X API availability or this codebase\'s own read budget (D-32 — X read ceilings start at zero until the price trigger is verified firing; a "budget_denied" refusal here is not a provider outage at all).',
      'Check `/admin/costs` for whether the refusal is `circuit_open`/`upstream` (a real X outage) versus `budget_denied` (D-32\'s own funding state).',
    ],
  },
  {
    provider: 'FMP (fundamentals)',
    behavior:
      'Last good quote/history keeps rendering with a stale timestamp. Fundamentals panels are omitted with a stated reason rather than showing a stale or fabricated figure. A 403 is never retried.',
    userVisibleState: 'Fundamentals panel: "Not available — provider error since {ts}," price/quote panels: last good value with an explicit age.',
    severity: 'medium',
    severityReason: LATENCY_ONLY_REASON,
    runbook: [
      'Distinguish a rate-limit (retryable per the adapter\'s own backoff policy) from a 403 (entitlement problem — never auto-retried, escalate instead).',
      'Confirm the circuit breaker opened rather than every request individually failing and retrying past the outage.',
    ],
  },
  {
    provider: 'Marketaux',
    behavior:
      'News sentiment reads `insufficient_data`. The composite (where Marketaux is one input) renormalizes across its remaining inputs rather than treating the missing one as zero.',
    userVisibleState: 'News axis panel shows "insufficient data" explicitly; any composite that would have included it is labelled as renormalized, not silently short.',
    severity: 'low',
    severityReason: LATENCY_ONLY_REASON,
    runbook: [
      'Check the 100-request/day free-tier quota first (`MARKETAUX_DAILY_QUOTA`, `dashboard/provider-deps.ts`) — the most common cause is quota exhaustion, not a real provider outage.',
      'Confirm the dashboard refresh degraded set (`degraded.add(\'marketaux\')`) is actually populated for the outage window.',
    ],
  },
  {
    provider: 'ApeWisdom',
    behavior:
      'D-39-corrected (see this module\'s own doc comment): D-12/D-30 called this a demoted cross-check, but with Reddit-Data-API sourcing dropped entirely for the legacy product, `services/attention/collector.ts` is the only running attention collector this codebase has. An outage here writes no `attention_snapshot` rows for the outage window — permanent, forward-only loss (D-16), not a cosmetic cross-check gap. It is never budget-gated (`attention/provider-deps.ts`), free and keyless, for the identical reason the market-data poll is never gated.',
    userVisibleState:
      'The leaderboard renders its own catalogued unavailable state (`AttentionUnavailable.tsx`, F08) naming the outage and the coverage gap it opened — never a dip, never a silently-stale ranking presented as current.',
    severity: 'critical',
    severityReason: CORPUS_LOSS_REASON,
    runbook: [
      'Check `adapters/apewisdom.ts`\'s own recent call log and circuit-breaker state first — ApeWisdom has no SLA and no key, so an outage here is not escalatable upstream, only diagnosable and waited out.',
      'Confirm the collector job (`attention_poll`, `/admin/jobs`) is still scheduled and firing; a stopped job is indistinguishable from a provider outage from the corpus\'s point of view and is exactly as serious.',
      'Record a `CoverageGap` for the outage window once diagnosed.',
    ],
  },
  {
    provider: 'LLM (relevance / entity-collision)',
    behavior:
      'The two registered D-21 complementary methods abstain. Research runs that depend on them are disabled with a stated reason. No deterministic metric is affected — this is the entire point of D-13\'s separation between the scorer service and these LLM-assisted methods.',
    userVisibleState: 'A research run refuses with "relevance/entity-collision unavailable," never a silently-skipped filtering step that would let unfiltered, uncollision-checked content through.',
    severity: 'low',
    severityReason: 'No deterministic metric is affected (D-13). Research being unavailable is inconvenient, not a data-integrity or corpus event.',
    runbook: ['Check the model transport (Vercel AI Gateway, D-34) status before assuming the provider itself is down.'],
  },
  {
    provider: 'SEC / FRED',
    behavior: 'Enrichment omitted silently — these are enrichment sources whose absence changes no computed number.',
    userVisibleState: 'No visible change; the panels that would have used this enrichment simply do not show it for the outage window.',
    severity: 'low',
    severityReason: 'Enrichment only. Its absence changes no number the product reports, which is the spec\'s own stated reason this is the lowest-severity row.',
    runbook: ['No action required unless the outage is prolonged enough to be worth noting in the next release\'s known-gaps list.'],
  },
];

export function findDegradationEntry(provider: string): ProviderDegradationEntry | undefined {
  return DEGRADATION_CATALOGUE.find((entry) => entry.provider === provider);
}

/** The catalogue's own default rendering order — most severe first. */
export function catalogueBySeverity(): readonly ProviderDegradationEntry[] {
  return [...DEGRADATION_CATALOGUE].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
