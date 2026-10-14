import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../config/loader.js";
import { assertAccess } from "../auth/access.js";
import { Source } from "../config/schema.js";
import { deleteKeys, deleteByPattern, setKeyTtl } from "../drivers/redis/executor.js";

export function registerRedisWrite(server: McpServer, source: Source): void {
  server.tool(
    "redis_write",
    "Mutate Redis keys (requires 'write' capability). Intended for cache invalidation: " +
      "delete keys so the app re-reads from DB. Operations: del / unlink (non-blocking delete), " +
      "expire (set TTL seconds), persist (remove TTL). Provide exact keys, OR op='del_pattern' " +
      "with a glob (must stay within the source's keyPrefix; capped at 1000 keys). The keyPrefix " +
      "is auto-prepended when missing. NOTE: a Redis master may be shared across projects — " +
      "del_pattern is therefore restricted to the source's keyPrefix. When the goal is to make " +
      "running services drop their cache consistently, prefer a pub/sub invalidation broadcast " +
      "(redis_publish) over blind key deletion if the application supports one.",
    {
      db_name: z.string().describe("Database name from list_databases (a redis-type source)"),
      op: z
        .enum(["del", "unlink", "del_pattern", "expire", "persist"])
        .describe("del/unlink: delete keys; del_pattern: delete by glob; expire/persist: TTL"),
      keys: z.array(z.string()).optional().describe("Exact keys for del/unlink/expire/persist"),
      pattern: z.string().optional().describe("Glob for op='del_pattern', e.g. 'vietbank-sme:common:ConfigModel:*'"),
      seconds: z.number().int().optional().describe("TTL seconds for op='expire'"),
    },
    async ({ db_name, op, keys, pattern, seconds }) => {
      try {
        assertAccess(source, db_name, "write");
        const db = getDb(db_name);
        if (!db || db.type !== "redis") {
          throw new Error(`Database '${db_name}' not found or is not a Redis database.`);
        }

        let result: Record<string, unknown>;
        if (op === "del" || op === "unlink") {
          if (!keys?.length) throw new Error(`op='${op}' cần 'keys'`);
          result = await deleteKeys(db_name, keys, op === "unlink");
        } else if (op === "del_pattern") {
          if (!pattern) throw new Error("op='del_pattern' cần 'pattern'");
          result = await deleteByPattern(db_name, pattern);
        } else if (op === "expire") {
          if (!keys?.length || seconds === undefined) throw new Error("op='expire' cần 'keys' và 'seconds'");
          result = { results: await Promise.all(keys.map((k) => setKeyTtl(db_name, k, seconds))) };
        } else {
          if (!keys?.length) throw new Error("op='persist' cần 'keys'");
          result = { results: await Promise.all(keys.map((k) => setKeyTtl(db_name, k, null))) };
        }
        return { content: [{ type: "text", text: JSON.stringify({ op, ...result }, null, 2) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "Redis write failed", details: error instanceof Error ? error.message : String(error) },
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
