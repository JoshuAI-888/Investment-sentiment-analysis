# 2026-09-03 — repository flatten and archive

**Lane:** — (coordinator) · **Agent:** cleanup session

Owner asked for the repository to be cleaned up: irrelevant documents archived, only
build-relevant documents kept, the package lifted out of `barebones/`, and the tree prepared for
the build. Four clarifying questions answered — see `../../MEMORY.md` **D-25**.

**Structure now:**

```
/
  README.md  CLAUDE.md  .gitignore  .gitattributes
  .claude/agents/    lane-build · lane-verify · lane-review
  docs/              the spec package, SPEC-REVIEW.md moved in
  archive/           finsent · approach-comparison · the old root README
```

**Done:**

- `barebones/docs/` → `docs/`; `barebones/README.md` → `README.md`; `SPEC-REVIEW.md` →
  `docs/SPEC-REVIEW.md`. All moves via `git mv`, so history is intact.
- finsent archived whole at `archive/finsent/` — `src`, `jobs`, `conf`, `app`, `notebooks`,
  `tests`, its `docs/`, `pyproject.toml`. **Not deleted:** D-18 ports its evaluation harness
  into F12, and `archive/README.md` says so where someone would be tempted.
- Approach comparison and its site archived; `.github/workflows/pages.yml` deleted, so the
  published page is no longer served.
- Every relative reference re-depthed and audited — 0 unresolved links across the package.
  Two pre-existing broken links fixed (`04-BUILD-LOOP.md` and `05-TEST-STRATEGY.md` pointed at
  `../MEMORY.md`), plus one introduced by the D-24 rewrite in `PROGRESS.md`.
- `DEPLOY.md` MT-01 marked resolved, keeping its one surviving item: branch protection on
  `main`, which cannot be set until F01's CI check exists.
- Root `.gitignore` restored — the archived one was finsent's, and its removal would have
  stopped `.env` being ignored.

**Not done, deliberately:** no F01 scaffolding. There is still no `apps/web/`, no
`package.json`, no CI. F01 starts from this tree as its own PR.

**Next:** `DEPLOY.md` MT-13 (file the Reddit application — longest lead in the plan), then F01.
