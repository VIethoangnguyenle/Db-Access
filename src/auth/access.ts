import { Capability, Source } from "../config/schema.js";

export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessError";
  }
}

export function hasAccess(source: Source, dbName: string, cap: Capability): boolean {
  const caps = source.access[dbName];
  return !!caps && caps.includes(cap);
}

/**
 * Throw nếu source không có quyền. Thông điệp cố tình không phân biệt
 * "DB không tồn tại" vs "không đủ quyền" để không lộ sự tồn tại của DB.
 */
export function assertAccess(source: Source, dbName: string, cap: Capability): void {
  if (!hasAccess(source, dbName, cap)) {
    throw new AccessError(`Database '${dbName}' not found or access denied.`);
  }
}

export function accessibleDatabases(source: Source): { name: string; capabilities: Capability[] }[] {
  return Object.entries(source.access).map(([name, capabilities]) => ({ name, capabilities }));
}
