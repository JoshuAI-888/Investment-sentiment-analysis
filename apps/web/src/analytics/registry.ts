/**
 * The method registry — the declarative half (F05 §4.4).
 *
 * `02-ARCHITECTURE-CONTRACTS.md` §4.3: *"the single runtime description of a metric. The
 * Inspector, the formula catalogue, the assumption validator and the Architecture Explorer all
 * read this — none of them reimplements a formula."*
 *
 * **This file is data.** No arithmetic, no I/O, no imports beyond zod — which is what lets
 * `analytics/` obey §3's "analytics depends only on contracts" while still being the place the
 * registry lives. `scripts/checks/load.ts` imports it by path and `check:calc-coverage` and
 * `check:copy` both read `methods` from it; that wiring has existed since F01 and needed no
 * change when this file appeared, which was the point of shipping the checks empty.
 *
 * The arithmetic each entry names lives in `calc/methods/`, bound to its descriptor in
 * `services/calculations.ts`. `tests/unit/calc/registry.test.ts` fails if either side drifts.
 *
 * **`editableAssumptions` is the sole runtime description of what a user may change**, and it is
 * only half the gate: `calc/registry.ts`'s `EDITABLE_ASSUMPTION_ALLOWLIST` must permit the key
 * too, so a database row carrying this projection can never make a prohibited parameter editable.
 */
import { z } from 'zod';

/**
 * `methods` is the export `check:calc-coverage` and `check:copy` read. It carries `id` and
 * `goldens` because those checks need them, and everything else because the Inspector does.
 */
