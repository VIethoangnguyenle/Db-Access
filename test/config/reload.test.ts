import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initConfig, getConfig, reloadConfig } from "../../src/config/loader.js";

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), "reload-")), "config.yaml");
}

const v1 = `
databases:
  db1: { type: oracle, host: h, port: 1521, service: XE, user: u, password: p }
sources:
  a: { apiKey: key-a, access: { db1: [read] } }
`;

test("reloadConfig nạp thay đổi mới", () => {
  const p = tmpFile();
  writeFileSync(p, v1);
  initConfig(p);
  assert.equal(Object.keys(getConfig().sources).length, 1);

  const v2 = v1 + `  b: { apiKey: key-b, access: { db1: [read] } }\n`;
  writeFileSync(p, v2);
  const r = reloadConfig(p);
  assert.equal(r.ok, true);
  assert.equal(Object.keys(getConfig().sources).length, 2);
  assert.ok(getConfig().sources.b);
});

test("reloadConfig lỗi → giữ config cũ", () => {
  const p = tmpFile();
  writeFileSync(p, v1);
  initConfig(p);

  // capability không hợp lệ → validate fail
  writeFileSync(p, v1.replace("db1: [read]", "db1: [delete]"));
  const r = reloadConfig(p);
  assert.equal(r.ok, false);
  // config cũ vẫn còn, vẫn đúng
  assert.deepEqual(getConfig().sources.a.access.db1, { capabilities: ["read"] });
});
