import { test } from "node:test";
import assert from "node:assert/strict";
import { retryOnSchemaMiss } from "../src/lib/claude.ts";

test("asks again when the answer did not fit the schema", async () => {
  let calls = 0;
  const result = await retryOnSchemaMiss(async () => {
    if (++calls < 3) throw new Error("Failed to parse structured output: Error: bad id");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("gives up after the last try", async () => {
  let calls = 0;
  await assert.rejects(
    retryOnSchemaMiss(async () => {
      calls++;
      throw new Error("Failed to parse structured output: Error: bad id");
    }),
    /parse structured output/,
  );
  assert.equal(calls, 3);
});

test("does not repeat other failures", async () => {
  let calls = 0;
  await assert.rejects(
    retryOnSchemaMiss(async () => {
      calls++;
      throw new Error("401 invalid api key");
    }),
    /401/,
  );
  assert.equal(calls, 1);
});
