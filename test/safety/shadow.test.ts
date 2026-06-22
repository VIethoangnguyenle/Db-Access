import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSql } from "../../src/drivers/oracle/parser.js";
import { buildShadowQuery } from "../../src/safety/shadow.js";

test("UPDATE có WHERE → SELECT đúng table + WHERE", () => {
  const sql = "UPDATE S.T SET A=1 WHERE ID=5";
  assert.equal(buildShadowQuery(sql, parseSql(sql)), "SELECT * FROM S.T WHERE ID=5");
});

test("DELETE không WHERE → SELECT toàn bảng", () => {
  const sql = "DELETE FROM S.T";
  assert.equal(buildShadowQuery(sql, parseSql(sql)), "SELECT * FROM S.T");
});

test("UPDATE có subquery → null (không chắc, không đoán)", () => {
  const sql = "UPDATE S.T SET A=(SELECT X FROM S.U WHERE U.ID=1) WHERE ID=5";
  assert.equal(buildShadowQuery(sql, parseSql(sql)), null);
});

test("SELECT → null", () => {
  const sql = "SELECT * FROM S.T";
  assert.equal(buildShadowQuery(sql, parseSql(sql)), null);
});
