import test from "node:test";
import assert from "node:assert/strict";
import { createMaintenanceJobs } from "../maintenance-jobs.mjs";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("T06: synchronous claim prevents manual/refresh overlap before execution", async () => {
  const jobs = createMaintenanceJobs();
  const held = deferred();
  const first = jobs.startJob("embed", {}, () => held.promise);
  assert.equal(first.state, "queued");
  assert.equal(jobs.activeJobId, first.id);
  assert.throws(() => jobs.startJob("scheduled_refresh", {}, async () => ({})), /already active/);
  await tick();
  assert.equal(jobs.jobs.get(first.id).state, "running");
  held.resolve({ errors: 0 });
  await jobs.waitForIdle();
  assert.equal(jobs.activeJobId, null);
  assert.equal(jobs.jobs.get(first.id).state, "succeeded");
});

test("T17: execution and classifier failures release claim and preserve result", async () => {
  const jobs = createMaintenanceJobs({ sanitizeError: () => "safe failure" });
  const thrown = jobs.startJob("embed", {}, async () => { throw new Error("private"); });
  await jobs.waitForIdle();
  assert.equal(jobs.jobs.get(thrown.id).state, "failed");
  assert.equal(jobs.jobs.get(thrown.id).error, "safe failure");
  const classified = jobs.startJob("embed", {}, async () => ({ retained: true }), () => { throw new Error("classifier"); });
  await jobs.waitForIdle();
  assert.equal(jobs.jobs.get(classified.id).state, "failed");
  assert.deepEqual(jobs.jobs.get(classified.id).result, { retained: true });
  const next = jobs.startJob("update", {}, async () => ({ errors: 1 }));
  await jobs.waitForIdle();
  assert.equal(jobs.jobs.get(next.id).state, "partial");
  assert.equal(jobs.activeJobId, null);
});

test("T17: throwing progress publication releases the maintenance claim", async () => {
  const jobs = createMaintenanceJobs();
  const job = jobs.startJob("embed", {}, async setProgress => {
    Object.defineProperty(jobs.jobs.get(job.id), "progress", { set() { throw new Error("progress"); } });
    setProgress({ phase: "embed" });
  });
  await jobs.waitForIdle();
  assert.equal(jobs.jobs.get(job.id).state, "failed");
  assert.equal(jobs.activeJobId, null);
});

test("T19: shutdown aborts cooperatively and retains claim until in-flight work settles", async () => {
  const jobs = createMaintenanceJobs();
  const held = deferred();
  let signal;
  const job = jobs.startJob("embed", {}, async (_progress, currentSignal) => {
    signal = currentSignal;
    await held.promise;
    return { errors: 0 };
  });
  await tick();
  let closed = false;
  const closing = jobs.stop().then(() => { closed = true; });
  assert.equal(signal.aborted, true);
  assert.equal(jobs.activeJobId, job.id);
  assert.throws(() => jobs.startJob("update", {}, async () => ({})), /stopping/);
  await tick();
  assert.equal(closed, false);
  held.resolve();
  await closing;
  assert.equal(closed, true);
  assert.equal(jobs.activeJobId, null);
});

test("T19: shutdown before queued execution prevents new work", async () => {
  const jobs = createMaintenanceJobs();
  let calls = 0;
  const job = jobs.startJob("embed", {}, async () => { calls++; });
  await jobs.stop();
  assert.equal(calls, 0);
  assert.equal(jobs.jobs.get(job.id).state, "failed");
  assert.equal(jobs.activeJobId, null);
});
