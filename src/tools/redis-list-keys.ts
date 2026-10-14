import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../config/loader.js";
import { assertAccess } from "../auth/access.js";
import { Source } from "../config/schema.js";
import { scanKeys } from "../drivers/redis/executor.js";

export function registerRedisListKeys(server: McpServer, source: Source): void {
  server.tool(
    "redis_list_keys",
    "Scan keys in a Redis database (read-only, non-blocking SCAN). Returns keys grouped by " +
      "prefix with per-group count, value types and sample keys. Business keys often end in a " +
      "numeric hash, so scan a prefix pattern then pick the exact key. Set detail=true to also " +
      "get a flat list of key + type + TTL (seconds).",
    {
      db_name: z.string().describe("Database name from list_databases (a redis-type source)"),
      pattern: z
        .string()
        .optional()
        .describe("Glob pattern, e.g. 'vietbank-sme:transaction:*'. Omitted → the source's keyPrefix + '*'. The configured keyPrefix is auto-prepended if missing."),
      limit: z.number().int().optional().describe("Max keys to scan (default 100, max 2000)"),
      detail: z.boolean().optional().describe("Include a flat key/type/ttl list (default false)"),
    },
    async ({ db_name, pattern, limit, detail }) => {
      try {
        assertAccess(source, db_name, "read");
        const db = getDb(db_name);
        if (!db || db.type !== "redis") {
          throw new Error(`Database '${db_name}' not found or is not a Redis database.`);
        }
        const result = await scanKeys(db_name, pattern, limit ?? 100, detail ?? false);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "Redis list_keys failed", details: error instanceof Error ? error.message : String(error) },
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
