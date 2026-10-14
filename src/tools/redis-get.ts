import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../config/loader.js";
import { assertAccess } from "../auth/access.js";
import { Source } from "../config/schema.js";
import { readKey } from "../drivers/redis/executor.js";

export function registerRedisGet(server: McpServer, source: Source): void {
  server.tool(
    "redis_get",
    "Read one Redis key (read-only). The value is automatically run through the source's " +
      "configured value codec chain (e.g. AES-decrypt then Java-deserialize) and returned as " +
      "structured data. Supports string, hash, list, set and zset. The configured keyPrefix is " +
      "auto-prepended if missing. If decoding fails, returns the raw bytes head plus the reason.",
    {
      db_name: z.string().describe("Database name from list_databases (a redis-type source)"),
      key: z.string().describe("Exact Redis key, e.g. 'vietbank-sme:transaction:TransactionModel:-1543315706'"),
    },
    async ({ db_name, key }) => {
      try {
        assertAccess(source, db_name, "read");
        const db = getDb(db_name);
        if (!db || db.type !== "redis") {
          throw new Error(`Database '${db_name}' not found or is not a Redis database.`);
        }
        const result = await readKey(db_name, key);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "Redis get failed", details: error instanceof Error ? error.message : String(error) },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
