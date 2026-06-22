import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
import {
    executeDeleteMany,
    executeInsertOne,
    executePreview,
    executeUpdateMany
} from "../drivers/mongo/executor.js";
import {createConfirmationToken, validateAndConsumeToken} from "../safety/token-manager.js";

// Safe parsing of JSON strings to objects
function parseJsonParam(param: string | undefined, name: string): any {
    if (!param) return undefined;
    try {
        return JSON.parse(param);
    } catch (err) {
        throw new Error(`Invalid JSON in parameter '${name}': ${err instanceof Error ? err.message : String(err)}`);
    }
}

export function registerMongoWrite(server: McpServer, source: Source): void {
    server.tool(
        "mongo_write",
        "Execute write operations (insertOne, updateMany, deleteMany) on a MongoDB database. Requires a two-step process with a confirmation_token.",
        {
            db_name: z.string().describe("Database name from list_databases"),
            collection_name: z.string().describe("Collection name"),
            operation: z.enum(["insertOne", "updateMany", "deleteMany"]).describe("The write operation to perform"),
            filter: z.string().optional().describe("JSON string representing the query filter (for updateMany, deleteMany)"),
            document: z.string().optional().describe("JSON string representing the document to insert (for insertOne)"),
            update: z.string().optional().describe("JSON string representing the update operations (for updateMany)"),
            confirmation_token: z.string().optional().describe("Required ONLY when confirming a write operation"),
        },
        async ({db_name, collection_name, operation, filter, document, update, confirmation_token}) => {
            try {
                assertAccess(source, db_name, "write");

                const dbConfig = getDb(db_name);
                if (!dbConfig || dbConfig.type !== "mongo") {
                    throw new Error(`Database '${db_name}' not found or is not a MongoDB database.`);
                }

                const filterObj = parseJsonParam(filter, "filter");
                const documentObj = parseJsonParam(document, "document");
                const updateObj = parseJsonParam(update, "update");

                if (operation === "insertOne" && !documentObj) throw new Error("Parameter 'document' is required for insertOne");
                if (operation === "updateMany" && !updateObj) throw new Error("Parameter 'update' is required for updateMany");

                const intentPayload = {operation, collection_name, filterObj, documentObj, updateObj};

                if (confirmation_token) {
                    validateAndConsumeToken(confirmation_token, db_name, intentPayload);

                    let result;
                    if (operation === "insertOne") {
                        result = await executeInsertOne(db_name, collection_name, documentObj);
                    } else if (operation === "updateMany") {
                        result = await executeUpdateMany(db_name, collection_name, filterObj, updateObj);
                    } else if (operation === "deleteMany") {
                        result = await executeDeleteMany(db_name, collection_name, filterObj);
                    }

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                ...result,
                                message: `Successfully executed ${operation}`
                            }, null, 2)
                        }],
                    };
                } else {
                    let previewResult = null;

                    if (operation === "updateMany" || operation === "deleteMany") {
                        previewResult = await executePreview(db_name, collection_name, filterObj);
                    } else if (operation === "insertOne") {
                        previewResult = {data: [documentObj]};
                    }

                    const token = createConfirmationToken(db_name, operation, intentPayload);

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                type: "PREVIEW",
                                message: `⚠️ ACTION REQUIRED: You are attempting to execute a ${operation} operation.`,
                                confirmation_token: token,
                                instruction: `To proceed with this execution, call this tool again with the SAME parameters and the confirmation_token provided above.`,
                                shadow_preview: previewResult?.data || "Preview not available."
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
                                error: "MongoDB Write failed",
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
