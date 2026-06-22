import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {getCollections} from "../drivers/mongo/schema.js";

export function registerMongoListCollections(server: McpServer, source: Source): void {
    server.tool(
        "mongo_list_collections",
        "List all collections in a specific MongoDB database.",
        {
            db_name: z.string().describe("The exact database name obtained from list_databases tool"),
        },
        async ({db_name}) => {
            try {
                assertAccess(source, db_name, "read");

                const dbConfig = getDb(db_name);

                if (!dbConfig || dbConfig.type !== "mongo") {
                    return {
                        content: [{type: "text", text: JSON.stringify({error: `Database '${db_name}' not found or is not a MongoDB database.`}, null, 2)}],
                        isError: true,
                    };
                }

                const collections = await getCollections(db_name);
                return {
                    content: [{type: "text", text: JSON.stringify({collections}, null, 2)}],
                };
            } catch (error) {
                return {
                    content: [{type: "text", text: JSON.stringify({error: "Failed to list collections", details: error instanceof Error ? error.message : String(error)}, null, 2)}],
                    isError: true,
                };
            }
        }
    );
}
