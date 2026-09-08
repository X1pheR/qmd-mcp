import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const patch = readFileSync(new URL("../patch-qmd-bind.mjs", import.meta.url), "utf8");
const admin = readFileSync(new URL("../admin-server.mjs", import.meta.url), "utf8");

test("successful updates invalidate source path cache for selected collections", () => {
  assert.match(patch, /export function invalidateSourcePathCache\(collectionNames\)/);
  assert.match(admin, /invalidateSourcePathCache/);
  assert.match(admin, /invalidateSourcePathCache\(collections\);/);
});
