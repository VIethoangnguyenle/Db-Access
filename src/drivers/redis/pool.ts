import Redis, { RedisOptions } from "ioredis";
import { getDb } from "../../config/loader.js";
import { DbConfig } from "../../config/schema.js";
import { buildPipeline, runPipeline, CodecStep } from "./codec/registry.js";

const clients = new Map<string, Redis>();

/** "h:p,h:p" → [{host,port}]. Mảng sẵn thì giữ nguyên. */
function parseSentinels(
  raw: string | { host: string; port: number }[]
): { host: string; port: number }[] {
  if (Array.isArray(raw)) return raw;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [host, port] = pair.split(":");
      return { host, port: parseInt(port, 10) };
    });
}

/** Giải mật khẩu qua passwordCodec (nếu khai). Không khai → dùng nguyên văn. */
function resolvePassword(db: DbConfig): string | undefined {
  if (db.password === undefined) return undefined;
  const steps = db.passwordCodec as CodecStep[] | undefined;
  if (!steps || steps.length === 0) return db.password;
  const out = runPipeline(buildPipeline(steps), Buffer.from(db.password, "latin1"), {
    key: "<password>",
    dbName: db.name,
  });
  if (typeof out !== "string") {
    throw new Error(
      `passwordCodec của '${db.name}' phải KẾT bằng chuỗi (thêm bước 'utf8'), nhận ${typeof out}`
    );
  }
  return out;
}

export async function getRedis(dbName: string): Promise<Redis> {
  const db = getDb(dbName);
  if (!db) throw new Error(`Database configuration '${dbName}' not found`);
  if (db.type !== "redis") throw new Error(`Database '${dbName}' is not a Redis database`);

  const existing = clients.get(dbName);
  if (existing) return existing;

  const options: RedisOptions = {
    db: db.db ?? 0,
    password: resolvePassword(db),
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 8000,
    // Giá trị nhị phân (đã mã hoá) → luôn lấy ở dạng Buffer, không ép utf8.
    keyPrefix: "",
  };

  if (db.sentinels) {
    options.sentinels = parseSentinels(db.sentinels);
    options.name = db.master;
    if (!db.master) throw new Error(`Redis '${dbName}': dùng sentinels phải khai 'master'`);
  } else {
    options.host = db.host;
    options.port = db.port;
  }

  const client = new Redis(options);
  client.on("error", (e) => console.error(`[redis:${dbName}] ${e.message}`));
  await client.connect();
  clients.set(dbName, client);
  return client;
}

export async function closeAllRedis(): Promise<void> {
  for (const [name, c] of clients) {
    try {
      c.disconnect();
    } catch {
      /* ignore */
    }
    clients.delete(name);
  }
}
