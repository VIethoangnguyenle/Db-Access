import { test } from "node:test";
import assert from "node:assert/strict";
import { extractApiKey } from "../../src/auth/http.js";

test("lấy từ x-api-key", () => {
  assert.equal(extractApiKey({ "x-api-key": "abc" }), "abc");
});

test("lấy từ Authorization: Bearer", () => {
  assert.equal(extractApiKey({ authorization: "Bearer xyz" }), "xyz");
});

test("x-api-key ưu tiên hơn bearer", () => {
  assert.equal(extractApiKey({ "x-api-key": "abc", authorization: "Bearer xyz" }), "abc");
});

test("không có gì → undefined", () => {
  assert.equal(extractApiKey({}), undefined);
  assert.equal(extractApiKey({ authorization: "Basic zzz" }), undefined);
  assert.equal(extractApiKey({ "x-api-key": "" }), undefined);
});
