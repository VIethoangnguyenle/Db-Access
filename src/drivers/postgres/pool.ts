import pg from "pg";
import type { Pool, PoolClient } from "pg";
import { getDb } from "../../config/loader.js";
import { ensure } from "../../net/tunnel-manager.js";

const pools = new Map<string, Pool>();

/** Lấy/khởi tạo pool Postgres cho database theo tên (qua tunnel nếu có ssh). */
export async function getPgPool(dbName: string): Promise<Pool> {
  const db = getDb(dbName);
  if (!db) throw new Error(`Database configuration '${dbName}' not found`);
  if (db.type !== "postgres") throw new Error(`Database '${dbName}' is not a PostgreSQL database`);

  const existing = pools.get(dbName);
  if (existing) return existing;

  const { host, port } = await ensure(db);
  const pool = new pg.Pool({
    host,
    port,
    database: db.database,
    user: db.user,
    password: db.password,
    max: 4,
  });
  pools.set(dbName, pool);
  return pool;
}

/** Mượn một client, chạy callback, luôn release. */
export async function withPgClient<T>(
  dbName: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = await getPgPool(dbName);
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}
