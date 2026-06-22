#!/usr/bin/env tsx
/**
 * CLI quản lý source trong config.yaml.
 *
 *   npm run source -- list
 *   npm run source -- add <name> --db <dbName>:<caps> [--db ...] [--desc <dbName>=<text>]
 *
 * Ví dụ:
 *   npm run source -- add project_b \
 *     --db oracle_sales:read,write --desc oracle_sales="DB bán hàng" \
 *     --db mongo_logs:read
 *
 * - Sinh apiKey ngẫu nhiên, ghi `KEY_<NAME>=<key>` vào .env
 * - Thêm source (apiKey tham chiếu `${KEY_<NAME>}`) vào config.yaml
 * - Nếu server đang chạy, hot-reload sẽ tự nạp lại; nếu không, restart server.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import yaml from "js-yaml";
import { addSource, parseDbSpec, generateApiKey, DbSpec } from "../src/config/source-admin.js";

const CONFIG_PATH = process.env.CONFIG_PATH || "./config.yaml";
const ENV_PATH = process.env.ENV_PATH || "./.env";

function loadRawConfig(): any {
  if (!existsSync(CONFIG_PATH)) {
    fail(`Không tìm thấy config: ${CONFIG_PATH} (đặt CONFIG_PATH nếu khác)`);
  }
  return (yaml.load(readFileSync(CONFIG_PATH, "utf8")) as any) ?? {};
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function cmdList(): void {
  const cfg = loadRawConfig();
  const sources = cfg.sources ?? {};
  const names = Object.keys(sources);
  if (!names.length) {
    console.log("(chưa có source nào)");
    return;
  }
  for (const name of names) {
    console.log(`• ${name}`);
    const access = sources[name].access ?? {};
    for (const [db, entry] of Object.entries<any>(access)) {
      const caps = Array.isArray(entry) ? entry : entry.capabilities;
      const desc = Array.isArray(entry) ? "" : entry.description ? ` — ${entry.description}` : "";
      console.log(`    ${db}: [${caps.join(", ")}]${desc}`);
    }
  }
}

function cmdAdd(args: string[]): void {
  const name = args[0];
  if (!name || name.startsWith("--")) fail("Thiếu <name>. Cú pháp: add <name> --db <dbName>:<caps> ...");

  const specs: DbSpec[] = [];
  const descByDb: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--db") {
      specs.push(parseDbSpec(args[++i] ?? ""));
    } else if (a === "--desc") {
      const v = args[++i] ?? "";
      const eq = v.indexOf("=");
      if (eq === -1) fail(`--desc sai định dạng: '${v}' (cần dbName=text)`);
      descByDb[v.slice(0, eq)] = v.slice(eq + 1);
    } else {
      fail(`Tham số không nhận diện: '${a}'`);
    }
  }

  for (const s of specs) {
    if (descByDb[s.db]) s.description = descByDb[s.db];
  }

  const cfg = loadRawConfig();
  let envVar: string;
  try {
    ({ envVar } = addSource(cfg, name, specs));
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }

  const apiKey = generateApiKey();

  // Ghi .env trước (để hot-reload đọc được secret trước khi config.yaml đổi)
  const line = `${envVar}=${apiKey}\n`;
  if (existsSync(ENV_PATH)) appendFileSync(ENV_PATH, line);
  else writeFileSync(ENV_PATH, line);

  // Ghi config.yaml (lưu ý: js-yaml dump sẽ chuẩn hoá format, không giữ comment)
  writeFileSync(CONFIG_PATH, yaml.dump(cfg, { lineWidth: 100, quotingType: '"' }));

  console.log(`✓ Đã thêm source '${name}'`);
  console.log(`  ${envVar}=${apiKey}   (đã ghi vào ${ENV_PATH})`);
  console.log(`  config.yaml: apiKey: \${${envVar}}`);
  console.log(`  → đưa key này cho dự án (header x-api-key). Server đang chạy sẽ tự hot-reload.`);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "list": cmdList(); break;
  case "add": cmdAdd(rest); break;
  default:
    console.log("Cú pháp:");
    console.log("  npm run source -- list");
    console.log("  npm run source -- add <name> --db <dbName>:<caps> [--db ...] [--desc <dbName>=<text>]");
    process.exit(cmd ? 1 : 0);
}
