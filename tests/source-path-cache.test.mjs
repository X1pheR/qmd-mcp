import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { relative, resolve, isAbsolute, sep } from "node:path";

const source = readFileSync(new URL("../node_modules/@tobilu/qmd/dist/mcp/server.js", import.meta.url), "utf8");
const start = source.indexOf("const sourceRelativeRoot =");
const end = source.indexOf("function formatSearchSummary(", start);
assert.ok(start >= 0 && end > start);
function fixture(root = "/vault") {
  const config = { collections: { docs: { path: "/vault" } } };
  const pathFor = vm.runInNewContext(source.slice(start, end) + "; sourceRelativePathFor", {
    process: { env: { QMD_SOURCE_RELATIVE_ROOT: root } },
    relative, resolve, isAbsolute, sep, loadConfig: () => config,
  });
  return { config, pathFor: path => pathFor({ displayPath: "docs/" + path, collectionName: "docs" }) };
}
test("exact released paths preserve underscores and remain distinct from normalized spellings", async () => {
  const f = fixture();
  assert.equal(await f.pathFor("_meta/source_path.md"), "_meta/source_path.md");
  assert.equal(await f.pathFor("meta/source-path.md"), "meta/source-path.md");
});
test("configured source handoff rejects traversal and outside-root collections", async () => {
  const f = fixture();
  assert.equal(await f.pathFor("../outside.md"), null);
  f.config.collections.docs.path = "/private";
  assert.equal(await f.pathFor("source.md"), null);
});
test("configuration changes are observed immediately without cache invalidation", async () => {
  const f = fixture();
  assert.equal(await f.pathFor("new.md"), "new.md");
  f.config.collections.docs.path = "/vault/nested";
  assert.equal(await f.pathFor("new.md"), "nested/new.md");
});
