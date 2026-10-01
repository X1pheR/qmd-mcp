import test from "node:test";
import assert from "node:assert/strict";
import { createEmbeddingScheduler } from "../embedding-scheduler.mjs";
import { createMaintenanceJobs } from "../maintenance-jobs.mjs";
import { readBoundedInteger } from "../runtime-config.mjs";

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness(options = {}) {
  const timers = new Map();
  let serial = 0, queries = 0, time = 0;
  const config = { collections: { docs: {}, notes: { embedding: true, includeByDefault: false }, history: { embedding: false } } };
  const debt = { docs: 1, notes: 1, history: 1 };
  const calls = [], warnings = [];
  const maintenance = createMaintenanceJobs();
  const clock = {
    now: () => time, monotonic: () => time,
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, delay, repeat: false }); return id; },
    setInterval(fn, delay) { const id = ++serial; timers.set(id, { fn, delay, repeat: true }); return id; },
    clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); },
  };
  const scheduler = createEmbeddingScheduler({
    intervalMinutes: 1, initialDelaySeconds: 0, maxDurationMs: 60000,
    maxDocsPerBatch: 8, maxBatchMb: 16, maintenance, clock,
    getConfig: () => config, activeQueries: () => queries,
    pending: names => (names || Object.keys(config.collections)).filter(n => config.collections[n]?.embedding !== false).reduce((sum, n) => sum + (debt[n] || 0), 0),
    embed: async value => { calls.push(value); debt[value.collection] = 0; return { chunksEmbedded: 1, errors: 0 }; },
    sanitizeError: () => "safe failure", warn: value => warnings.push(value),
    ...options,
  });
  return { scheduler, maintenance, timers, config, debt, calls, warnings,
    setQueries: value => { queries = value; }, setTime: value => { time = value; } };
}
async function finish(h) { await h.maintenance.waitForIdle(); await turn(); }

