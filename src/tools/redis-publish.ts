import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../config/loader.js";
import { assertAccess } from "../auth/access.js";
import { Source } from "../config/schema.js";
import { publishMessage, channelSubscribers } from "../drivers/redis/executor.js";

export function registerRedisPublish(server: McpServer, source: Source): void {
  server.tool(
    "redis_publish",
    "Publish a message to a Redis pub/sub channel, or (probe=true) just count subscribers " +
      "without sending anything. Requires 'write' capability. Redis pub/sub is NOT scoped to a DB " +
      "index, so any service subscribed on the same master receives it. Returns how many " +
      "subscribers got the message (0 = nobody is listening on that channel). A common use is " +
      "broadcasting a cache-invalidation event so running services drop their cache themselves. " +
      "The channel name and message payload are application-specific — see the database's entry " +
      "in list_databases (its description) for the project's invalidation topic and message shape.",
    {
      db_name: z.string().describe("Database name from list_databases (a redis-type source)"),
      channel: z.string().describe("Channel, e.g. 'OMNI_RELOAD_FACTORY'"),
      message: z.string().optional().describe("Message body (JSON string for ReloadCacheModel). Omit when probe=true."),
      probe: z.boolean().optional().describe("true → only count subscribers via PUBSUB NUMSUB, send nothing"),
    },
    async ({ db_name, channel, message, probe }) => {
      try {
        assertAccess(source, db_name, "write");
        const db = getDb(db_name);
        if (!db || db.type !== "redis") {
          throw new Error(`Database '${db_name}' not found or is not a Redis database.`);
        }
        const result = probe
          ? await channelSubscribers(db_name, channel)
          : await publishMessage(db_name, channel, message ?? (() => { throw new Error("thiếu 'message' (hoặc đặt probe=true)"); })());
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "Redis publish failed", details: error instanceof Error ? error.message : String(error) },
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
