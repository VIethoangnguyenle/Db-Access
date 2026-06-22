import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {getCollectionSchema} from "../drivers/mongo/schema.js";

export function registerMongoGetSchema(server: McpServer, source: Source): void {
    server.tool(
        "mongo_get_schema",
        "Get inferred schema (document count, sample document) for a specific MongoDB collection.",
        {
            db_name: z.string().describe("The exact database name obtained from list_databases tool"),
            collection_name: z.string().describe("The exact collection name"),
        },
        async ({db_name, collection_name}) => {
            try {
                assertAccess(source, db_name, "read");

                const dbConfig = getDb(db_name);

                if (!dbConfig || dbConfig.type !== "mongo") {
                    return {
                        content: [{type: "text", text: JSON.stringify({error: `Database '${db_name}' not found or is not a MongoDB database.`}, null, 2)}],
                        isError: true,
                    };
                }

                const result = await getCollectionSchema(db_name, collection_name);
                return {
                    content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                };
            } catch (error) {
                return {
                    content: [{type: "text", text: JSON.stringify({error: "Failed to get schema", details: error instanceof Error ? error.message : String(error)}, null, 2)}],
                    isError: true,
                };
            }
        }
    );
}
