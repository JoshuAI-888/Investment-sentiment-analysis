# Design — Retail Market Pulse mockup v1

**Status:** proposal for owner feedback. Nothing here is binding until `docs/MEMORY.md` records
it (the next decision id is D-39) and `../07-UI-DESIGN-LANGUAGE.md` is promoted from *Proposed*
to *Binding*. Illustrative data throughout — no number in the mockup is observed.

| File | What it is |
|---|---|
| [`mockup-v1.html`](mockup-v1.html) | One self-contained page. Open it in a browser. It loads Plus Jakarta Sans / Instrument Serif from Google Fonts and Plotly from cdnjs; offline, charts fall back to their table equivalents. |
| [`../07-UI-DESIGN-LANGUAGE.md`](../07-UI-DESIGN-LANGUAGE.md) | The design language the mockup applies: tokens, type, components, states, copy, charts, accessibility. Draft. |

## What the mockup is for

Two questions, in this order:

1. **Design.** Does the light "Vital-inspired" language from the owner's `retailpulsemockupv4.html`
   work for this product — pill navigation, serif accent words, 16/24 px radii, layered shadows,
   orange/teal for rising/fading, green/red/amber for direction, royal blue for actions and model
   output?
2. **Features.** Does the information architecture below match what the repository has planned
   and built — the RNI portal (`docs/rni/UI_SPEC.md`), the merged F07–F09 surfaces, F05's
   Inspector, F11's research states, F15's operator plane, F17's explorer?

## How to give feedback

Use the floating **Mockup controls** panel (bottom left):

- **Data state** — *Mature (day 45)*, *Cold start (day 3)*, *Degraded (X and scorer down)*,
  *Stale (refresh failed)*. Every page re-renders its honest state: hidden z-scores, `Partial —
  X unavailable`, `No stance — scorer unavailable since 04:10`, "as of 02:42".
- **Clear research session** — resets the floating research panel back to its empty state, so you
  can see both the pre-loaded example and the "nothing asked yet" placeholder.

**Research is global, not a page feature.** Click the circular ⌕ bubble, bottom-right, on any
page — it expands into the same panel (Response / Evidence / Process tabs, the composer) with an
animation, and a small badge shows on the collapsed bubble whenever there's a session to return
to. The question, the answer and which tab you were on all carry over as you navigate between
pages; only the small "scope" label in the panel's header updates to say what page you're
currently looking at. Escape, or the panel's own × button, collapses it back to just the bubble.
On narrow viewports it opens as a bottom sheet instead of a floating card. A second, page-specific
research affordance still exists on *Security → Research*: the F11 composer, with its eight named
progress steps and the *complete / running / degraded / abstained / retracted* preview — that one
is deliberately not global, since it represents a security-scoped deep-dive rather than the
ambient "ask about what you're looking at" assistant.

Click any number to open the **Calculation Inspector** drawer; any numbered citation chip to open
the **evidence modal**; any Explorer row to open the **source record** with its six tabs; any
*Refresh* or *Run now* to see the **dry-run preview**. `⌘K` focuses search.

## Information architecture in the mockup

| Nav | Represents | Source |
|---|---|---|
| Research → **Radar** (landing) | Retail Radar: summary band, cited so-what, watch cards, radar table with `Reddit sentiment` / `X sentiment` / `Combined summary` kept apart, four dimensions, attention map, themes, venue flow | `docs/rni/UI_SPEC.md` §4 |
| Research → **Security** | `NVDA — NVIDIA Corporation`: three source cards, timelines with a coverage hole, narrative lifecycle, bull vs strongest challenger, catalyst verification, breadth/concentration, research composer, and the legacy **four deterministic axes** with the divergence state | UI_SPEC §5, F09, F11 |
| Research → **Themes** | Stance matrix by security, emerging/fading, theme detail, taxonomy draft → preview → activate | UI_SPEC §6 |
| Evidence → **Explorer** | Persistence clocks per source class, evidence table, source record (captured · observations · claims · lineage · model calls · audit) | UI_SPEC §7 |
| Evidence → **Runs** | Four timestamps, six states, run list, refresh menu with scope preview, schedules with next five times | UI_SPEC §8 |
| Metrics → **Composites** | Market composite beside its components with renormalised weights, eleven sector proxies, the ApeWisdom board with NEW / THIN_SAMPLE / not_applicable | F07, F08 (merged) |
| Governance → **Evals** | Readiness, scores by task against bars, suggestions visibly separated from measurements | UI_SPEC §9, F12 |
| Governance → **Settings** | RNI: AI route, universe, sources, windows, schedules · Platform: jobs, models, costs, audit, MCP — every edit as draft → validate → preview → approve → activate | UI_SPEC §10, F15, F21 |
| Governance → **Method** | Feature cards, the real runtime as an animated flow (PoV vs Target, play/pause/step, static alternative), formula catalogue, assumptions incl. "no backtest exists" | F17 |
| **Sign in** | Email + password, first-sign-in password change | F02 (D-37, D-38) |

