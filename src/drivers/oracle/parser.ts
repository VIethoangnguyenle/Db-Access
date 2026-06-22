import {AST, Parser} from "node-sql-parser";

const parser = new Parser();
const OPT_SQL = {database: "mysql"};

export type SqlStatementType = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "UNKNOWN" | "DDL";

export interface ParsedSql {
    type: SqlStatementType;
    tableNames: string[];
    ast: AST | AST[];
}

/**
 * Parses SQL to determine its type and affected tables.
 * Blocks DDL statements explicitly by throwing an error.
 */
export function parseSql(sql: string): ParsedSql {
    try {
        // Basic pre-check for obvious DDL before AST parsing
        const upperSql = sql.trim().toUpperCase();
        if (upperSql.startsWith("DROP") || upperSql.startsWith("TRUNCATE") ||
            upperSql.startsWith("ALTER") || upperSql.startsWith("CREATE") ||
            upperSql.startsWith("GRANT") || upperSql.startsWith("REVOKE")) {
            return {type: "DDL", tableNames: [], ast: [] as any}; // DDL is blocked
        }

        const {ast, tableList} = parser.parse(sql, OPT_SQL);

        // tableList is an array of strings like "crud::schema::table_name"
        // e.g., ["select::null::users", "update::MY_SCHEMA::orders"]
        const tableNames = Array.from(new Set(tableList.map(t => {
            const parts = t.split("::");
            if (parts.length === 3) {
                return parts[1] !== "null" && parts[1] !== "" ? `${parts[1]}.${parts[2]}` : parts[2];
            }
            return parts.length > 1 ? parts[1] : parts[0];
        })));

        let type: SqlStatementType = "UNKNOWN";

        // Determine type from AST
        const astArray = Array.isArray(ast) ? ast : [ast];
        if (astArray.length > 0) {
            const firstAst = astArray[0];
            const typeStr = firstAst.type.toUpperCase();

            if (typeStr === "SELECT") type = "SELECT";
            else if (typeStr === "INSERT") type = "INSERT";
            else if (typeStr === "UPDATE") type = "UPDATE";
            else if (typeStr === "DELETE") type = "DELETE";
        }

        return {type, tableNames, ast};
    } catch (error) {
        // If AST parsing fails, it might be syntax error or unsupported statement (like some DDL)
        // We fall back to simple string matching for safety
        const upperSql = sql.trim().toUpperCase();
        if (upperSql.startsWith("SELECT")) return {type: "SELECT", tableNames: [], ast: [] as any};
        if (upperSql.startsWith("INSERT")) return {type: "INSERT", tableNames: [], ast: [] as any};
        if (upperSql.startsWith("UPDATE")) return {type: "UPDATE", tableNames: [], ast: [] as any};
        if (upperSql.startsWith("DELETE")) return {type: "DELETE", tableNames: [], ast: [] as any};

        return {type: "UNKNOWN", tableNames: [], ast: [] as any};
    }
}
