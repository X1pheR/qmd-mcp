#!/usr/bin/env bash
set -euo pipefail
mkdir -p .ci-embedding/config .ci-embedding/vault
printf '%s\n' 'collections:' '  docs:' '    path: /vault' '    pattern: "**/*.md"' '    embedding: false' > .ci-embedding/config/index.yml
cleanup(){ docker rm -f qmd-mcp-embedding-ci >/dev/null 2>&1 || true; rm -rf .ci-embedding; }
trap cleanup EXIT
docker run -d --name qmd-mcp-embedding-ci --label hypershell.purpose=qmd-embedding-smoke \
  -p 127.0.0.1:18183:8181 -e QMD_FORCE_CPU=1 -e QMD_REFRESH_INTERVAL_MINUTES=0 \
  -e QMD_EMBED_INTERVAL_MINUTES=1 -e QMD_EMBED_INITIAL_DELAY_SECONDS=1 \
  -v "$PWD/.ci-embedding/config:/config:ro" -v "$PWD/.ci-embedding/vault:/vault:ro" qmd-mcp:ci
python3 - <<'PY'
import json,time,urllib.request
base="http://127.0.0.1:18183"
for _ in range(80):
    try:
        with urllib.request.urlopen(base+"/health", timeout=2) as response:
            health=json.load(response)
        scheduled=health["scheduledEmbedding"]
        if scheduled["last"] and scheduled["last"]["state"]=="no_pending_work":
            assert scheduled["enabled"] is True
            assert scheduled["intervalMinutes"]==1 and scheduled["initialDelaySeconds"]==1
            assert scheduled["next"] is not None and health["activeJob"] is None
            break
    except (OSError, KeyError):
        pass
    time.sleep(.25)
else:
    raise SystemExit("Embedding scheduler no-op health did not become observable")
def post(payload,session=None):
    headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream"}
    if session: headers["mcp-session-id"]=session
    request=urllib.request.Request(base+"/mcp",data=json.dumps(payload).encode(),headers=headers,method="POST")
    with urllib.request.urlopen(request,timeout=10) as response:
        return response.headers,json.load(response)
headers,_=post({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"embedding-ci","version":"1"}}})
session=headers.get("mcp-session-id"); assert session
_,response=post({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"health","arguments":{}}},session)
payload=response["result"]["structuredContent"]
assert payload["scheduledEmbedding"]["enabled"] is True
assert payload["scheduledEmbedding"]["last"]["state"]=="no_pending_work"
assert payload["scheduledEmbedding"]["embedBatch"]["maxDurationMs"]==3600000
assert payload["scheduledEmbedding"]["embedBatch"]["deadlineMode"]=="cooperative"
assert payload["scheduledRefresh"]["embeddingAutomatic"] is False
_,response=post({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"job_status","arguments":{}}},session)
assert response["result"]["structuredContent"]["jobs"]==[]
PY
