import { readFileSync, writeFileSync } from "node:fs";

const target = "/opt/qmd/node_modules/@tobilu/qmd/dist/mcp/server.js";
let source = readFileSync(target, "utf8");

function replaceExactlyOnce(input, before, after, label) {
  const matches = input.split(before).length - 1;
  if (matches !== 1) {
    throw new Error(`Expected exactly one ${label} match, found ${matches}`);
  }
  return input.replace(before, after);
}

const staticPatches = [
  [
    'import { join, dirname } from "node:path";',
    'import { join, dirname, isAbsolute, relative, resolve, sep } from "node:path";',
    "path helpers",
  ],
  [
    'import { z } from "zod";',
    'import { z } from "zod";\nimport fastGlob from "fast-glob";',
    "source path glob",
  ],
  [
    'import { getConfigPath } from "../collections.js";',
    'import { getConfigPath, loadConfig } from "../collections.js";',
    "collection config loader",
  ],
  [
    'import { enableProductionMode } from "../store.js";',
    'import { enableProductionMode, handelize } from "../store.js";',
    "indexed path normalizer",
  ],
  [
    'httpServer.listen(port, "localhost", () => resolve());',
    'const bindHost = process.env.QMD_HTTP_HOST || "localhost";\n        httpServer.listen(port, bindHost, () => resolve());',
    "listen host",
  ],
  [
    'log(`QMD MCP server listening on http://localhost:${actualPort}/mcp`);',
    'log(`QMD MCP server listening on http://${process.env.QMD_HTTP_HOST || "localhost"}:${actualPort}/mcp`);',
    "startup log",
  ],
  [
    'const body = JSON.stringify({ status: "ok", uptime: Math.floor((Date.now() - startTime) / 1000) });',
    'const status = await store.getStatus();\n                const body = JSON.stringify({ status: "ok", uptime: Math.floor((Date.now() - startTime) / 1000), documents: status.totalDocuments, needsEmbedding: status.needsEmbedding });',
    "health status",
  ],
  [
    'async function createMcpServer(store) {',
    'export async function createMcpServer(store) {',
    "MCP server export",
  ],
];

for (const [before, after, label] of staticPatches) {
  source = replaceExactlyOnce(source, before, after, label);
}

const sourcePathHelperAnchor = `function encodeQmdPath(path) {
    // Encode each path segment separately to preserve slashes
    return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}`;
source = replaceExactlyOnce(
  source,
  sourcePathHelperAnchor,
  sourcePathHelperAnchor + `
const SOURCE_PATH_CACHE_TTL_MS = 60_000;
const SOURCE_PATH_EXCLUDE_DIRS = ["node_modules", ".git", ".cache", "vendor", "dist", "build"];
const sourcePathCache = new Map();
const sourceRelativeRoot = (process.env.QMD_SOURCE_RELATIVE_ROOT || "").trim() || null;

function relativeToConfiguredSourceRoot(absolutePath) {
    if (!sourceRelativeRoot) return null;
    const candidate = relative(resolve(sourceRelativeRoot), resolve(absolutePath));
    if (candidate === "") return "";
    if (candidate === ".." || candidate.startsWith(".." + sep) || isAbsolute(candidate)) return null;
    return candidate.split(sep).join("/");
}

async function sourcePathMapForCollection(collectionName) {
    const cached = sourcePathCache.get(collectionName);
    if (cached && Date.now() - cached.loadedAt < SOURCE_PATH_CACHE_TTL_MS) return cached;

    const config = loadConfig();
    const collection = config?.collections?.[collectionName];
    if (!collection?.path) {
        const missing = { loadedAt: Date.now(), collectionPath: null, paths: new Map() };
        sourcePathCache.set(collectionName, missing);
        return missing;
    }

    const configuredIgnore = Array.isArray(collection.ignore) ? collection.ignore : [];
    const ignore = [
        ...SOURCE_PATH_EXCLUDE_DIRS.map((name) => "**/" + name + "/**"),
        ...configuredIgnore,
    ];
    const files = await fastGlob(collection.pattern || "**/*.md", {
        cwd: collection.path,
        onlyFiles: true,
        followSymbolicLinks: false,
        dot: false,
        ignore,
    });
    const paths = new Map();
    for (const originalPath of files) {
        if (originalPath.split("/").some((part) => part.startsWith("."))) continue;
        let indexedPath;
        try {
            indexedPath = handelize(originalPath);
        } catch {
            continue;
        }
        if (!paths.has(indexedPath)) {
            paths.set(indexedPath, originalPath);
        } else if (paths.get(indexedPath) !== originalPath) {
            paths.set(indexedPath, null);
        }
    }

    const resolved = { loadedAt: Date.now(), collectionPath: collection.path, paths };
    sourcePathCache.set(collectionName, resolved);
    return resolved;
}

function collectionNameForResult(result) {
    if (result?.collectionName) return result.collectionName;
    if (!result?.displayPath || !result.displayPath.includes("/")) return null;
    return result.displayPath.split("/", 1)[0] || null;
}

async function sourceRelativePathFor(result) {
    if (!sourceRelativeRoot || !result?.displayPath) return null;
    const collectionName = collectionNameForResult(result);
    if (!collectionName) return null;
    const prefix = collectionName + "/";
    const indexedPath = result.displayPath.startsWith(prefix)
        ? result.displayPath.slice(prefix.length)
        : result.displayPath;
    const collection = await sourcePathMapForCollection(collectionName);
    const originalPath = collection.paths.get(indexedPath);
    if (!originalPath || !collection.collectionPath) return null;
    return relativeToConfiguredSourceRoot(resolve(collection.collectionPath, originalPath));
}`,
  "exact source path resolver",
);

