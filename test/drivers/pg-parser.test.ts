import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePgSql } from "../../src/drivers/postgres/parser.js";
import { appConfigSchema } from "../../src/config/schema.js";

test("parsePgSql nhận diện loại lệnh", () => {
  assert.equal(parsePgSql("SELECT * FROM public.users WHERE id=1").type, "SELECT");
  assert.equal(parsePgSql("INSERT INTO users(a) VALUES (1)").type, "INSERT");
  assert.equal(parsePgSql("UPDATE users SET a=1 WHERE id=2").type, "UPDATE");
  assert.equal(parsePgSql("DELETE FROM users WHERE id=2").type, "DELETE");
  assert.equal(parsePgSql("DROP TABLE users").type, "DDL");
});

test("parsePgSql lấy tableNames", () => {
  const p = parsePgSql("SELECT * FROM public.users");
  assert.ok(p.tableNames.includes("public.users") || p.tableNames.includes("users"));
});

test("config chấp nhận postgres khi có database", () => {
  const r = appConfigSchema.safeParse({
    databases: { pg1: { type: "postgres", host: "h", port: 5432, database: "app", user: "u", password: "p" } },
    sources: { a: { apiKey: "k", access: { pg1: ["read"] } } },
  });
  assert.equal(r.success, true);
});

test("config từ chối postgres thiếu database", () => {
  const r = appConfigSchema.safeParse({
    databases: { pg1: { type: "postgres", host: "h", port: 5432, user: "u", password: "p" } },
    sources: {},
  });
  assert.equal(r.success, false);
});
