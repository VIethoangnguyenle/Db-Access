import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config/loader.js";

function writeYaml(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const p = join(dir, "config.yaml");
  writeFileSync(p, body);
  return p;
}

afterEach(() => { delete process.env.PW; });

const yaml = `
databases:
  oracle_prod:
    type: oracle
    host: xx.xxx.xx.xx
    port: 1521
    service: XE
    user: u
    password: \${PW}
sources:
  agent_a:
    apiKey: key-a
    access:
      oracle_prod: [read, write]
`;

test("load + nội suy + gắn name; shorthand access -> { capabilities }", () => {
  process.env.PW = "p123";
  const cfg = loadConfig(writeYaml(yaml));
  assert.equal(cfg.databases.oracle_prod.name, "oracle_prod");
  assert.equal(cfg.databases.oracle_prod.password, "p123");
  assert.equal(cfg.sources.agent_a.name, "agent_a");
  assert.deepEqual(cfg.sources.agent_a.access.oracle_prod, { capabilities: ["read", "write"] });
});

test("access dạng object: giữ capabilities + description", () => {
  process.env.PW = "p123";
  const withDesc = yaml.replace(
    "      oracle_prod: [read, write]",
    "      oracle_prod:\n        capabilities: [read]\n        description: \"DB bán hàng\""
  );
  const cfg = loadConfig(writeYaml(withDesc));
  assert.deepEqual(cfg.sources.agent_a.access.oracle_prod, {
    capabilities: ["read"],
    description: "DB bán hàng",
  });
});

test("throw khi access trỏ DB không tồn tại", () => {
  process.env.PW = "p123";
  const bad = yaml.replace("oracle_prod: [read, write]", "ghost_db: [read]");
  assert.throws(() => loadConfig(writeYaml(bad)), /ghost_db/);
});