const queryStart = '    server.registerTool("query", {';
const getToolMarker = '    // ---------------------------------------------------------------------------\n    // Tool: qmd_get';
const queryStartIndex = source.indexOf(queryStart);
const queryEndIndex = source.indexOf(getToolMarker, queryStartIndex);
if (queryStartIndex < 0 || queryEndIndex < 0 || queryEndIndex <= queryStartIndex) {
  throw new Error("Unable to locate the QMD query tool block");
}

let upstreamQueryBlock = source.slice(queryStartIndex, queryEndIndex);
upstreamQueryBlock = replaceExactlyOnce(
  upstreamQueryBlock,
  `        const filtered = results.map(r => {
            const { line, snippet } = extractSnippet(r.body, primaryQuery, 300, r.bestChunkPos, r.bestChunk.length, intent);
            return {
                docid: \`#\${r.docid}\`,
                file: r.displayPath,
                title: r.title,
                score: Math.round(r.score * 100) / 100,
                context: r.context,
                line,
                snippet: addLineNumbers(snippet, line),
            };
        });`,
  `        const filtered = await Promise.all(results.map(async (r) => {
            const { line, snippet } = extractSnippet(r.body, primaryQuery, 300, r.bestChunkPos, r.bestChunk.length, intent);
            return {
                docid: \`#\${r.docid}\`,
                file: r.displayPath,
                collection: collectionNameForResult(r),
                source_relative_path: await sourceRelativePathFor(r),
                title: r.title,
                score: Math.round(r.score * 100) / 100,
                context: r.context,
                line,
                snippet: addLineNumbers(snippet, line),
            };
        }));`,
  "query exact source path metadata",
);
upstreamQueryBlock = replaceExactlyOnce(
  upstreamQueryBlock,
  'Each result includes a \\`line\\` field with the absolute 1-indexed line of the best match in the source markdown. To read more context around a hit, call \\`get(file, fromLine = max(1, line - 20), maxLines = 80, lineNumbers = true)\\`.',
  'Each result includes a \\`line\\` field with the absolute 1-indexed line of the best match. When \\`QMD_SOURCE_RELATIVE_ROOT\\` is configured and the original source path resolves unambiguously, \\`source_relative_path\\` preserves the exact source spelling and is preferred for handoff to an authoritative filesystem. Use \\`get\\` only when QMD document retrieval itself is needed.',
  "query source path guidance",
);

