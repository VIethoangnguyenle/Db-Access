import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {getTableColumns} from "../drivers/oracle/schema.js";

export function registerSqlGetColumns(server: McpServer, source: Source): void {
    server.tool(
        "sql_get_columns",
        "Get detailed schema of columns for a specific table (Oracle). Includes column names, types, nullability, and comments.",
        {
            db_name: z.string().describe("The exact database name obtained from list_databases tool"),
            table_name: z.string().describe("The exact table name"),
        },
        async ({db_name, table_name}) => {
            try {
                assertAccess(source, db_name, "read");

                const dbConfig = getDb(db_name);

                if (!dbConfig || dbConfig.type !== "oracle") {
                    return {
                        content: [{type: "text", text: JSON.stringify({error: `Database '${db_name}' not found or is not an Oracle database.`}, null, 2)}],
                        isError: true,
                    };
                }

                const result = await getTableColumns(db_name, table_name);
                return {
                    content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                };
            } catch (error) {
                return {
                    content: [{type: "text", text: JSON.stringify({error: "Failed to get columns", details: error instanceof Error ? error.message : String(error)}, null, 2)}],
                    isError: true,
                };
            }
        }
    );
}
