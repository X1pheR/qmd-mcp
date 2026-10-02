# Changelog

All notable changes to QMD MCP are documented here. Versions follow Semantic Versioning.

## [0.2.2] - 2026-10-02

- Fixes the SDK/store adapter so scheduled `resumeIncomplete` is forwarded end-to-end into `generateEmbeddings`; v0.2.1 set the option in the scheduler but dropped it in `store.embed`.
- Adds an executable adapter-boundary regression proving both the shared cancellation signal and resumable-checkpoint option reach the embedding implementation together.
- Keeps the v0.2.1 checkpoint, collection-rotation, cancellation-classification and vector-search isolation behavior otherwise unchanged.

Security: no disclosed vulnerability was fixed in this release.

## [0.2.1] - 2026-10-02

- Makes automatic embedding progress resumable across cooperative deadlines by retaining completed chunk checkpoints and skipping those exact model/fingerprint chunks on later scheduled runs.
- Rotates the first eligible collection across admitted scheduled runs so a permanently backlogged earlier collection cannot starve later eligible collections.
- Excludes incomplete checkpoint groups from vector-search results while preserving candidate capacity for complete documents.
- Treats scheduler deadline cancellation as recoverable deadline debt instead of reporting synthetic no-vector/model failures; genuine embedding failures retain their existing handling.
- Keeps the existing scheduler interval, runtime budget, resource bounds, collection policy, one-writer model and read-only source-mount expectations unchanged.

The collection-rotation cursor is process-local and resets to configured order after process restart. Manual embedding retains atomic cleanup of interrupted incomplete documents.

Security: no disclosed vulnerability was fixed in this release.

## [0.2.0] - 2026-10-01

- Adds opt-in automatic embedding with policy/pending selection, sequential collections and a shared maintenance claim; busy/query checks skip without queued catch-up.
- Adds scheduledEmbedding health and truthful partial/failure outcomes while refresh stays update-only.
- Propagates a shared cooperative AbortSignal through QMD SDK/store/session and native workers. Already-started calls settle; incomplete document vectors are removed for later retry.
- Drains maintained work before store closure and aligns the absent embedding-duration default to 60 minutes.
- Keeps QMD 2.5.3 and existing dependencies unchanged; expands behavioral/image acceptance and aligns release/Registry metadata.

Scheduling is disabled by default. CPU/RAM/swap limits and one-writer deployment remain operator responsibilities. Cooperative deadlines do not hard-limit a running native call.

Security: no disclosed vulnerability was fixed in this release.

## [0.1.7] - 2026-09-09

- Invalidates the exact-source-path cache for successfully updated collections so newly indexed files expose `source_relative_path` immediately instead of waiting for the 60-second query-cache TTL.
- Keeps the normal source-path query cache and QMD 2.5.3 dependency baseline unchanged.

Security: no disclosed vulnerability was fixed in this release.

## [0.1.6] - 2026-09-08

- Added native `linux/arm64` packaging alongside `linux/amd64` without changing the pinned QMD 2.5.3 dependency baseline.
- Selects and retains only the architecture-matching `@node-llama-cpp` CPU runtime in each image, correcting the prior prune order that allowed optional runtimes to be re-materialized.
- Pins the existing Node 22.23.2 base through its multi-architecture index, installs ARM64-only native compilation prerequisites in the disposable build stage, and enables ARM64 emulation only in the GitHub publication workflow.
- Extends the canonical verifier with architecture-specific runtime-package checks.

Security: no disclosed vulnerability was fixed in this release.

## [0.1.5] - 2026-08-30

- Added a fail-closed two-part approval gate for user-visible MCP resources returned by `get` and `multi_get`.
- `exposeToUser=true` is now insufficient by itself; callers must also set `confirmUserApprovedExposure=true` after explicit user approval.
- Preview/show/open/render/inspect intent is explicitly excluded from resource-exposure approval, while default document retrieval remains internal text.
- Added live MCP smoke coverage for internal reads, denied unapproved exposure, approved exposure, and `multi_get` denial.

Security: this release hardens a user-visible resource exposure boundary so accidental caller/tool selection cannot expose QMD content as an MCP resource.

## [0.1.4] - 2026-08-22

- Decoupled scheduled refresh from embeddings: scheduled refresh now updates the lexical/index state only, while embedding remains an explicit `start_embed` operation.
- Added CI coverage for the scheduled-refresh incident-prevention behavior.

Security: no disclosed vulnerability was fixed in this release.

## [0.1.3] - 2026-08-19

- Hardened MCP request handling with a 1 MiB request-body limit and protocol-correct malformed-JSON errors.
- Corrected destructive annotations for bounded index and embedding administration tools.
- Added MCP Registry ownership metadata and validated Registry metadata for the release line.
- Added OpenSSF Scorecard and M8ven publisher-verification trust signals.
- Tightened GitHub Actions token permissions and security-reporting documentation.
- Added an offline-verifiable Sigstore attestation bundle to immutable GitHub Releases.
- Added SLSA provenance and SPDX SBOM attestations for the published OCI image.

Security: no disclosed vulnerability was fixed in this release; the changes above are preventive hardening and supply-chain improvements.

## [0.1.2] - 2026-08-18

- Added lexical-only collection support with `embedding: false`.
- Added release-workflow recovery support compatible with immutable releases.

Security: no disclosed vulnerability was fixed in this release.

## [0.1.1] - 2026-08-17

- Added exact source-relative path handoff in query results for authoritative source retrieval.
- Expanded public Docker deployment documentation.

Security: no disclosed vulnerability was fixed in this release.

## [0.1.0] - 2026-08-14

- Initial public QMD MCP release.
- Added the bounded nine-tool Streamable HTTP MCP surface, Docker packaging, CI validation, security guidance, and upstream QMD compatibility policy.

Security: no disclosed vulnerability was fixed in this release.
