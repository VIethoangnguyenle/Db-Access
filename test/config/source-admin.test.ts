import { test } from "node:test";
import assert from "node:assert/strict";
import { addSource, parseDbSpec, envVarNameFor } from "../../src/config/source-admin.js";

function baseConfig() {
  return {
    databases: {
      oracle_sales: { type: "oracle", host: "h", port: 1521, service: "XE", user: "u", password: "p" },
      mongo_logs: { type: "mongo", host: "h", port: 27017, database: "logs", user: "u", password: "p" },
    },
    sources: {},
  };
}

test("envVarNameFor chuẩn hoá tên", () => {
  assert.equal(envVarNameFor("project_b"), "KEY_PROJECT_B");
  assert.equal(envVarNameFor("proj-a.1"), "KEY_PROJ_A_1");
});

test("parseDbSpec parse db:caps", () => {
  assert.deepEqual(parseDbSpec("oracle_sales:read,write"), {
    db: "oracle_sales",
    capabilities: ["read", "write"],
  });
  assert.throws(() => parseDbSpec("oracle_sales"), /sai định dạng/);
});

test("addSource thêm source + apiKey ${ENV} + access dạng đúng", () => {
  const cfg = baseConfig();
  const { envVar } = addSource(cfg, "project_b", [
    { db: "oracle_sales", capabilities: ["read"], description: "DB bán hàng" },
    { db: "mongo_logs", capabilities: ["read"] },
  ]);
  assert.equal(envVar, "KEY_PROJECT_B");
  assert.equal((cfg.sources as any).project_b.apiKey, "${KEY_PROJECT_B}");
  assert.deepEqual((cfg.sources as any).project_b.access, {
    oracle_sales: { capabilities: ["read"], description: "DB bán hàng" },
    mongo_logs: ["read"],
  });
});

test("addSource từ chối DB không tồn tại", () => {
  assert.throws(() => addSource(baseConfig(), "x", [{ db: "ghost", capabilities: ["read"] }]), /không tồn tại/);
});

test("addSource từ chối capability sai", () => {
  assert.throws(
    () => addSource(baseConfig(), "x", [{ db: "oracle_sales", capabilities: ["delete"] }]),
    /Capability không hợp lệ/
  );
});

test("addSource từ chối trùng tên source", () => {
  const cfg = baseConfig();
  addSource(cfg, "dup", [{ db: "oracle_sales", capabilities: ["read"] }]);
  assert.throws(() => addSource(cfg, "dup", [{ db: "mongo_logs", capabilities: ["read"] }]), /đã tồn tại/);
});
