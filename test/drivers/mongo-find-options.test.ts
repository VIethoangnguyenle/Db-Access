import { test } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import {
  assertFieldMap,
  clampLimit,
  deserializeMongoQuery,
  DEFAULT_FIND_LIMIT,
  MAX_FIND_LIMIT,
} from "../../src/drivers/mongo/executor.js";

test("$date ISO trong filter thành Date", () => {
  const q = deserializeMongoQuery({ createdDate: { $gte: { $date: "2026-09-24T00:00:00Z" } } });
  assert.ok(q.createdDate.$gte instanceof Date);
  assert.equal(q.createdDate.$gte.toISOString(), "2026-09-24T00:00:00.000Z");
});

test("$date epoch millis và $numberLong", () => {
  assert.equal(deserializeMongoQuery({ $date: 0 }).getTime(), 0);
  assert.equal(deserializeMongoQuery({ $date: { $numberLong: "1000" } }).getTime(), 1000);
});

test("$date hỏng thì báo lỗi, không lọc sai im lặng", () => {
  assert.throws(() => deserializeMongoQuery({ d: { $date: "không-phải-ngày" } }), /Invalid \$date/);
});

test("$oid vẫn chạy như cũ", () => {
  const q = deserializeMongoQuery({ _id: { $gte: { $oid: "68d3178329b9273681491d5b" } } });
  assert.ok(q._id.$gte instanceof ObjectId);
});

test("limit: mặc định, trần, giá trị hỏng", () => {
  assert.equal(clampLimit(undefined), DEFAULT_FIND_LIMIT);
  assert.equal(clampLimit(0), DEFAULT_FIND_LIMIT);
  assert.equal(clampLimit(Number.NaN), DEFAULT_FIND_LIMIT);
  assert.equal(clampLimit(120), 120);
  assert.equal(clampLimit(99999), MAX_FIND_LIMIT);
});

test("sort chỉ nhận 1/-1, không nhận operator", () => {
  assert.doesNotThrow(() => assertFieldMap({ createdDate: -1 }, [1, -1], "sort"));
  assert.throws(() => assertFieldMap({ createdDate: 2 }, [1, -1], "sort"), /sort/);
  assert.throws(() => assertFieldMap({ $natural: 1 }, [1, -1], "sort"), /sort/);
  assert.throws(() => assertFieldMap([1], [1, -1], "sort"), /sort/);
});

test("projection chỉ nhận 0/1", () => {
  assert.doesNotThrow(() => assertFieldMap({ cifNo: 1, _id: 0 }, [0, 1], "projection"));
  assert.throws(() => assertFieldMap({ cifNo: "$x" }, [0, 1], "projection"), /projection/);
});
