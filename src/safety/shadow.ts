import { ParsedSql } from "../drivers/oracle/parser.js";

/**
 * Dựng "shadow query" (SELECT) để preview các dòng bị UPDATE/DELETE tác động.
 * Chỉ xử lý các trường hợp KHÔNG mơ hồ; trả null khi không chắc (có subquery,
 * nhiều bảng/WHERE) để KHÔNG hiển thị preview sai.
 */
export function buildShadowQuery(sql: string, parsed: ParsedSql): string | null {
  if (parsed.type !== "UPDATE" && parsed.type !== "DELETE") return null;
  if (parsed.tableNames.length !== 1) return null;

  const upper = sql.toUpperCase();

  // Có bất kỳ SELECT nào ⇒ subquery (vì câu gốc là UPDATE/DELETE) ⇒ không chắc.
  if (/\bSELECT\b/.test(upper)) return null;
  // Nhiều WHERE ⇒ không chắc đâu là WHERE chính.
  if ((upper.match(/\bWHERE\b/g) || []).length > 1) return null;

  const table = parsed.tableNames[0];
  const whereIdx = upper.indexOf(" WHERE ");

  if (whereIdx === -1) {
    return `SELECT * FROM ${table}`;
  }
  const whereClause = sql.substring(whereIdx + 1); // từ "WHERE ..." tới hết
  return `SELECT * FROM ${table} ${whereClause}`;
}
