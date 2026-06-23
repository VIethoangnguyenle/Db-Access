import { Parser } from "node-sql-parser";
import type { ParsedSql, SqlStatementType } from "../oracle/parser.js";

const parser = new Parser();
const OPT_SQL = { database: "postgresql" };

/**
 * Parse SQL Postgres để xác định loại lệnh + bảng bị tác động. Chặn DDL.
 * Cùng hợp đồng (ParsedSql) với parser Oracle để tái dùng shadow preview.
 */
export function parsePgSql(sql: string): ParsedSql {
  try {
    const upperSql = sql.trim().toUpperCase();
    if (upperSql.startsWith("DROP") || upperSql.startsWith("TRUNCATE") ||
        upperSql.startsWith("ALTER") || upperSql.startsWith("CREATE") ||
        upperSql.startsWith("GRANT") || upperSql.startsWith("REVOKE")) {
      return { type: "DDL", tableNames: [], ast: [] as any };
    }

    const { ast, tableList } = parser.parse(sql, OPT_SQL);

    const tableNames = Array.from(new Set(tableList.map(t => {
      const parts = t.split("::");
      if (parts.length === 3) {
        return parts[1] !== "null" && parts[1] !== "" ? `${parts[1]}.${parts[2]}` : parts[2];
      }
      return parts.length > 1 ? parts[1] : parts[0];
    })));

    let type: SqlStatementType = "UNKNOWN";
    const astArray = Array.isArray(ast) ? ast : [ast];
    if (astArray.length > 0) {
      const typeStr = astArray[0].type.toUpperCase();
      if (typeStr === "SELECT") type = "SELECT";
      else if (typeStr === "INSERT") type = "INSERT";
      else if (typeStr === "UPDATE") type = "UPDATE";
      else if (typeStr === "DELETE") type = "DELETE";
    }

    return { type, tableNames, ast };
  } catch (error) {
    const upperSql = sql.trim().toUpperCase();
    if (upperSql.startsWith("SELECT") || upperSql.startsWith("WITH")) return { type: "SELECT", tableNames: [], ast: [] as any };
    if (upperSql.startsWith("INSERT")) return { type: "INSERT", tableNames: [], ast: [] as any };
    if (upperSql.startsWith("UPDATE")) return { type: "UPDATE", tableNames: [], ast: [] as any };
    if (upperSql.startsWith("DELETE")) return { type: "DELETE", tableNames: [], ast: [] as any };
    return { type: "UNKNOWN", tableNames: [], ast: [] as any };
  }
}
