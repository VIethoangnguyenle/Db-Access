import {withOracleConnection} from "./pool.js";
import {ParsedSql} from "./parser.js";
import {buildShadowQuery} from "../../safety/shadow.js";

export interface ExecutionResult {
    success: boolean;
    type: string;
    rowsAffected?: number;
    data?: any[];
    error?: string;
    shadowPreview?: any[];
}

/**
 * Executes a SELECT query safely.
 */
export async function executeSelect(dbName: string, sql: string, maxRows = 100): Promise<ExecutionResult> {
    return withOracleConnection(dbName, async (connection) => {
        try {
            const result = await connection.execute(sql, [], {maxRows});
            return {
                success: true,
                type: "SELECT",
                data: result.rows,
            };
        } catch (err) {
            return {
                success: false,
                type: "SELECT",
                error: err instanceof Error ? err.message : String(err)
            };
        }
    });
}

/**
 * Executes a DML query (INSERT, UPDATE, DELETE) with auto-commit.
 */
export async function executeWrite(dbName: string, sql: string): Promise<ExecutionResult> {
    return withOracleConnection(dbName, async (connection) => {
        try {
            const result = await connection.execute(sql, [], {autoCommit: true});
            return {
                success: true,
                type: "WRITE",
                rowsAffected: result.rowsAffected,
            };
        } catch (err) {
            return {
                success: false,
                type: "WRITE",
                error: err instanceof Error ? err.message : String(err)
            };
        }
    });
}

/**
 * Executes a shadow query to preview rows affected by an UPDATE or DELETE.
 */
export async function executePreview(dbName: string, sql: string, parsed: ParsedSql): Promise<ExecutionResult> {
    const shadowSql = buildShadowQuery(sql, parsed);

    if (!shadowSql) {
        return {
            success: false,
            type: "PREVIEW",
            error: "Could not generate preview query for this statement."
        };
    }

    // Cap preview to 50 rows to prevent massive output
    return executeSelect(dbName, shadowSql, 50);
}
