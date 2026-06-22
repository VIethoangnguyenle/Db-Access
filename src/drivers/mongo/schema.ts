import {getMongoDb} from "./pool.js";

export interface MongoCollectionSchema {
    collectionName: string;
    documentCount: number;
    sampleDocument?: any;
}

/**
 * Retrieves a list of collections in the MongoDB database.
 */
export async function getCollections(dbName: string): Promise<string[]> {
    const db = await getMongoDb(dbName);
    const collections = await db.listCollections().toArray();
    return collections.map(c => c.name).sort();
}

/**
 * Retrieves basic schema information (document count, sample doc) for a specific collection.
 */
export async function getCollectionSchema(dbName: string, collectionName: string): Promise<MongoCollectionSchema> {
    const db = await getMongoDb(dbName);
    const collection = db.collection(collectionName);

    const documentCount = await collection.estimatedDocumentCount();
    const sampleDocument = await collection.findOne({});

    return {
        collectionName,
        documentCount,
        sampleDocument: sampleDocument || undefined
    };
}
