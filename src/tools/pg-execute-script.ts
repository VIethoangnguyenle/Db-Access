import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {assertNoDdl, executePgScript} from "../drivers/postgres/script.js";
import {createConfirmationToken, validateAndConsumeToken} from "../safety/token-manager.js";

export function registerPgExecuteScript(server: McpServer, source: Source): void {
  server.tool(
    "pg_execute_script",
    [
      "Execute a PostgreSQL script (multiple statements and/or DO $$ ... $$ blocks) in a single transaction.",
      "Two-step: first call returns a confirmation_token; second call WITH the token executes (COMMIT on success, ROLLBACK on error).",
      "Captures NOTICE messages (RAISE NOTICE). DDL (DROP/TRUNCATE/ALTER/CREATE/GRANT/REVOKE) is blocked.",
    ].join(" "),
    {
      db_name: z.string().describe("Database name from list_databases"),
      script: z.string().describe("The SQL/PL-pgSQL script. Manages its own logic; the whole script runs in one transaction."),
      confirmation_token: z.string().optional().describe("Required ONLY when confirming script execution (step 2)."),
    },
    async ({db_name, script, confirmation_token}) => {
      try {
        assertAccess(source, db_name, "script");

        const dbConfig = getDb(db_name);
        if (!dbConfig || dbConfig.type !== "postgres") {
          throw new Error(`Database '${db_name}' not found or is not a PostgreSQL database.`);
        }

        assertNoDdl(script);

        if (confirmation_token) {
          validateAndConsumeToken(confirmation_token, db_name, script);
          const result = await executePgScript(db_name, script);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: result.success,
                message: result.success ? "✅ Script executed successfully" : "❌ Script execution failed (rolled back)",
                rowsAffected: result.rowsAffected,
                notices: result.notices,
                ...(result.error ? {error: result.error} : {}),
              }, null, 2),
            }],
          };
        }

        const token = createConfirmationToken(db_name, "PG_SCRIPT", script);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              type: "PREVIEW",
              message: "⚠️ ACTION REQUIRED: You are about to execute a PostgreSQL script (runs in one transaction).",
              confirmation_token: token,
              instruction: "To proceed, call this tool again with the SAME script and the confirmation_token above.",
              source_preview: script.substring(0, 400) + (script.length > 400 ? "..." : ""),
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{type: "text", text: JSON.stringify({error: "Script execution failed", details: error instanceof Error ? error.message : String(error)}, null, 2)}],
          isError: true,
        };
      }
    }
  );
}
