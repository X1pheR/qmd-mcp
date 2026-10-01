import { performance } from "node:perf_hooks";
import { collectionEmbeddingEnabled, embeddingEnabledCollectionNames } from "./embedding-policy.mjs";

const systemClock = {
  now: () => Date.now(), monotonic: () => performance.now(),
  setTimeout, clearTimeout, setInterval, clearInterval,
};

export function createEmbeddingScheduler({
  intervalMinutes, initialDelaySeconds, maxDurationMs, maxDocsPerBatch, maxBatchMb,
  maintenance, getConfig, pending, activeQueries, embed,
  clock = systemClock, sanitizeError, warn = message => console.error(message),
  parallelism = null,
}) {
  let initialTimer = null, intervalTimer = null, next = null, last = null;
  let started = false, stopped = false, runController = null, activeDeadlineTimer = null;
  const timestamp = () => new Date(clock.now()).toISOString();
  const health = () => ({
    enabled: intervalMinutes > 0, intervalMinutes, initialDelaySeconds, last, next,
    embedBatch: { maxDocsPerBatch, maxBatchMb, maxDurationMs, deadlineMode: "cooperative", parallelism },
  });

  function classify(result) {
    const errors = result.collectionErrors.length + result.embeddings.reduce((sum, value) => sum + (value.errors || 0), 0);
    if (errors > 0 && result.completedCollections === 0 && result.chunksEmbedded === 0) return "failed";
    return errors > 0 || result.needsEmbedding !== 0 || result.stopReason ? "partial" : "succeeded";
  }

  async function sweep(selected, setProgress, maintenanceSignal) {
    const controller = new AbortController();
    runController = controller;
    const signal = AbortSignal.any([controller.signal, maintenanceSignal]);
    const deadline = clock.monotonic() + maxDurationMs;
    const deadlineTimer = clock.setTimeout(() => controller.abort(), maxDurationMs);
    activeDeadlineTimer = deadlineTimer;
    const result = { embeddings: [], collectionErrors: [], needsEmbedding: null, chunksEmbedded: 0, completedCollections: 0 };
    const stopReason = () => stopped || maintenanceSignal.aborted ? "shutdown"
      : controller.signal.aborted || clock.monotonic() >= deadline ? "deadline"
      : activeQueries() > 0 ? "querying" : null;
    try {
      for (const [index, collection] of selected.entries()) {
        const reason = stopReason();
        if (reason) { result.stopReason = reason; break; }
        // Reload policy and debt synchronously immediately before each call.
        const config = getConfig();
        if (!collectionEmbeddingEnabled(config, collection) || pending([collection]) === 0) continue;
        try {
          let observedChunks = 0;
          const value = await embed({
            collection, force: false, chunkStrategy: "auto",
            maxDocsPerBatch, maxBatchBytes: maxBatchMb * 1024 * 1024, signal,
            onProgress(progress) {
              observedChunks = Math.max(observedChunks, progress.chunksEmbedded || 0);
              setProgress({ ...progress, collection, collectionIndex: index + 1, collectionCount: selected.length });
            },
          }).catch(error => {
            result.chunksEmbedded += observedChunks;
            throw error;
          });
          result.embeddings.push({ ...value, collection });
          result.chunksEmbedded += value.chunksEmbedded || 0;
          if (!value.errors && pending([collection]) === 0) result.completedCollections++;
        } catch (error) {
          result.collectionErrors.push({ collection, error: sanitizeError(error) });
        }
      }
      const reason = stopReason();
      if (reason) result.stopReason = reason;
    } catch (error) {
      // Keep earlier committed progress if policy reload or pending evaluation fails.
      result.collectionErrors.push({ collection: null, error: sanitizeError(error) });
    } finally {
      clock.clearTimeout(deadlineTimer);
      activeDeadlineTimer = null;
      runController = null;
    }
    try { result.needsEmbedding = pending(); }
    catch (error) { result.collectionErrors.push({ collection: null, error: sanitizeError(error) }); }
    setProgress({ phase: "complete", needsEmbedding: result.needsEmbedding });
    return result;
  }

  function tick() {
    if (intervalMinutes <= 0 || stopped) return null;
    const attemptedAt = timestamp();
    try {
      if (maintenance.activeJobId) {
        last = { attemptedAt, state: "skipped_busy", jobId: maintenance.activeJobId }; return null;
      }
      if (activeQueries() > 0) { last = { attemptedAt, state: "skipped_querying" }; return null; }
      const selected = embeddingEnabledCollectionNames(getConfig()).filter(name => pending([name]) > 0);
      if (selected.length === 0) { last = { attemptedAt, state: "no_pending_work" }; return null; }
      // No await between admission and the shared synchronous maintenance claim.
      const job = maintenance.startJob("scheduled_embed", { collections: selected, trigger: "timer", force: false },
        (setProgress, signal) => sweep(selected, setProgress, signal), classify);
      last = { attemptedAt, state: "started", jobId: job.id };
      void maintenance.waitForIdle().then(() => {
        const finished = maintenance.jobs.get(job.id);
        last = { attemptedAt, state: finished.state, jobId: job.id, finishedAt: finished.finishedAt };
        if (finished.state === "partial" || finished.state === "failed") {
          warn(`QMD scheduled embedding ${finished.state}: collections=${finished.result?.embeddings.length || 0}, failures=${finished.result?.collectionErrors.length || 0}, pending=${finished.result?.needsEmbedding ?? "unknown"}, stop=${finished.result?.stopReason || "none"}`);
        }
      });
      return job;
    } catch (error) {
      last = { attemptedAt, state: "failed_to_start", error: sanitizeError(error) };
      warn("QMD scheduled embedding failed to start; inspect scheduler health.");
      return null;
    }
  }

  function start() {
    if (intervalMinutes <= 0 || started || stopped) return;
    started = true;
    const intervalMs = intervalMinutes * 60000;
    next = new Date(clock.now() + initialDelaySeconds * 1000).toISOString();
    initialTimer = clock.setTimeout(() => {
      clock.clearTimeout(initialTimer); initialTimer = null;
      next = new Date(clock.now() + intervalMs).toISOString();
      tick();
      intervalTimer = clock.setInterval(() => {
        next = new Date(clock.now() + intervalMs).toISOString(); tick();
      }, intervalMs);
    }, initialDelaySeconds * 1000);
  }

  function stop() {
    stopped = true;
    if (initialTimer !== null) clock.clearTimeout(initialTimer);
    if (intervalTimer !== null) clock.clearInterval(intervalTimer);
    initialTimer = intervalTimer = null; next = null;
    runController?.abort();
    if (activeDeadlineTimer !== null) clock.clearTimeout(activeDeadlineTimer);
  }
  return { start, stop, tick, health };
}
