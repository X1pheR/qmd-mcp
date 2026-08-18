import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  assertSearchEmbeddingPolicy,
  collectionEmbeddingEnabled,
  countPendingEmbeddingHashes,
  effectiveEmbeddingStatus,
  embeddingEnabledCollectionNames,
  validateEmbeddingPolicy,
} from "../embedding-policy.mjs";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection TEXT NOT NULL,
      path TEXT NOT NULL,
      hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE content_vectors (
      hash TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL,
      embed_fingerprint TEXT NOT NULL DEFAULT '',
      total_chunks INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

test("embedding policy is opt-out and validates explicit values", () => {
  const config = {
    collections: {
      current: { path: "/vault" },
      archive: { path: "/vault/archive", embedding: true },
      log: { path: "/vault/log", embedding: false },
    },
  };

  assert.deepEqual(embeddingEnabledCollectionNames(config), ["current", "archive"]);
  assert.equal(collectionEmbeddingEnabled(config, "current"), true);
  assert.equal(collectionEmbeddingEnabled(config, "log"), false);
  assert.equal(collectionEmbeddingEnabled(config, "missing"), false);

  assert.throws(
    () => validateEmbeddingPolicy({ collections: { bad: { embedding: "false" } } }),
    /embedding must be true or false/,
  );
});

test("lexical-only collections reject vector or implicit semantic search", () => {
  const config = {
    collections: {
      docs: { path: "/vault" },
      log: { path: "/vault/log", includeByDefault: false, embedding: false },
    },
  };

  assert.doesNotThrow(() => assertSearchEmbeddingPolicy(config, {
    collections: ["log"],
    queries: [{ type: "lex", query: "marker" }],
  }));
  assert.doesNotThrow(() => assertSearchEmbeddingPolicy(config, {
    queries: [{ type: "vec", query: "normal default search" }],
  }));
  assert.throws(() => assertSearchEmbeddingPolicy(config, {
    collections: ["log"],
    queries: [{ type: "vec", query: "marker" }],
  }), /support only explicit lex searches/);
  assert.throws(() => assertSearchEmbeddingPolicy(config, {
    collections: ["docs", "log"],
    queries: [{ type: "hyde", query: "marker" }],
  }), /support only explicit lex searches/);
  assert.throws(() => assertSearchEmbeddingPolicy(config, {
    collection: "log",
    query: "implicit semantic query",
  }), /support only explicit lex searches/);
});

test("pending embedding count ignores lexical-only collections and deduplicates hashes", () => {
  const db = createDb();
  const insertDoc = db.prepare("INSERT INTO documents (collection, path, hash, active) VALUES (?, ?, ?, ?)");
  const insertVector = db.prepare(
    "INSERT INTO content_vectors (hash, seq, model, embed_fingerprint, total_chunks) VALUES (?, ?, ?, ?, ?)",
  );

  insertDoc.run("current", "a.md", "shared-pending", 1);
  insertDoc.run("archive", "copy.md", "shared-pending", 1);
  insertDoc.run("log", "log.md", "log-only-pending", 1);
  insertDoc.run("current", "complete.md", "complete", 1);
  insertDoc.run("current", "partial.md", "partial", 1);
  insertDoc.run("current", "inactive.md", "inactive", 0);

  insertVector.run("complete", 0, "model", "fingerprint", 1);
  insertVector.run("partial", 0, "model", "fingerprint", 2);

  const config = {
    collections: {
      current: { path: "/vault" },
      archive: { path: "/vault/archive" },
      log: { path: "/vault/log", embedding: false },
    },
  };

  assert.equal(countPendingEmbeddingHashes(db, config, "model", "fingerprint"), 2);
  assert.equal(countPendingEmbeddingHashes(db, config, "model", "fingerprint", ["current"]), 2);
  assert.equal(countPendingEmbeddingHashes(db, config, "model", "fingerprint", ["archive"]), 1);
  assert.equal(countPendingEmbeddingHashes(db, config, "model", "fingerprint", ["log"]), 0);
  db.close();
});

test("all lexical-only collections report no pending embeddings without querying vectors", () => {
  const db = new Database(":memory:");
  const config = { collections: { log: { path: "/vault/log", embedding: false } } };
  assert.equal(countPendingEmbeddingHashes(db, config, "model", "fingerprint"), 0);
  db.close();
});

test("effective status preserves upstream fields while replacing pending count", () => {
  assert.deepEqual(
    effectiveEmbeddingStatus({ totalDocuments: 4, needsEmbedding: 3, collections: ["a"] }, 1),
    { totalDocuments: 4, needsEmbedding: 1, collections: ["a"] },
  );
});