let routineQueryBlock = upstreamQueryBlock;
routineQueryBlock = replaceExactlyOnce(
  routineQueryBlock,
  '        title: "Query",',
  '        title: "Query (no reranking)",',
  "routine query title",
);
routineQueryBlock = replaceExactlyOnce(
  routineQueryBlock,
  '        description: `Search the knowledge base using a query document — one or more typed sub-queries combined for best recall.',
  '        description: `Search the knowledge base using a query document — one or more typed sub-queries combined for best recall. Reranking is disabled for this routine tool to avoid loading the CPU-only reranker.',
  "routine query description",
);
routineQueryBlock = replaceExactlyOnce(
  routineQueryBlock,
  '            candidateLimit: z.number().optional().describe("Maximum candidates to rerank (default: 40, lower = faster but may miss results)"),\n',
  '',
  "routine candidate limit schema",
);
routineQueryBlock = replaceExactlyOnce(
  routineQueryBlock,
  '            rerank: z.boolean().optional().default(true).describe("Rerank results using LLM (default: true). Set to false for faster results on CPU-only machines."),\n',
  '',
  "routine rerank schema",
);
routineQueryBlock = replaceExactlyOnce(
  routineQueryBlock,
  '    }, async ({ searches, limit, minScore, candidateLimit, collections, intent, rerank }) => {',
  '    }, async ({ searches, limit, minScore, collections, intent }) => {',
  "routine query handler signature",
);
routineQueryBlock = replaceExactlyOnce(
  routineQueryBlock,
  '            candidateLimit,\n            rerank,',
  '            rerank: false,',
  "routine search options",
);

let rerankedQueryBlock = upstreamQueryBlock;
rerankedQueryBlock = replaceExactlyOnce(
  rerankedQueryBlock,
  '    server.registerTool("query", {',
  '    server.registerTool("query_reranked", {',
  "reranked query tool name",
);
rerankedQueryBlock = replaceExactlyOnce(
  rerankedQueryBlock,
  '        title: "Query",',
  '        title: "Reranked Query",',
  "reranked query title",
);
rerankedQueryBlock = replaceExactlyOnce(
  rerankedQueryBlock,
  '        description: `Search the knowledge base using a query document — one or more typed sub-queries combined for best recall.',
  '        description: `Administrative CPU-heavy search with local LLM reranking. Use only when routine hybrid retrieval is insufficient.',
  "reranked query description",
);
rerankedQueryBlock = replaceExactlyOnce(
  rerankedQueryBlock,
  '            candidateLimit: z.number().optional().describe("Maximum candidates to rerank (default: 40, lower = faster but may miss results)"),',
  '            candidateLimit: z.number().int().min(1).max(20).optional().default(10).describe("Maximum candidates to rerank (default: 10, maximum: 20)"),',
  "reranked candidate limit schema",
);
rerankedQueryBlock = replaceExactlyOnce(
  rerankedQueryBlock,
  '            rerank: z.boolean().optional().default(true).describe("Rerank results using LLM (default: true). Set to false for faster results on CPU-only machines."),\n',
  '',
  "reranked rerank schema",
);
rerankedQueryBlock = replaceExactlyOnce(
  rerankedQueryBlock,
  '    }, async ({ searches, limit, minScore, candidateLimit, collections, intent, rerank }) => {',
  '    }, async ({ searches, limit, minScore, candidateLimit, collections, intent }) => {',
  "reranked query handler signature",
);
rerankedQueryBlock = replaceExactlyOnce(
  rerankedQueryBlock,
  '            rerank,',
  '            rerank: true,',
  "reranked search option",
);

source = source.slice(0, queryStartIndex)
  + routineQueryBlock
  + rerankedQueryBlock
  + source.slice(queryEndIndex);

source = replaceExactlyOnce(
  source,
  '            lineNumbers: z.boolean().optional().default(true).describe("Add line numbers to output (format: \'N: content\'). On by default; set false for raw content."),\n        },\n    }, async ({ file, fromLine, maxLines, lineNumbers }) => {',
  '            lineNumbers: z.boolean().optional().default(true).describe("Add line numbers to output (format: \'N: content\'). On by default; set false for raw content."),\n            exposeToUser: z.boolean().optional().default(false).describe("Return a user-visible MCP resource instead of internal text. Use only after explicit user approval."),\n        },\n    }, async ({ file, fromLine, maxLines, lineNumbers, exposeToUser }) => {',
  "get exposure schema",
);

