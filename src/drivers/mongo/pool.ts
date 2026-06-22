import { Db, MongoClient } from "mongodb";
import { getDb } from "../../config/loader.js";
import { ensure } from "../../net/tunnel-manager.js";

const clients = new Map<string, MongoClient>();

export async function getMongoDb(dbName: string): Promise<Db> {
  const db = getDb(dbName);
  if (!db) throw new Error(`Database configuration '${dbName}' not found`);
  if (db.type !== "mongo") throw new Error(`Database '${dbName}' is not a MongoDB database`);

  const existing = clients.get(dbName);
  if (existing) return existing.db(db.database);

  const { host, port } = await ensure(db);
  const uri = `mongodb://${host}:${port}`;

  try {
    const client = new MongoClient(uri, {
      auth: { username: db.user, password: db.password },
      maxPoolSize: 4,
    });
    await client.connect();
    clients.set(dbName, client);
    return client.db(db.database);
  } catch (error) {
    throw new Error(`Failed to connect to MongoDB '${dbName}': ${error instanceof Error ? error.message : String(error)}`);
  }
}
