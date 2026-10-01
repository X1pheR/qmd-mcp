import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createMaintenanceJobs } from "../maintenance-jobs.mjs";

const llmSource = readFileSync(new URL("../node_modules/@tobilu/qmd/dist/llm.js", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../node_modules/@tobilu/qmd/dist/store.js", import.meta.url), "utf8");
const sdkSource = readFileSync(new URL("../node_modules/@tobilu/qmd/dist/index.js", import.meta.url), "utf8");
const quiet = { warn() {}, error() {} };
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, "Pinned executable fixture anchors must exist");
  return source.slice(a, b);
}
const Native = vm.runInNewContext("class Native {" + between(llmSource, "    async embed(text, options = {}) {", "    async generate(") + "}; Native", { console: quiet, AbortSignal });
function native(contexts) {
  const value = new Native();
  Object.assign(value, {
    _ciMode: false, touchActivity() {}, embedModelUri: "test-model",
    ensureEmbedContexts: async () => contexts, ensureEmbedContext: async () => contexts[0],
    truncateToContextSize: async text => ({ text, truncated: false, limit: 100 }),
  });
  return value;
}
test("T15: sequential native loop awaits in-flight evaluation and starts no next text after abort", async () => {
  const controller = new AbortController(), held = deferred(), maintenance = createMaintenanceJobs();
  let calls = 0;
  const value = native([{ getEmbeddingFor: async () => { calls++; await held.promise; return { vector: [1] }; } }]);
  const job = maintenance.startJob("scheduled_embed", {}, () => value.embedBatch(["a", "b", "c"], { signal: controller.signal }));
  await turn(); controller.abort(); await turn();
  assert.equal(maintenance.activeJobId, job.id); assert.equal(calls, 1);
  held.resolve(); await maintenance.waitForIdle();
  assert.equal(calls, 1); assert.equal(maintenance.jobs.get(job.id).result.length, 3);
  assert.equal(maintenance.jobs.get(job.id).result[1], null); assert.equal(maintenance.activeJobId, null);
});
test("T15: parallel native workers retain index alignment and stop each next evaluation", async () => {
  const controller = new AbortController(), held = deferred(); let calls = 0;
  const context = () => ({ getEmbeddingFor: async () => { calls++; await held.promise; return { vector: [calls] }; } });
  const result = native([context(), context()]).embedBatch(["a", "b", "c", "d"], { signal: controller.signal });
  await turn(); assert.equal(calls, 2); controller.abort(); held.resolve();
  const vectors = await result;
  assert.equal(calls, 2); assert.equal(vectors.length, 4); assert.equal(vectors[1], null); assert.equal(vectors[3], null);
});
test("T16: abort during async setup prevents truncation and native evaluation", async () => {
  const controller = new AbortController(), held = deferred(); let prepared = 0, calls = 0;
  const value = native([{ getEmbeddingFor: async () => { calls++; return { vector: [1] }; } }]);
  value.ensureEmbedContext = async () => { await held.promise; return { getEmbeddingFor: async () => { calls++; return { vector: [1] }; } }; };
  value.truncateToContextSize = async text => { prepared++; return { text }; };
  const result = value.embed("a", { signal: controller.signal });
  await turn(); controller.abort(); held.resolve();
  assert.equal(await result, null); assert.equal(prepared, 0); assert.equal(calls, 0);
});
test("T16: abort during truncation prevents the native call", async () => {
  const controller = new AbortController(); let calls = 0;
  const value = native([{ getEmbeddingFor: async () => { calls++; return { vector: [1] }; } }]);
  value.truncateToContextSize = async text => { controller.abort(); return { text }; };
  assert.equal(await value.embed("a", { signal: controller.signal }), null); assert.equal(calls, 0);
});
test("T16: tokenization abort returns no partial document chunk list", async () => {
  const controller = new AbortController(); let tokenizations = 0;
  const chunkFunction = between(storeSource, "export async function chunkDocumentByTokens(", "// =============================================================================\n// Fuzzy matching").replace("export async", "async");
  const chunk = vm.runInNewContext(chunkFunction + "; chunkDocumentByTokens", {
    CHUNK_SIZE_TOKENS: 100, CHUNK_OVERLAP_TOKENS: 0, CHUNK_WINDOW_TOKENS: 0,
    getDefaultLlamaCpp: () => ({ tokenize: async () => { tokenizations++; controller.abort(); return [1]; } }),
    chunkDocumentAsync: async () => [{ text: "a", pos: 0 }, { text: "b", pos: 1 }],
  });
  assert.equal((await chunk("ab", 100, 0, 0, "docs.md", "auto", controller.signal)).length, 0);
  assert.equal(tokenizations, 1);
});
test("T24: SDK embed forwards the exact optional signal", async () => {
  let received;
  const body = between(sdkSource, "        embed: async (embedOpts) => {", "        // Index Health").trim().replace(/,$/, "");
  const embed = vm.runInNewContext("({" + body + "}).embed", { internal: {}, generateEmbeddings: async (_store, options) => { received = options.signal; } });
  const controller = new AbortController(); await embed({ signal: controller.signal });
  assert.equal(received, controller.signal);
});
function sessionClass() {
  return vm.runInNewContext(between(llmSource, "class LLMSession {", "// Session manager for the default") + "; LLMSession",
    { AbortController, AbortSignal, setTimeout, clearTimeout, SessionReleasedError: Error });
}
test("T24: LLMSession passes its cancellation signal to both native entry points", async () => {
  const signals = [], Session = sessionClass();
  const manager = { acquire() {}, release() {}, operationStart() {}, operationEnd() {}, getLlamaCpp: () => ({
    embed: async (_text, options) => { signals.push(options.signal); },
    embedBatch: async (_texts, options) => { signals.push(options.signal); },
  }) };
  const session = new Session(manager, { maxDuration: 0 });
  await session.embed("a"); await session.embedBatch(["a"]);
  assert.equal(signals[0], session.signal); assert.equal(signals[1], session.signal); session.release();
});
test("T24: external session abort listener is removed when the session releases", () => {
  let added, removed;
  const external = { aborted: false, addEventListener(_type, fn) { added = fn; }, removeEventListener(_type, fn) { removed = fn; } };
  const Session = sessionClass();
  const session = new Session({ acquire() {}, release() {} }, { maxDuration: 0, signal: external });
  session.release(); assert.ok(added); assert.equal(removed, added);
});
test("T16: abort after model resolution does not initiate native model loading", async () => {
  const controller = new AbortController(); let loads = 0;
  const method = between(llmSource, "    async ensureEmbedModel(", "    /**\n     * Compute how many");
  const Model = vm.runInNewContext("class Model {" + method + "}; Model");
  const value = new Model();
  Object.assign(value, { embedModelUri: "test-model", touchActivity() {},
    ensureLlama: async () => ({ loadModel: async () => { loads++; return {}; } }),
    resolveModel: async () => { controller.abort(); return "test-model"; }, modelLoadOptions: path => ({ path }) });
  await assert.rejects(value.ensureEmbedModel(controller.signal)); assert.equal(loads, 0); assert.equal(value.embedModelLoadPromise, null);
});
test("T16: abort during context creation permits in-flight setup but no next context", async () => {
  const controller = new AbortController(), held = deferred(); let creations = 0;
  const methods = between(llmSource, "    embedContextsCreatePromise = null;", "    async ensureGenerateModel(");
  const Contexts = vm.runInNewContext("class Contexts {" + methods + "}; Contexts", { LlamaCpp: { EMBED_CONTEXT_SIZE: 100 } });
  const value = new Contexts();
  Object.assign(value, { embedContexts: [], touchActivity() {},
    ensureEmbedModel: async () => ({ createEmbeddingContext: async () => { creations++; await held.promise; return {}; } }),
    computeParallelism: async () => 2, threadsPerContext: async () => 1 });
  const result = value.ensureEmbedContexts(controller.signal);
  await turn(); controller.abort(); held.resolve();
  await assert.rejects(result); assert.equal(creations, 1); assert.equal(value.embedContexts.length, 1);
});

