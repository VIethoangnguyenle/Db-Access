/**
 * PL/SQL Script Parser
 *
 * Lightweight parser for Oracle PL/SQL scripts that:
 * 1. Splits multi-block scripts by `/` delimiter (SQL*Plus convention)
 * 2. Strips SQL*Plus directives (SET SERVEROUTPUT ON, etc.)
 * 3. Classifies blocks as PLSQL_BLOCK or SINGLE_SQL
 * 4. Best-effort DDL guard via regex scan
 */

export interface PlsqlBlock {
    /** 0-based position in the script */
    index: number;
    /** Block classification */
    type: "PLSQL_BLOCK" | "SINGLE_SQL";
    /** Cleaned source code ready for execution */
    source: string;
    /** true if INSERT/UPDATE/DELETE keywords detected */
    containsDml: boolean;
    /** true if DDL keywords detected — will be blocked */
    containsDdl: boolean;
}

/**
 * SQL*Plus directives that should be stripped before execution via oracledb.
 * These are client-side directives, not valid SQL/PL/SQL.
 */
const SQLPLUS_DIRECTIVES = /^\s*(SET\s+\w+.*|SPOOL\s+.*|WHENEVER\s+.*|PROMPT\s+.*|SHOW\s+.*|EXIT\s*;?|QUIT\s*;?)$/gim;

/**
 * DDL patterns to detect inside PL/SQL blocks.
 * Best-effort — catches obvious cases but PL/SQL can construct dynamic DDL via EXECUTE IMMEDIATE.
 */
const DDL_PATTERNS = [
    /\bDROP\s+(TABLE|INDEX|SEQUENCE|VIEW|PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE|TABLESPACE|USER|ROLE|SYNONYM)\b/i,
    /\bTRUNCATE\s+TABLE\b/i,
    /\bALTER\s+(TABLE|INDEX|SEQUENCE|USER|SYSTEM)\b/i,
    /\bCREATE\s+(TABLE|INDEX|SEQUENCE|VIEW|PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE|TABLESPACE|USER|ROLE|SYNONYM)\b/i,
    /\bGRANT\s+/i,
    /\bREVOKE\s+/i,
];

/**
 * DML patterns to detect.
 */
const DML_PATTERNS = [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+\w+/i,
    /\bDELETE\s+FROM\b/i,
    /\bMERGE\s+INTO\b/i,
];

/**
 * Detect if a block is a PL/SQL anonymous block (DECLARE...BEGIN...END or BEGIN...END).
 */
function isPlsqlBlock(source: string): boolean {
    const trimmed = source.trim().toUpperCase();
    return trimmed.startsWith("DECLARE") || trimmed.startsWith("BEGIN");
}

/**
 * Strip SQL*Plus directives from raw script text.
 */
function stripDirectives(raw: string): string {
    return raw.replace(SQLPLUS_DIRECTIVES, "").trim();
}

/**
 * Split a multi-block script by the `/` delimiter.
 *
 * In SQL*Plus, a `/` on its own line signals "execute the buffer".
 * For multi-block scripts, blocks are separated by `/` on its own line.
 *
 * Strategy: split by lines that are exactly `/` (with optional whitespace).
 */
function splitBlocks(script: string): string[] {
    // Split on lines that contain only `/` (with optional surrounding whitespace)
    const blocks = script.split(/^\s*\/\s*$/m);

    return blocks
        .map(b => b.trim())
        .filter(b => b.length > 0);
}

/**
 * Check if source matches any of the given patterns.
 */
function matchesAny(source: string, patterns: RegExp[]): boolean {
    return patterns.some(p => p.test(source));
}

/**
 * Parse a raw PL/SQL script into executable blocks.
 *
 * @param rawScript - The full script content (may contain multiple blocks separated by `/`)
 * @returns Array of parsed blocks ready for execution
 * @throws Error if the script is empty after processing
 */
export function parsePlsqlScript(rawScript: string): PlsqlBlock[] {
    // Step 1: Strip SQL*Plus directives
    const cleaned = stripDirectives(rawScript);

    if (!cleaned) {
        throw new Error("Script is empty after stripping directives.");
    }

    // Step 2: Split into blocks
    const rawBlocks = splitBlocks(cleaned);

    if (rawBlocks.length === 0) {
        throw new Error("No executable blocks found in the script.");
    }

    // Step 3: Classify each block
    return rawBlocks.map((source, index) => {
        // Strip trailing semicolons for PL/SQL blocks (oracledb handles this)
        // But keep the semicolons inside the block — only strip a trailing lone semicolon
        let cleanSource = source;

        // For PL/SQL blocks, ensure it ends properly (END; is fine, no extra `;` after)
        if (!isPlsqlBlock(cleanSource)) {
            // For single SQL: strip trailing semicolons (oracledb doesn't want them)
            cleanSource = cleanSource.replace(/;\s*$/, "");
        }

        return {
            index,
            type: isPlsqlBlock(cleanSource) ? "PLSQL_BLOCK" : "SINGLE_SQL",
            source: cleanSource,
            containsDml: matchesAny(cleanSource, DML_PATTERNS),
            containsDdl: matchesAny(cleanSource, DDL_PATTERNS),
        };
    });
}

/**
 * Extract schema references from a script for the preview summary.
 * Looks for patterns like SCHEMA.TABLE_NAME.
 */
export function extractSchemaReferences(blocks: PlsqlBlock[]): string[] {
    const schemas = new Set<string>();
    const pattern = /\b([A-Z_][A-Z0-9_]*)\.[A-Z_][A-Z0-9_]*\b/gi;

    for (const block of blocks) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(block.source)) !== null) {
            // Filter out common false positives
            const schema = match[1].toUpperCase();
            if (!["DBMS_OUTPUT", "SYS", "DUAL", "SQL"].includes(schema)) {
                schemas.add(schema);
            }
        }
    }

    return Array.from(schemas);
}
