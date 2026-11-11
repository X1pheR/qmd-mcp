# Upstream QMD

QMD MCP is a maintained integration layer around the upstream `@tobilu/qmd` package. It does not vendor or mirror the complete QMD source repository.

## Current upstream baseline

- Package: `@tobilu/qmd`
- Version: `2.5.3`
- Upstream project: `tobi/qmd`
- Upstream release: `v2.5.3`

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

## Machine-readable maintained patch register

This register describes the current downstream source locked to @tobilu/qmd 2.5.3, not an unaccepted 2.8.3 source upgrade. The mapped local commits are in current main; official upstream issue/PR states were checked on 2026-11-11. The separate product-owned verification and exact official artifact adoption gates still apply.

<!-- SDLC-UPSTREAM-REGISTER:1 -->
```json
{
  "schema_version": 1,
  "upstream": "tobi/qmd",
  "baseline": "v2.5.3 (locked @tobilu/qmd package)",
  "patches": [
    {
      "id": "QM-P02",
      "kind": "upstream",
      "scope": "Routine query without reranking, bounded query_reranked and unified query tool surface",
      "local_commits": [
        "45efce0",
        "0e9f4d7"
      ],
      "checked_on": "2026-11-11",
      "issue": "https://github.com/tobi/qmd/issues/1066",
      "pr": "https://github.com/tobi/qmd/pull/1067",
      "pr_state": "draft",
      "pr_head_sha": "f803ecbcad72115dd5ef390137438dc2d514fb96"
    },
    {
      "id": "QM-P03",
      "kind": "upstream",
      "scope": "Explicit user-approval requirement for resource exposure",
      "local_commits": [
        "ad5a596"
      ],
      "checked_on": "2026-11-11",
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
      "checked_on": "2026-11-11",
      "issue": "https://github.com/tobi/qmd/issues/1068",
      "pr": "https://github.com/tobi/qmd/pull/1069",
      "pr_state": "draft",
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
      "checked_on": "2026-11-11",
      "issue": "https://github.com/tobi/qmd/issues/1064",
      "pr": "https://github.com/tobi/qmd/pull/1065",
      "pr_state": "draft",
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
      "checked_on": "2026-11-11",
      "issue": "https://github.com/tobi/qmd/issues/1070",
      "pr": "https://github.com/tobi/qmd/pull/1071",
      "pr_state": "draft",
      "pr_head_sha": "2b72a730c8d53849533332ff0a7d469c5820096e"
    },
    {
      "id": "QM-P08",
      "kind": "distribution",
      "scope": "Temporary ARM64-compatible QMD MCP image version and source packaging/publication of tracked unreleased upstream fixes",
      "local_commits": [
        "23f6d84",
        "b81ed59"
      ],
      "checked_on": "2026-11-11",
      "temporary": true,
      "depends_on": [
        "QM-P02",
        "QM-P03",
        "QM-P04",
        "QM-P05",
        "QM-P06",
        "QM-P09",
        "QM-P10",
        "QM-P12"
      ],
      "exit_when": "All linked upstream patches are present in an immutable suitable official artifact; verified native Node/Bun and MCP behavior plus image, consumer and rollback parity allow retiring the own image/tag/build workflow."
    },
    {
      "id": "QM-P09",
      "kind": "upstream",
      "scope": "Export upstream createMcpServer factory for integrated MCP wrapper extensions",
      "local_commits": [
        "45efce0"
      ],
      "checked_on": "2026-11-11",
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
      "checked_on": "2026-11-11",
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
      "checked_on": "2026-11-11",
      "issue": "https://github.com/tobi/qmd/issues/1061",
      "pr": "https://github.com/tobi/qmd/pull/1063",
      "pr_state": "draft",
      "pr_head_sha": "ee367f6eae346d5db784d3d44658e3e96af82435"
    }
  ]
}
```
