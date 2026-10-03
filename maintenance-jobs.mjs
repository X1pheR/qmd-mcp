import { randomUUID } from "node:crypto";

export function publicJob(job) {
  return {
    id: job.id, type: job.type, state: job.state,
    createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
    parameters: job.parameters, progress: job.progress, result: job.result, error: job.error,
  };
}

function resultErrorCount(result) {
  if (!result || typeof result !== "object") return 0;
  let total = Number.isFinite(result.errors) ? Number(result.errors) : 0;
  if (Array.isArray(result.embeddings)) {
    total += result.embeddings.reduce(
      (sum, embedding) => sum + (Number.isFinite(embedding?.errors) ? Number(embedding.errors) : 0), 0,
    );
  }
  return total;
}

export function createMaintenanceJobs({
  maxRetainedJobs = 20,
  admit = () => {}, finished = () => {},
  now = () => new Date().toISOString(),
  markActivity = () => {},
  sanitizeError = error => (error instanceof Error ? error.message : String(error)).slice(0, 1000),
} = {}) {
  const jobs = new Map();
  let activeJobId = null;
  let completion = null;
  let controller = null;
  let stopping = false;

  function pruneJobs() {
    const completed = [...jobs.values()]
      .filter(job => job.state !== "running" && job.state !== "queued")
      .sort((left, right) => String(left.finishedAt).localeCompare(String(right.finishedAt)));
    while (jobs.size > maxRetainedJobs && completed.length > 0) jobs.delete(completed.shift().id);
  }

  function startJob(type, parameters, execute, classify = result => resultErrorCount(result) > 0 ? "partial" : "succeeded") {
    if (stopping) throw new Error("Maintenance is stopping");
    if (activeJobId) {
      const active = jobs.get(activeJobId);
      throw new Error(`Job already active: ${active.id} (${active.type})`);
    }
    admit(type);
    const job = {
      id: randomUUID(), type, state: "queued", createdAt: now(),
      startedAt: null, finishedAt: null, parameters, progress: null, result: null, error: null,
    };
    const jobController = new AbortController();
    let resolveCompletion;
    const jobCompletion = new Promise(resolve => { resolveCompletion = resolve; });
    jobs.set(job.id, job);
    activeJobId = job.id;
    controller = jobController;
    completion = jobCompletion;
    markActivity();
    pruneJobs();

    queueMicrotask(async () => {
      try {
        if (jobController.signal.aborted) throw new Error("Maintenance stopped before execution");
        job.state = "running";
        job.startedAt = now();
        job.result = await execute(progress => { job.progress = progress; }, jobController.signal);
        const state = classify(job.result);
        if (!["succeeded", "partial", "failed"].includes(state)) throw new Error("Invalid maintenance terminal state");
        job.state = state;
      } catch (error) {
        job.state = "failed";
        job.error = sanitizeError(error);
      } finally {
        job.finishedAt = now();
        if (activeJobId === job.id) {
          activeJobId = null;
          controller = null;
          completion = null;
        }
        try {
          finished(job);
          markActivity();
          pruneJobs();
        } finally {
          resolveCompletion();
        }
      }
    });
    return publicJob(job);
  }

  return {
    jobs,
    get activeJobId() { return activeJobId; },
    startJob,
    async waitForIdle() { await completion; },
    async stop() {
      stopping = true;
      controller?.abort();
      await completion;
    },
  };
}
