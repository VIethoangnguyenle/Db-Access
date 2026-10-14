import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildPipeline, runPipeline, CodecStep } from "../src/drivers/redis/codec/registry.js";

const ctx = { key: "k", dbName: "d" };

function run(steps: CodecStep[], input: Buffer) {
  return runPipeline(buildPipeline(steps), input, ctx);
}

test("password chain: base64 → aes-ctr(iv prefix, key thô) → utf8", () => {
  const configKey = "0123456789abcdef0123456789abcdef"; // 32 byte, dùng thô
  const plain = "super-secret-pw";
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-ctr", Buffer.from(configKey), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const stored = Buffer.concat([iv, ct]).toString("base64"); // hệt StorageUtil

  const out = run(
    [
      { codec: "base64" },
      { codec: "aes", mode: "ctr", key: configKey, keyHash: "none", iv: "prefix" },
      { codec: "utf8" },
    ],
    Buffer.from(stored, "latin1")
  );
  assert.equal(out, plain);
});

test("value chain: aes-cbc(iv zero, key=sha256(secret)) → json", () => {
  const secret = "cache-secret";
  const key = crypto.createHash("sha256").update(secret).digest();
  const payload = { id: "099003", viContent: "Tài khoản đã đăng nhập", amount: 42000 };
  const c = crypto.createCipheriv("aes-256-cbc", key, Buffer.alloc(16));
  const ct = Buffer.concat([c.update(JSON.stringify(payload), "utf8"), c.final()]);

  const out = run(
    [
      { codec: "aes", mode: "cbc", key: secret, keyHash: "sha256", iv: "zero" },
      { codec: "json" },
    ],
    ct
  );
  assert.deepEqual(out, payload);
});

test("codec lạ → lỗi rõ ràng", () => {
  assert.throws(() => buildPipeline([{ codec: "khong-ton-tai" }]), /chưa đăng ký/);
});

test("aes sai độ dài key → báo gợi ý sha256", () => {
  assert.throws(
    () => buildPipeline([{ codec: "aes", mode: "cbc", key: "ngan", keyHash: "none" }]),
    /16\/24\/32/
  );
});

test("chuỗi rỗng → trả nguyên input", () => {
  const b = Buffer.from("abc");
  assert.equal(run([], b), b);
});
