import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {getTableColumns} from "../drivers/postgres/schema.js";

export function registerPgGetColumns(server: McpServer, source: Source): void {
  server.tool(
    "pg_get_columns",
    "Get detailed column schema (name, type, nullability, comment) for a PostgreSQL table.",
    {
      db_name: z.string().describe("Database name from list_databases"),
      table_name: z.string().describe("Table name (case-sensitive, unquoted lowercase by default)"),
      schema_name: z.string().optional().describe("Schema name (default: public)"),
    },
    async ({db_name, table_name, schema_name}) => {
      try {
        assertAccess(source, db_name, "read");
        const dbConfig = getDb(db_name);
        if (!dbConfig || dbConfig.type !== "postgres") {
          throw new Error(`Database '${db_name}' not found or is not a PostgreSQL database.`);
        }
        const result = await getTableColumns(db_name, table_name, schema_name || "public");
        return {content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
      } catch (error) {
        return {
          content: [{type: "text", text: JSON.stringify({error: "Failed to get columns", details: error instanceof Error ? error.message : String(error)}, null, 2)}],
          isError: true,
        };
      }
    }
  );
}
