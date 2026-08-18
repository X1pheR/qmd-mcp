import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer as createReadMcpServer } from "./node_modules/@tobilu/qmd/dist/mcp/server.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createStore } from "@tobilu/qmd";
import { loadConfig } from "./node_modules/@tobilu/qmd/dist/collections.js";
import { DEFAULT_EMBED_MODEL, getEmbeddingFingerprint } from "./node_modules/@tobilu/qmd/dist/store.js";
import {
  assertSearchEmbeddingPolicy,
  collectionEmbeddingEnabled,
  countPendingEmbeddingHashes,
  effectiveEmbeddingStatus,
  embeddingEnabledCollectionNames,
  validateEmbeddingPolicy,
} from "./embedding-policy.mjs";
import { z } from "zod";

const port = Number(process.env.QMD_HTTP_PORT || "8181");
const host = process.env.QMD_HTTP_HOST || "0.0.0.0";
const dbPath = process.env.INDEX_PATH || "/data/index.sqlite";
const configPath = process.env.QMD_CONFIG_PATH || "/config/index.yml";
const defaultCollection = process.env.QMD_DEFAULT_COLLECTION || null;
const maxRetainedJobs = 20;

const publicJobOutputSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  state: z.enum(["queued", "running", "succeeded", "partial", "failed"]),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  parameters: z.record(z.string(), z.unknown()),
  progress: z.unknown().nullable(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
});

const healthOutputSchema = {
  status: z.unknown(),
  indexHealth: z.unknown(),
  state: z.enum(["maintenance", "querying", "idle"]),
  activeQueries: z.number().int().nonnegative(),
  lastActivityAt: z.string().nullable(),
  activeJob: publicJobOutputSchema.nullable(),
  scheduledRefresh: z.object({
    enabled: z.boolean(),
    intervalMinutes: z.number().int().nonnegative(),
    initialDelaySeconds: z.number().int().nonnegative(),
    last: z.unknown().nullable(),
    next: z.string().nullable(),
    embedBatch: z.object({
      maxDocsPerBatch: z.number().int().positive(),
      maxBatchMb: z.number().int().positive(),
      maxDurationMinutes: z.number().positive(),
    }),
  }),
};

const startJobOutputSchema = {
  job: publicJobOutputSchema,
};

const jobStatusOutputSchema = {
  job: publicJobOutputSchema.optional(),
  jobs: z.array(publicJobOutputSchema).optional(),
};

function readBoundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

const refreshIntervalMinutes = readBoundedInteger("QMD_REFRESH_INTERVAL_MINUTES", 15, 0, 1440);
const refreshInitialDelaySeconds = readBoundedInteger("QMD_REFRESH_INITIAL_DELAY_SECONDS", 120, 0, 3600);
const scheduledEmbedMaxDocsPerBatch = readBoundedInteger("QMD_EMBED_MAX_DOCS_PER_BATCH", 8, 1, 32);
const scheduledEmbedMaxBatchMb = readBoundedInteger("QMD_EMBED_MAX_BATCH_MB", 16, 1, 128);
const scheduledEmbedMaxDurationMs = readBoundedInteger("QMD_EMBED_MAX_DURATION_MS", 3_600_000, 60_000, 7_200_000);

const store = await createStore({ dbPath, configPath });

function embeddingConfig() {
  const config = loadConfig();
  validateEmbeddingPolicy(config);
  return config;
}

function embeddingModelName() {
  return store.internal?.llm?.embedModelName || DEFAULT_EMBED_MODEL;
}

function effectiveNeedsEmbedding(selectedCollections) {
  const model = embeddingModelName();
  return countPendingEmbeddingHashes(
    store.internal.db,
    embeddingConfig(),
    model,
    getEmbeddingFingerprint(model),
    selectedCollections,
  );
}

async function effectiveStatus() {
  return effectiveEmbeddingStatus(await store.getStatus(), effectiveNeedsEmbedding());
}

async function effectiveIndexHealth() {
  return effectiveEmbeddingStatus(await store.getIndexHealth(), effectiveNeedsEmbedding());
}

