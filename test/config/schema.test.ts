import { test } from "node:test";
import assert from "node:assert/strict";
import { appConfigSchema } from "../../src/config/schema.js";

const valid = {
  databases: {
    oracle_prod: { type: "oracle", host: "h", port: 1521, service: "XE", user: "u", password: "p" },
    mongo_logs: { type: "mongo", host: "h", port: 27017, database: "logs", user: "u", password: "p" },
  },
  sources: {
    agent_a: { apiKey: "k", access: { oracle_prod: ["read"] } },
  },
};

test("accepts a valid config", () => {
  const r = appConfigSchema.safeParse(valid);
  assert.equal(r.success, true);
});

test("rejects oracle db missing service", () => {
  const bad = structuredClone(valid);
  delete (bad.databases.oracle_prod as any).service;
  const r = appConfigSchema.safeParse(bad);
  assert.equal(r.success, false);
});

test("rejects invalid capability", () => {
  const bad = structuredClone(valid);
  (bad.sources.agent_a.access.oracle_prod as any) = ["delete"];
  const r = appConfigSchema.safeParse(bad);
  assert.equal(r.success, false);
});
