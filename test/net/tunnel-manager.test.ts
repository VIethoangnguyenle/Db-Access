import { test } from "node:test";
import assert from "node:assert/strict";
import { ensure, shutdownAll, SshConnector, buildSshConnectConfig } from "../../src/net/tunnel-manager.js";
import { DbConfig, SshConfig } from "../../src/config/schema.js";

const directDb: DbConfig = {
  name: "direct", type: "oracle", host: "xx.xxx.xx.xx", port: 1521, service: "XE", user: "u", password: "p",
};
const sshDb: DbConfig = {
  ...directDb, name: "viassh",
  ssh: { host: "xx.xxx.xx.xx", port: 22, user: "ssh-user", privateKey: "/tmp/key" },
};

test("DB không có ssh → trả thẳng host/port", async () => {
  const ep = await ensure(directDb);
  assert.deepEqual(ep, { host: "xx.xxx.xx.xx", port: 1521 });
  await shutdownAll();
});

test("DB có ssh → trả loopback + chỉ mở 1 lần (cache)", async () => {
  let opens = 0;
  const fake: SshConnector = {
    open: async () => { opens++; return { localPort: 54321, close: async () => {} }; },
  };
  const ep1 = await ensure(sshDb, fake);
  const ep2 = await ensure(sshDb, fake);
  assert.deepEqual(ep1, { host: "127.0.0.1", port: 54321 });
  assert.deepEqual(ep2, { host: "127.0.0.1", port: 54321 });
  assert.equal(opens, 1);
  await shutdownAll();
});

const baseSsh: SshConfig = { host: "xx.xxx.xx.xx", port: 22, user: "ssh-user" };

test("buildSshConnectConfig: không key + có ssh-agent → dùng agent", () => {
  const cfg = buildSshConnectConfig(baseSsh, { SSH_AUTH_SOCK: "/tmp/agent.sock" } as NodeJS.ProcessEnv);
  assert.equal(cfg.agent, "/tmp/agent.sock");
  assert.equal(cfg.privateKey, undefined);
  assert.equal(cfg.username, "ssh-user");
});

test("buildSshConnectConfig: không key + không agent → throw", () => {
  assert.throws(() => buildSshConnectConfig(baseSsh, {} as NodeJS.ProcessEnv), /ssh-agent/);
});
