/**
 * MCP Tool: sql_execute_script
 *
 * Executes a relational script with a two-step confirmation flow (same pattern
 * as sql_write). The backend is selected automatically from the database's type:
 *   - Oracle: PL/SQL anonymous blocks (multi-block via `/`), DBMS_OUTPUT capture.
 *   - PostgreSQL: multiple statements / DO $$ ... $$ blocks in one transaction,
 *     NOTICE capture.
 * DDL is blocked for both backends.
 */

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {getRelationalDriver} from "../drivers/relational.js";
import {createConfirmationToken, validateAndConsumeToken} from "../safety/token-manager.js";

export function registerSqlExecuteScript(server: McpServer, source: Source): void {
    server.tool(
        "sql_execute_script",
        [
            "Execute a relational script on an Oracle or PostgreSQL database; the backend is selected automatically from the database's type.",
            "Oracle: PL/SQL anonymous blocks (DECLARE...BEGIN...END), multi-block via `/`, captures DBMS_OUTPUT.",
            "PostgreSQL: multiple statements and/or DO $$ ... $$ blocks executed in a single transaction (COMMIT on success, ROLLBACK on error), captures NOTICE.",
            "Two-step process: First call returns a script analysis and confirmation_token. Second call WITH the confirmation_token executes the script.",
            "Use this for remediation scripts, data migration scripts, and procedural logic.",
            "NOTE: DDL operations (DROP, TRUNCATE, ALTER, CREATE, GRANT, REVOKE) are blocked.",
        ].join(" "),
        {
            db_name: z.string().describe("Database name from list_databases"),
            script: z.string().describe(
                "The script to execute. For Oracle: one or more DECLARE...BEGIN...END blocks separated by `/`; " +
                "SQL*Plus directives are stripped automatically. For PostgreSQL: SQL statements and/or DO blocks. " +
                "The script manages its own logic; it runs transactionally per backend semantics."
            ),
            confirmation_token: z.string().optional().describe(
                "Required ONLY when confirming script execution (step 2). " +
                "Obtain this token from the preview response in step 1."
            ),
        },
        async ({db_name, script, confirmation_token}) => {
            try {
                assertAccess(source, db_name, "script");

                const driver = getRelationalDriver(db_name);

                // DDL guard (backend-specific).
                driver.assertScriptSafe(script);

                if (confirmation_token) {
                    // ── Step 2: Execute ──────────────────────────────────
                    validateAndConsumeToken(confirmation_token, db_name, script);
                    const result = await driver.executeScript(db_name, script);
                    return {
                        content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                    };
                } else {
                    // ── Step 1: Preview & generate token ─────────────────
                    const preview = driver.buildScriptPreview(script);
                    const token = createConfirmationToken(db_name, "SCRIPT", script);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                type: "PREVIEW",
                                confirmation_token: token,
                                instruction: "To proceed, call this tool again with the SAME script and the confirmation_token above.",
                                ...preview,
                            }, null, 2),
                        }],
                    };
                }
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            error: "Script execution failed",
                            details: error instanceof Error ? error.message : String(error),
                        }, null, 2),
                    }],
                    isError: true,
                };
            }
        }
    );
}