test("T01: disabled scheduling creates no timer or work", async () => {
  const h = harness({ intervalMinutes: 0 });
  h.scheduler.start(); h.scheduler.tick();
  assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 0);
  assert.equal(h.scheduler.health().enabled, false);
  assert.equal(h.scheduler.health().last, null); assert.equal(h.scheduler.health().next, null);
});
test("T02: bounded scheduler settings accept boundaries and reject malformed values", () => {
  for (const value of ["0", "1440"]) assert.equal(readBoundedInteger("X", 0, 0, 1440, { X: value }), Number(value));
  for (const value of ["-1", "1441", "1.5", "wrong"]) assert.throws(() => readBoundedInteger("X", 0, 0, 1440, { X: value }), /integer/);
  assert.equal(readBoundedInteger("X", 0, 0, 1440, {}), 0);
});
test("T03/T08: effective policy selects all enabled collections sequentially in one job", async () => {
  const held = deferred(); let h;
  h = harness({ embed: async value => {
    h.calls.push(value); if (value.collection === "docs") await held.promise;
    h.debt[value.collection] = 0; return { chunksEmbedded: 1, errors: 0 };
  } });
  const job = h.scheduler.tick();
  await turn(); assert.deepEqual(h.calls.map(v => v.collection), ["docs"]);
  assert.equal(h.maintenance.activeJobId, job.id);
  held.resolve(); await finish(h);
  assert.deepEqual(h.calls.map(v => v.collection), ["docs", "notes"]);
  assert.equal(h.maintenance.jobs.size, 1);
  assert.equal(h.scheduler.health().last.state, "succeeded");
});
test("T04: no eligible pending work creates no job", () => {
  const h = harness(); h.debt.docs = h.debt.notes = 0;
  h.scheduler.tick(); assert.equal(h.maintenance.jobs.size, 0);
  assert.equal(h.scheduler.health().last.state, "no_pending_work");
});
test("T05/T06: occupied synchronous claim cleanly skips scheduled work", async () => {
  const h = harness(), held = deferred();
  const job = h.maintenance.startJob("update", {}, () => held.promise);
  h.scheduler.tick();
  assert.equal(h.scheduler.health().last.state, "skipped_busy");
  assert.equal(h.maintenance.activeJobId, job.id); assert.equal(h.calls.length, 0);
  held.resolve(); await finish(h);
});
test("T07: query guard defers and preserves later eligibility", async () => {
  const h = harness(); h.setQueries(1); h.scheduler.tick();
  assert.equal(h.scheduler.health().last.state, "skipped_querying");
  assert.equal(h.debt.docs, 1); h.setQueries(0); h.scheduler.tick(); await finish(h);
  assert.equal(h.calls.length, 2);
});
test("T09: pending is rechecked after earlier collection completes shared work", async () => {
  let h; h = harness({ embed: async value => { h.calls.push(value); h.debt.docs = h.debt.notes = 0; return { errors: 0 }; } });
  h.scheduler.tick(); await finish(h); assert.equal(h.calls.length, 1);
});
test("T10: policy changed between collections prevents the next embedding", async () => {
  let h; h = harness({ embed: async value => {
    h.calls.push(value); h.debt.docs = 0; h.config.collections.notes.embedding = false; return { errors: 0 };
  } });
  h.scheduler.tick(); await finish(h); assert.equal(h.calls.length, 1);
  assert.equal(h.scheduler.health().last.state, "succeeded");
});
test("T11/T12: mixed failures preserve results and all-failure releases maintenance", async () => {
  let h; h = harness({ embed: async value => {
    h.calls.push(value);
    if (value.collection === "notes") throw new Error("private source");
    h.debt.docs = 0; return { chunksEmbedded: 1, errors: 0 };
  } });
  const job = h.scheduler.tick(); await finish(h);
  assert.equal(h.maintenance.jobs.get(job.id).state, "partial");
  assert.equal(h.maintenance.jobs.get(job.id).result.embeddings.length, 1);
  assert.equal(h.maintenance.jobs.get(job.id).result.collectionErrors[0].error, "safe failure");
  const f = harness({ embed: async () => { throw new Error("fail"); } });
  const failed = f.scheduler.tick(); await finish(f);
  assert.equal(f.maintenance.jobs.get(failed.id).state, "failed");
  assert.equal(f.maintenance.activeJobId, null);
  assert.doesNotThrow(() => f.maintenance.startJob("update", {}, async () => ({})));
  await finish(f);
});
test("T13/T14: one shared deadline leaves debt and stops the next collection", async () => {
  let h; h = harness({ embed: async value => { h.calls.push(value); h.debt.docs = 0; h.setTime(60001); return { errors: 0 }; } });
  const job = h.scheduler.tick(); await finish(h);
  assert.equal(h.calls.length, 1);
  assert.equal(h.maintenance.jobs.get(job.id).result.stopReason, "deadline");
  assert.equal(h.scheduler.health().last.state, "partial");
});
test("T18: query starts between collections and leaves recoverable pending debt", async () => {
  let h; h = harness({ embed: async value => { h.calls.push(value); h.debt.docs = 0; h.setQueries(1); return { errors: 0 }; } });
  const job = h.scheduler.tick(); await finish(h);
  assert.equal(h.calls.length, 1);
  assert.equal(h.maintenance.jobs.get(job.id).result.stopReason, "querying");
  assert.equal(h.scheduler.health().last.state, "partial");
});
test("T19/T20: stop clears timers, aborts work and keeps claim until actual return", async () => {
  const held = deferred(); let signal;
  const h = harness({ embed: async value => { signal = value.signal; await held.promise; return { errors: 0 }; } });
  h.scheduler.start();
  const first = [...h.timers.values()][0]; first.fn();
  await turn(); assert.equal(h.scheduler.health().last.state, "started");
  const active = h.maintenance.activeJobId;
  h.scheduler.stop();
  assert.equal(h.timers.size, 0); assert.equal(signal.aborted, true);
  assert.equal(h.maintenance.activeJobId, active); assert.equal(h.scheduler.health().next, null);
  held.resolve(); await finish(h);
  assert.equal(h.scheduler.health().last.state, "partial");
});
test("T21: success and no-op remain quiet; incomplete summary excludes private errors", async () => {
  const h = harness(); h.scheduler.tick(); await finish(h); h.scheduler.tick();
  assert.deepEqual(h.warnings, []);
  const f = harness({ embed: async () => { throw new Error("private text"); } });
  f.scheduler.tick(); await finish(f);
  assert.equal(f.warnings.length, 1); assert.ok(!f.warnings[0].includes("private"));
});

test("T12: returned chunk errors without retained progress are failed", async () => {
  const h = harness({ embed: async () => ({ errors: 1, chunksEmbedded: 0 }) });
  const job = h.scheduler.tick(); await finish(h);
  assert.equal(h.maintenance.jobs.get(job.id).state, "failed");
});
test("T10: invalid reloaded policy preserves prior results and releases claim", async () => {
  let h; h = harness({ embed: async value => {
    h.calls.push(value); h.debt.docs = 0; h.config.collections.notes.embedding = "invalid";
    return { errors: 0, chunksEmbedded: 1 };
  } });
  const job = h.scheduler.tick(); await finish(h);
  assert.equal(h.maintenance.jobs.get(job.id).state, "partial");
  assert.equal(h.maintenance.jobs.get(job.id).result.embeddings.length, 1);
  assert.equal(h.maintenance.activeJobId, null);
});
test("AE-12/T20: initial delay then interval checks skip busy without queueing", async () => {
  const held = deferred();
  const h = harness({ initialDelaySeconds: 120, embed: () => held.promise });
  h.scheduler.start(); h.scheduler.start();
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 120000);
  assert.equal(h.scheduler.health().next, new Date(120000).toISOString());
  [...h.timers.values()][0].fn(); await turn();
  const interval = [...h.timers.values()].find(value => value.repeat);
  interval.fn(); interval.fn();
  assert.equal(h.scheduler.health().last.state, "skipped_busy");
  assert.equal(h.maintenance.jobs.size, 1);
  held.resolve({ errors: 0 }); await finish(h);
  h.scheduler.stop();
  assert.equal(h.timers.size, 0);
});
