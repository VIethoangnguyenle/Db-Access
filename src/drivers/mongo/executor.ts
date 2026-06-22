import {ObjectId} from "mongodb";
import {getMongoDb} from "./pool.js";

const FORBIDDEN_OPERATORS = ["$where", "$function", "$accumulator", "$expr"];

/** Throw nếu filter/update chứa operator cho phép chạy JS phía server. */
export function assertSafeFilter(obj: any): void {
    if (obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) { obj.forEach(assertSafeFilter); return; }
    for (const [key, value] of Object.entries(obj)) {
        if (FORBIDDEN_OPERATORS.includes(key)) {
            throw new Error(`Forbidden MongoDB operator '${key}' is not allowed.`);
        }
        assertSafeFilter(value);
    }
}

export interface MongoExecutionResult {
    success: boolean;
    operation: string;
    matchedCount?: number;
    modifiedCount?: number;
    deletedCount?: number;
    insertedId?: string;
    data?: any[];
    error?: string;
    shadowPreview?: any[];
}

/**
 * Recursively converts string representation of ObjectId to actual ObjectId objects
 * e.g., { _id: { $oid: "..." } } -> { _id: new ObjectId("...") }
 */
export function deserializeMongoQuery(query: any): any {
    if (query === null || query === undefined) {
        return query;
    }

    if (typeof query !== "object") {
        return query;
    }

    if (Array.isArray(query)) {
        return query.map(deserializeMongoQuery);
    }

    // Handle specific MongoDB extended JSON like syntax
    if (Object.keys(query).length === 1 && typeof query.$oid === "string") {
        return new ObjectId(query.$oid);
    }

    // Common pattern: _id as a string that looks like an ObjectId
    const result: any = {};
    for (const [key, value] of Object.entries(query)) {
        if (
            key === "_id" &&
            typeof value === "string" &&
            value.length === 24 &&
            /^[0-9a-fA-F]{24}$/.test(value)
        ) {
            result[key] = new ObjectId(value);
        } else {
            result[key] = deserializeMongoQuery(value);
        }
    }

    return result;
}

/**
 * Executes a find operation.
 */
export async function executeFind(
    dbName: string,
    collectionName: string,
    filter: any,
    limit = 50
): Promise<MongoExecutionResult> {
    try {
        const db = await getMongoDb(dbName);
        const collection = db.collection(collectionName);

        const parsedFilter = deserializeMongoQuery(filter) || {};
        assertSafeFilter(parsedFilter);
        const data = await collection.find(parsedFilter).limit(limit).toArray();

        return {
            success: true,
            operation: "find",
            data
        };
    } catch (err) {
        return {
            success: false,
            operation: "find",
            error: err instanceof Error ? err.message : String(err)
        };
    }
}

/**
 * Executes an insertOne operation.
 */
export async function executeInsertOne(
    dbName: string,
    collectionName: string,
    document: any
): Promise<MongoExecutionResult> {
    try {
        const db = await getMongoDb(dbName);
        const collection = db.collection(collectionName);

        const parsedDoc = deserializeMongoQuery(document);
        const result = await collection.insertOne(parsedDoc);

        return {
            success: true,
            operation: "insertOne",
            insertedId: result.insertedId.toString()
        };
    } catch (err) {
        return {
            success: false,
            operation: "insertOne",
            error: err instanceof Error ? err.message : String(err)
        };
    }
}

/**
 * Executes an updateMany operation.
 */
export async function executeUpdateMany(
    dbName: string,
    collectionName: string,
    filter: any,
    update: any
): Promise<MongoExecutionResult> {
    try {
        const db = await getMongoDb(dbName);
        const collection = db.collection(collectionName);

        const parsedFilter = deserializeMongoQuery(filter) || {};
        assertSafeFilter(parsedFilter);
        const parsedUpdate = deserializeMongoQuery(update);
        assertSafeFilter(parsedUpdate);

        const result = await collection.updateMany(parsedFilter, parsedUpdate);

        return {
            success: true,
            operation: "updateMany",
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount
        };
    } catch (err) {
        return {
            success: false,
            operation: "updateMany",
            error: err instanceof Error ? err.message : String(err)
        };
    }
}

/**
 * Executes a deleteMany operation.
 */
export async function executeDeleteMany(
    dbName: string,
    collectionName: string,
    filter: any
): Promise<MongoExecutionResult> {
    try {
        const db = await getMongoDb(dbName);
        const collection = db.collection(collectionName);

        const parsedFilter = deserializeMongoQuery(filter) || {};
        assertSafeFilter(parsedFilter);
        const result = await collection.deleteMany(parsedFilter);

        return {
            success: true,
            operation: "deleteMany",
            deletedCount: result.deletedCount
        };
    } catch (err) {
        return {
            success: false,
            operation: "deleteMany",
            error: err instanceof Error ? err.message : String(err)
        };
    }
}

/**
 * Previews rows that would be affected by update/delete by running a find query.
 */
export async function executePreview(
    dbName: string,
    collectionName: string,
    filter: any
): Promise<MongoExecutionResult> {
    // Cap preview to 50 documents
    const result = await executeFind(dbName, collectionName, filter, 50);
    result.operation = "preview";
    return result;
}