async function updateCollections(collections, onProgress) {
  const result = await store.update({ collections, onProgress });
  return effectiveEmbeddingStatus(result, effectiveNeedsEmbedding());
}

const readStore = {
  ...store,
  search: async (options) => {
    assertSearchEmbeddingPolicy(embeddingConfig(), options);
    return store.search(options);
  },
  getStatus: effectiveStatus,
  getIndexHealth: effectiveIndexHealth,
};

embeddingConfig();

const sessions = new Map();
const jobs = new Map();
let activeJobId = null;
let activeQueries = 0;
let lastActivityAt = null;
let nextScheduledRefreshAt = null;
let refreshTimer = null;
let refreshStartTimer = null;
let lastScheduledRefresh = null;
const startedAt = Date.now();

function now() {
  return new Date().toISOString();
}

function markActivity() {
  lastActivityAt = now();
}

function runtimeState() {
  if (activeJobId) return "maintenance";
  if (activeQueries > 0) return "querying";
  return "idle";
}

function trackedQueryCount(payload) {
  const messages = Array.isArray(payload) ? payload : [payload];
  return messages.filter((message) =>
    message?.method === "tools/call"
      && ["query", "query_reranked"].includes(message?.params?.name),
  ).length;
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(dbPath, "<index>").replaceAll(configPath, "<config>").slice(0, 1000);
}

function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    state: job.state,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    parameters: job.parameters,
    progress: job.progress,
    result: job.result,
    error: job.error,
  };
}

function resultErrorCount(result) {
  if (!result || typeof result !== "object") return 0;
  let total = Number.isFinite(result.errors) ? Number(result.errors) : 0;
  if (Array.isArray(result.embeddings)) {
    total += result.embeddings.reduce(
      (sum, embedding) => sum + (Number.isFinite(embedding?.errors) ? Number(embedding.errors) : 0),
      0,
    );
  }
  return total;
}

function pruneJobs() {
  const completed = [...jobs.values()]
    .filter((job) => job.state !== "running" && job.state !== "queued")
    .sort((left, right) => String(left.finishedAt).localeCompare(String(right.finishedAt)));
  while (jobs.size > maxRetainedJobs && completed.length > 0) {
    const oldest = completed.shift();
    jobs.delete(oldest.id);
  }
}

async function collectionNames() {
  return Object.keys(embeddingConfig()?.collections || {});
}

async function embeddingCollectionNames() {
  return embeddingEnabledCollectionNames(embeddingConfig());
}

async function validateCollections(requested) {
  const available = await collectionNames();
  const selected = requested?.length ? requested : available;
  const invalid = selected.filter((name) => !available.includes(name));
  if (invalid.length > 0) {
    throw new Error(`Unknown collection(s): ${invalid.join(", ")}. Available: ${available.join(", ")}`);
  }
  return selected;
}

function startJob(type, parameters, execute) {
  if (activeJobId) {
    const active = jobs.get(activeJobId);
    if (active && ["queued", "running"].includes(active.state)) {
      throw new Error(`Job already active: ${active.id} (${active.type})`);
    }
    activeJobId = null;
  }

  const job = {
    id: randomUUID(),
    type,
    state: "queued",
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
    parameters,
    progress: null,
    result: null,
    error: null,
  };
  jobs.set(job.id, job);
  activeJobId = job.id;
  markActivity();
  pruneJobs();

  queueMicrotask(async () => {
    job.state = "running";
    job.startedAt = now();
    try {
      job.result = await execute((progress) => {
        job.progress = progress;
      });
      job.state = resultErrorCount(job.result) > 0 ? "partial" : "succeeded";
    } catch (error) {
      job.state = "failed";
      job.error = sanitizeError(error);
    } finally {
      job.finishedAt = now();
      if (activeJobId === job.id) {
        activeJobId = null;
      }
      markActivity();
      pruneJobs();
    }
  });

  return publicJob(job);
}

