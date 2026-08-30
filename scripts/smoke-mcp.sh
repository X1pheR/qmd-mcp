#!/usr/bin/env bash
set -euo pipefail
mkdir -p .ci-smoke/config .ci-smoke/vault/_meta .ci-smoke/vault/logs
printf '%s\n' \
  'global_context: CI smoke knowledge base.' \
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
  > .ci-smoke/config/index.yml
printf '%s\n' '# Smoke' 'Repository bootstrap validation.' > .ci-smoke/vault/smoke.md
printf '%s\n' '# Exact source path' 'qmd-source-path-marker' > .ci-smoke/vault/_meta/source_path.md
printf '%s\n' '# Append-only history' 'qmd-lexical-only-marker' > .ci-smoke/vault/logs/history.md

docker run -d --name qmd-mcp-ci \
  -p 127.0.0.1:18181:8181 \
  -e QMD_FORCE_CPU=1 \
  -e QMD_SOURCE_RELATIVE_ROOT=/vault \
  -e QMD_REFRESH_INTERVAL_MINUTES=0 \
  -v "$PWD/.ci-smoke/config:/config:ro" \
  -v "$PWD/.ci-smoke/vault:/vault:ro" \
  qmd-mcp:ci
trap 'docker rm -f qmd-mcp-ci >/dev/null 2>&1 || true' EXIT

python3 - <<'PY'
import json
import time
import urllib.error
import urllib.request

base = "http://127.0.0.1:18181"
for _ in range(60):
    try:
        with urllib.request.urlopen(base + "/health", timeout=2) as response:
            health = json.load(response)
        if health.get("status") == "ok":
            break
    except Exception:
        time.sleep(1)
else:
    raise SystemExit("QMD MCP did not become healthy")

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

headers, initialized = post({
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "qmd-mcp-ci", "version": "1"},
    },
})
session = headers.get("mcp-session-id")
assert session
assert initialized["result"]["serverInfo"]["version"] == "2.5.3"

_, listed = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session)
tools = {tool["name"]: tool for tool in listed["result"]["tools"]}
expected = {"query", "query_reranked", "get", "multi_get", "status", "health", "start_update", "start_embed", "job_status"}
assert set(tools) == expected, set(tools)
assert tools["start_update"]["annotations"]["destructiveHint"] is True
assert tools["start_embed"]["annotations"]["destructiveHint"] is True
for name in ("get", "multi_get"):
    properties = tools[name]["inputSchema"]["properties"]
    assert "exposeToUser" in properties, tools[name]
    assert "confirmUserApprovedExposure" in properties, tools[name]

oversized = urllib.request.Request(
    base + "/mcp",
    data=b"x" * (1024 * 1024 + 1),
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    urllib.request.urlopen(oversized, timeout=10)
except urllib.error.HTTPError as error:
    assert error.code == 413, error.code
else:
    raise AssertionError("oversized MCP request was accepted")

malformed = urllib.request.Request(
    base + "/mcp",
    data=b"{",
    headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    },
    method="POST",
)
try:
    urllib.request.urlopen(malformed, timeout=10)
except urllib.error.HTTPError as error:
    assert error.code == 400, error.code
    payload = json.loads(error.read().decode())
    assert payload["error"]["code"] == -32700, payload
else:
    raise AssertionError("malformed JSON request was accepted")

_, started = post({
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {"name": "start_update", "arguments": {"collections": ["docs", "log"]}},
}, session)
job = started["result"]["structuredContent"]["job"]
assert job["state"] in {"queued", "running", "succeeded"}
job_id = job["id"]

for _ in range(30):
    _, status = post({
        "jsonrpc": "2.0",
        "id": 4,
        "method": "tools/call",
        "params": {"name": "job_status", "arguments": {"jobId": job_id}},
    }, session)
    observed_job = status["result"]["structuredContent"]["job"]
    state = observed_job["state"]
    if state == "succeeded":
        assert observed_job["result"]["needsEmbedding"] == 2, observed_job
        break
    if state in {"failed", "partial"}:
        raise SystemExit(f"update job ended as {state}")
    time.sleep(0.5)
else:
    raise SystemExit("update job did not finish")

