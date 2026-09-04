# 2026-09-03 — parallel-lane split

**Lane:** — (coordinator) · **Agent:** lane-split session

Owner asked whether the package was build-ready, whether it had a working loop, and how the
work could be split across parallel builders. Assessment: spec-ready, not scaffold-ready
(`barebones/` was documentation only); the loop was sound but single-agent, and its selection
input had two defects.

**Changed:**

- **State split for concurrent writers (D-24).** `PROGRESS.md` had two guaranteed merge
  conflicts under any parallel topology — the `Last updated`/`Updated by` header line, which
  every merge rewrote, and the session-log tail, which every session appended to. Both are
  gone: the header line is deleted (git log is authoritative and cannot conflict) and the log
  is one file per session under `progress/log/`. Per-merge feature state moved into three
  single-writer lane files.
- **F16a made selectable.** The roadmap and `features/F16-scheduler-dispatcher.md` §0 split
  the dispatch core into Wave 1, but `PROGRESS.md` still carried one `F16 · Wave 4 · blocked`
  row. The loop's SELECT step reads that table, so it could never have picked up the Wave 1
  half — the half the collector depends on. F16a and F16b are now separate rows in
  `progress/collect.md` and `progress/surface.md`.
- **Branch corrected.** `04-BUILD-LOOP.md` §7 named `claude/spec-driven-agentic-plan-tm44an`;
  that branch is merged and the designated branch is `main`.
- **F-11 reconciled, not overridden.** Three lanes running from F01 would have contradicted
  `03-ROADMAP.md`'s structural rule that Wave 1 is a single-agent walking skeleton. Rather than
  silently break a binding rule, a narrow carve-out was written scoped to F-11's own test — a
  Wave 1 lane may run early only if it consumes no domain contract F03 has not yet proven. Only
  F20's service half and F04's adapter layer qualify. Full three-lane parallelism starts at
  Wave 2, as F-11 says.
- **Parallel build protocol written** — `06-PARALLEL-LANES.md`, plus subagent definitions
  under `.claude/agents/`.

**Not changed, flagged for the owner:** the per-feature estimates in `03-ROADMAP.md` §2 sum to
roughly 272–360 h, against the §1.1 revised total of 160–210 h. The gap predates this session
and is an owner-facing estimate question, not a doc defect to patch silently.

No application code written.
