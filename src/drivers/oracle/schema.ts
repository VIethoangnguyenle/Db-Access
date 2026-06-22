import {withOracleConnection} from "./pool.js";

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
    rOwner?: string;
    rTableName?: string;
}

export interface TableColumnsSchema {
    tableName: string;
    columns: ColumnInfo[];
}

export interface TableConstraintsSchema {
    tableName: string;
    constraints: ConstraintInfo[];
}

/**
 * Retrieves a list of tables in the Oracle database.
 */
export async function getTables(dbName: string): Promise<string[]> {
    return withOracleConnection(dbName, async (connection) => {
        const result = await connection.execute<{TABLE_NAME: string}>(
            `SELECT table_name FROM user_tables ORDER BY table_name`
        );
        return result.rows?.map(row => row.TABLE_NAME) || [];
    });
}

/**
 * Retrieves detailed schema information (columns, types, comments) for a specific table.
 */
export async function getTableColumns(dbName: string, tableName: string): Promise<TableColumnsSchema> {
    return withOracleConnection(dbName, async (connection) => {
        const upperTableName = tableName.toUpperCase();

        const columnsResult = await connection.execute<{
            COLUMN_NAME: string;
            DATA_TYPE: string;
            NULLABLE: string;
            COMMENTS: string | null;
        }>(
            `SELECT c.column_name, c.data_type, c.nullable, m.comments 
             FROM user_tab_columns c
             LEFT JOIN user_col_comments m ON c.table_name = m.table_name AND c.column_name = m.column_name
             WHERE c.table_name = :tableName 
             ORDER BY c.column_id`,
            [upperTableName]
        );

        const columns: ColumnInfo[] = columnsResult.rows?.map(row => ({
            name: row.COLUMN_NAME,
            type: row.DATA_TYPE,
            nullable: row.NULLABLE,
            comment: row.COMMENTS || null
        })) || [];

        return {
            tableName: upperTableName,
            columns
        };
    });
}

/**
 * Retrieves constraints (PK, FK) for a specific table.
 */
export async function getTableConstraints(dbName: string, tableName: string): Promise<TableConstraintsSchema> {
    return withOracleConnection(dbName, async (connection) => {
        const upperTableName = tableName.toUpperCase();

        const result = await connection.execute<{
            CONSTRAINT_NAME: string;
            CONSTRAINT_TYPE: string;
            COLUMN_NAME: string;
            R_OWNER: string | null;
            R_TABLE_NAME: string | null;
        }>(
            `SELECT c.constraint_name, c.constraint_type, col.column_name,
                    c.r_owner, rc.table_name as r_table_name
             FROM user_constraints c
             JOIN user_cons_columns col ON c.constraint_name = col.constraint_name AND c.owner = col.owner
             LEFT JOIN user_constraints rc ON c.r_constraint_name = rc.constraint_name AND c.owner = rc.owner
             WHERE c.table_name = :tableName 
             AND c.constraint_type IN ('P', 'R', 'U')
             ORDER BY c.constraint_type, c.constraint_name, col.position`,
            [upperTableName]
        );

        const constraintsMap = new Map<string, ConstraintInfo>();
        
        for (const row of result.rows || []) {
            if (!constraintsMap.has(row.CONSTRAINT_NAME)) {
                constraintsMap.set(row.CONSTRAINT_NAME, {
                    name: row.CONSTRAINT_NAME,
                    type: row.CONSTRAINT_TYPE === 'P' ? 'PRIMARY KEY' : (row.CONSTRAINT_TYPE === 'R' ? 'FOREIGN KEY' : 'UNIQUE'),
                    columns: [],
                    rOwner: row.R_OWNER || undefined,
                    rTableName: row.R_TABLE_NAME || undefined
                });
            }
            constraintsMap.get(row.CONSTRAINT_NAME)!.columns.push(row.COLUMN_NAME);
        }

        return {
            tableName: upperTableName,
            constraints: Array.from(constraintsMap.values())
        };
    });
}
