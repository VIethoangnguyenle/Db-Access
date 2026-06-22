import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {getTables} from "../drivers/oracle/schema.js";

export function registerSqlListTables(server: McpServer, source: Source): void {
    server.tool(
        "sql_list_tables",
        "Get a list of all tables in the specified relational database (Oracle).",
        {
            db_name: z.string().describe("The exact database name obtained from list_databases tool"),
        },
        async ({db_name}) => {
            try {
                assertAccess(source, db_name, "read");

                const dbConfig = getDb(db_name);

                if (!dbConfig || dbConfig.type !== "oracle") {
                    return {
                        content: [{type: "text", text: JSON.stringify({error: `Database '${db_name}' not found or is not an Oracle database.`}, null, 2)}],
                        isError: true,
                    };
                }

                const tables = await getTables(db_name);
                return {
                    content: [{type: "text", text: JSON.stringify({tables, total: tables.length}, null, 2)}],
                };
            } catch (error) {
                return {
                    content: [{type: "text", text: JSON.stringify({error: "Failed to list tables", details: error instanceof Error ? error.message : String(error)}, null, 2)}],
                    isError: true,
                };
            }
        }
    );
}
