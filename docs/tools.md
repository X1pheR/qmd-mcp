# MCP Tool Reference

QMD MCP exposes nine tools. The read tools search or retrieve indexed source content. The administration tools mutate only QMD's rebuildable index and embedding state; they do not write source collections.

| Tool | Access | Destructive | Purpose |
|---|---|---|---|
| `query` | Read | No | Search with one or more lexical, vector or hypothetical-document subqueries without local reranking. |
| `query_reranked` | Read | No | Run the same query model with local CPU-heavy reranking for cases where routine search is insufficient. |
| `get` | Read | No | Retrieve one indexed document or line range by path or document ID. |
| `multi_get` | Read | No | Retrieve multiple indexed documents by glob pattern or comma-separated path list. |
| `status` | Read | No | Report QMD collection and index status. |
| `health` | Read | No | Report collection, document, embedding and administration-job health. |
| `start_update` | Index write | No source mutation | Start one bounded asynchronous filesystem reindex job. |
| `start_embed` | Index write | Conditional, index only | Start one bounded asynchronous embedding job; `force=true` rebuilds existing embeddings in the selected scope. |
| `job_status` | Read | No | Return one administration job or a bounded list of recent jobs. |

## Search tools

### `query`

Routine hybrid search. Reranking is deliberately disabled so normal retrieval does not load the local reranker.

Material inputs:

- `searches` is required and accepts 1-10 typed `lex`, `vec` or `hyde` subqueries;
- `collections` optionally restricts search to configured collections;
- `intent` supplies disambiguating context but is not a search by itself;
- `limit` defaults to 10;
- `minScore` defaults to 0.

The first subquery receives additional weight. Results include the absolute 1-indexed source line of the best match. When `QMD_SOURCE_RELATIVE_ROOT` is configured, each result also includes its `collection` and an exact `source_relative_path` when the original source spelling can be reconstructed unambiguously. Use that exact path for handoff to an authoritative filesystem; call `get` only when QMD document retrieval itself is needed.

### `query_reranked`

Administrative search with local reranking. Inputs match `query` and add `candidateLimit`, which defaults to 10 and is bounded to 1-20.

This tool is read-only but can be substantially more CPU-intensive than `query`. Prefer `query` unless reranking is materially useful. It returns the same `collection` and optional exact `source_relative_path` metadata as the routine query.

## Retrieval tools

### `get`

Retrieves one document by indexed path or document ID. `file` is required. A path or document ID can include a `:from:count` suffix for bounded line-range retrieval. `fromLine` and `maxLines` provide equivalent explicit controls.

`lineNumbers` defaults to `true`. `exposeToUser` defaults to `false`; setting it to `true` changes the MCP response from internal text to a user-visible resource and should be done only when the caller explicitly intends that exposure.

### `multi_get`

Retrieves multiple documents using a glob pattern or comma-separated list. `pattern` is required. `maxBytes` defaults to 10240 bytes per file, and `maxLines` can further bound output.

`lineNumbers` defaults to `true`. `exposeToUser` has the same explicit resource-exposure semantics as `get`.

## Status tools

### `status`

Returns QMD's collection, document-count and index status without changing state.

### `health`

Returns the wrapper's bounded health contract, including document and embedding state plus the current administration-job state. It does not start maintenance work.

### `job_status`

Returns a specific administration job when `jobId` is supplied. Without an ID it returns a bounded recent-job list; `limit` defaults to 5 and is bounded to 1-20.

## Administration tools

QMD MCP permits only one administration job at a time. Update and embedding jobs operate on the configured QMD index/cache state and never gain arbitrary shell access or source-write authority.

### `start_update`

Starts one asynchronous filesystem reindex job. `collections` optionally selects 1-8 configured collections; omitting it updates all configured collections.

Side effects are limited to the QMD index. Source collections should be mounted read-only and are not modified by the tool.

### `start_embed`

Starts one asynchronous embedding job.

Material inputs:

- `collection` optionally selects one configured collection; otherwise the server uses `QMD_DEFAULT_COLLECTION` or the first configured collection;
- `force` defaults to `false`; when `true`, existing embeddings in scope are rebuilt;
- `chunkStrategy` defaults to `auto` and accepts `auto` or `regex`;
- `maxDocsPerBatch` defaults to 8 and is bounded to 1-32;
- `maxBatchMb` defaults to 16 and is bounded to 1-128.

`force=true` is destructive only to rebuildable embedding state. It does not delete source documents.

## Security boundary

The MCP transport does not authenticate clients. Deployment must provide the trusted-network or authenticated-gateway boundary. Source collections should be mounted read-only, while the QMD index/cache path is the only writable application state.

The wrapper intentionally exposes no arbitrary shell, filesystem-write or generic HTTP-request tool. See the main README and `SECURITY.md` for the deployment security model.
