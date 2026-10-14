# Upstream QMD

QMD MCP is a maintained integration layer around the upstream `@tobilu/qmd` package. It does not vendor or mirror the complete QMD source repository.

## Current upstream baseline

- Package: `@tobilu/qmd`
- Accepted source candidate version: `2.8.3`
- Upstream project: `tobi/qmd`
- Upstream release candidate baseline: `v2.8.3`; live downstream unchanged

The exact npm dependency graph is locked in `package-lock.json`.

## Maintained patch set

`patch-qmd-bind.mjs` applies exact-match patches during image build. Each patch must match exactly once or the build fails.

The current patch set provides:

1. configurable HTTP bind host for the upstream MCP HTTP listener;
2. bind-host-aware startup logging;
3. richer health output with QMD document and embedding state;
4. export of the upstream MCP server factory so the wrapper can extend one unified tool surface;
5. a routine `query` tool with reranking disabled;
6. a separate bounded `query_reranked` tool;
7. internal-text defaults for `get` and `multi_get`, with a two-part explicit user-approval gate for resource exposure (`exposeToUser` plus `confirmUserApprovedExposure`);
8. configurable embedding maximum duration with an aligned 60-minute default;
9. filtering of model-cache `.etag` sidecars from doctor diagnostics;
10. optional embedding AbortSignal forwarding and cooperative guards around setup, preparation, retries and sequential/parallel native calls.

`admin-server.mjs` wires the HTTP/session layer, shared `maintenance-jobs.mjs` lifecycle, update-only refresh and opt-in `embedding-scheduler.mjs`. The scheduler enforces one shared cooperative deadline through the pinned SDK and native loops; already-started evaluations are awaited and incomplete vectors remain eligible. `patch-embedding-deadline.mjs` owns these exact-match upstream deltas. Behavioral tests execute the patched upstream functions with fake native contexts; they do not measure real model latency or memory.

## Update process

Dependabot proposes npm dependency updates. For a QMD update:

1. review the upstream changelog and relevant MCP/store changes;
2. update `@tobilu/qmd` and the lock file;
3. build the image;
4. inspect any exact-patch failure instead of weakening the patch guard;
5. remove patches that upstream has made obsolete rather than carrying them indefinitely;
6. run functional MCP, index-update and embedding acceptance before release.

A passing dependency-resolution step alone is not sufficient for a QMD upgrade.

## Upstreaming

Generic fixes that belong in QMD itself should be proposed upstream when practical. QMD MCP should retain only behavior that is intentionally part of this product boundary or compatibility patches needed until an accepted upstream release contains the fix.

## Upstream release already contains QM-P07 fix