async function startScheduledRefresh() {
  const selected = await collectionNames();
  const embeddable = (await embeddingCollectionNames()).filter((name) => selected.includes(name));
  return startJob("scheduled_refresh", { collections: selected, trigger: "timer" }, async (setProgress) => {
    setProgress({ phase: "update", collection: null });
    const update = await updateCollections(
      selected,
      (progress) => setProgress({
        phase: "update",
        collection: progress.collection,
        current: progress.current,
        total: progress.total,
      }),
    );

    const statusAfterUpdate = await effectiveStatus();
    if (statusAfterUpdate.needsEmbedding === 0) {
      setProgress({ phase: "complete", collection: null, needsEmbedding: 0 });
      return {
        update,
        embeddings: [],
        embeddingSkipped: true,
        needsEmbedding: 0,
      };
    }

    const embeddings = [];
    for (const collection of embeddable) {
      if (effectiveNeedsEmbedding([collection]) === 0) continue;
      setProgress({ phase: "embed", collection });
      const result = await store.embed({
        collection,
        force: false,
        maxDocsPerBatch: scheduledEmbedMaxDocsPerBatch,
        maxBatchBytes: scheduledEmbedMaxBatchMb * 1024 * 1024,
        chunkStrategy: "regex",
        onProgress: (progress) => setProgress({
          phase: "embed",
          collection,
          chunksEmbedded: progress.chunksEmbedded,
          totalChunks: progress.totalChunks,
          bytesProcessed: progress.bytesProcessed,
          totalBytes: progress.totalBytes,
          errors: progress.errors,
        }),
      });
      embeddings.push({
        collection,
        docsProcessed: result.docsProcessed,
        chunksEmbedded: result.chunksEmbedded,
        errors: result.errors,
        durationMs: result.durationMs,
      });
    }
    return {
      update,
      embeddings,
      embeddingSkipped: embeddings.length === 0,
      needsEmbedding: effectiveNeedsEmbedding(),
    };
  });
}

async function scheduledRefreshTick() {
  const attemptedAt = now();
  try {
    if (activeJobId) {
      lastScheduledRefresh = { attemptedAt, state: "skipped_busy", jobId: activeJobId };
      return;
    }
    const job = await startScheduledRefresh();
    lastScheduledRefresh = { attemptedAt, state: "started", jobId: job.id };
  } catch (error) {
    lastScheduledRefresh = { attemptedAt, state: "failed_to_start", error: sanitizeError(error) };
  }
}

function startRefreshSchedule() {
  if (refreshIntervalMinutes <= 0) return;
  const intervalMs = refreshIntervalMinutes * 60 * 1000;
  nextScheduledRefreshAt = new Date(Date.now() + refreshInitialDelaySeconds * 1000).toISOString();
  refreshStartTimer = setTimeout(() => {
    nextScheduledRefreshAt = new Date(Date.now() + intervalMs).toISOString();
    void scheduledRefreshTick();
    refreshTimer = setInterval(() => {
      nextScheduledRefreshAt = new Date(Date.now() + intervalMs).toISOString();
      void scheduledRefreshTick();
    }, intervalMs);
  }, refreshInitialDelaySeconds * 1000);
}

function textResult(text, structuredContent, isError = false) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

