import { readFileSync, writeFileSync } from "node:fs";
import { patchEmbeddingDeadline } from "./patch-embedding-deadline.mjs";

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
    'import { getConfigPath } from "../collections.js";',
    'import { getConfigPath, loadConfig } from "../collections.js";',
    "collection config loader",
  ],
  [
    'const body = JSON.stringify({ status: "ok", uptime: Math.floor((Date.now() - startTime) / 1000) });',
    'const status = await store.getStatus();\n                const body = JSON.stringify({ status: "ok", uptime: Math.floor((Date.now() - startTime) / 1000), documents: status.totalDocuments, needsEmbedding: status.needsEmbedding });',
    "health status",
  ],
  [
    'async function createMcpServer(store, inflight) {',
    'export async function createMcpServer(store, inflight) {',
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
const sourceRelativeRoot = (process.env.QMD_SOURCE_RELATIVE_ROOT || "").trim() || null;

function relativeToConfiguredSourceRoot(absolutePath) {
    if (!sourceRelativeRoot) return null;
    const candidate = relative(resolve(sourceRelativeRoot), resolve(absolutePath));
    if (candidate === "") return "";
    if (candidate === ".." || candidate.startsWith(".." + sep) || isAbsolute(candidate)) return null;
    return candidate.split(sep).join("/");
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
    if (!result.displayPath.startsWith(prefix)) return null;
    const originalPath = result.displayPath.slice(prefix.length);
    if (!originalPath || isAbsolute(originalPath) || originalPath.split("/").includes("..")) return null;
    // QMD 2.8.3 stores the exact original relative path; no normalized-name
    // reverse lookup, filesystem scan or invalidation cache is necessary.
    const collection = loadConfig()?.collections?.[collectionName];
    if (!collection?.path) return null;
    return relativeToConfiguredSourceRoot(resolve(collection.path, originalPath));
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
  '    }, track(async ({ query, searches, limit, minScore, candidateLimit, collections, intent, rerank }) => {',
  '    }, track(async ({ query, searches, limit, minScore, collections, intent }) => {',
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
  '    }, track(async ({ query, searches, limit, minScore, candidateLimit, collections, intent, rerank }) => {',
  '    }, track(async ({ query, searches, limit, minScore, candidateLimit, collections, intent }) => {',
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
  '            lineNumbers: z.boolean().optional().default(true).describe("Add line numbers to output (format: \'N: content\'). On by default; set false for raw content."),\n        }),\n    }, track(async ({ file, fromLine, maxLines, lineNumbers }) => {',
  '            lineNumbers: z.boolean().optional().default(true).describe("Add line numbers to output (format: \'N: content\'). On by default; set false for raw content."),\n            exposeToUser: z.boolean().optional().default(false).describe("Return a user-visible MCP resource instead of internal text. Preview/show/open/render/inspect requests do not authorize resource exposure."),\n            confirmUserApprovedExposure: z.literal(true).optional().describe("Hard confirmation gate. Set true only when the user explicitly approved exposing this QMD result as a user-visible MCP resource; ordinary preview/show/open/render/inspect intent is not approval."),\n        }),\n    }, track(async ({ file, fromLine, maxLines, lineNumbers, exposeToUser, confirmUserApprovedExposure }) => {',
  "get exposure schema",
);

source = replaceExactlyOnce(
  source,
  '        return {\n            content: [{\n                    type: "resource",\n                    resource: {\n                        uri: `qmd://${encodeQmdPath(result.displayPath)}`,\n                        name: result.displayPath,\n                        title: result.title,\n                        mimeType: "text/markdown",\n                        text,\n                    },\n                }],\n        };',
  '        if (!exposeToUser) {\n            return { content: [{ type: "text", text: `# ${result.displayPath}\\n\\n${text}` }] };\n        }\n        if (confirmUserApprovedExposure !== true) {\n            throw new Error("User-visible MCP resource exposure blocked: explicit user approval is required. Preview, show, open, render, and inspect requests do not authorize resource exposure.");\n        }\n        return {\n            content: [{\n                    type: "resource",\n                    resource: {\n                        uri: `qmd://${encodeQmdPath(result.displayPath)}`,\n                        name: result.displayPath,\n                        title: result.title,\n                        mimeType: "text/markdown",\n                        text,\n                    },\n                }],\n        };',
  "get internal text default",
);

source = replaceExactlyOnce(
  source,
  '            lineNumbers: z.boolean().optional().default(true).describe("Add line numbers to output (format: \'N: content\'). On by default; set false for raw content."),\n        }),\n    }, track(async ({ pattern, maxLines, maxBytes, lineNumbers }) => {',
  '            lineNumbers: z.boolean().optional().default(true).describe("Add line numbers to output (format: \'N: content\'). On by default; set false for raw content."),\n            exposeToUser: z.boolean().optional().default(false).describe("Return user-visible MCP resources instead of internal text. Preview/show/open/render/inspect requests do not authorize resource exposure."),\n            confirmUserApprovedExposure: z.literal(true).optional().describe("Hard confirmation gate. Set true only when the user explicitly approved exposing these QMD results as user-visible MCP resources; ordinary preview/show/open/render/inspect intent is not approval."),\n        }),\n    }, track(async ({ pattern, maxLines, maxBytes, lineNumbers, exposeToUser, confirmUserApprovedExposure }) => {',
  "multi-get exposure schema",
);

source = replaceExactlyOnce(
  source,
  '            content.push({\n                type: "resource",\n                resource: {\n                    uri: `qmd://${encodeQmdPath(result.doc.displayPath)}`,\n                    name: result.doc.displayPath,\n                    title: result.doc.title,\n                    mimeType: "text/markdown",\n                    text,\n                },\n            });',
  '            if (exposeToUser) {\n                if (confirmUserApprovedExposure !== true) {\n                    throw new Error("User-visible MCP resource exposure blocked: explicit user approval is required. Preview, show, open, render, and inspect requests do not authorize resource exposure.");\n                }\n                content.push({\n                    type: "resource",\n                    resource: {\n                        uri: `qmd://${encodeQmdPath(result.doc.displayPath)}`,\n                        name: result.doc.displayPath,\n                        title: result.doc.title,\n                        mimeType: "text/markdown",\n                        text,\n                    },\n                });\n            } else {\n                content.push({ type: "text", text: `# ${result.doc.displayPath}\\n\\n${text}` });\n            }',
  "multi-get internal text default",
);

writeFileSync(target, source, "utf8");

const storeTarget = "/opt/qmd/node_modules/@tobilu/qmd/dist/store.js";
let storeSource = readFileSync(storeTarget, "utf8");
const sdkTarget = "/opt/qmd/node_modules/@tobilu/qmd/dist/index.js";
const llmTarget = "/opt/qmd/node_modules/@tobilu/qmd/dist/llm.js";
const deadlineSources = patchEmbeddingDeadline({
  sdk: readFileSync(sdkTarget, "utf8"), store: storeSource,
  llm: readFileSync(llmTarget, "utf8"),
});
writeFileSync(sdkTarget, deadlineSources.sdk, "utf8");
writeFileSync(llmTarget, deadlineSources.llm, "utf8");
writeFileSync(storeTarget, deadlineSources.store, "utf8");

console.log("Patched retained QMD integration behavior; released bind, embedding-duration and doctor implementations are reused.");
