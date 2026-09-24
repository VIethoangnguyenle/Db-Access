import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {executeFind} from "../drivers/mongo/executor.js";

// Safe parsing of JSON strings to objects
function parseJsonParam(param: string | undefined, name: string): any {
    if (!param) return undefined;
    try {
        return JSON.parse(param);
    } catch (err) {
        throw new Error(`Invalid JSON in parameter '${name}': ${err instanceof Error ? err.message : String(err)}`);
    }
}

export function registerMongoRead(server: McpServer, source: Source): void {
    server.tool(
        "mongo_read",
        "Execute a find (SELECT) operation on a MongoDB database. Write operations are blocked. "
        + "Filter supports extended JSON {\"$oid\": ...} and {\"$date\": \"ISO-8601\"}. "
        + "Returns at most `limit` documents (default 50, max 500).",
        {
            db_name: z.string().describe("Database name from list_databases"),
            collection_name: z.string().describe("Collection name"),
            filter: z.string().optional().describe("JSON string representing the query filter. E.g. '{\"status\":\"active\"}'"),
            sort: z.string().optional().describe("JSON string field -> 1/-1. E.g. '{\"createdDate\":-1}' for newest first"),
            limit: z.number().int().optional().describe("Max documents to return (default 50, max 500)"),
            projection: z.string().optional().describe("JSON string field -> 0/1 to include/exclude fields"),
        },
        async ({db_name, collection_name, filter, sort, limit, projection}) => {
            try {
                assertAccess(source, db_name, "read");

                const dbConfig = getDb(db_name);
                if (!dbConfig || dbConfig.type !== "mongo") {
                    throw new Error(`Database '${db_name}' not found or is not a MongoDB database.`);
                }

                const filterObj = parseJsonParam(filter, "filter");

                const result = await executeFind(db_name, collection_name, filterObj, {
                    limit,
                    sort: parseJsonParam(sort, "sort"),
                    projection: parseJsonParam(projection, "projection"),
                });
                return {
                    content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                error: "MongoDB Read failed",
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
