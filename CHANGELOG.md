# Changelog

All notable changes to QMD MCP are documented here. Versions follow Semantic Versioning.

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
