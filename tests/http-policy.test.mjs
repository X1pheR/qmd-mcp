import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  MAX_REQUEST_BODY_BYTES,
  RequestBodyTooLargeError,
  collectBoundedBody,
} from "../http-policy.mjs";

test("collectBoundedBody accepts a request at the size limit", async () => {
  const request = Readable.from([Buffer.alloc(MAX_REQUEST_BODY_BYTES, "a")]);
  const body = await collectBoundedBody(request);
  assert.equal(Buffer.byteLength(body), MAX_REQUEST_BODY_BYTES);
});

test("collectBoundedBody rejects a request above the size limit", async () => {
  const request = Readable.from([
    Buffer.alloc(MAX_REQUEST_BODY_BYTES, "a"),
    Buffer.from("b"),
  ]);
  await assert.rejects(() => collectBoundedBody(request), RequestBodyTooLargeError);
});
