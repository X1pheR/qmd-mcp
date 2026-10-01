import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../admin-server.mjs", import.meta.url), "utf8");
function region(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, "Query tracking fixture anchors must exist");
  return source.slice(a, b);
}
const countSource = region("function trackedQueryCount(", "function sanitizeError(");
const trackingSource = region("    const trackedQueries = trackedQueryCount(parsedBody);", "    nodeResponse.writeHead(response.status");
function fixture(handleRequest, payload) {
  const context = vm.createContext({ activeQueries: 0, activity: 0, parsedBody: payload, request: {},
    transport: { handleRequest }, markActivity() { context.activity++; } });
  vm.runInContext(countSource, context);
  const run = vm.runInContext("(async () => {" + trackingSource + "; return response; })", context);
  return { run, context };
}
const query = name => ({ method: "tools/call", params: { name } });
test("T07: actual HTTP query tracking counts both tools in a mixed payload and drains on success", async () => {
  let resolve; const held = new Promise(r => { resolve = r; });
  const value = fixture(() => held, [query("query"), query("health"), query("query_reranked")]);
  const running = value.run(); assert.equal(value.context.activeQueries, 2);
  resolve({ status: 200 }); assert.equal((await running).status, 200);
  assert.equal(value.context.activeQueries, 0); assert.equal(value.context.activity, 2);
});
test("T07: actual HTTP query tracking drains after asynchronous and synchronous transport failures", async () => {
  for (const handle of [async () => { throw new Error("failure"); }, () => { throw new Error("failure"); }]) {
    const value = fixture(handle, query("query"));
    await assert.rejects(value.run(), /failure/);
    assert.equal(value.context.activeQueries, 0); assert.equal(value.context.activity, 2);
  }
});
test("T07: overlapping requests keep the remaining active query counted", async () => {
  const held = [];
  const value = fixture(() => new Promise(resolve => held.push(resolve)), query("query"));
  const first = value.run(), second = value.run(); assert.equal(value.context.activeQueries, 2);
  held[0]({}); await first; assert.equal(value.context.activeQueries, 1);
  held[1]({}); await second; assert.equal(value.context.activeQueries, 0);
});
test("T07: non-query and malformed messages do not claim query activity", async () => {
  for (const payload of [null, {}, query("health"), [{ method: "query" }, query("get")]]) {
    const value = fixture(async () => ({}), payload); await value.run();
    assert.equal(value.context.activeQueries, 0); assert.equal(value.context.activity, 0);
  }
});