async function createMcpServer() {
  const server = await createReadMcpServer(readStore);

  server.registerTool(
    "health",
    {
      title: "QMD Admin Health",
      description: "Return QMD collection, index and current job health.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {},
      outputSchema: healthOutputSchema,
    },
    async () => {
      const [status, indexHealth] = await Promise.all([effectiveStatus(), effectiveIndexHealth()]);
      const payload = {
        status,
        indexHealth,
        state: runtimeState(),
        activeQueries,
        lastActivityAt,
        activeJob: activeJobId ? publicJob(jobs.get(activeJobId)) : null,
        scheduledRefresh: {
          enabled: refreshIntervalMinutes > 0,
          intervalMinutes: refreshIntervalMinutes,
          initialDelaySeconds: refreshInitialDelaySeconds,
          last: lastScheduledRefresh,
          next: nextScheduledRefreshAt,
          embedBatch: {
            maxDocsPerBatch: scheduledEmbedMaxDocsPerBatch,
            maxBatchMb: scheduledEmbedMaxBatchMb,
            maxDurationMinutes: scheduledEmbedMaxDurationMs / 60_000,
          },
        },
      };
      return textResult(
        `QMD admin health: ${status.totalDocuments} documents, ${status.needsEmbedding} need embedding, state ${runtimeState()}.`,
        payload,
      );
    },
  );

  server.registerTool(
    "start_update",
    {
      title: "Start QMD Index Update",
      description: "Start one bounded asynchronous filesystem reindex job for configured collections.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        collections: z.array(z.string()).min(1).max(8).optional().describe("Configured collection names. Defaults to all configured collections."),
      },
      outputSchema: startJobOutputSchema,
    },
    async ({ collections }) => {
      try {
        const selected = await validateCollections(collections);
        const job = startJob("update", { collections: selected }, async (setProgress) =>
          updateCollections(
            selected,
            (progress) => setProgress({
              collection: progress.collection,
              file: progress.file,
              current: progress.current,
              total: progress.total,
            }),
          ),
        );
        return textResult(`Started QMD update job ${job.id}.`, { job });
      } catch (error) {
        const message = sanitizeError(error);
        return textResult(message, { error: message }, true);
      }
    },
  );

  server.registerTool(
    "start_embed",
    {
      title: "Start QMD Embedding Update",
      description: "Start one bounded asynchronous embedding job for an embedding-enabled collection. Force rebuild is allowed only on this administrative server.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        collection: z.string().optional().describe("Configured embedding-enabled collection name. Defaults to QMD_DEFAULT_COLLECTION or the first embedding-enabled collection."),
        force: z.boolean().optional().default(false).describe("Rebuild existing embeddings as well as missing embeddings."),
        maxDocsPerBatch: z.number().int().min(1).max(32).optional().default(8),
        maxBatchMb: z.number().int().min(1).max(128).optional().default(16),
        chunkStrategy: z.enum(["auto", "regex"]).optional().default("auto"),
      },
      outputSchema: startJobOutputSchema,
    },
    async ({ collection, force, maxDocsPerBatch, maxBatchMb, chunkStrategy }) => {
      try {
        const embeddable = await embeddingCollectionNames();
        const requestedCollection = collection || defaultCollection || embeddable[0];
        if (!requestedCollection) throw new Error("No embedding-enabled QMD collection is available");
        const selected = await validateCollections([requestedCollection]);
        if (!collectionEmbeddingEnabled(embeddingConfig(), selected[0])) {
          throw new Error(`Embedding is disabled for collection '${selected[0]}'`);
        }
        const parameters = {
          collection: selected[0],
          force,
          maxDocsPerBatch,
          maxBatchMb,
          chunkStrategy,
        };
        const job = startJob("embed", parameters, async (setProgress) =>
          store.embed({
            collection: selected[0],
            force,
            maxDocsPerBatch,
            maxBatchBytes: maxBatchMb * 1024 * 1024,
            chunkStrategy,
            onProgress: (progress) => setProgress({
              chunksEmbedded: progress.chunksEmbedded,
              totalChunks: progress.totalChunks,
              bytesProcessed: progress.bytesProcessed,
              totalBytes: progress.totalBytes,
              errors: progress.errors,
            }),
          }),
        );
        return textResult(`Started QMD embedding job ${job.id}.`, { job });
      } catch (error) {
        const message = sanitizeError(error);
        return textResult(message, { error: message }, true);
      }
    },
  );

  server.registerTool(
    "job_status",
    {
      title: "QMD Admin Job Status",
      description: "Return one job or the most recent bounded QMD administration jobs.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        jobId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(20).optional().default(5),
      },
      outputSchema: jobStatusOutputSchema,
    },
    async ({ jobId, limit }) => {
      if (jobId) {
        const job = jobs.get(jobId);
        if (!job) {
          return textResult(`Unknown job: ${jobId}`, { error: "job_not_found" }, true);
        }
        const payload = { job: publicJob(job) };
        return textResult(`Job ${job.id}: ${job.state}.`, payload);
      }
      const recent = [...jobs.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
        .map(publicJob);
      return textResult(`Returned ${recent.length} QMD administration job(s).`, { jobs: recent });
    },
  );

  return server;
}

