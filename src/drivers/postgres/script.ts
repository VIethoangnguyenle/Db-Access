import { withPgClient } from "./pool.js";

export interface PgScriptResult {
  success: boolean;
  rowsAffected?: number;
  notices: string[];
  error?: string;
}

/** DDL patterns (best-effort) — chặn ngay cả trong script. */
const DDL_PATTERNS = [
  /\bDROP\s+(TABLE|INDEX|SEQUENCE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|SCHEMA|TYPE|TRIGGER|ROLE|USER|DATABASE|EXTENSION)\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+(TABLE|INDEX|SEQUENCE|VIEW|SCHEMA|TYPE|ROLE|USER|SYSTEM|DATABASE)\b/i,
  /\bCREATE\s+(TABLE|INDEX|SEQUENCE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|SCHEMA|TYPE|TRIGGER|ROLE|USER|DATABASE|EXTENSION)\b/i,
  /\bGRANT\s+/i,
  /\bREVOKE\s+/i,
];

/** Throw nếu script chứa DDL (best-effort). */
export function assertNoDdl(script: string): void {
  for (const p of DDL_PATTERNS) {
    if (p.test(script)) {
      throw new Error(
        "DDL operations (DROP, TRUNCATE, ALTER, CREATE, GRANT, REVOKE) bị chặn trong script. " +
        "Liên hệ DBA để chạy DDL trực tiếp."
      );
    }
  }
}

/**
 * Chạy script Postgres (có thể nhiều lệnh / khối DO $$ ... $$) trong một transaction.
 * Thành công → COMMIT; lỗi → ROLLBACK. Bắt các thông điệp NOTICE (RAISE NOTICE).
 */
export async function executePgScript(dbName: string, script: string): Promise<PgScriptResult> {
  return withPgClient(dbName, async (client) => {
    const notices: string[] = [];
    const onNotice = (n: any) => notices.push(typeof n?.message === "string" ? n.message : String(n));
    client.on("notice", onNotice);
    try {
      await client.query("BEGIN");
      const res: any = await client.query(script);
      await client.query("COMMIT");
      const last = Array.isArray(res) ? res[res.length - 1] : res;
      return { success: true, rowsAffected: last?.rowCount ?? 0, notices };
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      return { success: false, notices, error: err instanceof Error ? err.message : String(err) };
    } finally {
      client.removeListener("notice", onNotice);
    }
  });
}
