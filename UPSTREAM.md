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

## Machine-readable downstream patch register

This inline register is the product-owned logical-patch projection used by SDLC-09 structural verification. Its state does not replace current GitHub issue/PR verification, an actual upstream-compatible tested diff, or any required operator-approved product ADR. Unlinked rows are explicitly nonconformant; no historical fork behavior has been grandfathered. Cross-product integration and release actions remain gated separately. Patch scope and local commit mappings require further semantic review before external contribution.

<!-- SDLC-UPSTREAM-REGISTER:1 -->
```json
{
  "schema_version": 1,
  "upstream": "tobi/qmd",
  "baseline": "v2.5.3",
  "patches": [
    {
      "id": "QM-P01",
      "kind": "upstream",
      "scope": "Configurable upstream HTTP bind host and bind-aware startup logging",
      "local_commits": [
        "45efce0"
      ],
      "checked_on": "2026-10-10",
      "issue": null,
      "pr": null
    },
    {
      "id": "QM-P02",
      "kind": "upstream",
      "scope": "Unified upstream factory export and bounded MCP query surfaces",
      "local_commits": [
        "45efce0",
        "0e9f4d7"
      ],
      "checked_on": "2026-10-10",
      "issue": null,
      "pr": null
    },
    {
      "id": "QM-P03",
      "kind": "upstream",
      "scope": "Explicit user-approval requirement for resource exposure",
      "local_commits": [
        "ad5a596"
      ],
      "checked_on": "2026-10-10",
      "issue": null,
      "pr": null
    },
    {
      "id": "QM-P04",
      "kind": "upstream",
      "scope": "Upstream diagnostic health and source-cache invalidation",
      "local_commits": [
        "45efce0",
        "5770753"
      ],
      "checked_on": "2026-10-10",
      "issue": null,
      "pr": null
    },
    {
      "id": "QM-P05",
      "kind": "upstream",
      "scope": "Configurable embedding timeout, abort forwarding and cooperative deadlines",
      "local_commits": [
        "e44b2f4",
        "d31e67e",
        "d5272ef"
      ],
      "checked_on": "2026-10-10",
      "issue": null,
      "pr": null
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
      "checked_on": "2026-10-10",
      "issue": null,
      "pr": null
    },
    {
      "id": "QM-P07",
      "kind": "upstream",
      "scope": "Doctor model-cache diagnostic sidecar filtering",
      "local_commits": [
        "45efce0"
      ],
      "checked_on": "2026-10-10",
      "issue": null,
      "pr": null
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
    }
  ]
}
```

## Convergence lifecycle

Verify existing upstream issues and PRs, current default-branch equivalence, and source-owned regression evidence before submitting missing contributions. A PR that is closed without merge is nonconformant, and a merged PR is not automatically present in an immutable official release. Remove a downstream patch only on a tested candidate against a suitable released upstream artifact. Retire the fork only after verified patch elimination, accepted distribution/ADR disposition, rollback readiness, consumer parity, and separate operator approval for production/retirement.
