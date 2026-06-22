/**
 * MCP Tool: sql_execute_script
 *
 * Executes complex PL/SQL scripts (anonymous blocks) with DBMS_OUTPUT capture.
 * Supports multi-block scripts separated by `/` delimiter.
 * Uses two-step confirmation flow for safety (same pattern as sql_write).
 */

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {parsePlsqlScript, extractSchemaReferences} from "../drivers/oracle/plsql-parser.js";
import {executePlsqlScript} from "../drivers/oracle/plsql-executor.js";
import {createConfirmationToken, validateAndConsumeToken} from "../safety/token-manager.js";

export function registerSqlExecuteScript(server: McpServer, source: Source): void {
    server.tool(
        "sql_execute_script",
        [
            "Execute complex PL/SQL scripts (DECLARE...BEGIN...END anonymous blocks) on an Oracle database.",
            "Supports multi-block scripts separated by `/` delimiter and captures DBMS_OUTPUT.",
            "Two-step process: First call returns a script analysis and confirmation_token.",
            "Second call WITH the confirmation_token executes the script.",
            "Use this for DBA remediation scripts, data migration scripts, and procedural logic.",
            "NOTE: DDL operations (DROP, TRUNCATE, ALTER, CREATE) are blocked even inside PL/SQL.",
        ].join(" "),
        {
            db_name: z.string().describe("Database name from list_databases"),
            script: z.string().describe(
                "The PL/SQL script to execute. Can contain single or multiple DECLARE...BEGIN...END blocks " +
                "separated by `/` on its own line. SQL*Plus directives (SET SERVEROUTPUT ON, etc.) are " +
                "automatically stripped. The script manages its own COMMIT/ROLLBACK."
            ),
            confirmation_token: z.string().optional().describe(
                "Required ONLY when confirming script execution (step 2). " +
                "Obtain this token from the preview response in step 1."
            ),
        },
        async ({db_name, script, confirmation_token}) => {
            try {
                assertAccess(source, db_name, "script");

                // Validate database
                const dbConfig = getDb(db_name);
                if (!dbConfig || dbConfig.type !== "oracle") {
                    throw new Error(`Database '${db_name}' not found or is not an Oracle database.`);
                }

                // Parse the script
                const blocks = parsePlsqlScript(script);

                // DDL guard — check all blocks
                const ddlBlocks = blocks.filter(b => b.containsDdl);
                if (ddlBlocks.length > 0) {
                    throw new Error(
                        `DDL operations detected in block(s) ${ddlBlocks.map(b => b.index + 1).join(", ")}. ` +
                        `DDL (DROP, TRUNCATE, ALTER, CREATE, GRANT, REVOKE) is blocked for safety. ` +
                        `Contact a DBA to execute DDL operations directly.`
                    );
                }

                if (confirmation_token) {
                    // ── Step 2: Execute ──────────────────────────────────
                    validateAndConsumeToken(confirmation_token, db_name, script);

                    const result = await executePlsqlScript(db_name, blocks);

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: result.success,
                                message: result.success
                                    ? `✅ Script executed successfully (${result.blocks.length} block(s))`
                                    : `❌ Script execution failed`,
                                blocks: result.blocks.map(b => ({
                                    block: b.index + 1,
                                    type: b.type,
                                    success: b.success,
                                    rowsAffected: b.rowsAffected,
                                    output: b.output,
                                    ...(b.error ? {error: b.error} : {}),
                                })),
                                dbms_output: result.totalOutput,
                                ...(result.error ? {error: result.error} : {}),
                            }, null, 2),
                        }],
                    };
                } else {
                    // ── Step 1: Preview & generate token ─────────────────
                    const schemas = extractSchemaReferences(blocks);
                    const hasDml = blocks.some(b => b.containsDml);

                    const token = createConfirmationToken(db_name, "PLSQL_SCRIPT", script);

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                type: "PREVIEW",
                                message: `⚠️ ACTION REQUIRED: You are about to execute a PL/SQL script with ${blocks.length} block(s).`,
                                confirmation_token: token,
                                instruction: "To proceed, call this tool again with the SAME script and the confirmation_token above.",
                                analysis: {
                                    total_blocks: blocks.length,
                                    blocks: blocks.map(b => ({
                                        block: b.index + 1,
                                        type: b.type,
                                        contains_dml: b.containsDml,
                                        source_preview: b.source.substring(0, 200) + (b.source.length > 200 ? "..." : ""),
                                    })),
                                    schemas_referenced: schemas,
                                    contains_dml: hasDml,
                                },
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
