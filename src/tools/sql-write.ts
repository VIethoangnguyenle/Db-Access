import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {getRelationalDriver} from "../drivers/relational.js";
import {createConfirmationToken, validateAndConsumeToken} from "../safety/token-manager.js";

export function registerSqlWrite(server: McpServer, source: Source): void {
    server.tool(
        "sql_write",
        "Execute DML (INSERT/UPDATE/DELETE) on a relational database (Oracle or PostgreSQL); the backend is selected automatically from the database's type. Requires a two-step process: First call without a token returns a preview of affected rows and a confirmation_token. Second call WITH the confirmation_token executes the write. DDL and SELECT are blocked. NOTE: For Oracle you MUST prefix tables with their schema.",
        {
            db_name: z.string().describe("Database name from list_databases"),
            sql: z.string().describe("The INSERT, UPDATE, or DELETE statement to execute. For Oracle databases you MUST specify the schema prefix for all tables (e.g., UPDATE SCHEMA_NAME.TABLE_NAME); querying without a schema is blocked. PostgreSQL does not require a schema prefix."),
            confirmation_token: z.string().optional().describe("Required ONLY when confirming a write operation"),
        },
        async ({db_name, sql, confirmation_token}) => {
            try {
                assertAccess(source, db_name, "write");

                const driver = getRelationalDriver(db_name);
                const parsed = driver.parse(sql);

                // Enforce schema-prefix rule only for backends that require it (Oracle).
                if (driver.enforceSchemaPrefix) {
                    if (parsed.tableNames.length > 0) {
                        const missingSchema = parsed.tableNames.find(t => !t.includes("."));
                        if (missingSchema) {
                            throw new Error(`Rule Violation: Table '${missingSchema}' is missing a schema prefix. You MUST specify the schema (e.g. SCHEMA_NAME.${missingSchema}).`);
                        }
                    } else {
                        // Fallback to regex if parsing failed
                        const hasSchema = /\b(?:FROM|JOIN|UPDATE|INTO)\s+[a-zA-Z0-9_"]+\.[a-zA-Z0-9_"]+/i.test(sql);
                        if (!hasSchema) {
                            throw new Error("Rule Violation: You MUST include the schema name in your query (e.g. SCHEMA_NAME.TABLE_NAME).");
                        }
                    }
                }

                if (parsed.type === "SELECT" || parsed.type === "DDL" || parsed.type === "UNKNOWN") {
                    throw new Error(`Operation type '${parsed.type}' is not allowed in sql_write. Only INSERT, UPDATE, and DELETE are supported.`);
                }

                if (confirmation_token) {
                    validateAndConsumeToken(confirmation_token, db_name, sql);
                    const result = await driver.executeWrite(db_name, sql);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                ...result,
                                message: `Successfully executed ${parsed.type}`
                            }, null, 2)
                        }],
                    };
                } else {
                    let previewResult = null;
                    if (parsed.type === "UPDATE" || parsed.type === "DELETE") {
                        previewResult = await driver.executePreview(db_name, sql, parsed);
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
                                instruction: `To proceed with this execution, call this tool again with the SAME sql and the confirmation_token provided above.`,
                                affected_tables: parsed.tableNames,
                                shadow_preview: previewResult?.data || "Preview not available for this operation."
                            }, null, 2)
                        }],
                    };
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                error: "SQL Write failed",
                                details: error instanceof Error ? error.message : String(error)
                            }, null, 2),
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}
