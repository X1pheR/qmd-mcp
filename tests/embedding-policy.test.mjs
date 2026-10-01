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
      docs: { path: "/vault" },
      notes: { path: "/vault/notes", embedding: true },
      history: { path: "/vault/history", embedding: false },
    },
  };

  assert.deepEqual(embeddingEnabledCollectionNames(config), ["docs", "notes"]);
  assert.equal(collectionEmbeddingEnabled(config, "docs"), true);
  assert.equal(collectionEmbeddingEnabled(config, "history"), false);
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
      history: { path: "/vault/history", includeByDefault: false, embedding: false },
    },
  };

  assert.doesNotThrow(() => assertSearchEmbeddingPolicy(config, {
    collections: ["history"],
    queries: [{ type: "lex", query: "marker" }],
  }));
  assert.doesNotThrow(() => assertSearchEmbeddingPolicy(config, {
    queries: [{ type: "vec", query: "normal default search" }],
  }));
  assert.throws(() => assertSearchEmbeddingPolicy(config, {
    collections: ["history"],
    queries: [{ type: "vec", query: "marker" }],
  }), /support only explicit lex searches/);
  assert.throws(() => assertSearchEmbeddingPolicy(config, {
    collections: ["docs", "history"],
    queries: [{ type: "hyde", query: "marker" }],
  }), /support only explicit lex searches/);
  assert.throws(() => assertSearchEmbeddingPolicy(config, {
    collection: "history",
    query: "implicit semantic query",
  }), /support only explicit lex searches/);
});

test("pending embedding count ignores lexical-only collections and deduplicates hashes", () => {
  const db = createDb();
  const insertDoc = db.prepare("INSERT INTO documents (collection, path, hash, active) VALUES (?, ?, ?, ?)");
  const insertVector = db.prepare(
    "INSERT INTO content_vectors (hash, seq, model, embed_fingerprint, total_chunks) VALUES (?, ?, ?, ?, ?)",
  );

  insertDoc.run("docs", "a.md", "shared-pending", 1);
  insertDoc.run("notes", "copy.md", "shared-pending", 1);
  insertDoc.run("history", "history.md", "history-only-pending", 1);
  insertDoc.run("docs", "complete.md", "complete", 1);
  insertDoc.run("docs", "partial.md", "partial", 1);
  insertDoc.run("docs", "inactive.md", "inactive", 0);

  insertVector.run("complete", 0, "model", "fingerprint", 1);
  insertVector.run("partial", 0, "model", "fingerprint", 2);

  const config = {
    collections: {
      docs: { path: "/vault" },
      notes: { path: "/vault/notes" },
      history: { path: "/vault/history", embedding: false },
    },
  };

  assert.equal(countPendingEmbeddingHashes(db, config, "model", "fingerprint"), 2);
  assert.equal(countPendingEmbeddingHashes(db, config, "model", "fingerprint", ["docs"]), 2);
  assert.equal(countPendingEmbeddingHashes(db, config, "model", "fingerprint", ["notes"]), 1);
  assert.equal(countPendingEmbeddingHashes(db, config, "model", "fingerprint", ["history"]), 0);
  db.close();
});

test("all lexical-only collections report no pending embeddings without querying vectors", () => {
  const db = new Database(":memory:");
  const config = { collections: { history: { path: "/vault/history", embedding: false } } };
  assert.equal(countPendingEmbeddingHashes(db, config, "model", "fingerprint"), 0);
  db.close();
});

test("effective status preserves upstream fields while replacing pending count", () => {
  assert.deepEqual(
    effectiveEmbeddingStatus({ totalDocuments: 4, needsEmbedding: 3, collections: ["a"] }, 1),
    { totalDocuments: 4, needsEmbedding: 1, collections: ["a"] },
  );
});

test("T09: stale model and fingerprint vectors stay pending until the exact embedding identity completes", () => {
  const db = createDb();
  const doc = db.prepare("INSERT INTO documents (collection, path, hash, active) VALUES (?, ?, ?, ?)");
  const vector = db.prepare("INSERT INTO content_vectors (hash, seq, model, embed_fingerprint, total_chunks) VALUES (?, ?, ?, ?, ?)");
  doc.run("docs", "model.md", "stale-model", 1);
  doc.run("notes", "fingerprint.md", "stale-fingerprint", 1);
  vector.run("stale-model", 0, "old-model", "fingerprint", 1);
  vector.run("stale-fingerprint", 0, "model", "old-fingerprint", 1);
  const config = { collections: { docs: {}, notes: { includeByDefault: false } } };
  assert.equal(countPendingEmbeddingHashes(db, config, "model", "fingerprint"), 2);
  vector.run("stale-model", 0, "model", "fingerprint", 1);
  vector.run("stale-fingerprint", 0, "model", "fingerprint", 1);
  assert.equal(countPendingEmbeddingHashes(db, config, "model", "fingerprint"), 0);
  db.close();
});