The upstream doctor model-cache sidecar diagnostic was fixed
by [issue #812](https://github.com/tobi/qmd/issues/812) and
[merged PR #829](https://github.com/tobi/qmd/pull/829)
on 2026-08-12 (head e4c864d09dc86a2442d132f2110c3da9d7f7c512).
The upstream [v2.8.3 release](https://github.com/tobi/qmd/releases/tag/v2.8.3),
published 2026-08-16, explicitly identifies the etag false-positive
correction in its release notes. This reuses upstream evidence
instead of submitting a duplicate feature/fix.

The downstream still pins QMD 2.5.3, so the existing exact-match
doctor sidecar patch remains required by that old runtime.
PR merged and release included are NOT evidence that the downstream
has adopted it. Remove this patch only as part of an accepted
QMD dependency upgrade with full patched-source verifier and
representative doctor behavior regression parity. Other pinned
QMD patches may require rebaselining. No runtime update occurred.

## Existing upstream contribution: QM-P01

Upstream issue [#743](https://github.com/tobi/qmd/issues/743)
requests a configurable HTTP listen host. Existing open
[PR #583](https://github.com/tobi/qmd/pull/583) implements
CLI, environment and API host overrides and bind-aware logging.
[Comment #6102054302](https://github.com/tobi/qmd/issues/743#issuecomment-6102054302)
links the existing upstream issue and PR rather than opening
duplicate contribution work. On 2026-10-10, PR head
0f62acede19e32eb61dfeedee8f69478a24dde33 was open
against upstream main and unmerged.

The current downstream exact-match patch uses QMD_HTTP_HOST,
while upstream PR #583 uses QMD_HOST with
options.host > QMD_HOST > localhost precedence.
Source behavior aligns but the environment contract differs.
Before removing the downstream patch, require an immutable
upstream release including the change, owner-approved config
migration, representative HTTP/MCP bind tests, and tested
removal of the now-redundant exact-match patch.
An existing unmerged third-party PR is not adoption.

## Upstream text content and extensible factory submissions

QMD upstream main at 93d211f9ef4a869a9aed0d075ca767dda552627f
still returns embedded MCP resource content from get and multi_get
by default. Existing upstream
[issue #959](https://github.com/tobi/qmd/issues/959) has a compatibility
report from a text-only client. Draft
[PR #1055](https://github.com/tobi/qmd/pull/1055),
head 55103fc20574966e24a3986ba31b797e2127d88a,
implements portable text by default with separate explicit opt-in and
user-approval confirmation before user-visible resource exposure.
Dependency-free native Node assertions passed for the pure output
policy; full upstream Bun/Node CI and acceptance remain pending.

The separately maintained factory export was split from the preliminary
QM-P02 query behavior and tracked as QM-P09. Upstream issue
[#1056](https://github.com/tobi/qmd/issues/1056) and draft
[PR #1057](https://github.com/tobi/qmd/pull/1057),
head af752f5e974e435fec7bc3ac114781e7efb39ea8,
export the existing createMcpServer factory without changing
the default runtime. That one-line patch needs upstream API
maintainer approval; full upstream CI was not run.

Both source contributions are unmerged and not proven released.
The pinned QMD 2.5.3 downstream build still retains exact-match
patches and runtime behavior; no upgrade or release is authorized.

## Upstream HTTP health counters

The generic health-counter behavior was split from the preliminary
QM-P04 source-path cache behavior into QM-P10. Existing QMD HTTP
/health response at upstream main 93d211f9ef4a869a9aed0d075ca767dda552627f
returns only status/uptime; upstream
[issue #1058](https://github.com/tobi/qmd/issues/1058) and draft
[PR #1059](https://github.com/tobi/qmd/pull/1059),
head 1388035732c0240a04cef4000818f45953ee696e,
add document and needsEmbedding counters from the canonical store status,
plus explicit upstream test assertions. Maintainer review and full
upstream CI are still pending; no QMD downstream release or production
deployment changed.

## Upstream embedding duration already shipped

An upstream feature overlapping QM-P05 exists and must not receive
a duplicate proposal. [Issue #673](https://github.com/tobi/qmd/issues/673)
is served by [merged PR #708](https://github.com/tobi/qmd/pull/708),
commit 962fa6e870c6404bdad73b89ca7aa5eb183bfc23:
QMD exposes an embedding timeout override with validated options;
the capability is included in the official
[v2.8.3 release](https://github.com/tobi/qmd/releases/tag/v2.8.3).
This has been split into QM-P11 so the remaining QM-P05 tracks only
unresolved cooperative abort forwarding and incomplete-vector semantics.
Our maintained QMD wrapper still pins 2.5.3 and has **not**
adopted this upstream release; patch removal requires a separately
accepted QMD upgrade and parity verification.

## Machine-readable downstream patch register

This inline register is the product-owned logical-patch projection used by SDLC-09 structural verification. Its state does not replace current GitHub issue/PR verification, an actual upstream-compatible tested diff, or any required operator-approved product ADR. Unlinked rows are explicitly nonconformant; no historical fork behavior has been grandfathered. Cross-product integration and release actions remain gated separately. Patch scope and local commit mappings require further semantic review before external contribution.

<!-- SDLC-UPSTREAM-REGISTER:1 -->
```json
{
  "schema_version": 1,
  "upstream": "tobi/qmd",
  "baseline": "v2.8.3",
  "patches": [
    {
      "id": "QM-P02",
      "kind": "upstream",
      "scope": "Routine query without reranking, bounded query_reranked and unified query tool surface",
      "local_commits": [
        "45efce0",
        "0e9f4d7"
      ],
      "checked_on": "2026-10-14",
      "issue": "https://github.com/tobi/qmd/issues/1066",
      "pr": "https://github.com/tobi/qmd/pull/1067",
      "pr_state": "open",
      "pr_head_sha": "f803ecbcad72115dd5ef390137438dc2d514fb96"
    },
    {
      "id": "QM-P03",
      "kind": "upstream",
      "scope": "Explicit user-approval requirement for resource exposure",
      "local_commits": [
        "ad5a596"
      ],
      "checked_on": "2026-10-13",
      "issue": "https://github.com/tobi/qmd/issues/959",
      "pr": "https://github.com/tobi/qmd/pull/1055",
      "pr_state": "draft"
    },
    {
      "id": "QM-P04",
      "kind": "upstream",
      "scope": "Configured source-relative-path handoff metadata with canonical stored spelling and root containment; obsolete reverse-lookup cache removed",
      "local_commits": [
        "45efce0",
        "5770753"
      ],
      "checked_on": "2026-10-14",
      "issue": "https://github.com/tobi/qmd/issues/1068",
      "pr": "https://github.com/tobi/qmd/pull/1069",
      "pr_state": "open",
      "pr_head_sha": "8c0d4de14e4e1cc166bcdd25205fb0f5b720d552"
    },
    {
      "id": "QM-P05",
      "kind": "upstream",
      "scope": "Retained incomplete-vector checkpoint/resume behavior, requiring partition-aware upstream completeness and migration compatibility",
      "local_commits": [
        "e44b2f4",
        "d31e67e",
        "d5272ef"
      ],
      "checked_on": "2026-10-14",
      "issue": "https://github.com/tobi/qmd/issues/1064",
      "pr": "https://github.com/tobi/qmd/pull/1065",
      "pr_state": "open",
      "pr_head_sha": "ca92b902b750a89604750fa749fd8df238782526"
    },
    {
      "id": "QM-P06",
      "kind": "upstream",
      "scope": "Serialized optional maintenance and embedding scheduler with bounded recovery",
      "local_commits": [
        "b979fe7",
        "84f7c0c",
        "12e93c5"
      ],
      "checked_on": "2026-10-14",
      "issue": "https://github.com/tobi/qmd/issues/1070",
      "pr": "https://github.com/tobi/qmd/pull/1071",
      "pr_state": "open",
      "pr_head_sha": "2b72a730c8d53849533332ff0a7d469c5820096e"
    },
    {
      "id": "QM-P08",
      "kind": "upstream",
      "scope": "Native ARM64 and source maintenance distribution packaging",
      "local_commits": [
        "23f6d84",
        "b81ed59"
      ],
      "checked_on": "2026-10-10",
      "issue": null,
      "pr": null
    },
    {
      "id": "QM-P09",
      "kind": "upstream",
      "scope": "Export upstream createMcpServer factory for integrated MCP wrapper extensions",
      "local_commits": [
        "45efce0"
      ],
      "checked_on": "2026-10-13",
      "issue": "https://github.com/tobi/qmd/issues/1056",
      "pr": "https://github.com/tobi/qmd/pull/1057",
      "pr_state": "draft"
    },
    {
      "id": "QM-P10",
      "kind": "upstream",
      "scope": "HTTP /health includes document and pending-embedding status counters",
      "local_commits": [
        "45efce0"
      ],
      "checked_on": "2026-10-13",
      "issue": "https://github.com/tobi/qmd/issues/1058",
      "pr": "https://github.com/tobi/qmd/pull/1059",
      "pr_state": "draft"
    },
    {
      "id": "QM-P12",
      "kind": "upstream",
      "scope": "SDK AbortSignal forwarding, caller-local native evaluation admission, cooperative batch cancellation and listener cleanup",
      "local_commits": [
        "e44b2f4",
        "d31e67e",
        "d5272ef"
      ],
      "checked_on": "2026-10-14",
      "issue": "https://github.com/tobi/qmd/issues/1061",
      "pr": "https://github.com/tobi/qmd/pull/1063",
      "pr_state": "draft",
      "pr_head_sha": "ee367f6eae346d5db784d3d44658e3e96af82435"
    }
  ]
}
```

## Convergence lifecycle

Verify existing upstream issues and PRs, current default-branch equivalence, and source-owned regression evidence before submitting missing contributions. A PR that is closed without merge is nonconformant, and a merged PR is not automatically present in an immutable official release. Remove a downstream patch only on a tested candidate against a suitable released upstream artifact. Retire the fork only after verified patch elimination, accepted distribution/ADR disposition, rollback readiness, consumer parity, and separate operator approval for production/retirement.


## SDK embedding cancellation contribution — 2026-10-14

QM-P12 is the SDK/batch cooperative-cancellation slice formerly grouped under
QM-P05. Issue1061 and draft PR1063 are read-back verified at exact head
73566417ff6603690d657898b30e4a3403e9ad7f against upstream
93d211f9ef4a869a9aed0d075ca767dda552627f. An already-aborted force call does
not clear vectors; later work is not admitted after abort; an in-flight batch
is awaited; the caller reason is preserved and session listeners are removed.

Four test-first regressions and independent diff review passed. The complete
Node suite covers56files/1613declared tests; affected SDK82tests and the canonical
package smoke pass under Node and Bun. Bun1.3.14 has1531observed passes,
83skips and two SQLite hard-heap fixtures that also fail before the checked
operation on the unchanged upstream source. HTTP fixtures pass in an IPv4-only
disposable namespace. These local baseline findings are explicit in the draft
PR; no fully green Bun CI, merge or release is claimed.

Evidence is retained in the SDLC09 Reach Task and
/srv/hypershell/reports/sdlc09-20261011/qmd-cancellation-1061-receipt.json.
QM-P05 remains nonconformant: the contribution does not preempt native work
already admitted inside a batch or retain partially complete document vectors
for checkpoint resume. It does not change the pinned2.5.3 runtime or the
product's own scheduler. No downstream release or deployment changed.

## Accepted released-source migration — 2026-10-13

The source candidate adopts exact npm QMD2.8.3, integrity `sha512-zjfVwrObPB618B6x8SdhlGv/tX9OxRHsbQnr5DUtBvqPK6HGQ27lM+9/BAY5okpjrHVnW56hLyDkqoTcsrVLzA==`, whose npm gitHead matches official release commit `facd35e01359e59d938bc9418e93fb9318addee3`. GitHub release `immutable=false` remains explicit; immutable candidate provenance comes from the verified npm integrity, exact source and candidate image ID `sha256:c23f2f578af3c39be90b4d869013955a224f2e817967d145a54e411e573ef64c`. No live runtime, deployment configuration, product release or version tag changed. Historical pinned2.5.3 statements above describe the pre-migration source.

The canonical product verifier passed all77 executable regression tests, patched-source syntax, exact package/native runtime and OCI labels, and all three live disposable MCP/read/update, refresh-scheduler and embedding-scheduler smoke gates. Existing MCP2025 sessions remain compatible with the released MCP2.0 server factory. Exact original filename handoff, internal-text/user-approved resource exposure, no-rerank routine query, bounded query_reranked, serialized updates, cancellation/checkpoint resume and embedding-disabled collections retain acceptance. Build prerequisites now cover native SQLite compilation on both supported source architectures; native runtime acceptance here is amd64 only. Independent static review passed. Evidence: `qmd-v283-{canonical-final,regressions-next,path-doctor,duration-red,mcp-smoke-debug}.log`; final acceptance `run-20261013T230923175199Z-2886820a6fec`, npm provenance `run-20261013T231034180916Z-eb2b9790d846`. Earlier failure receipts remain failures and explain the actual compatibility corrections.

Retired active candidate groups:
- QM-P01: upstream merged PR #677 (`fec626e2f2a61f04d9780bcfb5ee5b67e26b3d85`, merge `5e578c056aa21bc423a6e37394eb1669c6fdd9c8`) provides host options and bind-aware logging. The older unmerged PR #583 is historical partial tracking. Exact host/log source patches were removed. The wrapper preserves its existing QMD_HTTP_HOST contract through its own accepted listener; no production environment migration was needed.
- QM-P07: released merged PR #829 (`e4c864d09dc86a2442d132f2110c3da9d7f7c512`) filters real GGUF blobs. The downstream doctor patch was removed; executable adversarial sidecar-order tests retain correct diagnostics for actual invalid GGUF candidates.
- QM-P11: released merged PR #708 (`962fa6e870c6404bdad73b89ca7aa5eb183bfc23`) exposes maxDurationMs. The downstream environment-parser/default patch was removed. Manual jobs pass the validated existing60-minute configuration explicitly; scheduler calls pass the remaining shared deadline through the supported SDK option.

The obsolete reverse-lookup cache, filesystem glob and invalidation machinery were also removed: released merged PR #698 (head `5528b14abe3cc3bfef59613a2feb410c33a996c3`, literal-path commit `070147d8ab313a20ae35b02bca388c02a82d1b92`) stores original paths. QM-P04 remains active for the separate configured source-relative metadata/containment contract. Exact underscore/hyphen spelling, traversal refusal, outside-root refusal and immediate config visibility are executable tests. QM-P02 still owns the separate routine/reranked policy surface, even though upstream issue #477/merged PR #478 already exposes a generic rerank toggle; no duplicate generic feature PR is justified. Other active source patches still require their issue/PR or an operator-approved disposition. Full fork retirement and release eligibility are not claimed.

## Existing contribution acceptance completed — 2026-10-13

PR #1055 text defaults (55103fc20574966e24a3986ba31b797e2127d88a), #1057 factory export (af752f5e974e435fec7bc3ac114781e7efb39ea8) and #1059 HTTP counters (1388035732c0240a04cef4000818f45953ee696e) remain open/unmerged and now pass exact-branch TypeScript/build,110affectedMCPtests under each Node22/Bun1.3.14 and canonical package smoke for grammar assets and both runtime CLI/wrappers. PR1055 adds two passing document-content regressions per runtime. Node21/Bun25establishedMCP/native skips remain explicit. Unchanged unrelated upstream93d211acceptance is reused rather than rerun. Evidence: `qmd-pr{1055,1057,1059}-acceptance.log`, successful combined run `run-20261013T231345288073Z-5c8f2ccc4a91`. Public PR descriptions now reflect these exact gates; no full greenBunCI or upstream adoption is claimed.

PR1063 now includes native admission completion at exact head `3cd88481c00d84f1b8312fc1342a3fc9da9c6cc4`. Six new TDD regressions failed before implementation and pass after it: pre-abort, shared-setup caller isolation, preparation abort, sequential/parallel stable-position admission and session forwarding. Shared model setup does not inherit an individual caller signal; admitted evaluations are awaited. TypeScript and affected LLM/SDK/native suites pass140tests per runtime (Node37/Bun38native/model skips); canonical package smoke passes. Independent tracked+untracked diff review passed. Evidence: `qmd-native-1061-{red,green,package}.log`; publication `run-20261013T232124350701Z-8bce47f193b5` and official exact-head GitHub readback. Temporary dependency-link and wrong-source-branch attempts failed cleanly before publication; normal fast-forward integration onto the existing named contribution branch satisfied the unchanged publisher gates. QM-P05 now owns only the remaining partition-aware checkpoint/resume scope. No native preemption, partial-checkpoint support, downstream release or deployment is claimed.

QM-P05 now has upstream issue #1064 and draft PR #1065 at exact head `ca92b902b750a89604750fa749fd8df238782526`, with an explicit Closes link and true-fork/base readback. The feature is stacked on native-admission PR #1063, prerequisite `ee367f6eae346d5db784d3d44658e3e96af82435`; its own feature commit is separate. Opt-in `resume: true` retains and reuses completed chunks only for an unchanged formatted chunk plan, positions, model and fingerprint. Incomplete checkpoints are excluded before KNN selection across real partitions and metadata scopes. A synchronous read transaction prevents a concurrent first checkpoint from entering the legacy fast path. Default cleanup and complete legacy embeddings retain their behavior. This is an upstream contribution, not a released or deployed adoption.


## Unapproved distribution disposition proposal — QM-P08

This is a proposal for an operator decision, not an approved ADR or a conformance exception. The register row remains unlinked and nonconformant. Exact source candidate: `f747bb8ea70cf468588335a80fb75dd5ee42df20`; mapped historical commits: `23f6d84`, `b81ed59`. Initial/import commits can contain baseline and unrelated application files; approval must not cover the entire mapped commit merely because it appears in this row.

Proposed narrow scope: Only the standalone package identity, native-architecture container/build requirements and product verification/publication wrappers. Query semantics, source handoff, scheduler, embedding and patched upstream source remain excluded.

Requested decision: retain this precisely bounded product-owned distribution adapter, or move/remove it through the existing source/release/deployment owners when the upstream artifact supplies an equivalent accepted distribution. Our package names, registry targets and operator release controls do not constitute a useful upstream feature request; do not manufacture an issue/PR asking upstream to adopt downstream ownership. Any reusable application or verification improvement discovered in this history still needs its own tested upstream-compatible contribution.

Before an approved disposition can clear a gate, the operator-owned product ADR must identify the exact retained scope, rationale, owner, acceptance evidence and review/exit trigger. Proposed review trigger: the next suitable official upstream release or2026-11-14, whichever comes first. Exit requires equivalent released functionality and distribution, accepted source/runtime/consumer parity, rollback readiness and the existing explicit production/retirement acceptance. This proposal authorizes none of those transitions and approves no missing contribution.

The existing shared repository/release lifecycle invokes the single canonical SDLC checker before managed tag/publication/recovery transitions. Direct public workflow integration remains incomplete: the checker source is private and repository-scoped public GitHub tokens cannot read it. No production credentials, privileged public runner, second checker or extra service was introduced.

## Cancellation fixture follow-up — 2026-10-14

Existing draft PR #1063 is read-back verified at `ee367f6eae346d5db784d3d44658e3e96af82435`, still linked to issue #1061. A two-line fixture correction requires the AbortSignal already forwarded by the accepted native prerequisite while preserving strict model equality; production source is unchanged. Exactly those two existing tests pass on Node and Bun in `run-20261014T015649214748Z-04fa534cea9c`, with independent review. Publication `run-20261014T020006885826Z-187ae1c88841` succeeded and exact head/issue readback passed. Earlier unchanged native source gates remain valid. Evidence: `qmd-cancellation-1063-model-options.log` in the existing SDLC-09 report directory. No downstream release or deployment is claimed.

## Checkpoint contribution acceptance — 2026-10-14

All 11 new checkpoint regressions pass on Node and Bun, including changed plan/model/fingerprint/position/count rejection, default cleanup, lazy legacy repair, 4,100 incomplete rows beyond the KNN cap and a real two-connection publication race. Native lint, types, build and canonical package smoke pass; independent source and typed-harness reviews pass. Accepted existing store/SDK/read/metadata phases are reused. Remaining metadata cases, vector-layout migration and partition repack pass; real concurrency, helper and HTTP/daemon acceptance passes in `run-20261014T021954903207Z-c6614ad25881` (Node2 concurrency,46 helpers,22 HTTP/daemon; Bun11 HTTP with established16 skips). Disposable IPv4-only loopback and adequate bounded process limits are verifier conditions, not production changes.

One pre-existing 20,001-document metadata fixture exceeds a 1.5 GiB worker on both the feature (`run-20261014T021018111357Z-54b8628ff99d`) and unchanged prerequisite (`run-20261014T021438070658Z-354f1f62e9fb`), each with cgroup OOM evidence. It is not a new checkpoint regression or a green full-suite claim. Earlier failed worker/budget attempts are retained in evidence rather than counted as passes. Exact logs: `qmd-checkpoint-1064-{race-node-final,bun,harness-lint,remaining-node,functional-final,concurrency-http,vector-baseline}.log` under the existing SDLC-09 report directory. Source commit `ca92b902...` and managed publication `run-20261014T022411833295Z-ebcc4010c4d8` are verified, and typed GitHub readback confirms PR #1065 exact head and issue. Nine retained groups now have five complete active pairs and four structural blockers; no downstream release, production change or fork retirement is claimed.


## Verified opt-in query policy contribution — 2026-10-14

QM-P02 now has issue #1066 and draft PR #1067 at exact head
`f803ecbcad72115dd5ef390137438dc2d514fb96`, linked by Closes #1066.
This source-native proposal exposes optional `queryPolicy: "split-rerank"`
through the factory exported by prerequisite PR #1057 at
`af752f5e974e435fec7bc3ac114781e7efb39ea8`. Default factory, stdio and
HTTP behavior remain unchanged. Routine query always skips reranking;
the separate query_reranked always enables it and accepts integer
candidateLimit 1–20 with default10. Plain/typed queries, metadata,
collections, formatting and in-flight tracking remain shared.

Duplicate checks reuse issue477/mergedPR478 for the existing generic
rerank toggle. The separate enforced tool policy was not covered there
or by a current upstream PR. Typed GitHub readback confirms the exact
new fork/head, open draft state, main base and issue link.

Valid RED: run-20261014T030306834669Z-0c9e9fe354b9.
Initial10Node/type/lint GREEN: run-20261014T030353112220Z-918b8ea4cee9.
Final source/fixture review passes. The nonempty fixture line expectation
was corrected by an independent fixing context to the unchanged formatter's
first-line behavior; Bun shim-only matcher incompatibilities were also
fixed without weakening assertions. Final13Node cases are established
by unchanged12 in run031036-aad52, corrected one in run031559-850854,
and seven changed matcher cases in run031812-287158. All13Bun cases,
types, lint, build/package and35affected existing MCP/HTTP tests per
runtime pass in run-20261014T031812729912Z-287158737ad3.
ProductionSHA25633820254a4fd0c8b0f3e741d0b708c734bae12c4d3bea0eed3d171c34021482c;
fixtureSHA256e6c32c2643c4c30e9d861917008255b06f679dc514ce9978f083565d0d712015.
No full-project suite claim. Existing reports qmd-query-policy-1066-*.log
retain failures and accepted phases.

Verified commit run032045-89a00; managed publication
run-20261014T032102859560Z-875c86e039f7 succeeds at the same head.
Current QMD register has9retained groups,6complete pairs and3remaining
structural blockers. No downstream dependency/source adoption, own
release, production change or patch retirement is claimed.


## Verified source handoff contribution — 2026-10-14

QM-P04 now has issue #1068 and draft PR #1069 at exact head 8c0d4de14e4e1cc166bcdd25205fb0f5b720d552, Closes #1068 verified by current GitHub API. This opt-in sourceRoot factory option adds collection and source_relative_path to either query variant. Current registered collection configuration is read directly without document statistics or a reverse-lookup cache. Original filename spelling is preserved; unknown/absolute/traversal/outside-root mappings return no usable path. Metadata is lexical only: no file access, symlink resolution, freshness or authorization claim. Default callers and result shape remain unchanged. It is stacked on factory #1057 and query-policy #1067, with an explicit prerequisite disclosure.

Fourteen strict regressions pass on Node and Bun, including six invalid mappings, collection updates, sibling-prefix containment, two-server isolation, option mutation and default absence. Types/lint pass in run-20261014T034207978747Z-ad7f4339b7f5. Build and installed Node/Bun CLI/wrapper/grammar package smoke pass in run-20261014T040002153858Z-6c75cc382e45, OOMKilled=false. Production/docs/full fixture and incremental boundary reviews pass. Source SHA256 ca9fdfb067646b0e320e37546a9b8ad413cd8985a082f501080e6889c4c4c7c8; fixture cd92fb048e51665a716120822801db125b6f074be93f71aae70893148ad45722. Managed normalization035218-6494 and public source scrub035220-6d443 pass; verified commit040048-316c and managed publication040105-c8c613 succeed at the exact head. Existing accepted default compatibility and policy tests are reused. Logs qmd-source-handoff-1068-*.log remain in the existing report directory.

Current register: nine retained groups, seven complete active pairs, two structurally nonconformant groups (scheduler and unapproved distribution). No downstream source adoption, own release, deployment or patch retirement is claimed.

## Verified serialized maintenance contribution — 2026-10-14

QM-P06 now has issue [#1070](https://github.com/tobi/qmd/issues/1070) and draft [PR #1071](https://github.com/tobi/qmd/pull/1071), verified open at exact head `2b72a730c8d53849533332ff0a7d469c5820096e` in existing genuine fork X1pheR/qmd, base main, with configured Closes #1070. Typed issue readback confirms exactly that closing PR. Candidate `repos/worktrees/sdlc09-qmd-maintenance-1070` starts from checkpoint `ca92b902b750a89604750fa749fd8df238782526`; the PR explicitly discloses cancellation/checkpoint #1063/#1065 prerequisites. The new commit changes eight files, while the PR's fourteen-file diff also contains those prerequisite changes. CLI watch #646 remains a distinct scope.

The native public SDK exports one host-owned synchronous maintenance claim with bounded completed receipts, cooperative actual-completion drain, host admission/terminal/sanitization hooks and partial committed results. The optional embedding adapter defaults off and starts only explicitly; it uses that same claim, refreshed collection policy/debt/query admission, fair first-collection rotation, bounded resumable non-force native embedding and one shared monotonic deadline. The SDK forwards the existing native maxDurationMs option. No store, CLI or MCP scheduler is activated automatically; no new service, durable queue, filesystem authority or deployment is added.

Native vertical RED/GREEN covers admission reentrancy, clock/sanitizer/notification failures, shared claim/retention, dynamic sweep admission, deadline/shutdown actual drain, progress retention, budget validation, timer setup/cleanup and stop-during-host-callback races. Final 67 cases pass on both Node and Bun with types/lint in `run-20261014T073217657442Z-54db89fab7e2`; exact owned workers are removed in `run-20261014T073241387819Z-018a6c7a467d`. Six affected fake-LLM duration/batch/cancellation cases pass on both runtimes in `run-20261014T070453883487Z-fb3cb3caa3e2`. The overbroad model-backed SDK attempt OOMed loading an unrelated model; full model-suite acceptance is not claimed.

Public-export RED `run-20261014T072950411438Z-c4cf099995af` fails the missing SDK entry; GREEN `run-20261014T073009771594Z-4021a6af8a77` passes both runtimes, types/lint/build. Final existing package gate plus real npm-tarball consumers pass on Node and Bun in `run-20261014T073502732315Z-891d8a26118b`, OOMKilled=false/ExitCode=0, including native grammar/CLI/wrapper checks and compiled JS/type export presence. All evidence remains in `qmd-maintenance-1070-*.log` under the existing SDLC09 reports directory.

Independent final review passes after two bounded separate fixing cycles; it verifies exact source hashes, all public exports/docs, no remaining concrete logic/security findings and no credentials/private identifiers. Maintenance source SHA256 `42002513af9c13e1db1e84be7dcafa27e3ea44c602b9a0e90577de020dd32673`; scheduler SHA256 `c07cacb2ee0a62b39ada6b62ba8bfa69335535d6b0a4a5a0993c2464c17aadd4`. Managed normalization `run-20261014T073537327248Z-cbc257beb1bc`, verified commit `run-20261014T073554684387Z-4564e9dd95ce` and exact managed publication `run-20261014T073629742821Z-176fdf50f520` pass. Typed fork branch/PR/issue API readbacks verify the exact commit/link. Upstream checks at publication show Socket Project Report success and Pull Request Alerts in progress, with no ordinary commit statuses; overall CI success is not claimed.

Current register: nine retained groups, eight complete active issue/PR pairs and one structural blocker, unapproved distribution QM-P08. No downstream source adoption, own release, deployment or patch retirement is claimed.
