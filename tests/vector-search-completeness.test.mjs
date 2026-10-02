import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const storeSource = readFileSync(new URL("../node_modules/@tobilu/qmd/dist/store.js", import.meta.url), "utf8");
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, "Pinned executable fixture anchors must exist");
  return source.slice(a, b);
}
const searchSource = between(
  storeSource,
  "export async function searchVec(",
  "// =============================================================================\n// Embeddings"
).replace("export async", "async");

test("AE-30: vector search excludes incomplete checkpoint groups without reducing complete candidate capacity", async () => {
  let candidateK = null;
  const partial = { hash_seq: "partial_0", hash: "partial", filepath: "qmd://docs/partial.md", display_path: "docs/partial.md", title: "partial", body: "partial", pos: 0 };
  const completeA = { hash_seq: "complete-a_0", hash: "complete-a", filepath: "qmd://docs/a.md", display_path: "docs/a.md", title: "a", body: "a", pos: 0 };
  const completeB = { hash_seq: "complete-b_0", hash: "complete-b", filepath: "qmd://docs/b.md", display_path: "docs/b.md", title: "b", body: "b", pos: 0 };
  const db = {
    prepare(sql) {
      if (sql.includes("sqlite_master")) return { get: () => ({ name: "vectors_vec" }) };
      if (sql.includes("SUM(chunk_count)")) return { get: () => ({ count: 2 }) };
      if (sql.includes("FROM vectors_vec")) return { all: (_embedding, k) => {
        candidateK = k;
        return [
          { hash_seq: partial.hash_seq, distance: 0.01 },
          { hash_seq: completeA.hash_seq, distance: 0.02 },
          { hash_seq: completeB.hash_seq, distance: 0.03 },
        ];
      } };
      if (sql.includes("FROM content_vectors cv")) return { all: () =>
        sql.includes("HAVING COUNT(*) = MAX(total_chunks)") ? [completeA, completeB] : [partial, completeA, completeB]
      };
      throw new Error("unexpected SQL");
    },
  };
  const searchVec = vm.runInNewContext(searchSource + "; searchVec", {
    Float32Array,
    getEmbedding: async () => [1],
    withLazyContentVectorMigration: (_db, fn) => fn(),
    getDocid: hash => hash,
    getContextForFile: () => null,
  });
  const result = await searchVec(db, "query", "model", 2, undefined, undefined, [1]);
  assert.equal(candidateK, 8);
  assert.equal(result.map(row => row.hash).join(","), "complete-a,complete-b");
});
