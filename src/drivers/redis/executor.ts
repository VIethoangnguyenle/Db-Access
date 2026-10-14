import type Redis from "ioredis";
import { getDb } from "../../config/loader.js";
import { DbConfig } from "../../config/schema.js";
import { getRedis } from "./pool.js";
import { buildPipeline, runPipeline, CodecStep, Codec } from "./codec/registry.js";

const MAX_SCAN = 2000;

function valuePipeline(db: DbConfig): Codec[] {
  return buildPipeline(db.valueCodec as CodecStep[] | undefined);
}

/** Thêm keyPrefix nếu key chưa mang sẵn prefix đó (tiện cho người gọi). */
function withPrefix(db: DbConfig, key: string): string {
  if (!db.keyPrefix) return key;
  return key.startsWith(db.keyPrefix) ? key : `${db.keyPrefix}${key}`;
}

/** Giải một value bytes qua valueCodec. Lỗi giải → trả thông tin thô + lý do. */
function decodeValue(
  pipeline: Codec[],
  buf: Buffer,
  key: string,
  dbName: string
): { decoded: unknown } | { raw: string; bytes: number; note: string } {
  if (pipeline.length === 0) {
    // Không khai codec: cố đọc utf8, không được thì base64.
    const text = buf.toString("utf8");
    return { decoded: text.includes("�") ? buf.toString("base64") : text };
  }
  try {
    return { decoded: runPipeline(pipeline, buf, { key, dbName }) };
  } catch (e) {
    return {
      raw: buf.subarray(0, 32).toString("base64"),
      bytes: buf.length,
      note: `decode lỗi: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export interface ScanResult {
  total: number;
  truncated: boolean;
  groups: { prefix: string; count: number; types: Record<string, number>; samples: string[] }[];
  keys?: { key: string; type: string; ttl: number }[];
}

/**
 * Quét key theo pattern (SCAN, không block). Gom nhóm theo 2 tầng prefix đầu để
 * dễ nhìn; `detail=true` thì kèm danh sách key + type + ttl (tối đa `limit`).
 */
export async function scanKeys(
  dbName: string,
  pattern: string | undefined,
  limit: number,
  detail: boolean
): Promise<ScanResult> {
  const db = getDb(dbName)!;
  const client: Redis = await getRedis(dbName);
  const match = pattern ? withPrefix(db, pattern) : db.keyPrefix ? `${db.keyPrefix}*` : "*";
  const cap = Math.min(limit || 100, MAX_SCAN);

  const found: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await client.scan(cursor, "MATCH", match, "COUNT", 500);
    cursor = next;
    for (const k of batch) {
      if (found.length >= cap) break;
      found.push(k);
    }
  } while (cursor !== "0" && found.length < cap);

  const groups = new Map<string, { count: number; types: Record<string, number>; samples: string[] }>();
  const keys: { key: string; type: string; ttl: number }[] = [];

  for (const k of found) {
    const parts = k.split(":");
    const prefix = parts.slice(0, 2).join(":") || k;
    const g = groups.get(prefix) ?? { count: 0, types: {}, samples: [] };
    g.count++;
    if (g.samples.length < 2) g.samples.push(k);
    groups.set(prefix, g);
    if (detail || g.count <= 1) {
      const [type, ttl] = await Promise.all([client.type(k), client.ttl(k)]);
      g.types[type] = (g.types[type] ?? 0) + 1;
      if (detail) keys.push({ key: k, type, ttl });
    }
  }

  return {
    total: found.length,
    truncated: found.length >= cap,
    groups: [...groups.entries()]
      .map(([prefix, g]) => ({ prefix, count: g.count, types: g.types, samples: g.samples }))
      .sort((a, b) => b.count - a.count),
    ...(detail ? { keys } : {}),
  };
}

export interface ReadResult {
  key: string;
  type: string;
  ttl: number;
  value: unknown;
}

/** Đọc một key, tự giải value qua valueCodec. Hỗ trợ string/hash/list/set/zset. */
export async function readKey(dbName: string, rawKey: string): Promise<ReadResult> {
  const db = getDb(dbName)!;
  const client: Redis = await getRedis(dbName);
  const key = withPrefix(db, rawKey);
  const pipeline = valuePipeline(db);

  const type = await client.type(key);
  const ttl = await client.ttl(key);
  const dec = (b: Buffer) => decodeValue(pipeline, b, key, dbName);

  let value: unknown;
  switch (type) {
    case "none":
      throw new Error(`Key '${key}' không tồn tại`);
    case "string":
      value = dec((await client.getBuffer(key))!);
      break;
    case "hash": {
      const h = await client.hgetallBuffer(key);
      value = Object.fromEntries(Object.entries(h).map(([f, b]) => [f, dec(b as Buffer)]));
      break;
    }
    case "list":
      value = (await client.lrangeBuffer(key, 0, -1)).map((b) => dec(b as Buffer));
      break;
    case "set":
      value = (await client.smembersBuffer(key)).map((b) => dec(b as Buffer));
      break;
    case "zset": {
      const z = (await (client as any).zrangeBuffer(key, 0, -1, "WITHSCORES")) as Buffer[];
      const out: { member: unknown; score: string }[] = [];
      for (let i = 0; i < z.length; i += 2) {
        out.push({ member: dec(z[i] as Buffer), score: (z[i + 1] as Buffer).toString() });
      }
      value = out;
      break;
    }
    default:
      value = `<unsupported type: ${type}>`;
  }

  return { key, type, ttl, value };
}

// ─── Ghi / vô hiệu hoá cache (cần capability "write") ──────────────────────

const MAX_DELETE = 1000;

/** Xoá key theo danh sách (DEL/UNLINK). keyPrefix tự thêm nếu thiếu. */
export async function deleteKeys(
  dbName: string,
  rawKeys: string[],
  unlink: boolean
): Promise<{ requested: number; deleted: number; keys: string[] }> {
  const db = getDb(dbName)!;
  const client = await getRedis(dbName);
  const keys = rawKeys.map((k) => withPrefix(db, k));
  const deleted = unlink ? await client.unlink(...keys) : await client.del(...keys);
  return { requested: keys.length, deleted, keys };
}

/**
 * Xoá key theo PATTERN (SCAN → UNLINK). Bắt buộc nằm trong keyPrefix của source
 * để không quét nhầm dự án khác trên cụm dùng chung. Cap `MAX_DELETE`.
 */
export async function deleteByPattern(
  dbName: string,
  pattern: string
): Promise<{ matched: number; deleted: number; truncated: boolean; samples: string[] }> {
  const db = getDb(dbName)!;
  const match = withPrefix(db, pattern);
  if (db.keyPrefix && !match.startsWith(db.keyPrefix)) {
    throw new Error(`Pattern phải nằm trong keyPrefix '${db.keyPrefix}' (nhận '${match}')`);
  }
  const client = await getRedis(dbName);
  const found: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await client.scan(cursor, "MATCH", match, "COUNT", 500);
    cursor = next;
    for (const k of batch) {
      if (found.length >= MAX_DELETE) break;
      found.push(k);
    }
  } while (cursor !== "0" && found.length < MAX_DELETE);

  let deleted = 0;
  for (let i = 0; i < found.length; i += 200) {
    deleted += await client.unlink(...found.slice(i, i + 200));
  }
  return {
    matched: found.length,
    deleted,
    truncated: found.length >= MAX_DELETE,
    samples: found.slice(0, 5),
  };
}

/** Đặt/huỷ TTL cho một key. seconds=null → PERSIST (bỏ hạn). */
export async function setKeyTtl(
  dbName: string,
  rawKey: string,
  seconds: number | null
): Promise<{ key: string; applied: boolean; ttl: number }> {
  const db = getDb(dbName)!;
  const client = await getRedis(dbName);
  const key = withPrefix(db, rawKey);
  const applied =
    seconds === null ? (await client.persist(key)) === 1 : (await client.expire(key, seconds)) === 1;
  return { key, applied, ttl: await client.ttl(key) };
}

// ─── Pub/Sub ───────────────────────────────────────────────────────────────

/**
 * PUBLISH một message tới channel. Pub/sub của Redis KHÔNG theo DB nên mọi
 * instance subscribe trên cùng master đều nhận, bất kể chỉ số DB. Trả số
 * subscriber đã nhận (0 = không ai nghe channel đó).
 */
export async function publishMessage(
  dbName: string,
  channel: string,
  message: string
): Promise<{ channel: string; receivers: number }> {
  const client = await getRedis(dbName);
  const receivers = await client.publish(channel, message);
  return { channel, receivers };
}

/** PUBSUB NUMSUB — đếm subscriber của channel mà KHÔNG gửi gì (thuần đọc). */
export async function channelSubscribers(
  dbName: string,
  channel: string
): Promise<{ channel: string; subscribers: number }> {
  const client = await getRedis(dbName);
  const res = (await client.call("PUBSUB", "NUMSUB", channel)) as (string | number)[];
  return { channel, subscribers: Number(res[1] ?? 0) };
}
