import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {getRelationalDriver} from "../drivers/relational.js";

export function registerSqlGetConstraints(server: McpServer, source: Source): void {
    server.tool(
        "sql_get_constraints",
        "Get constraints (Primary Keys, Foreign Keys, Unique) for a specific table in a relational database (Oracle or PostgreSQL).",
        {
            db_name: z.string().describe("The exact database name obtained from list_databases tool"),
            table_name: z.string().describe("The exact table name"),
        },
        async ({db_name, table_name}) => {
            try {
                assertAccess(source, db_name, "read");

                const driver = getRelationalDriver(db_name);
                const result = await driver.getTableConstraints(db_name, table_name);
                return {
                    content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                };
            } catch (error) {
                return {
                    content: [{type: "text", text: JSON.stringify({error: "Failed to get constraints", details: error instanceof Error ? error.message : String(error)}, null, 2)}],
                    isError: true,
                };
            }
        }
    );
}
