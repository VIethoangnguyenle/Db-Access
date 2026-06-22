import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafeFilter } from "../../src/drivers/mongo/executor.js";

test("cho phép filter thường", () => {
  assert.doesNotThrow(() => assertSafeFilter({ status: "active", n: { $gt: 5 } }));
});

test("chặn $where", () => {
  assert.throws(() => assertSafeFilter({ $where: "sleep(9999)" }), /\$where/);
});

test("chặn operator nguy hiểm lồng sâu", () => {
  assert.throws(() => assertSafeFilter({ a: { b: { $function: {} } } }), /\$function/);
});