## Decisions the mockup takes, for the owner to confirm or overturn

| Decision | Why | Where it shows |
|---|---|---|
| Brand **Retail Market Pulse**; light theme | Owner instruction 2026-09-04 | wordmark, tokens |
| **Radar is the front door**, legacy dashboard becomes "Composites" | RNI answers the persona's first question; F07 is cut-line item 6 | nav order |
| RNI routes mocked under `/rni/…` | UI_SPEC's `/`, `/settings`, `/data` collide with existing routes; only `/api/rni/*` and the `(rni)` group are frozen | evidence deep links |
| Dimension labels **Stock · Company · Trading intent · Theme** | Every prose doc uses them; the frozen enum (`company_fundamentals`, `market_trading`, `catalyst_event`, `retail_narrative`) does not match and needs reconciling | radar, source cards |
| Freshness vocabulary **Current / Delayed / Stale / Refreshing / Failed / Partial** | UI_SPEC §8.1; the data model's `FRESH/AGING/STALE` and the slice statuses are internal | pill, runs |
| Claim type `FORECAST` rendered as **FUTURE_CLAIM** | "forecast" is predictive vocabulary under `check:copy`; the enum needs a display label | source record → claims |
| Research is a global floating bubble, not a docked pane | Owner decision, follow-up round: available on every page, collapsed by default, session persists across navigation | bottom-right FAB + expandable panel, every page |
| One universe badge (S&P 500 — FMP) with the ApeWisdom top-100 as a second versioned list | D-30 and D-RNI-06 define different universes; the mockup asks whether they merge | Settings → Universe |
| Plotly for charts, each with a table equivalent | Owner approved Plotly; a11y rule needs the table | every chart |

## Copy discipline applied

The mockup's visible text was scanned with the same list as `apps/web/scripts/checks/copy.ts`:
no *signal*, *consensus*, *strong buy*, *risk-on*, *retail sentiment*, *Reddit-wide*, *all Reddit*,
*guaranteed*; `Reddit sentiment` only as the standalone RNI heading; no predictive vocabulary
outside the disclosure line itself; the §6.4 line verbatim wherever a divergence state renders;
the RNI disclosure ("Retail discussion is noisy opinion…") on the landing page and in the footer;
"observed Reddit sample", "sector proxy" and "coverage begins {date}" present.

## Verified

- Every page × four data states renders at 1440 and 390 px with no horizontal scroll and no
  page errors (headless Chromium via Playwright; fonts and the CDN are unreachable from the build
  sandbox, so charts were checked with a local Plotly copy).
- Copy scan: 0 findings.

## What happens after feedback (Phase B)

1. `MEMORY.md` D-39: design language adopted (light; supersedes source PRD §12.1's dark terminal),
   research-pane decision, front-door decision, dimension-label reconciliation.
2. `docs/07-UI-DESIGN-LANGUAGE.md` promoted to *Binding*; indexed in `README.md`, `CLAUDE.md`,
   `04-BUILD-LOOP.md` §1, `06-PARALLEL-LANES.md` §7 and `.claude/agents/lane-build.md` for
   SURFACE and RNI-SURFACE features.
3. `docs/features/F23-design-system-primitives.md`: `next/font`, tokens in `tailwind.config.ts`
   and `globals.css`, `src/ui/` primitives (AppShell, TopBar, ContextBar, Card, StatTile, Tag,
   DirectionLabel, Table, Tabs, Drawer/BottomSheet, Toast, Sparkline, CitationChip,
   AbstentionNotice, DisclosureLine) wrapping the components that already ship (`CoverageLabel`,
   `FreshnessBadge`, `DegradedPanel`, `InspectableMetric`, `EvidenceDrawer`, `DivergencePanel`),
   with axe on every route. Not a skill: the repo enforces through reading lists and CI, not
   advisory prompts.
