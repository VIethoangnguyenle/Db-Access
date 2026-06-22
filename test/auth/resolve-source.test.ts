import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSourceIndex, resolveSourceFrom } from "../../src/auth/resolve-source.js";
import { AppConfig } from "../../src/config/schema.js";

const cfg: AppConfig = {
  databases: {},
  sources: {
    agent_a: { name: "agent_a", apiKey: "key-a", access: { db1: { capabilities: ["read"] } } },
    agent_b: { name: "agent_b", apiKey: "key-b", access: {} },
  },
};

test("map đúng apiKey → source", () => {
  const idx = buildSourceIndex(cfg);
  assert.equal(resolveSourceFrom(idx, "key-a")?.name, "agent_a");
  assert.equal(resolveSourceFrom(idx, "key-b")?.name, "agent_b");
});

test("trả undefined với key sai/thiếu", () => {
  const idx = buildSourceIndex(cfg);
  assert.equal(resolveSourceFrom(idx, "nope"), undefined);
  assert.equal(resolveSourceFrom(idx, undefined), undefined);
});
