import { withPgClient } from "./pool.js";
import type { ParsedSql } from "../oracle/parser.js";
import { buildShadowQuery } from "../../safety/shadow.js";

export interface PgExecutionResult {
  success: boolean;
  type: string;
  rowsAffected?: number;
  data?: any[];
  truncated?: boolean;
  error?: string;
}

/** SELECT (cap số dòng trả về). */
export async function executeSelect(dbName: string, sql: string, maxRows = 100): Promise<PgExecutionResult> {
  return withPgClient(dbName, async (client) => {
    try {
      const res = await client.query(sql);
      const rows = res.rows ?? [];
      const truncated = rows.length > maxRows;
      return {
        success: true,
        type: "SELECT",
        data: rows.slice(0, maxRows),
        ...(truncated ? { truncated: true } : {}),
      };
    } catch (err) {
      return { success: false, type: "SELECT", error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/** DML (INSERT/UPDATE/DELETE), autocommit theo từng query. */
export async function executeWrite(dbName: string, sql: string): Promise<PgExecutionResult> {
  return withPgClient(dbName, async (client) => {
    try {
      const res = await client.query(sql);
      return { success: true, type: "WRITE", rowsAffected: res.rowCount ?? 0 };
    } catch (err) {
      return { success: false, type: "WRITE", error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/** Preview các dòng bị UPDATE/DELETE tác động (shadow SELECT). */
export async function executePreview(dbName: string, sql: string, parsed: ParsedSql): Promise<PgExecutionResult> {
  const shadowSql = buildShadowQuery(sql, parsed);
  if (!shadowSql) {
    return { success: false, type: "PREVIEW", error: "Could not generate preview query for this statement." };
  }
  return executeSelect(dbName, shadowSql, 50);
}
