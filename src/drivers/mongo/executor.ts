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
    if (Object.keys(query).length === 1 && "$date" in query) {
        return toDate(query.$date);
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

/** `{ $date: "2026-09-24T00:00:00Z" }` (ISO string hoặc epoch millis) -> Date; giá trị hỏng thì báo lỗi, không lọc sai im lặng. */
function toDate(value: unknown): Date {
    const raw = typeof value === "object" && value !== null && "$numberLong" in value
        ? Number((value as { $numberLong: string }).$numberLong)
        : value;
    const date = new Date(raw as string | number);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid $date value: ${JSON.stringify(value)}`);
    }
    return date;
}

export const DEFAULT_FIND_LIMIT = 50;
export const MAX_FIND_LIMIT = 500;

export interface FindOptions {
    limit?: number;
    sort?: Record<string, number>;
    projection?: Record<string, number>;
}

/** limit thiếu/hỏng -> mặc định; vượt trần -> trần. Không cho kéo cả collection về một lần. */
export function clampLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit) || limit < 1) return DEFAULT_FIND_LIMIT;
    return Math.min(Math.floor(limit), MAX_FIND_LIMIT);
}

/** sort/projection chỉ nhận map field -> số trong tập cho phép (1/-1 cho sort, 0/1 cho projection). */
export function assertFieldMap(map: unknown, allowed: number[], name: string): void {
    if (map === undefined) return;
    if (map === null || typeof map !== "object" || Array.isArray(map)) {
        throw new Error(`'${name}' must be an object of field -> ${allowed.join("/")}`);
    }
    const bad = Object.entries(map).find(([key, value]) => key.startsWith("$") || !allowed.includes(value as number));
    if (bad) {
        throw new Error(`Invalid '${name}' entry ${JSON.stringify(bad[0])}: expected ${allowed.join("/")}`);
    }
}

/**
 * Executes a find operation.
 */
export async function executeFind(
    dbName: string,
    collectionName: string,
    filter: any,
    options: FindOptions = {}
): Promise<MongoExecutionResult> {
    try {
        const db = await getMongoDb(dbName);
        const collection = db.collection(collectionName);

        const parsedFilter = deserializeMongoQuery(filter) || {};
        assertSafeFilter(parsedFilter);
        assertFieldMap(options.sort, [1, -1], "sort");
        assertFieldMap(options.projection, [0, 1], "projection");
        const cursor = collection.find(parsedFilter, {projection: options.projection});
        const sorted = options.sort ? cursor.sort(options.sort as any) : cursor;
        const data = await sorted.limit(clampLimit(options.limit)).toArray();

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
    const result = await executeFind(dbName, collectionName, filter, {limit: DEFAULT_FIND_LIMIT});
    result.operation = "preview";
    return result;
}
