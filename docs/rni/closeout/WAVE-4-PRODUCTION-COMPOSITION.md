# Wave 4 — production composition and offline G6 evidence

**Required base:** `<W3_ACCEPTED_SHA>`.

## Definition of the solution

The real production composition follows one exact manifest/lease/deadline authority chain:

```text
verify manifest and build authority
-> acquire Reddit and X independently under the approved plan
-> commit bounded source/capture/retrieval evidence
-> resolve/classify/persist per-security semantics and relationships
-> E06 platform analytics -> E07 convergence -> staged E08/I07
-> final confidence assessment -> publication decision -> atomic release
```

Provider I/O occurs outside database transactions. Fixture fallback is impossible in production.
The production factory becomes available only after the complete fake-provider pipeline and all
authority, retry, partial-state, citation, rights and release tests pass.

Wave 4 is offline engineering. It does not inspect credentials, call providers, seed/activate an
authority pack, deploy, enable schedules/heartbeat, or claim live proof.

## Execution order

1. W4-A performs a read-only dependency audit.
2. W4-B is the sole production-composition writer.
3. W4-C may use Spark only after W4-B to inventory deterministic test/evidence coverage.
4. W4-R performs independent adversarial review.
5. The coordinator resolves findings, runs full gates, creates a non-authoritative compiled
   authority-input/hash inventory, then pushes `<W4_ACCEPTED_SHA>`. The deployable pack is generated
   only in W5-B after the exact Preview deployment identity exists.

## Session W4-A — dependency audit

**Title:** `RNI W4-A — production readiness audit`
**Model:** `gpt-6-astra`
**Reasoning:** `high`

```text
Audit <W3_ACCEPTED_SHA> read-only against Waves 0–3 and the RNI contract. Confirm written owner
approval and passing integrated evidence exist for D-RNI-34, D-RNI-33, multi-security completion,
acquisition allocation/coverage, readiness receipts, confidence formulas, post-E08 gating, and both
ticker/full-universe visibility. Confirm the two excluded provisional files remain untracked and
unwired. Do not edit or run providers.

Return READY only if the existing public ports can compose the complete pipeline without inventing
policy. List exact composition interfaces and remaining gaps. If any semantic decision or required
gate is absent, return BLOCKED and identify the decision/test; do not propose a coding workaround.
```

## Session W4-B — production pipeline composition

**Title:** `RNI W4-B — non-fixture production executor`
**Model:** `gpt-6-astra`
**Reasoning:** `high`

```text
You are the RNI integration coordinator for Wave 4-B and the sole writer of integration-owned
composition roots. Start from <W3_ACCEPTED_SHA> only after W4-A returns READY. Read the full RNI
cold-start set, DEPLOY.md, OPENAI_AND_TOKEN_OPTIMISATION.md and Wave 4.

Compose the accepted public ports into the real manifest-bound production pipeline. Keep Reddit and
X acquisition, leases, coverage, errors and budgets independent. Verify exact config/model/prompt/
schema/tool/price/source/policy/build authority before effects. Keep provider I/O outside database
transactions and commit bounded source evidence before every interpretation call. Connect exact
D-RNI-34 checkpoints, multi-security semantic/relationship completion, E06, E07, staged E08/I07,
final confidence, publication decision, ticker release and D-RNI-33 full-universe atomic release.
Only the combined lease may publish.

Use deterministic fake transports only. Add success, one-platform partial/unavailable, zero-result,
comparative source, prompt injection, provider timeout, budget denial, retry/redelivery, crash after
source commit, stale/crossed manifest or lease, changed content, rights withdrawal, citation failure,
deadline, 501-member resume and atomic release tests. Prove exact replay makes no duplicate writes or
model calls. Prove production mode cannot use fixtures.

Keep getProductionRniWorkerExecutor() unavailable until the whole pipeline passes. Change it only
in the final reviewed commit when every dependency is present and tested; otherwise return BLOCKED.
Do not modify owner policy, migrations, lane-owned internals, prompts, authority values, secrets,
deployment, schedules, or excluded provisional files. Do not call providers. Run focused tests,
then RNI unit/contract/eval, serialized PostgreSQL, typecheck, lint, production build and bundle/copy
scans. Update coordinator-owned progress, commit one reviewable change, and return the handoff.
```

## Session W4-C — mechanical evidence inventory

**Title:** `RNI W4-C — G6 evidence inventory`
**Model:** `gpt-5.3-codex-spark`
**Reasoning:** `high`

```text
Perform a bounded mechanical audit of the reviewed Wave 4-B commit. Read Wave 4 and the exact test
commands/evidence already produced. Do not edit source code, choose policy, inspect credentials,
generate or approve authority contents, change migrations, deploy, call providers, or make a final
security judgment.

Create a concise report mapping every Wave 4 acceptance case to an existing test file and observed
result. Inventory touched paths, production/fixture imports, factory enablement, required authority
kinds, and any missing deterministic test. Verify no secret-like names are exposed in client bundle
or recorded output using existing repository checks. Return facts only; mark uncertain items for the
high-capability reviewer. Do not return PASS/approval.
```

If Spark is unavailable, run W4-C with `gpt-5.6-terra` at medium reasoning. Do not delay Wave 4 for
Spark; it is an efficiency aid, not an acceptance authority.

## Session W4-R — independent production review

**Title:** `RNI W4-R — production executor review`
**Model:** `gpt-6-astra`
**Reasoning:** `xhigh`

```text
Review the integrated Wave 4 commit read-only. Reject source interpretation before commit; Reddit/X
fallback, shared counts or leases; provider I/O in transactions; crossed manifest/build/policy/
price/lease/deadline authority; stale content or spans; incomplete comparative relationships;
caller-trusted release/confidence/receipt data; E08 visibility before the final gate; pre-release
citation/evidence reads; fixture fallback; replay model redispatch; rights races; non-atomic release;
stale prompt-input hashes; or credentials reaching logs/client bundles.

Re-run focused fake-provider and direct database attacks as needed. Return file/line P0/P1/P2
findings. PASS requires the complete offline gate, not plausible wiring. Do not edit, call providers,
seed, activate, deploy, or update progress.
```

## Session W4-D — compiled authority-input inventory

**Title:** `RNI W4-D — authority input inventory and G6 checkpoint`
**Model:** `gpt-5.6-terra`
**Reasoning:** `medium`

```text
You are the RNI integration coordinator completing Wave 4 after W4-R PASS. Produce only a
non-authoritative compiled inventory of the ten authority kinds and five mechanically compiled
prompt identities expected by DEPLOY.md. Record code-derived versions and hashes needed to detect
stale inputs. Do not create or label this as a deployable authority pack: no exact Preview
deployment/artifact identity exists yet. Never print values or secrets. Do not seed or activate.

Run the complete offline regression and authenticated local/fake-provider full story, including
source-to-citation navigation, independent partial states, manual idempotency, 501-member atomic
closeout, production-mode no-fixture proof, build and bundle scans. Resolve reviewer findings and
obtain re-review. Update coordinator progress accurately: code-side G6 evidence may pass, but live
G7 and G8 remain open. Commit and push <W4_ACCEPTED_SHA>; keep the non-authoritative inventory
outside Git.
```

## Wave 4 exit gate

- Complete non-fixture composition passes using deterministic provider fakes.
- Production factory is enabled only if the full accepted chain is present.
- Independent review passes and all P0/P1 findings are re-reviewed.
- A non-authoritative compiled input/hash inventory exists; no deployable pack has been generated,
  seeded or activated.
- `<W4_ACCEPTED_SHA>` is pushed. Wave 5 must start from this exact code/build identity.
