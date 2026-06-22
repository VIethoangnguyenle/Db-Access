/**
 * PL/SQL Executor
 *
 * Executes PL/SQL anonymous blocks with DBMS_OUTPUT capture.
 * All blocks in a script share the same connection (same transaction context).
 */

import oracledb from "oracledb";
import {getOraclePool} from "./pool.js";
import {PlsqlBlock} from "./plsql-parser.js";

export interface BlockResult {
    /** 0-based block index */
    index: number;
    /** Block type */
    type: "PLSQL_BLOCK" | "SINGLE_SQL";
    /** Whether this block executed successfully */
    success: boolean;
    /** Number of rows affected (for DML statements) */
    rowsAffected?: number;
    /** DBMS_OUTPUT lines captured after this block */
    output: string[];
    /** Error message if execution failed */
    error?: string;
}

export interface ScriptExecutionResult {
    /** Overall success (all blocks succeeded) */
    success: boolean;
    /** Per-block results */
    blocks: BlockResult[];
    /** Merged DBMS_OUTPUT from all blocks */
    totalOutput: string[];
    /** Error message if the script failed */
    error?: string;
}

/** Max DBMS_OUTPUT lines to drain per block (prevent infinite loops) */
const MAX_OUTPUT_LINES = 5000;

/**
 * Drain all DBMS_OUTPUT lines from the current connection.
 *
 * Uses the standard Oracle pattern:
 *   DBMS_OUTPUT.GET_LINE(:ln, :st)
 * where st=0 means more lines, st=1 means done.
 */
async function drainDbmsOutput(connection: oracledb.Connection): Promise<string[]> {
    const lines: string[] = [];
    let status = 0;
    let iterations = 0;

    while (status === 0 && iterations < MAX_OUTPUT_LINES) {
        const result = await connection.execute(
            `BEGIN DBMS_OUTPUT.GET_LINE(:ln, :st); END;`,
            {
                ln: {dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767},
                st: {dir: oracledb.BIND_OUT, type: oracledb.NUMBER},
            }
        );

        const outBinds = result.outBinds as { ln: string; st: number };
        status = outBinds.st;

        if (status === 0) {
            lines.push(outBinds.ln ?? "");
        }

        iterations++;
    }

    if (iterations >= MAX_OUTPUT_LINES) {
        lines.push(`[WARNING] DBMS_OUTPUT truncated at ${MAX_OUTPUT_LINES} lines.`);
    }

    return lines;
}

/**
 * Execute a parsed PL/SQL script (array of blocks) on a single connection.
 *
 * - Enables DBMS_OUTPUT before execution
 * - Executes blocks sequentially
 * - Drains DBMS_OUTPUT after each block
 * - On error: stops execution, captures error, but does NOT rollback
 *   (the PL/SQL block itself should handle COMMIT/ROLLBACK)
 *
 * @param dbName - Database name from config
 * @param blocks - Parsed PL/SQL blocks to execute
 */
export async function executePlsqlScript(
    dbName: string,
    blocks: PlsqlBlock[]
): Promise<ScriptExecutionResult> {
    const pool = await getOraclePool(dbName);
    let connection: oracledb.Connection | null = null;

    try {
        connection = await pool.getConnection();

        // Enable DBMS_OUTPUT buffer (NULL = unlimited size)
        await connection.execute(`BEGIN DBMS_OUTPUT.ENABLE(NULL); END;`);

        const blockResults: BlockResult[] = [];
        const totalOutput: string[] = [];

        for (const block of blocks) {
            try {
                // Execute the block
                const result = await connection.execute(block.source, [], {
                    autoCommit: false,  // Let script manage transactions
                });

                // Drain output after this block
                const output = await drainDbmsOutput(connection);

                blockResults.push({
                    index: block.index,
                    type: block.type,
                    success: true,
                    rowsAffected: result.rowsAffected,
                    output,
                });

                totalOutput.push(...output);
            } catch (err) {
                // Drain any output that was written before the error
                let output: string[] = [];
                try {
                    output = await drainDbmsOutput(connection);
                } catch {
                    // Ignore drain errors after execution failure
                }

                const errorMsg = err instanceof Error ? err.message : String(err);

                blockResults.push({
                    index: block.index,
                    type: block.type,
                    success: false,
                    output,
                    error: errorMsg,
                });

                totalOutput.push(...output);

                // Stop executing remaining blocks on error
                return {
                    success: false,
                    blocks: blockResults,
                    totalOutput,
                    error: `Block ${block.index + 1} failed: ${errorMsg}`,
                };
            }
        }

        return {
            success: true,
            blocks: blockResults,
            totalOutput,
        };
    } catch (err) {
        return {
            success: false,
            blocks: [],
            totalOutput: [],
            error: `Script execution failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error(`[plsql-executor] Error closing connection for '${dbName}':`, err);
            }
        }
    }
}
