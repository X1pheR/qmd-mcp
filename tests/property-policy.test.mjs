import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import fc from "fast-check";

import { collectBoundedBody, RequestBodyTooLargeError } from "../http-policy.mjs";
import { assertSearchEmbeddingPolicy } from "../embedding-policy.mjs";

test("collectBoundedBody respects arbitrary byte limits across randomized chunk boundaries", async () => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 0, max: 128 }),
    fc.array(fc.uint8Array({ maxLength: 64 }), { maxLength: 8 }),
    async (maxBytes, chunks) => {
      const buffers = chunks.map((chunk) => Buffer.from(chunk));
      const totalBytes = buffers.reduce((total, chunk) => total + chunk.length, 0);
      const request = Readable.from(buffers);

      if (totalBytes <= maxBytes) {
        const body = await collectBoundedBody(request, maxBytes);
        assert.equal(body, Buffer.concat(buffers, totalBytes).toString("utf8"));
      } else {
        await assert.rejects(
          () => collectBoundedBody(request, maxBytes),
          RequestBodyTooLargeError,
        );
      }
    },
  ), { numRuns: 250 });
});

test("lexical-only collections accept exactly non-empty all-lex query sets", () => {
  const config = {
    collections: {
      log: { path: "/vault/log", embedding: false },
    },
  };

  fc.assert(fc.property(
    fc.array(fc.constantFrom("lex", "vec", "hyde"), { minLength: 1, maxLength: 8 }),
    (types) => {
      const options = {
        collections: ["log"],
        queries: types.map((type, index) => ({ type, query: `query-${index}` })),
      };
      const allLex = types.every((type) => type === "lex");

      if (allLex) {
        assert.doesNotThrow(() => assertSearchEmbeddingPolicy(config, options));
      } else {
        assert.throws(
          () => assertSearchEmbeddingPolicy(config, options),
          /support only explicit lex searches/,
        );
      }
    },
  ), { numRuns: 250 });
});
