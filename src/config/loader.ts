import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { appConfigSchema, AppConfig, DbConfig, Source } from "./schema.js";

/**
 * Nội suy ${ENV_VAR} trong text bằng process.env. Throw nếu biến thiếu.
 */
export function interpolateEnv(raw: string): string {
  return raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
    const val = process.env[name];
    if (val === undefined) {
      throw new Error(`Config references missing environment variable: ${name}`);
    }
    return val;
  });
}

export function loadConfig(filePath: string): AppConfig {
  const raw = interpolateEnv(readFileSync(filePath, "utf8"));
  const parsed = yaml.load(raw);
  const validated = appConfigSchema.parse(parsed);

  const databases: Record<string, DbConfig> = {};
  for (const [name, db] of Object.entries(validated.databases)) {
    databases[name] = { ...db, name };
  }

  const sources: Record<string, Source> = {};
  for (const [name, src] of Object.entries(validated.sources)) {
    for (const dbName of Object.keys(src.access)) {
      if (!databases[dbName]) {
        throw new Error(`Source '${name}' references unknown database '${dbName}'`);
      }
    }
    sources[name] = { name, apiKey: src.apiKey, access: src.access };
  }

  return { databases, sources };
}

let _config: AppConfig | undefined;

export function initConfig(filePath: string): AppConfig {
  _config = loadConfig(filePath);
  return _config;
}

export function getConfig(): AppConfig {
  if (!_config) throw new Error("Config not initialized — call initConfig() first");
  return _config;
}

export function getDb(name: string): DbConfig | undefined {
  return getConfig().databases[name];
}
