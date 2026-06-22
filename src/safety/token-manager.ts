import crypto from "crypto";

export interface PendingOperation {
    token: string;
    dbName: string;
    operationType: string;
    payload: any;      // Original SQL or Mongo filter/update object
    timestamp: number;
}

// Store pending operations in memory with a 5-minute TTL
const pendingOperations = new Map<string, PendingOperation>();
const TTL_MS = 5 * 60 * 1000;

/**
 * Generate a new confirmation token and store the pending operation.
 */
export function createConfirmationToken(
    dbName: string,
    operationType: string,
    payload: any
): string {
    // Clean up expired tokens first
    cleanup();

    // Create a short, readable but random token
    const token = crypto.randomBytes(4).toString("hex").toUpperCase();

    pendingOperations.set(token, {
        token,
        dbName,
        operationType,
        payload,
        timestamp: Date.now()
    });

    return token;
}

/**
 * Validates a confirmation token against the requested operation.
 * Returns the stored payload if valid, or throws an error if invalid/expired/mismatched.
 */
export function validateAndConsumeToken(
    token: string,
    dbName: string,
    expectedPayload: any
): PendingOperation {
    cleanup();

    const pending = pendingOperations.get(token);

    if (!pending) {
        throw new Error(`Confirmation token '${token}' is invalid or has expired.`);
    }

    if (pending.dbName !== dbName) {
        throw new Error(`Token mismatch: token was generated for database '${pending.dbName}', not '${dbName}'.`);
    }

    // Basic validation that the payload hasn't fundamentally changed
    // We stringify for a simple deep equality check on the structural intent
    const pendingStr = JSON.stringify(pending.payload);
    const currentStr = JSON.stringify(expectedPayload);

    if (pendingStr !== currentStr) {
        throw new Error(`Token mismatch: the requested operation has changed since the token was generated.`);
    }

    // Token is valid - consume it (single-use)
    pendingOperations.delete(token);

    return pending;
}

function cleanup() {
    const now = Date.now();
    for (const [token, op] of pendingOperations.entries()) {
        if (now - op.timestamp > TTL_MS) {
            pendingOperations.delete(token);
        }
    }
}
