import oracledb from "oracledb";
import { getDb } from "../../config/loader.js";
import { ensure } from "../../net/tunnel-manager.js";

const pools = new Map<string, oracledb.Pool>();

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.DATE, oracledb.CLOB];

export async function getOraclePool(dbName: string): Promise<oracledb.Pool> {
  const db = getDb(dbName);
  if (!db) throw new Error(`Database configuration '${dbName}' not found`);
  if (db.type !== "oracle") throw new Error(`Database '${dbName}' is not an Oracle database`);

  const existing = pools.get(dbName);
  if (existing) return existing;

  const { host, port } = await ensure(db);
  const connectString = `${host}:${port}/${db.service}`;

  try {
    console.error(`[oracle-pool] Creating pool for '${dbName}' → ${connectString}`);
    const pool = await oracledb.createPool({
      user: db.user,
      password: db.password,
      connectString,
      poolMin: 1,
      poolMax: 4,
      poolIncrement: 1,
    });
    pools.set(dbName, pool);
    return pool;
  } catch (error) {
    throw new Error(`Failed to create Oracle pool for '${dbName}': ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function withOracleConnection<T>(
  dbName: string,
  callback: (connection: oracledb.Connection) => Promise<T>
): Promise<T> {
  const pool = await getOraclePool(dbName);
  let connection: oracledb.Connection | null = null;
  try {
    connection = await pool.getConnection();
    return await callback(connection);
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) {
        console.error(`Error closing Oracle connection for '${dbName}':`, err);
      }
    }
  }
}
