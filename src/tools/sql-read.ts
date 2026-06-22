import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {parseSql} from "../drivers/oracle/parser.js";
import {executeSelect} from "../drivers/oracle/executor.js";

export function registerSqlRead(server: McpServer, source: Source): void {
    server.tool(
        "sql_read",
        "Execute a SELECT query on an Oracle database. DML and DDL are strictly blocked.",
        {
            db_name: z.string().describe("Database name from list_databases"),
            sql: z.string().describe("The SELECT SQL statement to execute. RULE: You MUST specify the schema prefix for all tables (e.g., SELECT * FROM SCHEMA_NAME.TABLE_NAME). Querying without a schema is strictly blocked."),
        },
        async ({db_name, sql}) => {
            try {
                assertAccess(source, db_name, "read");

                const dbConfig = getDb(db_name);
                if (!dbConfig || dbConfig.type !== "oracle") {
                    throw new Error(`Database '${db_name}' not found or is not an Oracle database.`);
                }

                const parsed = parseSql(sql);

                // Enforce schema rule strictly
                if (parsed.tableNames.length > 0) {
                    const missingSchema = parsed.tableNames.find(t => !t.includes("."));
                    if (missingSchema) {
                        throw new Error(`Rule Violation: Table '${missingSchema}' is missing a schema prefix. You MUST specify the schema (e.g. SCHEMA_NAME.${missingSchema}).`);
                    }
                } else {
                    // Fallback to regex if parsing failed
                    const hasSchema = /\b(?:FROM|JOIN)\s+[a-zA-Z0-9_"]+\.[a-zA-Z0-9_"]+/i.test(sql);
                    if (!hasSchema) {
                        throw new Error("Rule Violation: You MUST include the schema name in your query (e.g. SCHEMA_NAME.TABLE_NAME).");
                    }
                }

                if (parsed.type !== "SELECT") {
                    throw new Error("Only SELECT operations are allowed in sql_read. Use sql_write for DML operations.");
                }

                const result = await executeSelect(db_name, sql);
                return {
                    content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                error: "SQL Read failed",
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
