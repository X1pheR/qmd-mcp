# QMD MCP

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/X1pheR/qmd-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/X1pheR/qmd-mcp)
[![Verified by M8ven](https://m8ven.ai/badge/mcp/x1pher-qmd-mcp-jfo7qm)](https://m8ven.ai/verified?check=https%3A%2F%2Fgithub.com%2Fx1pher%2Fqmd-mcp)

QMD MCP packages [QMD](https://github.com/tobi/qmd) as a long-running Streamable HTTP MCP server. It provides QMD search and document retrieval together with bounded index-maintenance operations, without exposing arbitrary shell execution.

This is a community-maintained integration. It is not affiliated with, endorsed by, or officially maintained by the upstream QMD project.

## Feedback and contributions

Use GitHub Issues for bug reports and feature requests and pull requests for proposed changes. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow, test requirements, and coding conventions. Security issues must follow the private process in [`SECURITY.md`](SECURITY.md).

Release changes are recorded in [`CHANGELOG.md`](CHANGELOG.md).

## Quick start

The public Docker image is published on GitHub Container Registry (GHCR):

```text
ghcr.io/x1pher/qmd-mcp:v0.1.3
```

The package is public, so Docker does not need a GitHub login to pull it.

For production deployments, use the immutable digest published in the corresponding GitHub Release rather than relying on the version tag alone.

The image currently supports `linux/amd64`. It intentionally retains only the QMD `linux-x64` native llama runtime to keep the image bounded.

### 1. Create the directories

```bash
mkdir -p qmd/config qmd/content
cd qmd
```

Put the Markdown files you want QMD to index in `content/`.

### 2. Create `config/index.yml`

```yaml
global_context: >-
  This is a local Markdown knowledge base. Search results are discovery evidence;
  read the source document before relying on a material claim.

collections:
  notes:
    path: /vault
    pattern: "**/*.md"
    ignore:
      - "archive/**"

  archive:
    path: /vault/archive
    pattern: "**/*.md"
    includeByDefault: false

  append-only-log:
    path: /vault/logs
    pattern: "history.md"
    includeByDefault: false
    embedding: false
```

`path` values refer to paths inside the container. The Compose example below mounts `./content` at `/vault`.

`embedding: false` is a QMD MCP wrapper extension for collections that should remain lexical-only. The files are still indexed and available to explicit lexical (`lex`) searches, but they are excluded from embedding health, scheduled embedding and manual `start_embed` jobs. Use it for large append-only logs or other exact-lookup material where repeatedly rebuilding vectors adds cost without useful semantic recall.

### 3. Create `compose.yml`

```yaml
services:
  qmd-mcp:
    image: ghcr.io/x1pher/qmd-mcp:v0.1.3
    container_name: qmd-mcp
    environment:
      QMD_FORCE_CPU: "1"
      QMD_REFRESH_INTERVAL_MINUTES: "15"
      QMD_REFRESH_INITIAL_DELAY_SECONDS: "120"
    ports:
      - "127.0.0.1:8181:8181"
    volumes:
      - ./content:/vault:ro
      - ./config:/config:ro
      - qmd-data:/data
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          fetch('http://127.0.0.1:8181/health')
          .then(r=>process.exit(r.ok?0:1))
          .catch(()=>process.exit(1))
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s
    restart: unless-stopped

volumes:
  qmd-data:
```

The example binds the HTTP port to loopback only. If another container must call QMD MCP directly, attach both containers to a shared Docker network and use the QMD service name instead of exposing it broadly on the host.

`QMD_FORCE_CPU=1` gives a predictable CPU-only deployment. Remove it or set it to `0` if you deliberately want QMD to probe for supported acceleration.

### 4. Start the container

```bash
docker compose up -d
```

Check the service:

```bash
curl --fail http://127.0.0.1:8181/health
```

The Streamable HTTP MCP endpoint is:

```text
http://127.0.0.1:8181/mcp
```

### Docker CLI alternative

You can run the same release without Compose:

```bash
docker volume create qmd-data

docker run -d \
  --name qmd-mcp \
  --restart unless-stopped \
  -p 127.0.0.1:8181:8181 \
  -e QMD_FORCE_CPU=1 \
  -e QMD_REFRESH_INTERVAL_MINUTES=15 \
  -e QMD_REFRESH_INITIAL_DELAY_SECONDS=120 \
  -v "$PWD/content:/vault:ro" \
  -v "$PWD/config:/config:ro" \
  -v qmd-data:/data \
  ghcr.io/x1pher/qmd-mcp:v0.1.3
```

## What QMD MCP provides

QMD MCP keeps QMD's read-oriented MCP tools and adds bounded administration operations:

- `health` reports index and runtime state;
- `start_update` starts a bounded asynchronous filesystem reindex job;
- `start_embed` starts a bounded asynchronous embedding job;
- `job_status` reports recent administration jobs;
- scheduled refresh and embedding can run automatically while `embedding: false` collections remain lexical-only;
- routine `query` runs with reranking disabled;
- `query_reranked` provides a separate CPU-heavy reranked path;
- query results can include an exact `source_relative_path` for authoritative filesystem handoff when `QMD_SOURCE_RELATIVE_ROOT` is configured and the source path resolves unambiguously;
- document retrieval returns internal text by default, with explicit opt-in MCP resource exposure.

Only one administration job runs at a time. Completed jobs are retained in memory with a bounded history. See [`docs/tools.md`](docs/tools.md) for the complete nine-tool reference, including access level and side effects.

## Runtime paths

The container uses these stable paths:

| Path | Purpose |
|---|---|
| `/config/index.yml` | QMD collection configuration |
| `/data/index.sqlite` | QMD index database |
| `/data/home` | Runtime home directory |
| `/data/cache` | Model and runtime cache |

Source collections should normally be mounted read-only. `/data` must remain writable because it contains the rebuildable index and model/runtime cache.

## Configuration

The Dockerfile provides working defaults for the normal runtime paths and HTTP listener. Override only the settings your deployment needs.

| Variable | Default | Purpose |
|---|---:|---|
| `QMD_HTTP_HOST` | `0.0.0.0` | HTTP listen address inside the container |
| `QMD_HTTP_PORT` | `8181` | HTTP listen port |
| `QMD_CONFIG_PATH` | `/config/index.yml` | QMD collection configuration file |
| `INDEX_PATH` | `/data/index.sqlite` | QMD index database |
| `QMD_SOURCE_RELATIVE_ROOT` | unset | Optional common source root. When set, query results include exact, collision-safe `source_relative_path` values relative to this root. |
| `QMD_DEFAULT_COLLECTION` | unset | Default collection for `start_embed`; otherwise the first configured collection is used |
| `QMD_FORCE_CPU` | `0` | Set to `1` to disable acceleration probing and force CPU use |
| `QMD_EMBED_PARALLELISM` | unset | Optional QMD embedding parallelism override |
| `QMD_EMBED_MAX_DOCS_PER_BATCH` | `8` | Maximum documents per scheduled embedding batch; accepted range `1`-`32` |
| `QMD_EMBED_MAX_BATCH_MB` | `16` | Maximum scheduled embedding batch size in MiB; accepted range `1`-`128` |
| `QMD_EMBED_MAX_DURATION_MS` | `3600000` | Maximum scheduled embedding session length; accepted range `60000`-`7200000` ms |
| `QMD_REFRESH_INTERVAL_MINUTES` | `15` | Scheduled refresh interval; `0` disables it, maximum `1440` |
| `QMD_REFRESH_INITIAL_DELAY_SECONDS` | `120` | Delay before the first scheduled refresh; accepted range `0`-`3600` |

Invalid bounded numeric values fail at startup instead of being silently accepted. `QMD_SOURCE_RELATIVE_ROOT` never exposes its absolute path; only a relative source path is returned, and ambiguous normalized-path collisions return `null` rather than guessing.

## Security model

- The container runs as the upstream Node image's unprivileged `node` user.
- Source collections should normally be mounted read-only.
- Index and cache state remain separate from source content.
- Administration is limited to the exposed job operations. The wrapper calls the QMD store API directly; it does not invoke QMD CLI update hooks or expose arbitrary shell execution.
- MCP request bodies are capped at 1 MiB before JSON parsing.
- Error messages redact configured index and config paths.
- MCP transport is not an authentication layer. Keep it on a trusted network boundary or place it behind an authenticated MCP gateway.
- Production deployments should use an immutable release image digest instead of a branch, `latest`, or another moving tag.

See [`SECURITY.md`](SECURITY.md) for vulnerability reporting and deployment guidance.

## Upstream relationship

This repository is not a fork of the full QMD source tree. It consumes an exact `@tobilu/qmd` package version and applies a small fail-closed compatibility patch set during image build. The build fails if an expected upstream patch target no longer matches exactly.

See [`UPSTREAM.md`](UPSTREAM.md) for the current upstream version, patch inventory, and update process.

## Validation

The container build is the primary validation boundary. It installs the locked dependency set, applies every upstream patch, runs the complete unit/property test suite, performs JavaScript syntax checks, and prunes development-only dependencies before the runtime stage. CI also starts the image, initializes the MCP protocol, verifies the exact nine-tool surface, runs a real index update against a temporary Markdown collection, and verifies the resulting document count.

Dependency and base-image updates are proposed by Dependabot. A QMD update is accepted only after the image build and functional release acceptance pass against the proposed version.

## Releases

Versions use SemVer tags such as `v0.1.3`. A release must point to an exact CI-green commit. The tag-triggered Release workflow:

1. verifies that the tag matches `package.json`;
2. builds the `linux/amd64` image;
3. publishes it to GHCR;
4. records the immutable image digest;
5. publishes SBOM/provenance and a GitHub attestation;
6. creates the corresponding GitHub Release.

Normal CI does not publish images or releases. Release tags are immutable and are never reused for a different commit.

## License

QMD MCP's original wrapper code is MIT licensed. QMD and bundled dependencies retain their own licenses. See [`LICENSE`](LICENSE) and [`UPSTREAM.md`](UPSTREAM.md).
