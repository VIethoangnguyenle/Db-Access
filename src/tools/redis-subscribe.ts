import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../config/loader.js";
import { assertAccess } from "../auth/access.js";
import { Source } from "../config/schema.js";
import { subscribeMessages } from "../drivers/redis/executor.js";

export function registerRedisSubscribe(server: McpServer, source: Source): void {
  server.tool(
    "redis_subscribe",
    "Listen on one or more Redis pub/sub channels for up to `timeout_seconds` (max 30) and return " +
      "the messages received (read-only — sends nothing). Blocks for the duration. Use to OBSERVE " +
      "the exact payload an application publishes — e.g. subscribe to a cache-reload channel, let " +
      "the app emit its own invalidation event, and read the real message shape/token instead of " +
      "guessing. Each message is returned as a raw string plus a parsed `json` field when valid JSON.",
    {
      db_name: z.string().describe("Database name from list_databases (a redis-type source)"),
      channels: z.array(z.string()).min(1).describe("Channels to subscribe to, e.g. ['OMNI_RELOAD_FACTORY']"),
      timeout_seconds: z.number().int().optional().describe("How long to listen (default 15, max 30)"),
      max_messages: z.number().int().optional().describe("Stop early after this many messages (default 20)"),
    },
    async ({ db_name, channels, timeout_seconds, max_messages }) => {
      try {
        assertAccess(source, db_name, "read");
        const db = getDb(db_name);
        if (!db || db.type !== "redis") {
          throw new Error(`Database '${db_name}' not found or is not a Redis database.`);
        }
        const result = await subscribeMessages(
          db_name,
          channels,
          (timeout_seconds ?? 15) * 1000,
          max_messages ?? 20
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "Redis subscribe failed", details: error instanceof Error ? error.message : String(error) },
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
