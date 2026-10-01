#!/usr/bin/env bash
set -euo pipefail
command -v docker >/dev/null
command -v python3 >/dev/null
revision="${VERIFY_REVISION:-$(git rev-parse HEAD)}"
cleanup(){ docker rm -f qmd-mcp-ci qmd-mcp-scheduler-ci qmd-mcp-embedding-ci >/dev/null 2>&1 || true; rm -rf .ci-smoke .ci-scheduler .ci-embedding; }
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
./scripts/smoke-embedding-scheduler.sh
git diff --check
python3 - <<'PY'
import json
from pathlib import Path
package=json.loads(Path('package.json').read_text())
lock=json.loads(Path('package-lock.json').read_text())
server=json.loads(Path('server.json').read_text())
version=package['version']
assert lock['version']==version and lock['packages']['']['version']==version
assert server['version']==version, 'MCP Registry version must match release candidate'
assert server['packages'][0]['identifier']==f'ghcr.io/x1pher/qmd-mcp:v{version}'
assert f'ARG VERSION={version}\n' in Path('Dockerfile').read_text()
assert f'## [{version}]' in Path('CHANGELOG.md').read_text()
readme=Path('README.md').read_text()
assert 'immutable digest published' not in readme and 'immutable release image digest instead' not in readme
assert 'stable version tag' in readme

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
