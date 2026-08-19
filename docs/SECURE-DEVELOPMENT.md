# Secure development model

QMD MCP is a narrow adapter around QMD. Its security model assumes that the MCP HTTP endpoint is deployed only behind a trusted or authenticated boundary; the server does not implement internet-facing authentication itself.

## Trust and privilege boundaries

- Source collections are read-only from the MCP surface. The server can rebuild derived QMD index and embedding state, but it does not provide source-file write tools.
- The public tool surface is intentionally limited to nine named MCP tools. It does not expose a generic shell, arbitrary HTTP client, or generic filesystem operation.
- The container runs as the unprivileged `node` user. Deployment examples mount indexed source content read-only.
- Public GitHub workflows do not consume production credentials. Release provenance uses GitHub OIDC and attestations rather than long-lived signing secrets.
- The HTTP transport is not an authorization boundary. Operators must place it behind an appropriate trusted or authenticated network/service boundary.

## Secure design principles

The project applies the following secure-design principles during changes and review:

- **Economy of mechanism:** keep the wrapper small, use direct QMD APIs where possible, and avoid generic execution or administration surfaces.
- **Fail-safe defaults:** reject unknown or unsafe states. Lexical-only collections reject vector or hypothetical-document search, request bodies above the configured limit are rejected, malformed JSON is returned as a protocol parse error, and compatibility patching fails closed when the expected upstream source does not match.
- **Complete mediation:** relevant limits and policy checks are applied on each request or tool invocation rather than relying on caller behavior.
- **Open design:** security does not depend on implementation secrecy. The tool surface, deployment boundary, source code, tests, and release provenance are public.
- **Least privilege and separation of privilege:** the runtime is non-root, source mounts are read-only, administrative tools are bounded, and release permissions are scoped to the job that needs them.
- **Least common mechanism:** the project avoids a shared generic command or credential-bearing passthrough and keeps production secrets out of public CI.
- **Limited attack surface:** the service exposes one Streamable HTTP MCP endpoint and nine fixed tools rather than general-purpose execution primitives.
- **Allowlist-oriented validation:** MCP schemas, collection names, search modes, source paths, request sizes, and release metadata are constrained to explicit supported shapes.
- **Least astonishment:** write-capable tools are documented and conservatively annotated as destructive where they replace derived state.

## Common vulnerability classes and mitigations

The project explicitly considers common software weakness classes, including OWASP Top 10 and CWE-style categories, when changing trust boundaries.

| Risk | Current mitigation |
| --- | --- |
| OS command injection | MCP callers cannot submit shell commands. The wrapper uses bounded APIs rather than a generic execution tool. |
| Path traversal / arbitrary filesystem access | Source access is anchored in configured QMD collections; no generic filesystem MCP tool is exposed. Returned source paths are derived from indexed collection state. |
| Resource exhaustion / denial of service | HTTP request bodies are bounded, tool inputs are schema-constrained, and administrative work is exposed as bounded background jobs rather than arbitrary execution. |
| Malformed input / protocol confusion | JSON parsing failures return protocol-correct parse errors; malformed or unsupported MCP inputs are rejected before work is performed. |
| Broken authentication or authorization | The server is explicitly not an internet-facing authentication service; deployments must provide a trusted/authenticated boundary outside the MCP process. |
| Sensitive-data exposure | The MCP surface is designed around source retrieval and derived-index state rather than credentials. Public workflows do not contain production secrets, and repository Secret Scanning and Push Protection are enabled. |
| Dependency / supply-chain compromise | Direct dependencies and GitHub Actions are pinned, Dependabot and CodeQL are enabled, dependency vulnerabilities are checked, and releases use immutable tags/releases, OCI digests, SPDX SBOM, SLSA provenance, and Sigstore/GitHub attestations. |
| Policy regression | Unit, integration, and property-based tests exercise request-size and lexical-only policy boundaries. CI and CodeQL must pass before protected branches can be updated. |

## Security review expectations

Changes that affect MCP schemas, HTTP/session handling, source-path handling, subprocess behavior, dependency execution, release provenance, or read/write boundaries require explicit security review in addition to ordinary functional tests. Add a regression test for a fixed defect and use property-based tests where a boundary has a useful invariant.

Security vulnerabilities must follow [`SECURITY.md`](../SECURITY.md). Contribution and test requirements are defined in [`CONTRIBUTING.md`](../CONTRIBUTING.md).
