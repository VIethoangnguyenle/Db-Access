import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {Source} from "../config/schema.js";
import {accessibleDatabases} from "../auth/access.js";
import {getDb} from "../config/loader.js";

export function registerListDatabases(server: McpServer, source: Source): void {
  server.tool(
    "list_databases",
    "List databases this source is allowed to access, with their type and granted capabilities. Call this first.",
    {},
    async () => {
      const list = accessibleDatabases(source).map((entry) => {
        const db = getDb(entry.name);
        return { name: entry.name, type: db?.type ?? "unknown", capabilities: entry.capabilities };
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ databases: list, total: list.length }, null, 2) }],
      };
    }
  );
}
