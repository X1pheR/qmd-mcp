function once(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Expected exactly one ${label} match, found ${count}`);
  return source.replace(before, after);
}
function region(source, start, end, transform, label) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  if (a < 0 || b <= a) throw new Error(`Missing ${label} region`);
  return source.slice(0, a) + transform(source.slice(a, b)) + source.slice(b);
}
export function patchEmbeddingDeadline({ sdk, store, llm }) {
  sdk = once(sdk, "                onProgress: embedOpts?.onProgress,", "                onProgress: embedOpts?.onProgress,\n                signal: embedOpts?.signal,\n                resumeIncomplete: embedOpts?.resumeIncomplete,", "SDK embed scheduler options");

  store = once(store, "export async function generateEmbeddings(store, options) {",
    "export async function generateEmbeddings(store, options) {\n    options?.signal?.throwIfAborted();", "embedding pre-abort");
  store = once(store, "    })(), name: 'generateEmbeddings' });",
    "    })(), signal: options?.signal, name: 'generateEmbeddings' });", "embedding session signal");
  store = once(store, 'if (raw === undefined || raw === "") return 30 * 60 * 1000;',
    'if (raw === undefined || raw === "") return 3_600_000;', "embedding duration default");
  store = region(store, "export async function generateEmbeddings(", "export function createStore(", source => {
    source = once(source, "        const tryEmbedChunk = async (chunk) => {",
      "        const tryEmbedChunk = async (chunk) => {\n            if (!session.isValid) return false;", "retry admission");
    source = once(source, "                for (const [key, chunk] of [...retryQueue]) {",
      "                for (const [key, chunk] of [...retryQueue]) {\n                    if (!session.isValid) break;", "retry loop deadline");
    source = once(source, "            for (const doc of batchDocs) {",
      "            for (const doc of batchDocs) {\n                if (!session.isValid) break;", "document preparation deadline");
    source = once(source, "                const chunks = await chunkDocumentByTokens(doc.body, undefined, undefined, undefined, doc.path, options?.chunkStrategy, session.signal);",
      "                const chunks = await chunkDocumentByTokens(doc.body, undefined, undefined, undefined, doc.path, options?.chunkStrategy, session.signal);\n                if (!session.isValid) break;", "post-preparation deadline");
    source = once(source, "                for (let seq = 0; seq < chunks.length; seq++) {",
      "                const existingSeqs = options?.resumeIncomplete ? new Set(withLazyContentVectorMigration(db, () => db.prepare(\"SELECT seq FROM content_vectors WHERE hash = ? AND model = ? AND embed_fingerprint = ?\").all(doc.hash, model, fingerprint)).map(row => row.seq)) : null;\n                for (let seq = 0; seq < chunks.length; seq++) {\n                    if (existingSeqs?.has(seq)) continue;", "resumable chunk admission");
    source = once(source, "            totalChunks += batchChunks.length;",
      "            if (!session.isValid) break;\n            totalChunks += batchChunks.length;", "prepared batch deadline");
    source = once(source, "            const removedPartialChunks = removeIncompleteEmbeddings(db, expectedChunksByHash, model);",
      "            const removedPartialChunks = options?.resumeIncomplete && options?.signal?.aborted ? 0 : removeIncompleteEmbeddings(db, expectedChunksByHash, model);", "resumable checkpoint cleanup");
    source = once(source, "                    for (const chunk of remainingChunks)\n                        recordFailure(chunk, \"LLM session expired before embedding chunk\");",
      "                    if (!options?.signal?.aborted) {\n                        for (const chunk of remainingChunks)\n                            recordFailure(chunk, \"LLM session expired before embedding chunk\");\n                    }", "deadline cancellation remaining chunks");
    source = once(source, "                        else {\n                            recordFailure(chunk, \"batch embedding returned no vector\");\n                        }",
      "                        else if (!options?.signal?.aborted) {\n                            recordFailure(chunk, \"batch embedding returned no vector\");\n                        }", "deadline cancellation null vectors");
    source = once(source, "                    if (!session.isValid) {\n                        for (const chunk of chunkBatch)",
      "                    if (!session.isValid) {\n                        if (!options?.signal?.aborted) {\n                            for (const chunk of chunkBatch)", "deadline cancellation batch exception open");
    source = once(source, "                        batchChunkBytesProcessed += chunkBatch.reduce((sum, c) => sum + c.bytes, 0);",
      "                        }\n                        batchChunkBytesProcessed += chunkBatch.reduce((sum, c) => sum + c.bytes, 0);", "deadline cancellation batch exception close");
    source = once(source, "                const firstResult = await session.embed(firstText, { model });",
      "                const firstResult = await session.embed(firstText, { model });\n                if (!session.isValid) break;", "dimension setup deadline");
    source = once(source, "                        for (const chunk of chunkBatch) {\n                            await tryEmbedChunk(chunk);",
      "                        for (const chunk of chunkBatch) {\n                            if (!session.isValid) break;\n                            await tryEmbedChunk(chunk);", "fallback deadline");
    return source;
  }, "embedding document loop");

  store = region(store, "export async function searchVec(", "// =============================================================================\n// Embeddings", source => {
    source = once(source, "    // Step 1: Get vector matches from sqlite-vec (no JOINs allowed)",
      "    const incompleteChunkCount = withLazyContentVectorMigration(db, () => db.prepare(\"SELECT COALESCE(SUM(chunk_count), 0) AS count FROM (SELECT COUNT(*) AS chunk_count FROM content_vectors GROUP BY hash HAVING COUNT(*) < MAX(total_chunks))\").get()?.count ?? 0);\n    // Step 1: Get vector matches from sqlite-vec (no JOINs allowed)", "vector search incomplete checkpoint count");
    const vecCall = "  `).all(new Float32Array(embedding), limit * 3);";
    source = once(source, vecCall,
      "  `).all(new Float32Array(embedding), limit * 3 + incompleteChunkCount);", "vector search checkpoint overfetch");
    const placeholderClause = "    WHERE cv.hash || '_' || cv.seq IN (${placeholders})";
    source = once(source, placeholderClause,
      placeholderClause + "\n      AND cv.hash IN (SELECT hash FROM content_vectors GROUP BY hash HAVING COUNT(*) = MAX(total_chunks))", "vector search complete hash guard");
    return source;
  }, "vector search checkpoint completeness");

  store = region(store, "export async function chunkDocumentByTokens(", "// =============================================================================\n// Fuzzy matching", source => {
    source = once(source, "    const llm = getDefaultLlamaCpp();",
      "    if (signal?.aborted) return [];\n    const llm = getDefaultLlamaCpp();", "chunk preparation admission");
    source = once(source, "    let charChunks = await chunkDocumentAsync(content, maxChars, overlapChars, windowChars, filepath, chunkStrategy);",
      "    let charChunks = await chunkDocumentAsync(content, maxChars, overlapChars, windowChars, filepath, chunkStrategy);\n    if (signal?.aborted) return [];", "post-AST deadline");
    source = once(source, "        const tokens = await llm.tokenize(text);",
      "        let tokens;\n        try { tokens = await llm.tokenize(text, { signal }); }\n        catch (error) { if (signal?.aborted) return; throw error; }\n        if (signal?.aborted) return;", "post-tokenization deadline");
    source = once(source, "            const truncatedText = await llm.detokenize(fallbackTokens);",
      "            if (signal?.aborted) return;\n            let truncatedText;\n            try { truncatedText = await llm.detokenize(fallbackTokens, { signal }); }\n            catch (error) { if (signal?.aborted) return; throw error; }\n            if (signal?.aborted) return;", "detokenization deadline");
    source = once(source, "    return results;", "    return signal?.aborted ? [] : results;", "incomplete preparation rejection");
    return source;
  }, "chunk preparation");

  llm = region(llm, "    async ensureEmbedModel(", "    /**\n     * Compute how many", source => {
    source = once(source, "async ensureEmbedModel() {", "async ensureEmbedModel(signal) {\n        signal?.throwIfAborted();", "model setup admission");
    source = once(source, "            const llama = await this.ensureLlama();", "            const llama = await this.ensureLlama();\n            signal?.throwIfAborted();", "post-runtime setup deadline");
    source = once(source, "            const modelPath = await this.resolveModel(this.embedModelUri);",
      "            const modelPath = await this.resolveModel(this.embedModelUri);\n            signal?.throwIfAborted();", "post-model resolution deadline");
    return source;
  }, "model setup");
  llm = region(llm, "    embedContextsCreatePromise = null;", "    async ensureGenerateModel(", source => {
    source = once(source, "async ensureEmbedContexts() {", "async ensureEmbedContexts(signal) {\n        signal?.throwIfAborted();", "context setup admission");
    source = once(source, "            const model = await this.ensureEmbedModel();",
      "            const model = await this.ensureEmbedModel(signal);\n            signal?.throwIfAborted();", "post-model setup deadline");
    source = once(source, "            const n = await this.computeParallelism(150);",
      "            const n = await this.computeParallelism(150);\n            signal?.throwIfAborted();", "post-parallelism deadline");
    source = once(source, "            const threads = await this.threadsPerContext(n);",
      "            const threads = await this.threadsPerContext(n);\n            signal?.throwIfAborted();", "post-thread setup deadline");
    source = once(source, "            for (let i = 0; i < n; i++) {",
      "            for (let i = 0; i < n; i++) {\n                signal?.throwIfAborted();", "context loop deadline");
    source = once(source, "async ensureEmbedContext() {\n        const contexts = await this.ensureEmbedContexts();",
      "async ensureEmbedContext(signal) {\n        const contexts = await this.ensureEmbedContexts(signal);\n        signal?.throwIfAborted();", "single context deadline");
    return source;
  }, "context setup");
  llm = once(llm, "    async tokenize(text) {\n        await this.ensureEmbedContext(); // Ensure model is loaded",
    "    async tokenize(text, options = {}) {\n        options.signal?.throwIfAborted();\n        await this.ensureEmbedContext(options.signal); // Ensure model is loaded\n        options.signal?.throwIfAborted();", "tokenizer setup deadline");
  llm = once(llm, "    async detokenize(tokens) {\n        await this.ensureEmbedContext();",
    "    async detokenize(tokens, options = {}) {\n        options.signal?.throwIfAborted();\n        await this.ensureEmbedContext(options.signal);\n        options.signal?.throwIfAborted();", "detokenizer setup deadline");

  llm = region(llm, "    async embed(text, options = {}) {", "    async generate(", source => {
    source = once(source, "    async embed(text, options = {}) {",
      "    async embed(text, options = {}) {\n        if (options.signal?.aborted) return null;", "native embed admission");
    source = once(source, "            const context = await this.ensureEmbedContext();",
      "            const context = await this.ensureEmbedContext(options.signal);\n            if (options.signal?.aborted) return null;", "native embed setup deadline");
    source = once(source, "\n            const { text: safeText, truncated, limit } = await this.truncateToContextSize(text);",
      "\n            const { text: safeText, truncated, limit } = await this.truncateToContextSize(text);\n            if (options.signal?.aborted) return null;", "native embed tokenization deadline");
    source = once(source, '            console.error("Embedding error:", error);',
      '            if (options.signal?.aborted) return null;\n            console.error("Embedding error:", error);', "native abort quiet result");
    source = once(source, "    async embedBatch(texts, options = {}) {",
      "    async embedBatch(texts, options = {}) {\n        if (options.signal?.aborted) return texts.map(() => null);", "native batch admission");
    source = once(source, "            const contexts = await this.ensureEmbedContexts();",
      "            const contexts = await this.ensureEmbedContexts(options.signal);\n            if (options.signal?.aborted) return texts.map(() => null);", "native batch setup deadline");
    source = once(source, "                for (const text of texts) {",
      "                for (const text of texts) {\n                    if (options.signal?.aborted) { embeddings.push(null); continue; }", "sequential native deadline");
    source = once(source, "                for (const text of chunk) {",
      "                for (const text of chunk) {\n                    if (options.signal?.aborted) { results.push(null); continue; }", "parallel native deadline");
    const tokenizationAnchor = "                        const { text: safeText, truncated, limit } = await this.truncateToContextSize(text);\n                        if (truncated)";
    if (source.split(tokenizationAnchor).length - 1 !== 2) throw new Error("Expected exactly two batch tokenization guards");
    source = source.replace(tokenizationAnchor, "                        const { text: safeText, truncated, limit } = await this.truncateToContextSize(text);\n                        if (options.signal?.aborted) { embeddings.push(null); continue; }\n                        if (truncated)");
    source = once(source, tokenizationAnchor, "                        const { text: safeText, truncated, limit } = await this.truncateToContextSize(text);\n                        if (options.signal?.aborted) { results.push(null); continue; }\n                        if (truncated)", "parallel post-tokenization deadline");
    source = once(source, '            console.error("Batch embedding error:", error);',
      '            if (options.signal?.aborted) return texts.map(() => null);\n            console.error("Batch embedding error:", error);', "native batch abort quiet result");
    return source;
  }, "native evaluation");

  llm = region(llm, "class LLMSession {", "// Session manager for the default", source => {
    source = once(source, "    maxDurationTimer = null;", "    maxDurationTimer = null;\n    externalSignal = null;\n    externalAbortListener = null;", "session listener ownership");
    source = once(source, '                options.signal.addEventListener("abort", () => {\n                    this.abortController.abort(options.signal.reason);\n                }, { once: true });',
      '                this.externalSignal = options.signal;\n                this.externalAbortListener = () => this.abortController.abort(options.signal.reason);\n                options.signal.addEventListener("abort", this.externalAbortListener, { once: true });', "external session abort listener");
    source = once(source, "        this.released = true;",
      '        this.released = true;\n        this.externalSignal?.removeEventListener("abort", this.externalAbortListener);\n        this.externalSignal = null;\n        this.externalAbortListener = null;', "external listener cleanup");
    source = once(source, "this.manager.getLlamaCpp().embed(text, options)",
      "this.manager.getLlamaCpp().embed(text, { ...options, signal: options?.signal ? AbortSignal.any([this.signal, options.signal]) : this.signal })", "session native embed signal");
    source = once(source, "this.manager.getLlamaCpp().embedBatch(texts, options)",
      "this.manager.getLlamaCpp().embedBatch(texts, { ...options, signal: options?.signal ? AbortSignal.any([this.signal, options.signal]) : this.signal })", "session native batch signal");
    return source;
  }, "session lifecycle");
  return { sdk, store, llm };
}
