/**
 * Chẩn đoán bẫy "sai db_name".
 *
 * Mỗi `db_name` là một connection riêng, đăng nhập bằng user Oracle riêng. Agent
 * đọc luật "phải có schema prefix" nên thêm `SCHEMA.TABLE` vào SQL, nhưng thường
 * quên đổi `db_name` sang chính schema đó. Oracle trả ORA-01031 / ORA-00942, và
 * agent suy diễn nhầm thành "thiếu GRANT" rồi đi nhờ DBA cấp quyền.
 *
 * Khi lỗi đó xảy ra mà SQL trỏ tới một schema vốn LÀ một db_name khác source này
 * đọc được, ta gắn thêm `hint` chỉ thẳng db_name đúng.
 */
import {Capability, Source} from "../config/schema.js";
import {hasAccess} from "../auth/access.js";

/** Lỗi Oracle phát sinh khi truy cập schema mà user hiện tại không có quyền. */
const PRIVILEGE_ERROR = /ORA-01031|ORA-00942/i;

/** `FROM|JOIN|INTO|UPDATE SCHEMA.TABLE` — dùng khi parser không trả được tableNames. */
const SCHEMA_QUALIFIED = /\b(?:FROM|JOIN|INTO|UPDATE)\s+"?([A-Za-z0-9_$#]+)"?\s*\.\s*"?[A-Za-z0-9_$#]+"?/gi;

function referencedSchemas(sql: string, tableNames: string[]): string[] {
    const parsed = tableNames.filter((t) => t.includes(".")).map((t) => t.split(".")[0]);
    const names = parsed.length > 0 ? parsed : [...sql.matchAll(SCHEMA_QUALIFIED)].map((m) => m[1]);
    return [...new Set(names.map((n) => n.replace(/"/g, "").toUpperCase()))];
}

/** Các db_name source này truy cập được, khớp với schema mà SQL tham chiếu. */
function reachableTargets(source: Source, dbName: string, schemas: string[], cap: Capability): string[] {
    const byUpper = new Map(Object.keys(source.access).map((name) => [name.toUpperCase(), name]));
    return schemas
        .filter((schema) => schema !== dbName.toUpperCase())
        .map((schema) => byUpper.get(schema))
        .filter((name): name is string => Boolean(name) && hasAccess(source, name as string, cap));
}

function buildHint(dbName: string, targets: string[], cap: Capability): string {
    const listed = targets.map((t) => `'${t}'`).join(", ");
    return (
        `Wrong db_name. The statement targets schema ${listed}, but db_name was '${dbName}', ` +
        `so it ran as the '${dbName}' Oracle user — which has no privileges on that schema. ` +
        `Each db_name is a SEPARATE connection with its own Oracle user, not a schema switch. ` +
        `Retry with db_name='${targets[0]}' (this source already has '${cap}' on it). ` +
        `This is NOT a missing GRANT: do not ask a DBA to grant privileges.`
    );
}

/**
 * Trả lại `result` nguyên vẹn, trừ khi đó là lỗi thiếu quyền do sai `db_name` —
 * khi ấy gắn thêm trường `hint`.
 */
export function withCrossSchemaHint(
    result: unknown,
    source: Source,
    dbName: string,
    sql: string,
    tableNames: string[],
    cap: Capability
): unknown {
    const failure = result as {success?: boolean; error?: string} | null;
    if (!failure || failure.success !== false) return result;
    if (!failure.error || !PRIVILEGE_ERROR.test(failure.error)) return result;

    const targets = reachableTargets(source, dbName, referencedSchemas(sql, tableNames), cap);
    if (targets.length === 0) return result;

    return {...failure, hint: buildHint(dbName, targets, cap)};
}
