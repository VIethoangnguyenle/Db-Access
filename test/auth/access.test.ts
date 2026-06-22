import { test } from "node:test";
import assert from "node:assert/strict";
import { hasAccess, assertAccess, accessibleDatabases, AccessError } from "../../src/auth/access.js";
import { Source } from "../../src/config/schema.js";

const source: Source = {
  name: "agent_a",
  apiKey: "k",
  access: { oracle_prod: ["read"], oracle_dev: ["read", "write", "script"] },
};

test("hasAccess đúng theo capability", () => {
  assert.equal(hasAccess(source, "oracle_prod", "read"), true);
  assert.equal(hasAccess(source, "oracle_prod", "write"), false);
  assert.equal(hasAccess(source, "oracle_dev", "script"), true);
  assert.equal(hasAccess(source, "unknown_db", "read"), false);
});

test("assertAccess throw AccessError khi bị từ chối", () => {
  assert.doesNotThrow(() => assertAccess(source, "oracle_prod", "read"));
  assert.throws(() => assertAccess(source, "oracle_prod", "write"), AccessError);
  assert.throws(() => assertAccess(source, "unknown_db", "read"), AccessError);
});

test("accessibleDatabases liệt kê đúng", () => {
  const list = accessibleDatabases(source);
  assert.deepEqual(
    list.sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "oracle_dev", capabilities: ["read", "write", "script"] },
      { name: "oracle_prod", capabilities: ["read"] },
    ]
  );
});