_, queried = post({
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
        "name": "query",
        "arguments": {
            "searches": [{"type": "lex", "query": "qmd-source-path-marker"}],
            "collections": ["docs"],
            "intent": "CI exact source path handoff validation",
            "limit": 3,
        },
    },
}, session)
results = queried["result"]["structuredContent"]["results"]
assert results, queried
match = next(item for item in results if item["source_relative_path"] == "_meta/source_path.md")
assert match["collection"] == "docs"
assert match["file"] == "docs/meta/source-path.md"

_, log_query = post({
    "jsonrpc": "2.0",
    "id": 6,
    "method": "tools/call",
    "params": {
        "name": "query",
        "arguments": {
            "searches": [{"type": "lex", "query": "qmd-lexical-only-marker"}],
            "collections": ["log"],
            "limit": 3,
        },
    },
}, session)
log_results = log_query["result"]["structuredContent"]["results"]
assert any(item["source_relative_path"] == "logs/history.md" for item in log_results), log_query

_, rejected_vector = post({
    "jsonrpc": "2.0",
    "id": 7,
    "method": "tools/call",
    "params": {
        "name": "query",
        "arguments": {
            "searches": [{"type": "vec", "query": "qmd-lexical-only-marker"}],
            "collections": ["log"],
            "limit": 3,
        },
    },
}, session)
assert rejected_vector["result"].get("isError") is True, rejected_vector
assert "support only explicit lex searches" in rejected_vector["result"]["content"][0]["text"]

_, rejected_embed = post({
    "jsonrpc": "2.0",
    "id": 8,
    "method": "tools/call",
    "params": {"name": "start_embed", "arguments": {"collection": "log"}},
}, session)
assert rejected_embed["result"].get("isError") is True, rejected_embed
assert "Embedding is disabled for collection 'log'" in rejected_embed["result"]["content"][0]["text"]

_, effective_status = post({
    "jsonrpc": "2.0",
    "id": 9,
    "method": "tools/call",
    "params": {"name": "status", "arguments": {}},
}, session)
assert effective_status["result"]["structuredContent"]["needsEmbedding"] == 2, effective_status

_, internal_get = post({
    "jsonrpc": "2.0",
    "id": 10,
    "method": "tools/call",
    "params": {
        "name": "get",
        "arguments": {"file": "docs/meta/source-path.md", "lineNumbers": False},
    },
}, session)
assert internal_get["result"].get("isError") is not True, internal_get
assert internal_get["result"]["content"][0]["type"] == "text", internal_get

_, unapproved_exposure = post({
    "jsonrpc": "2.0",
    "id": 11,
    "method": "tools/call",
    "params": {
        "name": "get",
        "arguments": {
            "file": "docs/meta/source-path.md",
            "lineNumbers": False,
            "exposeToUser": True,
        },
    },
}, session)
assert unapproved_exposure["result"].get("isError") is True, unapproved_exposure
assert "explicit user approval" in unapproved_exposure["result"]["content"][0]["text"].lower(), unapproved_exposure

_, approved_exposure = post({
    "jsonrpc": "2.0",
    "id": 12,
    "method": "tools/call",
    "params": {
        "name": "get",
        "arguments": {
            "file": "docs/meta/source-path.md",
            "lineNumbers": False,
            "exposeToUser": True,
            "confirmUserApprovedExposure": True,
        },
    },
}, session)
assert approved_exposure["result"].get("isError") is not True, approved_exposure
assert approved_exposure["result"]["content"][0]["type"] == "resource", approved_exposure

_, unapproved_multi_exposure = post({
    "jsonrpc": "2.0",
    "id": 13,
    "method": "tools/call",
    "params": {
        "name": "multi_get",
        "arguments": {
            "pattern": "docs/meta/source-path.md",
            "lineNumbers": False,
            "exposeToUser": True,
        },
    },
}, session)
assert unapproved_multi_exposure["result"].get("isError") is True, unapproved_multi_exposure

with urllib.request.urlopen(base + "/health", timeout=2) as response:
    health = json.load(response)
assert health["documents"] == 3, health
assert health["needsEmbedding"] == 2, health
PY
