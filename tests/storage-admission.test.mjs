import test from "node:test";
import assert from "node:assert/strict";
import { createStorageAdmission, StorageDeferredError } from "../storage-admission.mjs";
import { createMaintenanceJobs } from "../maintenance-jobs.mjs";
import { createEmbeddingScheduler } from "../embedding-scheduler.mjs";

const psi = value => "some avg10=99.0 avg60=1.0 avg300=1.0 total=1\nfull avg10=" + value + " avg60=0.0 avg300=0.0 total=1\n";
function harness(extra = {}) {
  let time = 1000000, io = 0, memory = 0, throttle = { schemaVersion: 1, observedAt: new Date(time).toISOString(), throttledIOs: 0 };
  const guard = createStorageAdmission({ now: () => time, read: path =>
    path === "/proc/pressure/io" ? psi(io) : path === "/proc/pressure/memory" ? psi(memory) : JSON.stringify(throttle), ...extra });
  return { guard, advance: ms => { time += ms; }, io: value => { io = value; },
    memory: value => { memory = value; }, throttle: value => { throttle = value; } };
}

test("ambient pressure defers maintenance without work amplification, then recovers after cooldown", async () => {
  const h = harness(), jobs = createMaintenanceJobs({ admit: h.guard.admit, finished: h.guard.finished });
  h.io(8);
  for (let i = 0; i < 100; i++) assert.throws(() => jobs.startJob("scheduled_embed", {}, async () => ({})), StorageDeferredError);
  assert.equal(jobs.jobs.size, 0); assert.equal(jobs.activeJobId, null);
  h.io(0); assert.equal(h.guard.check("embed").reason, "cooldown");
  h.advance(300001);
  jobs.startJob("scheduled_embed", {}, async () => ({}));
  await jobs.waitForIdle();
  assert.equal(jobs.jobs.size, 1);
});

test("partial and failed work back off per kind while shared quiet period separates refresh/embed", () => {
  const h = harness();
  h.guard.finished({ type: "scheduled_embed", state: "partial" });
  assert.equal(h.guard.check("refresh").allowed, false);
  h.advance(60001); assert.equal(h.guard.check("refresh").allowed, true);
  assert.equal(h.guard.check("embed").allowed, false);
  h.advance(1800000); assert.equal(h.guard.check("embed").allowed, true);
  h.guard.finished({ type: "embed", state: "failed" });
  assert.equal(h.guard.health().backoff.embed.failures, 2);
  h.advance(3600001); assert.equal(h.guard.check("embed").allowed, true);
  h.guard.finished({ type: "embed", state: "succeeded" });
  assert.equal(h.guard.health().backoff.embed.failures, 0);
});

test("configured stale or malformed cloud signals fail closed without a cloud call", () => {
  const h = harness({ throttlePath: "/signal" });
  assert.equal(h.guard.check("embed").allowed, true);
  h.advance(600001); assert.equal(h.guard.check("embed").reason, "throttle_unavailable");
  h.throttle({}); assert.equal(h.guard.check("embed").reason, "throttle_unavailable");
});

test("cloud throttling and real memory pressure independently defer", () => {
  const h = harness({ throttlePath: "/signal" });
  h.throttle({ schemaVersion: 1, observedAt: new Date(1000000).toISOString(), throttledIOs: 1 });
  assert.equal(h.guard.check("embed").reason, "storage_throttled");
  const memory = harness(); memory.memory(6);
  assert.equal(memory.guard.check("refresh").reason, "memory_pressure");
});

test("unreadable pressure is visible and cannot silently admit work", () => {
  const h = harness({ read: () => { throw new Error("missing"); } });
  assert.equal(h.guard.check("embed").reason, "pressure_unavailable");
});

test("embedding stops between collections when ambient IO deteriorates and retains progress", async () => {
  const h = harness(), jobs = createMaintenanceJobs({ admit: h.guard.admit, finished: h.guard.finished });
  let debt = 2, calls = 0;
  const scheduler = createEmbeddingScheduler({
    intervalMinutes: 30, initialDelaySeconds: 0, maxDurationMs: 60000,
    maxDocsPerBatch: 2, maxBatchMb: 2, maintenance: jobs, storage: h.guard,
    getConfig: () => ({ collections: { first: {}, second: {} } }),
    pending: () => debt, activeQueries: () => 0, sanitizeError: () => "safe",
    warn: () => {}, embed: async () => { calls++; debt--; h.io(9); return { chunksEmbedded: 1, errors: 0 }; },
  });
  const job = scheduler.tick(); await jobs.waitForIdle();
  assert.equal(calls, 1); assert.equal(jobs.jobs.get(job.id).state, "partial");
  assert.equal(jobs.jobs.get(job.id).result.stopReason, "storage_pressure");
  assert.equal(jobs.jobs.get(job.id).result.chunksEmbedded, 1);
});
