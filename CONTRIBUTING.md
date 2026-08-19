# Contributing to QMD MCP

Contributions and issue reports are welcome through the GitHub repository.

## Before opening a change

- Use a GitHub issue for bugs, feature requests, or design discussion when the change is not self-explanatory.
- Use the private vulnerability-reporting process in `SECURITY.md` for security issues. Do not open a public issue for an undisclosed vulnerability.
- Keep this project a narrow QMD MCP wrapper. Avoid unrelated platform, orchestration, or deployment-specific behavior.
- Preserve the read-only source-content boundary and the bounded administration model.

## Development workflow

Create a branch, make one logically bounded change, and open a pull request against `main`.

Use JavaScript ES modules, two-space indentation, semicolons, and descriptive names. Prefer explicit validation and fail-closed behavior at MCP, filesystem, HTTP, and configuration boundaries.

Every functional change must include or update automated tests. Security-sensitive boundary changes should include regression or property tests where practical.

Run the repository validation before opening a pull request:

```bash
npm ci
npm test
docker build --build-arg VERSION=ci --build-arg REVISION="$(git rev-parse HEAD)" -t qmd-mcp:ci .
```

The Docker build is the authoritative integration gate because it applies the pinned QMD compatibility patch, runs the complete Node test suite, performs syntax checks, prunes development-only dependencies, and produces the same runtime shape exercised by CI.

GitHub CI must pass before a pull request is merged. CodeQL, OpenSSF Scorecard, Dependabot, Secret Scanning, Push Protection, immutable releases, SBOM/provenance attestations, and repository branch rules provide additional security and supply-chain controls.

## Dependencies and upstream QMD

Direct dependencies are pinned. Dependabot proposes routine updates. Review new dependencies for maintenance, license, security history, necessity, and transitive cost before adding them.

Changes to `@tobilu/qmd` require the review and validation process documented in `UPSTREAM.md`. Do not weaken fail-closed patch matching to make an upstream update pass.

## Releases

Releases use SemVer tags. Release changes must be summarized in `CHANGELOG.md`; explicitly mention security fixes when a release contains one. Release tags are never reused.

## License

By contributing, you agree that your contribution is licensed under the repository's MIT license.
