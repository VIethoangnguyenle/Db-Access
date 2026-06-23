import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {parsePgSql} from "../drivers/postgres/parser.js";
import {executeSelect} from "../drivers/postgres/executor.js";

export function registerPgRead(server: McpServer, source: Source): void {
  server.tool(
    "pg_read",
    "Execute a SELECT query on a PostgreSQL database. DML and DDL are strictly blocked. Schema prefix is optional (defaults to search_path / public).",
    {
      db_name: z.string().describe("Database name from list_databases"),
      sql: z.string().describe("The SELECT (or WITH ... SELECT) statement to execute."),
    },
    async ({db_name, sql}) => {
      try {
        assertAccess(source, db_name, "read");

        const dbConfig = getDb(db_name);
        if (!dbConfig || dbConfig.type !== "postgres") {
          throw new Error(`Database '${db_name}' not found or is not a PostgreSQL database.`);
        }

        const parsed = parsePgSql(sql);
        if (parsed.type !== "SELECT") {
          throw new Error("Only SELECT operations are allowed in pg_read. Use pg_write for DML operations.");
        }

        const result = await executeSelect(db_name, sql);
        return {content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
      } catch (error) {
        return {
          content: [{type: "text", text: JSON.stringify({error: "Postgres Read failed", details: error instanceof Error ? error.message : String(error)}, null, 2)}],
          isError: true,
        };
      }
    }
  );
}