async function createSession() {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => sessions.set(sessionId, transport),
  });
  const server = await createMcpServer();
  await server.connect(transport);
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };
  return transport;
}

async function collectBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const httpServer = createServer(async (nodeRequest, nodeResponse) => {
  try {
    const pathname = nodeRequest.url || "/";
    if (pathname === "/health" && nodeRequest.method === "GET") {
      const status = await effectiveStatus();
      nodeResponse.writeHead(200, { "Content-Type": "application/json" });
      nodeResponse.end(JSON.stringify({
        status: "ok",
        state: runtimeState(),
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        documents: status.totalDocuments,
        needsEmbedding: status.needsEmbedding,
        embeddings: status.needsEmbedding === 0 ? "Current" : `${status.needsEmbedding} pending`,
        activeQueries,
        activeJob: activeJobId,
        lastActivityAt,
        nextScheduledRefreshAt,
        scheduledRefreshEnabled: refreshIntervalMinutes > 0,
        refreshIntervalMinutes,
      }));
      return;
    }

    if (pathname !== "/mcp") {
      nodeResponse.writeHead(404);
      nodeResponse.end("Not Found");
      return;
    }

    const headers = {};
    for (const [key, value] of Object.entries(nodeRequest.headers)) {
      if (typeof value === "string") headers[key] = value;
    }
    const sessionId = headers["mcp-session-id"];
    let transport;
    let rawBody;
    let parsedBody;

    if (nodeRequest.method === "POST") {
      rawBody = await collectBody(nodeRequest);
      parsedBody = JSON.parse(rawBody);
      if (sessionId) {
        transport = sessions.get(sessionId);
        if (!transport) {
          nodeResponse.writeHead(404, { "Content-Type": "application/json" });
          nodeResponse.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: parsedBody?.id ?? null }));
          return;
        }
      } else if (isInitializeRequest(parsedBody)) {
        transport = await createSession();
      } else {
        nodeResponse.writeHead(400, { "Content-Type": "application/json" });
        nodeResponse.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Missing session ID" }, id: parsedBody?.id ?? null }));
        return;
      }
    } else {
      if (!sessionId || !sessions.has(sessionId)) {
        nodeResponse.writeHead(sessionId ? 404 : 400, { "Content-Type": "application/json" });
        nodeResponse.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid session ID" }, id: null }));
        return;
      }
      transport = sessions.get(sessionId);
    }

    const request = new Request(`http://localhost:${port}/mcp`, {
      method: nodeRequest.method || "GET",
      headers,
      ...(rawBody ? { body: rawBody } : {}),
    });
    const trackedQueries = trackedQueryCount(parsedBody);
    if (trackedQueries > 0) {
      activeQueries += trackedQueries;
      markActivity();
    }

    let response;
    try {
      response = await transport.handleRequest(request, parsedBody ? { parsedBody } : undefined);
    } finally {
      if (trackedQueries > 0) {
        activeQueries = Math.max(0, activeQueries - trackedQueries);
        markActivity();
      }
    }
    nodeResponse.writeHead(response.status, Object.fromEntries(response.headers));
    nodeResponse.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(`QMD admin request failed: ${sanitizeError(error)}`);
    nodeResponse.writeHead(500, { "Content-Type": "application/json" });
    nodeResponse.end(JSON.stringify({ error: "internal_error" }));
  }
});

await new Promise((resolve, reject) => {
  httpServer.once("error", reject);
  httpServer.listen(port, host, resolve);
});
console.error(`QMD unified MCP listening on http://${host}:${port}/mcp`);
startRefreshSchedule();

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (refreshStartTimer) clearTimeout(refreshStartTimer);
  if (refreshTimer) clearInterval(refreshTimer);
  for (const transport of sessions.values()) await transport.close();
  sessions.clear();
  await new Promise((resolve) => httpServer.close(resolve));
  await store.close();
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    await stop();
    process.exit(0);
  });
}
