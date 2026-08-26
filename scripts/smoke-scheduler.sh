#!/usr/bin/env bash
set -euo pipefail
mkdir -p .ci-scheduler/config .ci-scheduler/vault/logs
printf '%s\n' \
  'global_context: CI scheduler update-only smoke.' \
  'collections:' \
  '  docs:' \
  '    path: /vault' \
  '    pattern: "**/*.md"' \
  '    ignore:' \
  '      - "logs/**"' \
  '  log:' \
  '    path: /vault/logs' \
  '    pattern: "history.md"' \
  '    includeByDefault: false' \
  '    embedding: false' \
  > .ci-scheduler/config/index.yml
printf '%s\n' '# Semantic source' 'qmd-scheduler-semantic-marker' > .ci-scheduler/vault/semantic.md
printf '%s\n' '# Append-only history' 'qmd-scheduler-lexical-marker' > .ci-scheduler/vault/logs/history.md

docker run -d --name qmd-mcp-scheduler-ci \
  -p 127.0.0.1:18182:8181 \
  -e QMD_FORCE_CPU=1 \
  -e QMD_SOURCE_RELATIVE_ROOT=/vault \
  -e QMD_REFRESH_INTERVAL_MINUTES=1 \
  -e QMD_REFRESH_INITIAL_DELAY_SECONDS=1 \
  -v "$PWD/.ci-scheduler/config:/config:ro" \
  -v "$PWD/.ci-scheduler/vault:/vault:ro" \
  qmd-mcp:ci
trap 'docker rm -f qmd-mcp-scheduler-ci >/dev/null 2>&1 || true' EXIT

python3 - <<'PY'
import json
import time
import urllib.request

base = "http://127.0.0.1:18182"
for _ in range(60):
    try:
        with urllib.request.urlopen(base + "/health", timeout=2) as response:
            if json.load(response).get("status") == "ok":
                break
    except Exception:
        pass
    time.sleep(0.5)
else:
    raise SystemExit("QMD scheduler smoke did not become healthy")

def post(payload, session=None):
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if session:
        headers["mcp-session-id"] = session
    request = urllib.request.Request(
        base + "/mcp",
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.headers, json.load(response)

headers, _ = post({
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "qmd-scheduler-ci", "version": "1"},
    },
})
session = headers.get("mcp-session-id")
assert session

for _ in range(80):
    _, status = post({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {"name": "job_status", "arguments": {"limit": 5}},
    }, session)
    jobs = status["result"]["structuredContent"].get("jobs", [])
    scheduled = next((job for job in jobs if job["type"] == "scheduled_refresh"), None)
    if scheduled and scheduled["state"] == "succeeded":
        result = scheduled["result"]
        assert result["embeddingSkipped"] is True, scheduled
        assert result["embeddings"] == [], scheduled
        assert result["needsEmbedding"] == 1, scheduled
        break
    if scheduled and scheduled["state"] in {"failed", "partial"}:
        raise SystemExit(f"scheduled refresh ended as {scheduled['state']}")
    time.sleep(0.25)
else:
    raise SystemExit("scheduled refresh did not finish")

_, health = post({
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {"name": "health", "arguments": {}},
}, session)
payload = health["result"]["structuredContent"]
assert payload["status"]["needsEmbedding"] == 1, payload
assert payload["indexHealth"]["needsEmbedding"] == 1, payload
assert payload["scheduledRefresh"]["embeddingAutomatic"] is False, payload

_, queried = post({
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
        "name": "query",
        "arguments": {
            "searches": [{"type": "lex", "query": "qmd-scheduler-lexical-marker"}],
            "collections": ["log"],
            "limit": 3,
        },
    },
}, session)
assert queried["result"]["structuredContent"]["results"], queried
PY
