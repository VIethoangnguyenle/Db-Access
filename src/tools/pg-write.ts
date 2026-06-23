import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {parsePgSql} from "../drivers/postgres/parser.js";
import {executePreview, executeWrite} from "../drivers/postgres/executor.js";
import {createConfirmationToken, validateAndConsumeToken} from "../safety/token-manager.js";

export function registerPgWrite(server: McpServer, source: Source): void {
  server.tool(
    "pg_write",
    "Execute DML (INSERT/UPDATE/DELETE) on a PostgreSQL database. Two-step: first call returns a preview of affected rows + a confirmation_token; second call WITH the token executes. DDL and SELECT are blocked.",
    {
      db_name: z.string().describe("Database name from list_databases"),
      sql: z.string().describe("The INSERT, UPDATE, or DELETE statement to execute."),
      confirmation_token: z.string().optional().describe("Required ONLY when confirming a write operation"),
    },
    async ({db_name, sql, confirmation_token}) => {
      try {
        assertAccess(source, db_name, "write");

        const dbConfig = getDb(db_name);
        if (!dbConfig || dbConfig.type !== "postgres") {
          throw new Error(`Database '${db_name}' not found or is not a PostgreSQL database.`);
        }

        const parsed = parsePgSql(sql);
        if (parsed.type === "SELECT" || parsed.type === "DDL" || parsed.type === "UNKNOWN") {
          throw new Error(`Operation type '${parsed.type}' is not allowed in pg_write. Only INSERT, UPDATE, and DELETE are supported.`);
        }

        if (confirmation_token) {
          validateAndConsumeToken(confirmation_token, db_name, sql);
          const result = await executeWrite(db_name, sql);
          return {content: [{type: "text", text: JSON.stringify({...result, message: `Successfully executed ${parsed.type}`}, null, 2)}]};
        }

        let previewResult = null;
        if (parsed.type === "UPDATE" || parsed.type === "DELETE") {
          previewResult = await executePreview(db_name, sql, parsed);
        }
        const token = createConfirmationToken(db_name, parsed.type, sql);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              type: "PREVIEW",
              message: `⚠️ ACTION REQUIRED: You are attempting to execute a ${parsed.type} operation.`,
              confirmation_token: token,
              instruction: "To proceed, call this tool again with the SAME sql and the confirmation_token provided above.",
              affected_tables: parsed.tableNames,
              shadow_preview: previewResult?.data || "Preview not available for this operation.",
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{type: "text", text: JSON.stringify({error: "Postgres Write failed", details: error instanceof Error ? error.message : String(error)}, null, 2)}],
          isError: true,
        };
      }
    }
  );
}
