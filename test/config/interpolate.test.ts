import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { interpolateEnv } from "../../src/config/loader.js";

afterEach(() => {
  delete process.env.FOO;
  delete process.env.BAR;
});

test("thay thế ${VAR} bằng giá trị env", () => {
  process.env.FOO = "secret";
  assert.equal(interpolateEnv("pass: ${FOO}"), "pass: secret");
});

test("thay nhiều biến", () => {
  process.env.FOO = "a";
  process.env.BAR = "b";
  assert.equal(interpolateEnv("${FOO}-${BAR}"), "a-b");
});

test("throw khi env thiếu", () => {
  assert.throws(() => interpolateEnv("x: ${MISSING_VAR}"), /MISSING_VAR/);
});