test("T16: tokenizer cancellation rejects the entire preparation without a hard failure", async () => {
  const controller = new AbortController();
  const chunkFunction = between(storeSource, "export async function chunkDocumentByTokens(", "// =============================================================================\n// Fuzzy matching").replace("export async", "async");
  const chunk = vm.runInNewContext(chunkFunction + "; chunkDocumentByTokens", {
    CHUNK_SIZE_TOKENS: 100, CHUNK_OVERLAP_TOKENS: 0, CHUNK_WINDOW_TOKENS: 0,
    getDefaultLlamaCpp: () => ({ tokenize: async () => { controller.abort(); controller.signal.throwIfAborted(); } }),
    chunkDocumentAsync: async () => [{ text: "a", pos: 0 }],
  });
  assert.equal((await chunk("a", 100, 0, 0, "docs.md", "auto", controller.signal)).length, 0);
});

function storeFixture({ separate = false, abortPreparation = false } = {}) {
  const controller = new AbortController(), rows = new Map(); let singleCalls = 0, batchCalls = 0, sessionOptions, clears = 0;
  const docs = separate ? [{ hash: "a", path: "a.md", body: "a", bytes: 1 }, { hash: "b", path: "b.md", body: "b", bytes: 1 }]
    : [{ hash: "a", path: "a.md", body: "a", bytes: 1 }];
  const db = { prepare(sql) { return {
    all(hash) { return [...(rows.get(hash) ?? [])].map(seq => ({ seq })); },
    run(hash) { if (sql.startsWith("DELETE FROM content_vectors")) rows.delete(hash); },
  }; } };
  const Session = sessionClass(), llm = {
    embed: async () => { singleCalls++; return { embedding: [1] }; },
    embedBatch: async () => { batchCalls++; controller.abort(); return [{ embedding: [1] }, null]; },
  };
  const manager = { acquire() {}, release() {}, operationStart() {}, operationEnd() {}, getLlamaCpp: () => llm };
  const cleanup = between(storeSource, "function removeIncompleteEmbeddings(", "// =============================================================================\n// Query expansion");
  const generateSource = between(storeSource, "export async function generateEmbeddings(", "export function createStore(").replace("export async", "async");
  const generate = vm.runInNewContext(cleanup + generateSource + "; generateEmbeddings", {
    console: quiet, process: { env: {} }, TextEncoder, Float32Array,
    getLlm: () => llm, DEFAULT_EMBED_MODEL: "test", getEmbeddingFingerprint: () => "test",
    resolveEmbedOptions: () => ({ maxDocsPerBatch: 10, maxBatchBytes: 100 }),
    clearAllEmbeddings: () => { clears++; }, getPendingEmbeddingDocs: () => docs,
    buildEmbeddingBatches: value => [value], getEmbeddingDocsForBatch: (_db, value) => value,
    extractTitle: () => "test", formatDocForEmbedding: text => text,
    chunkDocumentByTokens: async () => {
      if (abortPreparation) { controller.abort(); return []; }
      return (separate ? ["x"] : ["x", "y"]).map((text, pos) => ({ text, pos, tokens: 1 }));
    },
    insertEmbedding: (_db, hash, seq) => { if (!rows.has(hash)) rows.set(hash, new Set()); rows.get(hash).add(seq); },
    withLazyContentVectorMigration: (_db, fn) => fn(),
    withLLMSessionForLlm: async (_llm, fn, options) => {
      sessionOptions = options; const session = new Session(manager, options);
      try { return await fn(session); } finally { session.release(); }
    },
  });
  return { controller, rows, run: options => generate({ db, ensureVecTable() {} }, { signal: controller.signal, ...options }),
    state: () => ({ singleCalls, batchCalls, sessionOptions, clears }) };
}
test("T16: interrupted hash loses partial vectors and remains eligible for a later sweep", async () => {
  const fixture = storeFixture(), result = await fixture.run();
  assert.equal(result.chunksEmbedded, 0); assert.equal(fixture.rows.size, 0);
  assert.equal(fixture.state().singleCalls, 1); assert.equal(fixture.state().batchCalls, 1);
});
test("T16: interrupted batch retains complete hashes and removes incomplete hashes only", async () => {
  const fixture = storeFixture({ separate: true }), result = await fixture.run();
  assert.equal(result.chunksEmbedded, 1); assert.equal(fixture.rows.get("a").size, 1); assert.equal(fixture.rows.has("b"), false);
});
test("T16: preparation abort admits no dimension probe or embedding batch", async () => {
  const fixture = storeFixture({ abortPreparation: true }), result = await fixture.run();
  assert.equal(result.chunksEmbedded, 0); assert.equal(fixture.state().singleCalls, 0); assert.equal(fixture.state().batchCalls, 0);
});
test("T24: store session forwards the shared signal and defaults to sixty minutes", async () => {
  const fixture = storeFixture(); await fixture.run();
  assert.equal(fixture.state().sessionOptions.signal, fixture.controller.signal);
  assert.equal(fixture.state().sessionOptions.maxDuration, 3_600_000);
});
test("T16: pre-aborted forced embedding does not clear stored vectors", async () => {
  const fixture = storeFixture(); fixture.controller.abort();
  await assert.rejects(fixture.run({ force: true })); assert.equal(fixture.state().clears, 0);
});
