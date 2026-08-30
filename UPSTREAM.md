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
8. configurable embedding maximum duration;
9. filtering of model-cache `.etag` sidecars from doctor diagnostics.

`admin-server.mjs` adds the long-running HTTP/session layer, bounded administration jobs and scheduled refresh behavior.

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
