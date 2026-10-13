import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { join } from "node:path";

const source = readFileSync(new URL("../node_modules/@tobilu/qmd/dist/cli/qmd.js", import.meta.url), "utf8");
const start = source.indexOf("function findCachedModelInspection(");
const end = source.indexOf("function envValueForDisplay(", start);
assert.ok(start >= 0 && end > start);
function fixture(valid) {
  const inspected = [];
  const names = ["model.gguf.etag", "model.gguf.tmp", "model.gguf"];
  const inspect = vm.runInNewContext(source.slice(start, end) + "; findCachedModelInspection", {
    DEFAULT_MODEL_CACHE_DIR: "/fixture/models", existsSync: () => true,
    readdirSync: () => names.map(name => ({ name, isFile: () => true })),
    pathJoin: join, formatModelDiagnosticPath: path => path,
    inspectGgufFile: path => { inspected.push(path); return { valid, exists: true, details: "fixture header" }; },
  });
  return { inspected, result: inspect("hf:fixture/model.gguf") };
}
test("released doctor ignores sidecars before a valid GGUF blob", () => {
  const value = fixture(true);
  assert.deepEqual(value.inspected, ["/fixture/models/model.gguf"]);
  assert.equal(value.result.path, "/fixture/models/model.gguf");
  assert.equal(value.result.invalid.length, 0);
});
test("released doctor still reports an invalid GGUF blob without false sidecar diagnostics", () => {
  const value = fixture(false);
  assert.deepEqual(value.inspected, ["/fixture/models/model.gguf"]);
  assert.equal(value.result.path, null);
  assert.equal(value.result.invalid.length, 1);
});
