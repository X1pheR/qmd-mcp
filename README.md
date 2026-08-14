# QMD MCP

QMD MCP packages QMD as a long-running Streamable HTTP MCP server with the normal QMD read tools plus bounded index-administration operations.

It is intended for deployments that want QMD search and retrieval plus controlled index maintenance behind one MCP endpoint without exposing arbitrary shell execution.

## Capabilities

QMD MCP keeps QMD's read-oriented MCP tools and adds:

- `health` for index and runtime state;
- `start_update` for bounded asynchronous filesystem reindex jobs;
- `start_embed` for bounded asynchronous embedding jobs;
- `job_status` for recent administration jobs;
- optional scheduled refresh and embedding;
- a routine `query` path with reranking disabled;
- a separate CPU-heavy `query_reranked` tool;
- internal-text document retrieval by default, with explicit opt-in MCP resource exposure.

Only one administration job runs at a time. Completed jobs are retained in memory with a bounded history.

## Image contract

The supported image target is currently `linux/amd64`. The image intentionally retains only the QMD `linux-x64` native llama runtime to keep the image bounded.

The default runtime paths are:

```text
/config/index.yml    QMD index configuration
/data/index.sqlite   QMD index database
/data/home           runtime home
/data/cache          model/runtime cache
```

The MCP endpoint is `/mcp`. A lightweight HTTP health endpoint is available at `/health`.

## Configuration

Relevant environment variables are:

```text
QMD_HTTP_HOST=0.0.0.0
QMD_HTTP_PORT=8181
QMD_CONFIG_PATH=/config/index.yml
INDEX_PATH=/data/index.sqlite
QMD_DEFAULT_COLLECTION=
QMD_FORCE_CPU=0
QMD_EMBED_PARALLELISM=
QMD_EMBED_MAX_DOCS_PER_BATCH=8
QMD_EMBED_MAX_BATCH_MB=16
QMD_EMBED_MAX_DURATION_MS=3600000
QMD_REFRESH_INTERVAL_MINUTES=15
QMD_REFRESH_INITIAL_DELAY_SECONDS=120
```

`QMD_DEFAULT_COLLECTION` is optional. If unset, `start_embed` uses the first configured collection when no collection is supplied explicitly.

Set `QMD_REFRESH_INTERVAL_MINUTES=0` to disable scheduled refresh. Set `QMD_FORCE_CPU=1` when a deployment should avoid GPU probing and use CPU only.

## Security model

- The container runs as the upstream Node image's unprivileged `node` user.
- Source collections should normally be mounted read-only.
- Index and cache state remain separate from source content.
- Administration is limited to the exposed job operations; arbitrary shell execution is not exposed.
- Error messages redact configured index and config paths.
- MCP transport is not an authentication layer. Place it on a trusted network boundary or behind an authenticated MCP gateway.
- Production deployments should consume an immutable release image digest.

See `SECURITY.md` for vulnerability reporting and deployment guidance.

## Upstream relationship

This repository is not a fork of the full QMD source tree. It consumes an exact `@tobilu/qmd` package version and applies a small fail-closed compatibility patch set during image build. The build fails when an expected upstream patch target no longer matches exactly.

See `UPSTREAM.md` for the current upstream version, patch inventory and update process.

## Validation

The primary validation boundary is the container build because it installs the locked dependency set, applies every upstream patch and performs JavaScript syntax checks.

Dependency and base-image updates are proposed by Dependabot. A QMD update is accepted only after the image build and functional release acceptance pass against the proposed version.

## Release policy

Versions use SemVer tags such as `v0.1.0`. A release must point to an exact CI-green commit. The release workflow publishes the versioned GHCR image from that commit. Deployments should pin the resulting image digest rather than a mutable branch or floating tag.

## License

QMD MCP's original wrapper code is MIT licensed. QMD and bundled dependencies retain their own licenses. See `LICENSE` and `UPSTREAM.md`.