export const methods = [
  {
    id: 'attention.rank_change',
    version: '1.0.0',
    title: 'Attention rank change (24 h)',
    subjectKind: 'security',
    unit: 'ranks',
    symbolicFormula: 'rank_change = clamp(rank(t−24h) − rank(t), −board_size, +board_size)',

    officialAssumptions: {
      /** Below this many mentions in the window, the method abstains rather than shrinking. */
      min_mentions: '25',
      /**
       * The size of the board being ranked. **Not editable, deliberately**: it is a property of
       * the source, not a preference. A user who could set it to 5 would get a rank change
       * clamped into a range the board never had.
       */
      board_size: '100',
    },

    editableAssumptions: [
      {
        key: 'min_mentions',
        min: '1',
        max: '1000',
        unit: 'mentions',
        label: 'Minimum mentions before a rank change is shown',
      },
    ],

    workingPrecision: 34,
    roundingRule: 'int_0dp_half_even',

    eligibilityRules: [
      'The security must have at least `min_mentions` mentions in the current window.',
      'The security must appear on the board at both ends of the comparison. A top-N board reports absence and rank 0 identically, and absence is not a position.',
      'Both observations must come from the same board. A rank on one board is not comparable with a rank on another.',
    ],

    failureBehaviour: 'abstain',

    /**
     * Nothing independent to compare against. **D-30 (superseding D-12/R-03):** ApeWisdom
     * *selected* the universe, so it cannot then validate attention rank on it.
     */
    externalComparator: null,

    limitations: [
      'The sampling frame is the posts one board indexes, not everything written anywhere. This is a count of what that board saw, and nothing else.',
      'Selection bias: the board ranks what is already being talked about, so a security enters the measurement only after attention has already arrived. A rank change describes what has happened, not what is about to.',
      'The board that produces these ranks is the same instrument that selected the 100 securities tracked here (D-30). It therefore cannot serve as an independent check on its own ranking.',
      'A change in the board’s composition between two observations moves every rank on it. Large moves are clamped and marked, but a clamped value is a statement about the board, not about the security.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],

    goldens: ['src/analytics/goldens/attention.rank_change.v1.0.0.json'],

    /** Two observations a day; past six hours the artifact renders as `stale` (§4.8 §1). */
    stalenessMinutes: 360,
  },

  {
    id: 'attention.rank_change',
    version: '1.1.0',
    title: 'Attention rank change (24 h)',
    subjectKind: 'security',
    unit: 'ranks',
    symbolicFormula: 'rank_change = clamp(rank(t−24h) − rank(t), −board_size, +board_size)',

    officialAssumptions: {
      min_mentions: '25',
      board_size: '100',
    },

    editableAssumptions: [
      {
        key: 'min_mentions',
        min: '1',
        max: '1000',
        unit: 'mentions',
        label: 'Minimum mentions before a rank change is shown',
      },
    ],

    workingPrecision: 34,
    roundingRule: 'int_0dp_half_even',

    eligibilityRules: [
      'Both observations must share the same `provider_methodology_version`. A change in methodology between the two snapshots makes them incomparable, checked before anything else (F06 §4.1).',
      'The security must have at least `min_mentions` mentions in the current window.',
      'The security must appear on the board at both ends of the comparison. A top-N board reports absence and rank 0 identically, and absence is not a position.',
      'Both observations must come from the same board. A rank on one board is not comparable with a rank on another.',
    ],

    failureBehaviour: 'abstain',

    externalComparator: null,

    limitations: [
      'The sampling frame is the posts one board indexes, not everything written anywhere. This is a count of what that board saw, and nothing else.',
      'Selection bias: the board ranks what is already being talked about, so a security enters the measurement only after attention has already arrived. A rank change describes what has happened, not what is about to.',
      'The board that produces these ranks is the same instrument that selected the 100 securities tracked here (D-30). It therefore cannot serve as an independent check on its own ranking.',
      'A change in the board’s composition between two observations moves every rank on it. Large moves are clamped and marked, but a clamped value is a statement about the board, not about the security.',
      'A methodology change between the two observations makes the comparison not_applicable rather than computing a delta across it (F06 §4.1, F-05 amendment).',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],

    goldens: ['src/analytics/goldens/attention.rank_change.v1.1.0.json'],

    stalenessMinutes: 360,
  },

  {
    id: 'attention.mention_delta',
    version: '1.0.0',
    title: 'Attention mention count, change (24 h)',
    subjectKind: 'security',
    unit: 'mentions',
    symbolicFormula: 'mention_delta = mentions_current - mentions_prior',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'int_0dp_half_even',
    eligibilityRules: ['Always computable — there is no sample floor for an absolute count change.'],
    failureBehaviour: 'clamp',
    externalComparator: null,
    limitations: [
      'The sampling frame is the posts one board indexes, not everything written anywhere.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/attention.mention_delta.json'],
    stalenessMinutes: 360,
  },

  {
    id: 'attention.mention_growth',
    version: '1.0.0',
    title: 'Attention mention count, proportional change (24 h)',
    subjectKind: 'security',
    unit: 'ratio',
    symbolicFormula: 'mention_growth = mention_delta / max(mentions_prior, 1)',
    officialAssumptions: {
      /** Below this many *prior* mentions, growth is hidden in favour of the absolute delta. */
      min_mentions: '5',
    },
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'ratio_6dp_half_even',
    eligibilityRules: [
      'The prior window must have at least `min_mentions` mentions (§4.1: "prior mentions < 5 ⇒ hide growth, show absolute delta"). Below the floor, attention.mention_delta is shown instead.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'The sampling frame is the posts one board indexes, not everything written anywhere.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/attention.mention_growth.json'],
    stalenessMinutes: 360,
  },

  {
    id: 'attention.engagement_per_mention',
    version: '1.0.0',
    title: 'Engagement per mention',
    subjectKind: 'security',
    unit: 'ratio',
    symbolicFormula: 'engagement_per_mention = engagement / max(mentions_current, 1)',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'ratio_6dp_half_even',
    eligibilityRules: ['Always computable — the denominator is floored at one rather than gated.'],
    failureBehaviour: 'clamp',
    externalComparator: null,
    limitations: [
      'The sampling frame is the posts one board indexes, not everything written anywhere.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/attention.engagement_per_mention.json'],
    stalenessMinutes: 360,
  },

  {
    id: 'attention.mentions_zscore',
    version: '1.0.0',
    title: 'Attention anomaly (robust z-score)',
    subjectKind: 'security',
    unit: 'z_score',
    symbolicFormula:
      'robust_z = (ln(1+mentions_t) - median(ln(1+mentions_history))) / max(1.4826 * MAD(ln(1+mentions_history)), epsilon)',
    officialAssumptions: {
      /** §4.1: "Require at least 14 comparable snapshots before displaying the z-score." */
      min_history: '14',
      epsilon: '0.000001',
    },
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'ratio_6dp_half_even',
    eligibilityRules: [
      'At least `min_history` comparable snapshots must exist. Fewer than that, the median and the MAD describe the sample more than the security.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'The sampling frame is the posts one board indexes, not everything written anywhere.',
      'MAD-based robustness limits, but does not remove, the effect of a single board-composition change on the whole history window.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/attention.mentions_zscore.json'],
    stalenessMinutes: 360,
  },

  {
    id: 'social.stance_reddit',
    version: '1.0.0',
    title: 'Stance of sampled snippets (Reddit)',
    subjectKind: 'security',
    unit: 'stance_unit',
    symbolicFormula:
      'shrunk_social = [sum(weight_i·signed_i)/sum(weight_i)] · n_eff/(n_eff+8), weight_i = relevance_i·confidence_i·exp(-age_hours_i/36)',
    officialAssumptions: {
      /**
       * **Provisional (F06, pending real corpus data).** Reddit is this method's original
       * calibration target: source §4.2's relevance-ranked web search restricted to
       * reddit.com is a continuous, high-volume sampling frame, closest of the three axes to
       * the 5–12-snippet regime the re-lock says the old thresholds were calibrated against.
       * Kept at the source values unchanged rather than re-derived downward, because nothing
       * about Reddit's own sampling frame has changed — only X's and Substack's have.
       * **Trigger to revisit:** `DEPLOY.md` MT-08 + 14 days of real Reddit collection;
       * re-derive against the observed item-count distribution rather than this reasoning.
       */
      min_items: '5',
      display_floor: '8',
    },
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'ratio_6dp_half_even',
    eligibilityRules: [
      'Fewer than `min_items` relevant items ⇒ insufficient_data, no score.',
      '`min_items`–`display_floor - 1` items ⇒ score stored, flagged low sample adequacy.',
      '`display_floor` or more ⇒ displayable without the low-adequacy flag. The comparison is against `n_eff`, not the raw item count.',
      'All-zero item weights (zero relevance or zero classifier confidence throughout) ⇒ no_coverage_in_window, no score.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'Computed over snippets selected by a relevance-ranked web search restricted to reddit.com. This is not a random or representative sample of any population. Adequacy measures how much material was available, not how likely the result is to be correct.',
      'No author-follower weighting, in the PoV, ever.',
      '`unclear` and sarcasm items contribute zero direction and remain in the diagnostics rather than being excluded.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/social.stance_reddit.json'],
    stalenessMinutes: 360,
  },

  {
    id: 'social.stance_x',
    version: '1.0.0',
    title: 'Stance of sampled snippets (X)',
    subjectKind: 'security',
    unit: 'stance_unit',
    symbolicFormula:
      'shrunk_social = [sum(weight_i·signed_i)/sum(weight_i)] · n_eff/(n_eff+8), weight_i = relevance_i·confidence_i·exp(-age_hours_i/36)',
    officialAssumptions: {
      /**
       * **Corrected by lane-review, then by the coordinator (F06, second round).** The first
       * draft lowered `min_items` to '3' here, reasoning by analogy from news's own `n < 3`
       * floor. That reasoning cannot stand: `01-PRODUCT-SPEC.md` §6.3 states *"n < 5 relevant
       * items ⇒ no stance score"* as a binding invariant, not a Reddit-specific default, and
       * Tier B's own gate (B5) requires **zero** thin-sample stance scores at n < 5 — a metric
       * with no per-axis carve-out. A lane may not lower a locked invariant to fit a hard case;
       * that is exactly `CLAUDE.md`'s "a needed contract change is reported, not made."
       *
       * `min_items` is therefore held at '5' on every axis, X included. The real, unresolved
       * problem the first draft was reaching for — *"n ≥ 5 is met trivially on Reddit and
       * nearly always fails on X at 15-minute resolution"* — still stands, but its answer is
       * that X legitimately abstains most windows under D-15's event-conditional sampling, not
       * that the floor moves. That is a disclosed limitation, not a defect this method can
       * paper over. `display_floor` is restored to Reddit's '8' for the same reason: '5' against
       * a `min_items` of '5' is a degenerate, empty low-adequacy band.
       * **Trigger to revisit `display_floor` only** (never `min_items`, which is locked by B5):
       * `DEPLOY.md` MT-08 + MT-13 (Reddit *and* X collection both running) + 14 days; re-derive
       * against the observed per-window item-count distribution.
       */
      min_items: '5',
      display_floor: '8',
    },
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'ratio_6dp_half_even',
    eligibilityRules: [
      'Fewer than `min_items` relevant items ⇒ insufficient_data, no score.',
      '`min_items`–`display_floor - 1` items ⇒ score stored, flagged low sample adequacy.',
      '`display_floor` or more ⇒ displayable without the low-adequacy flag. The comparison is against `n_eff`, not the raw item count.',
      'All-zero item weights ⇒ no_coverage_in_window, no score.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'Computed over a 15-minute-resolution, event-conditional sample (D-15) — never averaged across a trigger gap as though the series were continuous. This is not a random or representative sample of any population. Sample adequacy measures how much material was available, not how likely the result is to be correct.',
      'No author-follower weighting, in the PoV, ever.',
      '`unclear` and sarcasm items contribute zero direction and remain in the diagnostics rather than being excluded.',
      'The `min_items` floor of 5 is the same on every axis (a locked product invariant, §6.3/B5) and is expected to abstain on most X windows under D-15\'s event-conditional sampling — that is a disclosed property of the axis, not a threshold gap.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/social.stance_x.json'],
    stalenessMinutes: 360,
  },

  {
    id: 'social.stance_substack',
    version: '1.0.0',
    title: 'Stance of sampled snippets (Substack)',
    subjectKind: 'security',
    unit: 'stance_unit',
    symbolicFormula:
      'shrunk_social = [sum(weight_i·signed_i)/sum(weight_i)] · n_eff/(n_eff+8), weight_i = relevance_i·confidence_i·exp(-age_hours_i/36)',
    officialAssumptions: {
      /**
       * **Corrected by lane-review, then by the coordinator (F06, second round).** Held at
       * '3'/'5' in the first draft by analogy with X's (also-reverted) provisional floor.
       * `min_items` cannot go below '5' on any axis: `01-PRODUCT-SPEC.md` §6.3 states *"n < 5
       * relevant items ⇒ no stance score"* as a binding invariant, and Tier B's B5 gate
       * requires zero thin-sample stance scores at n < 5 with no per-axis exception. Restored
       * to '5'/'8', matching Reddit, until a real Substack corpus justifies moving
       * `display_floor` specifically (never `min_items`, which B5 locks).
       * **Trigger to revisit `display_floor` only:** `DEPLOY.md` MT-08 + Substack collection
       * running + 14 days; re-derive against the observed distribution.
       */
      min_items: '5',
      display_floor: '8',
    },
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'ratio_6dp_half_even',
    eligibilityRules: [
      'Fewer than `min_items` relevant items ⇒ insufficient_data, no score.',
      '`min_items`–`display_floor - 1` items ⇒ score stored, flagged low sample adequacy.',
      '`display_floor` or more ⇒ displayable without the low-adequacy flag. The comparison is against `n_eff`, not the raw item count.',
      'All-zero item weights ⇒ no_coverage_in_window, no score.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'Computed over a small, long-form-newsletter sampling frame, not a random or representative sample of any population. Sample adequacy measures how much material was available, not how likely the result is to be correct.',
      'No author-follower weighting, in the PoV, ever.',
      '`unclear` and sarcasm items contribute zero direction and remain in the diagnostics rather than being excluded.',
      'The `min_items` floor of 5 is the same on every axis (a locked product invariant, §6.3/B5); `display_floor` is not yet measured against a real Substack corpus — see the assumption comment in analytics/registry.ts.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/social.stance_substack.json'],
    stalenessMinutes: 360,
  },

  {
    id: 'news.sentiment',
    version: '1.0.0',
    title: 'News sentiment (entity-tagged)',
    subjectKind: 'security',
    unit: 'sentiment_unit',
    symbolicFormula:
      'shrunk_news = [sum(news_weight_i·entity_sentiment_i)/sum(news_weight_i)] · n/(n+5), news_weight_i = relevance_i·1·exp(-age_hours_i/48)',
    officialAssumptions: {
      /** F-08: Marketaux's free tier caps at 3 articles per request. */
      min_articles: '3',
    },
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'ratio_6dp_half_even',
    eligibilityRules: [
      'Fewer than `min_articles` entity-tagged articles ⇒ insufficient_data, no score (F-08).',
      'All-zero article weights (zero relevance throughout) ⇒ no_coverage_in_window, no score.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'Entity sentiment only, for the resolved ticker — not article-level tone applied to every company the article mentions.',
      '`source_weight_i` is fixed at 1 for every publisher until a documented quality methodology and an evaluation dataset exist. A publisher-quality weight without those would be a made-up number.',
      "Marketaux's free tier caps at 3 articles per request, which is also this method's abstention floor — the two facts are the same limit, not a coincidence.",
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/news.sentiment.json'],
    stalenessMinutes: 360,
  },

  {
    id: 'price.regime',
    version: '1.0.0',
    title: 'Price regime (trend strength)',
    subjectKind: 'security',
    unit: 'trend_unit',
    symbolicFormula:
      'trend_strength = clamp((0.6·r_5 + 0.4·r_20) / max(vol_20/sqrt(252), 0.005), −3, 3) / 3',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'ratio_6dp_half_even',
    eligibilityRules: [
      'Exactly 21 declared closes are required, no more and no fewer. Fewer (a newly-listed security, or a collection gap) is insufficient_data, not a computation attempted on a short window. Found by lane-review: this abstention path existed in code before it existed in this list. More is also insufficient_data — this method reads a fixed positional window, so a caller handing in a full price history would silently compute over a stale window rather than the current one; found by a second lane-review pass.',
      'Every close in the 21-session window must be tagged `adjusted_close`. A series tagged any other quote kind is not_applicable — mixing intraday and close-to-close returns in one metric is a registry-level prohibition (§8.4).',
      'Every close must be a positive price. A zero or negative close is not_applicable.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'Labels (positive ≥ 0.35, negative ≤ −0.35, otherwise neutral) describe the trend as computed, not a forecast of what the trend does next.',
      'The 0.6/0.4 blend of the 5- and 20-session returns and the volatility floor of 0.005 are transcribed exactly from source §8.4 and are not tuned.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/price.regime.json'],
    stalenessMinutes: 1440,
  },

  {
    id: 'price.volatility_20',
    version: '1.0.0',
    title: '20-session annualised volatility',
    subjectKind: 'security',
    unit: 'ratio',
    symbolicFormula: 'vol_20 = stdev(daily_returns over 20 sessions) · sqrt(252)',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'ratio_6dp_half_even',
    eligibilityRules: [
      'Exactly 21 declared closes are required, no more and no fewer. Fewer is insufficient_data, not a computation attempted on a short window. More is also insufficient_data — this method reads a fixed positional window, so more than 21 would silently compute over a stale window rather than the current one.',
      'Every close in the 21-session window must be tagged `adjusted_close`.',
      'Every close must be a positive price.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'Population standard deviation (n denominator), not sample (n − 1) — the 20-session window is treated as fully observed rather than as a sample of a larger population. See calc/stats.ts.',
      'The same figure `price.regime`\'s `trend_strength` divides by; registered once rather than under a second `technical.*` id, so the two never silently diverge (F06 decision).',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/price.volatility_20.json'],
    stalenessMinutes: 1440,
  },

  {
    id: 'market.sector_breadth',
    version: '1.0.0',
    title: 'Sector breadth',
    subjectKind: 'market',
    unit: 'score_unit',
    symbolicFormula: 'sector_breadth_score = 2 · (positive_sector_etfs / sector_etfs_with_data) − 1',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'ratio_6dp_half_even',
    eligibilityRules: ['At least one sector ETF must have reported data this cycle.'],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'Sector ETF proxies stand in for the sectors they track; a proxy is not the sector itself.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/market.sector_breadth.json'],
    stalenessMinutes: 1440,
  },

  {
    id: 'market.composite',
    version: '1.0.0',
    title: 'Market composite',
    subjectKind: 'market',
    unit: 'score_unit',
    symbolicFormula:
      'market_score = weighted_mean(news_sentiment: 0.35, price_regime: 0.30, sector_breadth_score: 0.25, sampled_retail_stance: 0.10), renormalized over whichever components are present',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'ratio_6dp_half_even',
    eligibilityRules: [
      'A component with inadequate coverage is omitted from the input set entirely, never supplied as zero.',
      'Weights are renormalized over whichever components are present; the artifact records which participated in each contributing step.',
      'At least one component must be present, or the composite is no_coverage_in_window.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'Labels (positive ≥ 0.35 … negative ≤ −0.35) describe today\'s renormalized composite. A composite computed over three components is not comparable to one computed over four — check which participated before comparing two days.',
      // Deliberately not naming the forbidden phrases here: this text reaches the Inspector via
      // `limitations[]` (`services/inspector.ts`), and quoting them would put the banned
      // vocabulary itself in front of a user, in the one sentence that exists to say it never
      // is. Found by lane-review.
      'No trade recommendation, market-direction call or probability language attaches to this or any composite label.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/market.composite.json'],
    stalenessMinutes: 1440,
  },

  {
    id: 'market.divergence_state',
    version: '1.0.0',
    title: 'Divergence state',
    subjectKind: 'security',
    unit: 'state_code',
    symbolicFormula: 'divergence_state = classify(attention_direction, social_direction, price_direction), source §8.6',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'int_0dp_half_even',
    eligibilityRules: [
      'Always computable from three already-classified direction codes — this method aggregates, it does not classify (F06 §2 scope).',
      'A combination the source table does not name resolves to `no_clear_pattern` rather than a nearest-guess state.',
    ],
    failureBehaviour: 'clamp',
    externalComparator: null,
    limitations: [
      'A categorical state, encoded as an integer for the artifact\'s decimal `result` — see analytics/divergence.ts for the code-to-state mapping.',
      'Causality is unproven in every state this method can return; the disclosure line on every artifact says so explicitly.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/market.divergence_state.json'],
    stalenessMinutes: 1440,
  },

  {
    id: 'technical.rsi_14',
    version: '1.0.0',
    title: 'Relative strength index (14-session)',
    subjectKind: 'security',
    unit: 'index_point',
    symbolicFormula: 'RSI_14 = 100 − 100 / (1 + mean(gains_14)/mean(losses_14))',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'pct_2dp_half_even',
    eligibilityRules: [
      'Exactly 15 declared closes are required, no more and no fewer. Fewer is insufficient_data, not a computation attempted on a short window. More is also insufficient_data — this method reads a fixed positional window, so more than 15 would silently compute over a stale window rather than the current one.',
      'Every close in the 15-session window must be tagged `adjusted_close`.',
      'A window with no losing session reports RSI 100 rather than dividing by zero; a flat window (no change at all) reports the conventional neutral reading, 50 — this is `clamp`, and applies only once the short-window abstention above has already passed.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'Uses a simple mean of gains/losses, not Wilder\'s exponential smoothing — source names no smoothing method; this is the more auditable of the two common readings of "RSI(14)" (F06 transcription decision).',
      'Must not, and does not, call an LLM to compute this (source §8.7).',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/technical.rsi_14.json'],
    stalenessMinutes: 1440,
  },

  {
    id: 'technical.moving_average_20',
    version: '1.0.0',
    title: '20-session moving average',
    subjectKind: 'security',
    unit: 'price',
    symbolicFormula: 'MA_20 = mean(close_0 .. close_19)',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'usd_2dp_half_up',
    eligibilityRules: [
      'Exactly 20 declared closes are required, no more and no fewer. Fewer is insufficient_data, not a computation attempted on a short window. More is also insufficient_data — this method reads a fixed positional window, so more than 20 would silently compute over a stale window rather than the current one.',
      'Every close in the 20-session window must be tagged `adjusted_close`.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: ['This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.'],
    goldens: ['src/analytics/goldens/technical.moving_average_20.json'],
    stalenessMinutes: 1440,
  },

  {
    id: 'technical.moving_average_50',
    version: '1.0.0',
    title: '50-session moving average',
    subjectKind: 'security',
    unit: 'price',
    symbolicFormula: 'MA_50 = mean(close_0 .. close_49)',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'usd_2dp_half_up',
    eligibilityRules: [
      'Exactly 50 declared closes are required, no more and no fewer. Fewer is insufficient_data, not a computation attempted on a short window. More is also insufficient_data — this method reads a fixed positional window, so more than 50 would silently compute over a stale window rather than the current one.',
      'Every close in the 50-session window must be tagged `adjusted_close`.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: ['This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.'],
    goldens: ['src/analytics/goldens/technical.moving_average_50.json'],
    stalenessMinutes: 1440,
  },

  {
    id: 'technical.recent_high_20',
    version: '1.0.0',
    title: 'Recent high (20-session)',
    subjectKind: 'security',
    unit: 'price',
    symbolicFormula: 'recent_high_20 = max(close_0 .. close_19)',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'usd_2dp_half_up',
    eligibilityRules: [
      'Exactly 20 declared closes are required, no more and no fewer. Fewer is insufficient_data, not a computation attempted on a short window. More is also insufficient_data — this method reads a fixed positional window, so more than 20 would silently report the high/low of a stale range rather than the current one.',
      'Every close in the 20-session window must be tagged `adjusted_close`.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'Highest *closing* price over the window, not the highest intraday print — computed over the same adjusted-close series as the rest of technical context, never mixed with an intraday series (§8.4).',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/technical.recent_high_20.json'],
    stalenessMinutes: 1440,
  },

  {
    id: 'technical.recent_low_20',
    version: '1.0.0',
    title: 'Recent low (20-session)',
    subjectKind: 'security',
    unit: 'price',
    symbolicFormula: 'recent_low_20 = min(close_0 .. close_19)',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'usd_2dp_half_up',
    eligibilityRules: [
      'Exactly 20 declared closes are required, no more and no fewer. Fewer is insufficient_data, not a computation attempted on a short window. More is also insufficient_data — this method reads a fixed positional window, so more than 20 would silently report the high/low of a stale range rather than the current one.',
      'Every close in the 20-session window must be tagged `adjusted_close`.',
    ],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: [
      'Lowest *closing* price over the window, not the lowest intraday print.',
      'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
    ],
    goldens: ['src/analytics/goldens/technical.recent_low_20.json'],
    stalenessMinutes: 1440,
  },
] as const;

/**
 * A structural check that this file is what the checks and the binder expect, without importing
 * either of them. Keeping it here means a malformed entry fails where it was written.
 */
export const methodsShape = z.array(
  z.object({ id: z.string(), version: z.string(), goldens: z.array(z.string()) }),
);

export type MethodId = (typeof methods)[number]['id'];
