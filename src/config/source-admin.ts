/**
 * source-admin.ts — logic thuần để thêm source vào config (dùng bởi CLI scripts/source.ts).
 * Tách riêng để unit-test mà không đụng filesystem.
 */
import { randomBytes } from "node:crypto";
import { appConfigSchema, capabilitySchema } from "./schema.js";

/** Tên biến môi trường chứa apiKey cho một source. */
export function envVarNameFor(sourceName: string): string {
  return "KEY_" + sourceName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/** Sinh apiKey ngẫu nhiên (hex, 48 ký tự). */
export function generateApiKey(): string {
  return randomBytes(24).toString("hex");
}

export interface DbSpec {
  db: string;
  capabilities: string[];
  description?: string;
}

/**
 * Thêm một source vào object config (parsed YAML, dạng raw — apiKey là `${ENV}`).
 * Mutate `rawConfig` tại chỗ và trả về tên env var để ghi vào .env.
 * Throw nếu: trùng tên source, DB không tồn tại, capability sai, hoặc kết quả không validate.
 */
export function addSource(rawConfig: any, name: string, specs: DbSpec[]): { envVar: string } {
  if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`Tên source không hợp lệ: '${name}' (chỉ chữ/số/_/-)`);
  }
  if (!specs.length) {
    throw new Error("Cần ít nhất một --db <dbName>:<caps>");
  }

  rawConfig.sources = rawConfig.sources ?? {};
  if (rawConfig.sources[name]) {
    throw new Error(`Source '${name}' đã tồn tại`);
  }

  const databases = rawConfig.databases ?? {};
  const validCaps = capabilitySchema.options as readonly string[];
  const access: Record<string, unknown> = {};

  for (const spec of specs) {
    if (!databases[spec.db]) {
      throw new Error(`Database '${spec.db}' không tồn tại trong config`);
    }
    for (const c of spec.capabilities) {
      if (!validCaps.includes(c)) {
        throw new Error(`Capability không hợp lệ: '${c}' (cho phép: ${validCaps.join(", ")})`);
      }
    }
    access[spec.db] = spec.description
      ? { capabilities: spec.capabilities, description: spec.description }
      : spec.capabilities;
  }

  const envVar = envVarNameFor(name);
  rawConfig.sources[name] = { apiKey: "${" + envVar + "}", access };

  const result = appConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    throw new Error(`Config sau khi thêm không hợp lệ: ${result.error.message}`);
  }

  return { envVar };
}

/**
 * Parse một đối số `--db` dạng `dbName:cap1,cap2`.
 */
export function parseDbSpec(arg: string): DbSpec {
  const idx = arg.indexOf(":");
  if (idx === -1) {
    throw new Error(`--db sai định dạng: '${arg}' (cần dbName:cap1,cap2)`);
  }
  const db = arg.slice(0, idx);
  const capabilities = arg.slice(idx + 1).split(",").map((s) => s.trim()).filter(Boolean);
  if (!db || !capabilities.length) {
    throw new Error(`--db sai định dạng: '${arg}' (cần dbName:cap1,cap2)`);
  }
  return { db, capabilities };
}
