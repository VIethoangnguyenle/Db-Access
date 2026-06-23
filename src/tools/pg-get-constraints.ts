import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {getTableConstraints} from "../drivers/postgres/schema.js";

export function registerPgGetConstraints(server: McpServer, source: Source): void {
  server.tool(
    "pg_get_constraints",
    "Get constraints (Primary Keys, Foreign Keys, Unique) for a PostgreSQL table.",
    {
      db_name: z.string().describe("Database name from list_databases"),
      table_name: z.string().describe("Table name"),
      schema_name: z.string().optional().describe("Schema name (default: public)"),
    },
    async ({db_name, table_name, schema_name}) => {
      try {
        assertAccess(source, db_name, "read");
        const dbConfig = getDb(db_name);
        if (!dbConfig || dbConfig.type !== "postgres") {
          throw new Error(`Database '${db_name}' not found or is not a PostgreSQL database.`);
        }
        const result = await getTableConstraints(db_name, table_name, schema_name || "public");
        return {content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
      } catch (error) {
        return {
          content: [{type: "text", text: JSON.stringify({error: "Failed to get constraints", details: error instanceof Error ? error.message : String(error)}, null, 2)}],
          isError: true,
        };
      }
    }
  );
}
