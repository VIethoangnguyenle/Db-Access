import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {getTables} from "../drivers/postgres/schema.js";

export function registerPgListTables(server: McpServer, source: Source): void {
  server.tool(
    "pg_list_tables",
    "List tables in a PostgreSQL database schema (default 'public').",
    {
      db_name: z.string().describe("Database name from list_databases"),
      schema_name: z.string().optional().describe("Schema name (default: public)"),
    },
    async ({db_name, schema_name}) => {
      try {
        assertAccess(source, db_name, "read");
        const dbConfig = getDb(db_name);
        if (!dbConfig || dbConfig.type !== "postgres") {
          throw new Error(`Database '${db_name}' not found or is not a PostgreSQL database.`);
        }
        const tables = await getTables(db_name, schema_name || "public");
        return {content: [{type: "text", text: JSON.stringify({schema: schema_name || "public", tables, total: tables.length}, null, 2)}]};
      } catch (error) {
        return {
          content: [{type: "text", text: JSON.stringify({error: "Failed to list tables", details: error instanceof Error ? error.message : String(error)}, null, 2)}],
          isError: true,
        };
      }
    }
  );
}
