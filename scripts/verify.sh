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
image_arch="$(docker image inspect qmd-mcp:ci --format '{{.Architecture}}')"
case "${image_arch}" in
  amd64) llama_runtime=linux-x64 ;;
  arm64) llama_runtime=linux-arm64 ;;
  *) echo "Unsupported verified image architecture: ${image_arch}" >&2; exit 1 ;;
esac
docker run --rm --entrypoint sh -e EXPECTED_LLAMA_RUNTIME="${llama_runtime}" qmd-mcp:ci -ec   'test -d "/opt/qmd/node_modules/@node-llama-cpp/${EXPECTED_LLAMA_RUNTIME}"; test "$(find /opt/qmd/node_modules/@node-llama-cpp -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 1'
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
assert 'docker/setup-qemu-action@96fe6ef7f33517b61c61be40b68a1882f3264fb8' in release
assert 'platforms: linux/amd64,linux/arm64' in release
PY