source = replaceExactlyOnce(
  source,
  '        return {\n            content: [{\n                    type: "resource",\n                    resource: {\n                        uri: `qmd://${encodeQmdPath(result.displayPath)}`,\n                        name: result.displayPath,\n                        title: result.title,\n                        mimeType: "text/markdown",\n                        text,\n                    },\n                }],\n        };',
  '        if (!exposeToUser) {\n            return { content: [{ type: "text", text: `# ${result.displayPath}\\n\\n${text}` }] };\n        }\n        return {\n            content: [{\n                    type: "resource",\n                    resource: {\n                        uri: `qmd://${encodeQmdPath(result.displayPath)}`,\n                        name: result.displayPath,\n                        title: result.title,\n                        mimeType: "text/markdown",\n                        text,\n                    },\n                }],\n        };',
  "get internal text default",
);

source = replaceExactlyOnce(
  source,
  '            lineNumbers: z.boolean().optional().default(true).describe("Add line numbers to output (format: \'N: content\'). On by default; set false for raw content."),\n        },\n    }, async ({ pattern, maxLines, maxBytes, lineNumbers }) => {',
  '            lineNumbers: z.boolean().optional().default(true).describe("Add line numbers to output (format: \'N: content\'). On by default; set false for raw content."),\n            exposeToUser: z.boolean().optional().default(false).describe("Return user-visible MCP resources instead of internal text. Use only after explicit user approval."),\n        },\n    }, async ({ pattern, maxLines, maxBytes, lineNumbers, exposeToUser }) => {',
  "multi-get exposure schema",
);

source = replaceExactlyOnce(
  source,
  '            content.push({\n                type: "resource",\n                resource: {\n                    uri: `qmd://${encodeQmdPath(result.doc.displayPath)}`,\n                    name: result.doc.displayPath,\n                    title: result.doc.title,\n                    mimeType: "text/markdown",\n                    text,\n                },\n            });',
  '            if (exposeToUser) {\n                content.push({\n                    type: "resource",\n                    resource: {\n                        uri: `qmd://${encodeQmdPath(result.doc.displayPath)}`,\n                        name: result.doc.displayPath,\n                        title: result.doc.title,\n                        mimeType: "text/markdown",\n                        text,\n                    },\n                });\n            } else {\n                content.push({ type: "text", text: `# ${result.doc.displayPath}\\n\\n${text}` });\n            }',
  "multi-get internal text default",
);

writeFileSync(target, source, "utf8");

const storeTarget = "/opt/qmd/node_modules/@tobilu/qmd/dist/store.js";
let storeSource = readFileSync(storeTarget, "utf8");
storeSource = replaceExactlyOnce(
  storeSource,
  "    }, { maxDuration: 30 * 60 * 1000, name: 'generateEmbeddings' });",
  `    }, { maxDuration: (() => {
        const raw = process.env.QMD_EMBED_MAX_DURATION_MS;
        if (raw === undefined || raw === "") return 30 * 60 * 1000;
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 60_000 || value > 7_200_000) {
            throw new Error("QMD_EMBED_MAX_DURATION_MS must be an integer between 60000 and 7200000 milliseconds");
        }
        return value;
    })(), name: 'generateEmbeddings' });`,
  "embedding max duration",
);
writeFileSync(storeTarget, storeSource, "utf8");

const cliTarget = "/opt/qmd/node_modules/@tobilu/qmd/dist/cli/qmd.js";
let cliSource = readFileSync(cliTarget, "utf8");
cliSource = replaceExactlyOnce(
  cliSource,
  '            if (!entry.isFile() || !entry.name.includes(filename))',
  '            if (!entry.isFile() || entry.name.endsWith(".etag") || !entry.name.includes(filename))',
  "doctor model-cache sidecar filter",
);
writeFileSync(cliTarget, cliSource, "utf8");

console.log("Patched QMD HTTP behavior, query routing, document retrieval, embedding timeout, and doctor cache diagnostics.");
