#!/usr/bin/env bash
set -euo pipefail
command -v docker >/dev/null
command -v python3 >/dev/null
revision="${VERIFY_REVISION:-$(git rev-parse HEAD)}"
cleanup(){ docker rm -f qmd-mcp-ci qmd-mcp-scheduler-ci >/dev/null 2>&1 || true; rm -rf .ci-smoke .ci-scheduler; }
trap cleanup EXIT
cleanup
docker build --build-arg VERSION=ci --build-arg REVISION="$revision" -t qmd-mcp:ci .
test "$(docker image inspect qmd-mcp:ci --format '{{.Config.User}}')" = "node"
test "$(docker image inspect qmd-mcp:ci --format '{{index .Config.Labels "org.opencontainers.image.title"}}')" = "QMD MCP"
test "$(docker image inspect qmd-mcp:ci --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$revision"
test "$(docker image inspect qmd-mcp:ci --format '{{index .Config.Labels "io.modelcontextprotocol.server.name"}}')" = "io.github.X1pheR/qmd-mcp"
./scripts/smoke-mcp.sh
docker rm -f qmd-mcp-ci >/dev/null 2>&1 || true
./scripts/smoke-scheduler.sh
docker rm -f qmd-mcp-scheduler-ci >/dev/null 2>&1 || true
git diff --check
python3 - <<'PY'
from pathlib import Path
ci=Path('.github/workflows/ci.yml').read_text(encoding='utf-8')
assert '\non:\n' in ci
assert '\ntrue:\n' not in ci
assert 'run: ./scripts/verify.sh' in ci
release=Path('.github/workflows/release.yml').read_text(encoding='utf-8')
assert 'Deployments should pin the digest rather than the tag.' not in release
assert 'stable version tag' in release
PY
