import { withPgClient } from "./pool.js";

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: string;
  comment: string | null;
}

export interface ConstraintInfo {
  name: string;
  type: string;
  columns: string[];
  rTableName?: string;
}

export interface TableColumnsSchema {
  schema: string;
  tableName: string;
  columns: ColumnInfo[];
}

export interface TableConstraintsSchema {
  schema: string;
  tableName: string;
  constraints: ConstraintInfo[];
}

/** Danh sách bảng trong một schema (mặc định public). */
export async function getTables(dbName: string, schema = "public"): Promise<string[]> {
  return withPgClient(dbName, async (client) => {
    const res = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schema]
    );
    return res.rows.map((r) => r.table_name);
  });
}

/** Cột (tên, kiểu, nullable, comment) của một bảng. */
export async function getTableColumns(dbName: string, tableName: string, schema = "public"): Promise<TableColumnsSchema> {
  return withPgClient(dbName, async (client) => {
    const res = await client.query<{
      name: string;
      data_type: string;
      attnotnull: boolean;
      description: string | null;
    }>(
      `SELECT a.attname AS name,
              format_type(a.atttypid, a.atttypmod) AS data_type,
              a.attnotnull,
              d.description
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_description d ON d.objoid = a.attrelid AND d.objsubid = a.attnum
       WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [schema, tableName]
    );
    const columns: ColumnInfo[] = res.rows.map((r) => ({
      name: r.name,
      type: r.data_type,
      nullable: r.attnotnull ? "N" : "Y",
      comment: r.description ?? null,
    }));
    return { schema, tableName, columns };
  });
}

/** Constraints (PK / FK / UNIQUE) của một bảng. */
export async function getTableConstraints(dbName: string, tableName: string, schema = "public"): Promise<TableConstraintsSchema> {
  return withPgClient(dbName, async (client) => {
    const res = await client.query<{
      conname: string;
      contype: string;
      column_name: string;
      r_table: string | null;
    }>(
      `SELECT con.conname,
              con.contype,
              a.attname AS column_name,
              cl2.relname AS r_table
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
       JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
       LEFT JOIN pg_class cl2 ON cl2.oid = con.confrelid
       WHERE n.nspname = $1 AND cl.relname = $2 AND con.contype IN ('p', 'f', 'u')
       ORDER BY con.contype, con.conname, k.ord`,
      [schema, tableName]
    );

    const map = new Map<string, ConstraintInfo>();
    for (const row of res.rows) {
      if (!map.has(row.conname)) {
        map.set(row.conname, {
          name: row.conname,
          type: row.contype === "p" ? "PRIMARY KEY" : row.contype === "f" ? "FOREIGN KEY" : "UNIQUE",
          columns: [],
          rTableName: row.r_table ?? undefined,
        });
      }
      map.get(row.conname)!.columns.push(row.column_name);
    }
    return { schema, tableName, constraints: Array.from(map.values()) };
  });
}
