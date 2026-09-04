# UI design language — Retail Market Pulse

**Status:** Proposed — pending owner feedback on `docs/design/mockup-v1.html`. Not yet indexed
in `README.md`, `CLAUDE.md`, `04-BUILD-LOOP.md` or `06-PARALLEL-LANES.md` §7, and not yet cited
by any feature spec. Promotion to **Binding** happens in one pass together with:

- `docs/MEMORY.md` **D-39** — the design language adopted, the light/dark decision, and the
  supersession (or amendment) of source PRD §12.1's "dense, dark financial-terminal aesthetic".
- `docs/features/F23-design-system-primitives.md` — the feature that turns this document into
  `src/ui/` components, tokens and tests, per its own Definition of Done.
- Index entries in `README.md`'s read-order table, `CLAUDE.md`'s cold start, `04-BUILD-LOOP.md`
  §1, and `06-PARALLEL-LANES.md` §7's per-lane brief list (SURFACE and RNI-SURFACE only — this
  is presentation, not a contract COLLECT or SPINE need read).

Until then, treat this as a proposal a lane agent is not yet obligated to read. This document
and `docs/design/mockup-v1.html` are extracted from the same token values; a change to one
without the other is a defect in whichever drifted.

**Source:** owner-supplied reference mockup (`retailpulsemockupv4.html`, "Vital-inspired design
language"), adapted to this repository's product surfaces, invariants and copy rules. Every
worked example lives in `docs/design/mockup-v1.html`; this document states the rules those
examples follow, so a future page can be built from the rule without re-deriving it from the
mockup's markup.

## 1. Why this exists

`docs/01-PRODUCT-SPEC.md` §6 states a set of product invariants that are, in practice, UI
requirements: every aggregate shows its source, `n`, window and freshness; every deterministic
value is inspectable; a metric below threshold abstains with a stated reason rather than
rendering a zero; the three platform axes (Reddit, X, Substack — extended by RNI's own
Reddit/X separation) never blend into one stored number; every metric without a Tier D4 record
carries the §6.4 disclosure verbatim. F07, F09, F17 and F19 each restate pieces of this
independently today. This document is the one place a builder reads it once.

## 2. Tokens

Colour, radius and shadow are CSS custom properties on `:root` so a single edit here — and to
the matching block in `apps/web/app/globals.css` once F23 lands — retunes every surface.

```css
--royal:#2F3FE0; --royal-2:#1F2BB8; --royal-soft:#EEF0FF; --royal-tint:#F6F7FF;
--ink:#0F1330; --ink-2:#3C4266; --ink-3:#6F7593; --ink-4:#A6AAC2;
--bg:#FAFAFD; --panel:#FFFFFF; --line:#E6E8F2; --line-2:#F0F1F7;
--rise:#FF6B3D; --rise-soft:#FFEFE9; --fade:#2FA5C9; --fade-soft:#E8F6FB;
--bull:#1DB07C; --bull-soft:#E6F8F0; --bear:#E7453D; --bear-soft:#FDECEB;
--hold:#F2B01E; --hold-soft:#FFF6DF; --hold-ink:#A5770D;
--reddit:#FF4500; --x:#0F1330; --substack:#FF6719;
--r:16px; --r2:24px;
--sh:0 1px 2px rgba(15,19,48,.04),0 12px 32px rgba(15,19,48,.06);
--sh2:0 24px 60px rgba(47,63,224,.12);
```

**Semantic roles, not decoration.** `--royal` is the one colour used for actions, links, active
navigation and model-written content labels (`Model-written · cited · verified`) — nothing else
uses it, so a user learns "blue means the system did this" once. `--rise`/`--fade` describe
**attention direction** (a name heating up vs cooling off) and are never reused for sentiment.
`--bull`/`--bear`/`--hold` describe **sentiment or health direction** (bullish/bearish/neutral,
job status, freshness). `--reddit`/`--x`/`--substack` tag which platform a fact came from and
appear only on source chips and section rules — never as a background fill large enough to read
as a status colour.

**Direction is never colour alone** (RNI `UI_SPEC.md` §12, source PRD §12.1). Every directional
value pairs an arrow or glyph with the colour: `▲` rise/bullish, `▼` fall/bearish, `●` neutral or
mixed, plain text for "no usable evidence" — see `.dir.up/.dn/.nt/.na` in the mockup. A screen
reader or a colour-blind reader gets the same information as a sighted reader scanning for
colour.

**Type.** Plus Jakarta Sans (400–800) for all UI text; Instrument Serif italic for the single
accent phrase inside an `<h1>` (`em.i`), used exactly once per page heading to mark editorial
voice — never for body copy, never for more than a few words. Tabular numerals throughout
(`font-variant-numeric: tabular-nums`) so a column of numbers aligns.

| Role | Rule | Example |
|---|---|---|
| Page title | 34px/800, −0.03em, Instrument Serif accent on the last clause | `h1` |
| Lede | 15px, `--ink-2`, max 76ch | `.lede` |
| Section heading | 16px/700, label + right-aligned caption | `h2` / `h2 span` |
| Card heading | 14–15px/700 | `h3` |
| Stat value | 30px/800, tabular | `.stat b` |
| Body / table | 12.5–14px | default |
| Caption / coverage line | 11–12px, `--ink-3` | `.cov`, `.co` |

**Shape.** 16px radius (`--r`) on cards, tags, tables-in-cards; 24px (`--r2`) on hero cards and
modals. Two shadow tiers: `--sh` at rest, `--sh2` on hover/elevated (modal, popover). A card that
is clickable gets `.hover`'s `translateY(-3px)` lift; a card that is not clickable does not.

**Grid.** 12-column card grid (`.grid` + `.c3`…`.c12`), 18px gutter. Every grid and flex track
that can hold long content is `minmax(0,1fr)`, not bare `1fr` — a bare `1fr` track lets its
content's intrinsic width push the whole grid wider than the viewport, which is what caused the
horizontal-scroll defects this document's own worked example (`mockup-v1.html`) had to fix
during verification. Below 1240px the grid collapses to one column and the research pane hides;
below 640px the top bar wraps and stat tiles go two-up.

## 3. Layout shell

```
┌ fixture-mode banner (amber, only when PROVIDER_MODE=fixture) ─────────────┐
├ top bar: wordmark · env badge · nav (grouped) · ⌘K search · freshness · role/avatar ┤
├ context bar: window · compare · scope · universe · methodology · data-through · refresh ┤
├ main content ─────────────────────────────────────┬ research pane (optional, 420px) ┤
└ footer: product disclaimer + methodology/limitations/legal links ─────────┘
```

Each region is placed on its own explicit grid row and column
(`grid-template-rows:auto auto auto 1fr`); do not rely on source-order auto-placement once a
sibling column (the research pane) exists, or a wide element will be placed into the wrong row.
The research pane is `position:sticky` under the top bar and independently scrollable.

**Navigation is grouped**, not flat, once a product has more than about six top-level surfaces
(RNI's own IA already asks for three groups — Research / Evidence / Governance): a `<span
class="grp">` label between clusters of nav buttons, hidden below ~1700px where the grouped nav
itself hides behind the page-level nav collapse.

**Global search** (`⌘K`) resolves a ticker or company name locally — no provider call per
keystroke (`GET /api/search` reads the local security master) — or, if the query does not look
like a ticker, opens it as a research question. Suggestions show what kind of result each row is
(`Ticker`, `Theme`, `Explorer`) so a user is not surprised by where Enter takes them.

**The context bar** only shows on pages whose numbers depend on a window/comparison/scope
(Radar, Security, Themes) — hide it via a class toggle on pages where it has nothing to say
(Runs, Settings, Method), rather than showing it disabled.

## 4. Component inventory

Left column is the mockup's CSS class or DOM pattern; middle is the equivalent already merged
under `apps/web/src/ui/`; right is what F23 should add. A component already merged is the
**source of truth for behaviour** — the mockup's version is illustrative HTML, not a spec that
overrides a shipped component's props.

| Mockup pattern | Shipped (`apps/web/src/ui/`) | F23 should add |
|---|---|---|
| `.stat` tile | — | `StatTile` |
| `.card`, `.card.hover` | — | `Card` |
| `[data-inspect]`, drawer | `InspectableMetric.tsx`, `CalculationInspector.tsx` | wire `InspectableMetric` to open `CalculationInspector` as a drawer, not only a page |
| `.tag`, `.dir` | — | `Tag`, `DirectionLabel` (glyph + colour, never colour alone) |
| `.cov` coverage line | `CoverageLabel.tsx` | reuse as-is |
| freshness pill / `.only-stale` etc. | `FreshnessBadge.tsx` | extend states to RNI's `Current/Delayed/Stale/Refreshing/Failed/Partial` |
| `.banner.warn/.bad/.info`, `DegradedPanel` | `DegradedPanel.tsx` | generalise beyond the three hardcoded provider labels |
| `.abst` abstention block | `InspectableMetric`'s `data-abstained` branch | `AbstentionNotice` for abstentions not attached to a single metric (e.g. a whole card) |
| `.disc` / `.disc.q` disclosure line | `DivergencePanel.tsx`'s verbatim §6.4 render | `DisclosureLine` primitive taking the exact string as a prop, never composed in the component |
| `.cite` + popover, evidence modal | `EvidenceDrawer.tsx` (native `<details>`) | `SourceChip`/`CitationChip` for inline numbered citations distinct from the evidence list |
| `.src3` three-source cards | — (F09's `StanceAxisPanel.tsx` is the closest analogue) | `PlatformSummaryCard` (Reddit / X / Combined, RNI's required heading set) |
| `.dims` four-dimension row | — | `DimensionRow` (Stock/Company/Trading intent/Theme — see §7 on the naming conflict) |
| `.composer` + `.steps` | — | `ResearchComposer`, `ResearchProgressTimeline` (8 named steps, F11) |
| `.tbl table`, sortable header | `AttentionTable.tsx` | generalise into `DataTable` with the same sort-by-magnitude and caption conventions |
| `.mock` controls widget | — | dev-only, not shipped |
| architecture SVG, step controls | — | `ArchitectureFlowDiagram`, `ArchitectureStepController` (F17) |
| `.slider`, `.stepper` (draft→activate) | — | `AssumptionSlider`, `VersionStepper` (F15) |

## 5. State matrix

Every surface that renders a computed value must be able to render each of these without a
special case per page. Reuse the mockup's data-state pattern (`body[data-st]` + `.only-*` /
`.not-*` utility classes) only as a **preview harness for design review** — production state is
driven by real service output, never a client-side class toggle.

| State | What it means | Rendered as |
|---|---|---|
| Fresh | value computed within its refresh window | value + `FreshnessBadge` "fresh" |
| Stale | last refresh failed; a prior value exists | value + `FreshnessBadge` "stale" with the `as of {time}` marker — **never suppressed** |
| Degraded | a named provider is unavailable this cycle | `DegradedPanel` naming the provider and what is missing; unaffected values still render |
| Insufficient / abstained | below the method's minimum sample | a stated reason, never a zero or a dash (`InspectableMetric`'s `data-abstained`) |
| Empty / cold start | nothing computed yet | names the depth so far ("Day 3 of history"), not a blank page |
| Partial (cross-source) | one of two independent sources unavailable | the available source stays visible; the combined view is labelled `Partial — {source} unavailable`, never silently re-labelled as a full combination and never a fallback |
| Retracted | an operator marked a run invalid | visible everywhere the run renders; nothing is deleted |

**A rule that generalises all seven:** the UI never manufactures information it does not have.
An omitted composite component is a visibly different row, not a hidden one at the official
weight. A missing platform is a labelled gap, not an average of what remains. A dash and a
measured zero must never look identical.

### A collision this document's own worked example found and how it is avoided

Utility classes that gate visibility by state must be defined by **what state hides them**, not
by what state they are "normally" shown in. `mockup-v1.html` originally used a single
`.not-cold` class (visible in mature, degraded and stale) as if it meant "the default value,"
paired with `.only-degraded` and `.only-stale` siblings meant as *overrides* — but because
`.not-cold` does not exclude degraded or stale, both spans rendered at once (`"noneX down"`,
duplicated "Current" and "Stale" tags in the same cell). The fix was two more precise classes,
`.not-degraded` and `.not-stale`, used wherever a value has exactly one state-specific
alternative:

```css
body[data-st="cold"] .not-cold{display:none!important}
body[data-st="degraded"] .not-degraded{display:none!important}
body[data-st="stale"] .not-stale{display:none!important}
```

The general principle for any future state-gated markup: name the gating class after the one
state it disappears for, not after the state you were picturing when you wrote it.

## 6. Copy rules

Every rule below is already enforced by `apps/web/scripts/checks/copy.ts`, extended by
`INTEGRATION_PLAN.md`'s RNI heading exception; this section exists so a designer or a builder
does not have to read the check to know what it will flag.

**Banned unconditionally**, in any user-facing string: `signal`, `strong buy`, `risk-on`,
`consensus`, `Reddit sentiment` (except as the standalone RNI section heading, see below),
`all Reddit`, `Reddit-wide`, `retail sentiment`, `live X sentiment`, `guaranteed`,
`will outperform`. Use **state** or **pattern** where "signal" would go; name the sampling frame
instead of implying a census.

**Predictive vocabulary** — `forecast`, `predicts`, `predicted`, `expected return`,
`probability`, `outperform`, `underperform`, `price target`, `target price` — is allowed only on
a metric that carries a Tier D4 record (its information coefficient, Newey–West t-statistic,
sample period and a link to the versioned backtest). No metric in the product carries one today,
so these words appear nowhere in shipped copy except inside the disclosure line itself, which
uses "forecast" to say the product is not one.

**The three RNI section headings are a narrow, deliberate exception** to the "Reddit sentiment"
ban: `Reddit sentiment`, `X sentiment` and `Combined summary` are required, verbatim, as
standalone headings under `app/(rni)/**` or `src/rni/ui/**` — and *only* there, and *only* as the
entire text of the heading. `"Reddit sentiment is bullish"` still fails; the exception is for the
label, never for a sentence built around it.

**Required, verbatim, wherever it applies:**

- The §6.4 disclosure, wherever a divergence state renders or a metric has not passed Tier D4:
  > This is a description of what is currently observable. It has not been tested against
  > historical returns and is not a forecast.
- RNI's own disclosure, on the landing surface and in the footer:
  > Retail discussion is noisy opinion. Reddit and X coverage may be incomplete and differ.
  > Findings are research leads, not investment advice.
- `observed Reddit sample` (coverage-limited) on every attention surface; `sector proxy` on the
  sector grid; `coverage begins {date}` on every historical view, per axis where the axes started
  on different dates.

**Every aggregate names its source, its `n`, its window and its freshness** (`CoverageLabel` +
`FreshnessBadge`) — this is not decoration, it is the line between an honest product and a
misleading one, and it is a Definition-of-Done item on more than one feature.

**Interaction copy avoids bare confirmations.** A destructive-looking or costly action names its
own scope in the verb — `Pause 3 news jobs`, `Discover 503 securities since 06:28` — never a
context-free `Confirm`. Every such action previews scope, estimated calls and cost, and the
config version it will run against, before the user commits to it.

## 7. Open naming conflicts this document does not resolve

Two vocabularies in the frozen RNI contract disagree with the prose specs that describe the same
concepts. The mockup makes one choice in each case and flags it; resolving them is Phase B work
(a `MEMORY.md` decision, then a two-line rename in the RNI contract or its consumers — whichever
is cheaper once it is someone's actual PR).

- **Dimension labels.** Every prose document (`UI_SPEC.md`, `PRD.md`, `INTEGRATION_PLAN.md`) says
  *Stock / Company / Trading intent / Theme*. The frozen `RniDimensionKey` enum says
  `company_fundamentals | market_trading | catalyst_event | retail_narrative`. The mockup uses
  the prose labels everywhere a person reads them, and assumes a display-label mapping will sit
  between the enum and the UI rather than the enum's own identifiers ever reaching a screen.
- **Freshness vocabulary.** `UI_SPEC.md` §8.1 says *Current / Delayed / Stale / Refreshing /
  Failed / Partial*. `DATA_MODEL_AND_LINEAGE.md`'s `freshness_state.status` says
  *FRESH / AGING / STALE / UNKNOWN / FAILED*, and the frozen `RniPlatformSlice.status` says
  *pending / running / complete / partial / failed / unavailable*. The mockup renders the
  §8.1 vocabulary as the one a user actually sees, treating the other two as internal state
  names a display layer translates from.
- **`FORECAST` claim type.** `evidence_claim.claim_type` includes `FORECAST`, but the word
  "forecast" is banned in user-facing copy outside the disclosure line. The mockup renders this
  claim type's display label as **Future claim** rather than the enum's own name.

## 8. Charts

Plotly is approved for this product (owner decision, 2026-09-04) — it is not blocked by
`check:bundle` (a secret-leak scan, not a size budget) and is acceptable in production subject to
two rules that are non-negotiable regardless of library:

1. **Every chart carries a text or tabular equivalent** (`<details class="alt">` in the mockup),
   not merely alt text on the container — RNI `UI_SPEC.md` §12 and source PRD §12.1 both require
   this, and it is the only way a screen-reader user or a `prefers-reduced-motion` user gets the
   same information.
2. **A coverage gap is a gap**, never interpolated across (D-16, F22 §4.4). A time series with a
   missing run renders as a broken line with the gap labelled, not a smooth curve through it.

Load Plotly (or any chart library) as a deferred client island, not blocking First Contentful
Paint — the F19 performance budgets (dashboard <2s p95) assume this. If the library fails to
load (offline, a blocked CDN, a strict CSP), degrade to the table equivalent automatically rather
than showing a broken chart — `mockup-v1.html`'s `draw()` function does this by checking
`typeof Plotly === 'undefined'` before attempting to render.

## 9. Accessibility

- WCAG 2.2 AA contrast (4.5:1 text) as the floor, not the target.
- Direction, freshness and confidence are never conveyed by colour alone (§2).
- Every interactive control (drawer, modal, tab, sort header) is keyboard-operable with visible
  focus (`:focus-visible`), and a drawer/modal traps focus and returns it on close.
- `aria-live="polite"` on research progress; token-by-token generation is never exposed as a
  live region.
- `prefers-reduced-motion` disables the architecture diagram's flow animation and the freshness
  pulse; both remain usable via the step controls without the animation.
- A drawer on desktop is a bottom sheet on narrow viewports, not a full-screen takeover with no
  way back to context.

## 10. Responsive rules

- Below 1240px: research pane hides, 12-column grid collapses to one column, grouped nav hides.
- Below 640px: top bar wraps, stat tiles go two-up, the context bar's pills wrap rather than
  scroll, evidence rows stack.
- No page may produce horizontal scroll at 390px width. Verified in `docs/design/mockup-v1.html`
  by rendering every page × every data state in headless Chromium at 1440 and 390px and asserting
  `document.documentElement.scrollWidth` does not exceed the viewport — the same check should
  gate F23's components in Playwright.
