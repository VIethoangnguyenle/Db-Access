import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {getRelationalDriver} from "../drivers/relational.js";

export function registerSqlRead(server: McpServer, source: Source): void {
    server.tool(
        "sql_read",
        "Execute a SELECT query on a relational database (Oracle or PostgreSQL); the backend is selected automatically from the database's type. DML and DDL are strictly blocked. NOTE: For Oracle you MUST prefix tables with their schema (SCHEMA_NAME.TABLE_NAME).",
        {
            db_name: z.string().describe("Database name from list_databases"),
            sql: z.string().describe("The SELECT SQL statement to execute. For Oracle databases you MUST specify the schema prefix for all tables (e.g., SELECT * FROM SCHEMA_NAME.TABLE_NAME); querying without a schema is blocked. PostgreSQL does not require a schema prefix."),
        },
        async ({db_name, sql}) => {
            try {
                assertAccess(source, db_name, "read");

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
                        const hasSchema = /\b(?:FROM|JOIN)\s+[a-zA-Z0-9_"]+\.[a-zA-Z0-9_"]+/i.test(sql);
                        if (!hasSchema) {
                            throw new Error("Rule Violation: You MUST include the schema name in your query (e.g. SCHEMA_NAME.TABLE_NAME).");
                        }
                    }
                }

                if (parsed.type !== "SELECT") {
                    throw new Error("Only SELECT operations are allowed in sql_read. Use sql_write for DML operations.");
                }

                const result = await driver.executeSelect(db_name, sql);
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
