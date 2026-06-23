/**
 * Relational driver abstraction.
 *
 * Oracle and PostgreSQL share the same relational paradigm, so the `sql_*` tools
 * talk to this common interface instead of importing a specific driver. The
 * driver is selected at call time from the database's configured `type`
 * (see {@link getRelationalDriver}), so adding a new relational backend never
 * adds new tools.
 */
import {getDb} from "../config/loader.js";
import {ParsedSql} from "./oracle/parser.js";

import {parseSql} from "./oracle/parser.js";
import * as oraExec from "./oracle/executor.js";
import * as oraSchema from "./oracle/schema.js";
import {parsePlsqlScript, extractSchemaReferences} from "./oracle/plsql-parser.js";
import {executePlsqlScript} from "./oracle/plsql-executor.js";

import {parsePgSql} from "./postgres/parser.js";
import * as pgExec from "./postgres/executor.js";
import * as pgSchema from "./postgres/schema.js";
import {assertNoDdl, executePgScript} from "./postgres/script.js";

export interface RelationalDriver {
  /** Database backend type (matches config `type`). */
  readonly type: "oracle" | "postgres";
  /** Human-readable label for messages/errors. */
  readonly label: string;
  /** Whether a SCHEMA.TABLE prefix is required on every table reference. */
  readonly enforceSchemaPrefix: boolean;

  parse(sql: string): ParsedSql;

  getTables(dbName: string): Promise<string[]>;
  getTableColumns(dbName: string, tableName: string): Promise<unknown>;
  getTableConstraints(dbName: string, tableName: string): Promise<unknown>;

  executeSelect(dbName: string, sql: string): Promise<unknown>;
  executeWrite(dbName: string, sql: string): Promise<object>;
  executePreview(dbName: string, sql: string, parsed: ParsedSql): Promise<{data?: unknown}>;

  /** Throw if the script contains blocked operations (e.g. DDL). */
  assertScriptSafe(script: string): void;
  /** Build the non-token fields of the step-1 preview payload. */
  buildScriptPreview(script: string): Record<string, unknown> & {message: string};
  /** Execute the script (step 2) and return the formatted result payload. */
  executeScript(dbName: string, script: string): Promise<Record<string, unknown> & {success: boolean; message: string}>;
}

const oracleDriver: RelationalDriver = {
  type: "oracle",
  label: "Oracle",
  enforceSchemaPrefix: true,
  parse: parseSql,
  getTables: oraSchema.getTables,
  getTableColumns: oraSchema.getTableColumns,
  getTableConstraints: oraSchema.getTableConstraints,
  executeSelect: oraExec.executeSelect,
  executeWrite: oraExec.executeWrite,
  executePreview: oraExec.executePreview,
  assertScriptSafe(script) {
    const blocks = parsePlsqlScript(script);
    const ddlBlocks = blocks.filter((b) => b.containsDdl);
    if (ddlBlocks.length > 0) {
      throw new Error(
        `DDL operations detected in block(s) ${ddlBlocks.map((b) => b.index + 1).join(", ")}. ` +
          `DDL (DROP, TRUNCATE, ALTER, CREATE, GRANT, REVOKE) is blocked for safety. ` +
          `Contact a DBA to execute DDL operations directly.`
      );
    }
  },
  buildScriptPreview(script) {
    const blocks = parsePlsqlScript(script);
    const schemas = extractSchemaReferences(blocks);
    const hasDml = blocks.some((b) => b.containsDml);
    return {
      message: `⚠️ ACTION REQUIRED: You are about to execute a PL/SQL script with ${blocks.length} block(s).`,
      analysis: {
        total_blocks: blocks.length,
        blocks: blocks.map((b) => ({
          block: b.index + 1,
          type: b.type,
          contains_dml: b.containsDml,
          source_preview: b.source.substring(0, 200) + (b.source.length > 200 ? "..." : ""),
        })),
        schemas_referenced: schemas,
        contains_dml: hasDml,
      },
    };
  },
  async executeScript(dbName, script) {
    const blocks = parsePlsqlScript(script);
    const result = await executePlsqlScript(dbName, blocks);
    return {
      success: result.success,
      message: result.success
        ? `✅ Script executed successfully (${result.blocks.length} block(s))`
        : `❌ Script execution failed`,
      blocks: result.blocks.map((b) => ({
        block: b.index + 1,
        type: b.type,
        success: b.success,
        rowsAffected: b.rowsAffected,
        output: b.output,
        ...(b.error ? {error: b.error} : {}),
      })),
      dbms_output: result.totalOutput,
      ...(result.error ? {error: result.error} : {}),
    };
  },
};

const postgresDriver: RelationalDriver = {
  type: "postgres",
  label: "PostgreSQL",
  enforceSchemaPrefix: false,
  parse: parsePgSql,
  getTables: (dbName) => pgSchema.getTables(dbName),
  getTableColumns: (dbName, tableName) => pgSchema.getTableColumns(dbName, tableName),
  getTableConstraints: (dbName, tableName) => pgSchema.getTableConstraints(dbName, tableName),
  executeSelect: pgExec.executeSelect,
  executeWrite: pgExec.executeWrite,
  executePreview: pgExec.executePreview,
  assertScriptSafe(script) {
    assertNoDdl(script);
  },
  buildScriptPreview(script) {
    return {
      message: "⚠️ ACTION REQUIRED: You are about to execute a PostgreSQL script (runs in one transaction).",
      source_preview: script.substring(0, 400) + (script.length > 400 ? "..." : ""),
    };
  },
  async executeScript(dbName, script) {
    const result = await executePgScript(dbName, script);
    return {
      success: result.success,
      message: result.success ? "✅ Script executed successfully" : "❌ Script execution failed (rolled back)",
      rowsAffected: result.rowsAffected,
      notices: result.notices,
      ...(result.error ? {error: result.error} : {}),
    };
  },
};

const DRIVERS: Record<string, RelationalDriver> = {
  oracle: oracleDriver,
  postgres: postgresDriver,
};

/**
 * Resolve the relational driver for a database by its configured `type`.
 * Throws if the database is missing or is not a relational (Oracle/Postgres) DB.
 */
export function getRelationalDriver(dbName: string): RelationalDriver {
  const dbConfig = getDb(dbName);
  if (!dbConfig) {
    throw new Error(`Database '${dbName}' not found.`);
  }
  const driver = DRIVERS[dbConfig.type];
  if (!driver) {
    throw new Error(
      `Database '${dbName}' is a '${dbConfig.type}' database, not a relational (Oracle/PostgreSQL) one. ` +
        `Use the mongo_* tools for MongoDB.`
    );
  }
  return driver;
}
