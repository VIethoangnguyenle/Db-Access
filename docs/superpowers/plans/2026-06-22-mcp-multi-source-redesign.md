# MCP DB Remote — Multi-source + SSH first-class Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển MCP DB server từ mô hình "một .env phẳng, ai có key thấy hết DB" sang multi-tenant: server giữ config tập trung (YAML + `${ENV}`), mỗi source xác thực bằng API key riêng và được cấp capability per-DB (`read`/`write`/`script`), SSH tunnel do server tự quản qua `ssh2`, kèm vá các lỗ bảo mật đã review.

**Architecture:** Một file `config.yaml` được load + validate lúc khởi động (`config/loader.ts`). Request HTTP mang `x-api-key` → `resolveSource` → `createServer(source)` đăng ký tool đóng gói theo source. Mỗi tool gọi `assertAccess(source, db, capability)` rồi nhờ `tunnel-manager` resolve endpoint (mở SSH nếu cần) trước khi chạm driver. Boundary thật = capability + quyền DB account; token 2 bước + shadow preview là guardrail.

**Tech Stack:** TypeScript (ESM Node16), `@modelcontextprotocol/sdk`, `oracledb`, `mongodb`, `node-sql-parser`, `zod`, `express`; thêm `js-yaml` (config) và `ssh2` (tunnel). Test bằng Node built-in test runner (`node:test`) chạy qua `tsx` (đã có sẵn).

---

## File Structure

**Tạo mới:**
- `src/config/schema.ts` — zod schema + types (`Capability`, `DbConfig`, `Source`, `AppConfig`).
- `src/config/loader.ts` — nội suy `${ENV}`, parse YAML, validate, singleton `getConfig()/getDb()`.
- `src/auth/resolve-source.ts` — index `apiKey → Source`.
- `src/auth/access.ts` — `assertAccess`, `hasAccess`, `accessibleDatabases`.
- `src/net/tunnel-manager.ts` — `ensure(db)`, `shutdownAll()` (ssh2, injectable connector).
- `src/safety/shadow.ts` — `buildShadowQuery` (chuyển từ parser, sửa bug).
- `src/server.ts` — `createServer(source)`.
- `config.example.yaml` — mẫu config.
- `test/**` — unit tests.

**Sửa:**
- `src/tools/*.ts` — `register*(server, source)` + `assertAccess`; `list-databases` lọc theo source; mongo tools gọi guard `$where`.
- `src/drivers/oracle/pool.ts`, `src/drivers/mongo/pool.ts` — dùng `getDb` + `tunnel.ensure`.
- `src/drivers/oracle/parser.ts` — bỏ `buildShadowQuery` (đã move).
- `src/drivers/oracle/executor.ts`, `src/drivers/mongo/executor.ts` — wiring shadow / guard.
- `src/index.ts` — load config, binding source, vá bảo mật.
- `package.json` — deps + script test.
- `mcp-db-tools.service`, `README.md`, `.env.example`.

**Xóa:** `src/config/env-scanner.ts`.

---

## Task 1: Tooling — deps + test runner

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Cài dependencies**

Run:
```bash
npm install js-yaml ssh2
npm install -D @types/js-yaml @types/ssh2
```
Expected: cài thành công, `package.json` có 4 mục mới.

- [ ] **Step 2: Thêm script test vào `package.json`**

Trong khối `"scripts"`, thêm dòng `test`:
```json
"scripts": {
  "build": "tsc",
  "start": "node dist/index.js",
  "dev": "tsx src/index.ts",
  "test": "node --import tsx --test test/**/*.test.ts"
}
```

- [ ] **Step 3: Tạo test smoke để xác nhận runner chạy**

Create `test/smoke.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("test runner works", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 4: Chạy test**

Run: `npm test`
Expected: PASS — `1 passing` (hoặc `pass 1`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json test/smoke.test.ts
git commit -m "chore: add js-yaml, ssh2 deps + node:test runner"
```

---

## Task 2: Config schema (`config/schema.ts`)

**Files:**
- Create: `src/config/schema.ts`
- Test: `test/config/schema.test.ts`

- [ ] **Step 1: Viết test fail trước**

Create `test/config/schema.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { appConfigSchema } from "../../src/config/schema.js";

const valid = {
  databases: {
    oracle_prod: { type: "oracle", host: "h", port: 1521, service: "XE", user: "u", password: "p" },
    mongo_logs: { type: "mongo", host: "h", port: 27017, database: "logs", user: "u", password: "p" },
  },
  sources: {
    agent_a: { apiKey: "k", access: { oracle_prod: ["read"] } },
  },
};

test("accepts a valid config", () => {
  const r = appConfigSchema.safeParse(valid);
  assert.equal(r.success, true);
});

test("rejects oracle db missing service", () => {
  const bad = structuredClone(valid);
  delete (bad.databases.oracle_prod as any).service;
  const r = appConfigSchema.safeParse(bad);
  assert.equal(r.success, false);
});

test("rejects invalid capability", () => {
  const bad = structuredClone(valid);
  (bad.sources.agent_a.access.oracle_prod as any) = ["delete"];
  const r = appConfigSchema.safeParse(bad);
  assert.equal(r.success, false);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --import tsx --test test/config/schema.test.ts`
Expected: FAIL — không import được `appConfigSchema`.

- [ ] **Step 3: Viết `src/config/schema.ts`**

```ts
import { z } from "zod";

export const capabilitySchema = z.enum(["read", "write", "script"]);
export type Capability = z.infer<typeof capabilitySchema>;

export const sshSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(22),
  user: z.string().min(1),
  privateKey: z.string().min(1), // đường dẫn tới private key file
  passphrase: z.string().optional(),
});
export type SshConfig = z.infer<typeof sshSchema>;

export const dbSchema = z
  .object({
    type: z.enum(["oracle", "mongo"]),
    host: z.string().min(1),
    port: z.number().int().positive(),
    service: z.string().optional(),  // oracle service name
    database: z.string().optional(), // mongo database name
    user: z.string().min(1),
    password: z.string(),
    ssh: sshSchema.optional(),
  })
  .refine((d) => d.type !== "oracle" || !!d.service, {
    message: "oracle database requires 'service'",
  })
  .refine((d) => d.type !== "mongo" || !!d.database, {
    message: "mongo database requires 'database'",
  });
export type RawDb = z.infer<typeof dbSchema>;

export const sourceSchema = z.object({
  apiKey: z.string().min(1),
  access: z.record(z.string(), z.array(capabilitySchema)),
});

export const appConfigSchema = z.object({
  databases: z.record(z.string(), dbSchema),
  sources: z.record(z.string(), sourceSchema),
});

// Resolved (đã gắn name) types dùng xuyên suốt app
export interface DbConfig extends RawDb { name: string; }
export interface Source {
  name: string;
  apiKey: string;
  access: Record<string, Capability[]>;
}
export interface AppConfig {
  databases: Record<string, DbConfig>;
  sources: Record<string, Source>;
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --import tsx --test test/config/schema.test.ts`
Expected: PASS — 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/config/schema.test.ts
git commit -m "feat(config): zod schema cho AppConfig (db + source + ssh)"
```

---

## Task 3: Nội suy `${ENV}` (`config/loader.ts` — interpolateEnv)

**Files:**
- Create: `src/config/loader.ts`
- Test: `test/config/interpolate.test.ts`

- [ ] **Step 1: Viết test fail trước**

Create `test/config/interpolate.test.ts`:
```ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { interpolateEnv } from "../../src/config/loader.js";

afterEach(() => {
  delete process.env.FOO;
  delete process.env.BAR;
});

test("thay thế ${VAR} bằng giá trị env", () => {
  process.env.FOO = "secret";
  assert.equal(interpolateEnv("pass: ${FOO}"), "pass: secret");
});

test("thay nhiều biến", () => {
  process.env.FOO = "a";
  process.env.BAR = "b";
  assert.equal(interpolateEnv("${FOO}-${BAR}"), "a-b");
});

test("throw khi env thiếu", () => {
  assert.throws(() => interpolateEnv("x: ${MISSING_VAR}"), /MISSING_VAR/);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --import tsx --test test/config/interpolate.test.ts`
Expected: FAIL — không import được `interpolateEnv`.

- [ ] **Step 3: Viết `src/config/loader.ts` (chỉ phần interpolateEnv)**

```ts
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
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --import tsx --test test/config/interpolate.test.ts`
Expected: PASS — 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/config/loader.ts test/config/interpolate.test.ts
git commit -m "feat(config): interpolateEnv nội suy \${ENV} fail-fast"
```

---

## Task 4: Load + validate config + singleton (`config/loader.ts`)

**Files:**
- Modify: `src/config/loader.ts`
- Test: `test/config/loader.test.ts`

- [ ] **Step 1: Viết test fail trước**

Create `test/config/loader.test.ts`:
```ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config/loader.js";

function writeYaml(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const p = join(dir, "config.yaml");
  writeFileSync(p, body);
  return p;
}

afterEach(() => { delete process.env.PW; });

const yaml = `
databases:
  oracle_prod:
    type: oracle
    host: xx.xxx.xx.xx
    port: 1521
    service: XE
    user: u
    password: \${PW}
sources:
  agent_a:
    apiKey: key-a
    access:
      oracle_prod: [read, write]
`;

test("load + nội suy + gắn name", () => {
  process.env.PW = "p123";
  const cfg = loadConfig(writeYaml(yaml));
  assert.equal(cfg.databases.oracle_prod.name, "oracle_prod");
  assert.equal(cfg.databases.oracle_prod.password, "p123");
  assert.equal(cfg.sources.agent_a.name, "agent_a");
  assert.deepEqual(cfg.sources.agent_a.access.oracle_prod, ["read", "write"]);
});

test("throw khi access trỏ DB không tồn tại", () => {
  process.env.PW = "p123";
  const bad = yaml.replace("oracle_prod: [read, write]", "ghost_db: [read]");
  assert.throws(() => loadConfig(writeYaml(bad)), /ghost_db/);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --import tsx --test test/config/loader.test.ts`
Expected: FAIL — `loadConfig` chưa tồn tại.

- [ ] **Step 3: Bổ sung vào `src/config/loader.ts`**

Thêm import ở đầu file và các hàm phía sau `interpolateEnv`:
```ts
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { appConfigSchema, AppConfig, DbConfig, Source } from "./schema.js";

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
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --import tsx --test test/config/loader.test.ts`
Expected: PASS — 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/config/loader.ts test/config/loader.test.ts
git commit -m "feat(config): loadConfig (YAML + validate + cross-ref) + singleton getDb"
```

---

## Task 5: Resolve source theo API key (`auth/resolve-source.ts`)

**Files:**
- Create: `src/auth/resolve-source.ts`
- Test: `test/auth/resolve-source.test.ts`

- [ ] **Step 1: Viết test fail trước**

Create `test/auth/resolve-source.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSourceIndex, resolveSourceFrom } from "../../src/auth/resolve-source.js";
import { AppConfig } from "../../src/config/schema.js";

const cfg: AppConfig = {
  databases: {},
  sources: {
    agent_a: { name: "agent_a", apiKey: "key-a", access: { db1: ["read"] } },
    agent_b: { name: "agent_b", apiKey: "key-b", access: {} },
  },
};

test("map đúng apiKey → source", () => {
  const idx = buildSourceIndex(cfg);
  assert.equal(resolveSourceFrom(idx, "key-a")?.name, "agent_a");
  assert.equal(resolveSourceFrom(idx, "key-b")?.name, "agent_b");
});

test("trả undefined với key sai/thiếu", () => {
  const idx = buildSourceIndex(cfg);
  assert.equal(resolveSourceFrom(idx, "nope"), undefined);
  assert.equal(resolveSourceFrom(idx, undefined), undefined);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --import tsx --test test/auth/resolve-source.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết `src/auth/resolve-source.ts`**

```ts
import { AppConfig, Source } from "../config/schema.js";
import { getConfig } from "../config/loader.js";

export type SourceIndex = Map<string, Source>;

export function buildSourceIndex(config: AppConfig): SourceIndex {
  const idx: SourceIndex = new Map();
  for (const source of Object.values(config.sources)) {
    if (idx.has(source.apiKey)) {
      throw new Error(`Duplicate apiKey detected for source '${source.name}'`);
    }
    idx.set(source.apiKey, source);
  }
  return idx;
}

export function resolveSourceFrom(idx: SourceIndex, apiKey: string | undefined): Source | undefined {
  if (!apiKey) return undefined;
  return idx.get(apiKey);
}

let _index: SourceIndex | undefined;

export function initSourceIndex(): SourceIndex {
  _index = buildSourceIndex(getConfig());
  return _index;
}

export function resolveSource(apiKey: string | undefined): Source | undefined {
  if (!_index) throw new Error("Source index not initialized — call initSourceIndex() first");
  return resolveSourceFrom(_index, apiKey);
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --import tsx --test test/auth/resolve-source.test.ts`
Expected: PASS — 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/auth/resolve-source.ts test/auth/resolve-source.test.ts
git commit -m "feat(auth): resolve source theo apiKey (index + chống trùng key)"
```

---

## Task 6: Access control (`auth/access.ts`)

**Files:**
- Create: `src/auth/access.ts`
- Test: `test/auth/access.test.ts`

- [ ] **Step 1: Viết test fail trước**

Create `test/auth/access.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasAccess, assertAccess, accessibleDatabases, AccessError } from "../../src/auth/access.js";
import { Source } from "../../src/config/schema.js";

const source: Source = {
  name: "agent_a",
  apiKey: "k",
  access: { oracle_prod: ["read"], oracle_dev: ["read", "write", "script"] },
};

test("hasAccess đúng theo capability", () => {
  assert.equal(hasAccess(source, "oracle_prod", "read"), true);
  assert.equal(hasAccess(source, "oracle_prod", "write"), false);
  assert.equal(hasAccess(source, "oracle_dev", "script"), true);
  assert.equal(hasAccess(source, "unknown_db", "read"), false);
});

test("assertAccess throw AccessError khi bị từ chối", () => {
  assert.doesNotThrow(() => assertAccess(source, "oracle_prod", "read"));
  assert.throws(() => assertAccess(source, "oracle_prod", "write"), AccessError);
  assert.throws(() => assertAccess(source, "unknown_db", "read"), AccessError);
});

test("accessibleDatabases liệt kê đúng", () => {
  const list = accessibleDatabases(source);
  assert.deepEqual(
    list.sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "oracle_dev", capabilities: ["read", "write", "script"] },
      { name: "oracle_prod", capabilities: ["read"] },
    ]
  );
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --import tsx --test test/auth/access.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết `src/auth/access.ts`**

```ts
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
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --import tsx --test test/auth/access.test.ts`
Expected: PASS — 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/auth/access.ts test/auth/access.test.ts
git commit -m "feat(auth): access control per-(source,db,capability)"
```

---

## Task 7: Shadow preview an toàn (`safety/shadow.ts`)

**Files:**
- Create: `src/safety/shadow.ts`
- Modify: `src/drivers/oracle/parser.ts` (bỏ `buildShadowQuery`)
- Modify: `src/drivers/oracle/executor.ts` (đổi import)
- Test: `test/safety/shadow.test.ts`

- [ ] **Step 1: Viết test fail trước**

Create `test/safety/shadow.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSql } from "../../src/drivers/oracle/parser.js";
import { buildShadowQuery } from "../../src/safety/shadow.js";

test("UPDATE có WHERE → SELECT đúng table + WHERE", () => {
  const sql = "UPDATE S.T SET A=1 WHERE ID=5";
  assert.equal(buildShadowQuery(sql, parseSql(sql)), "SELECT * FROM S.T WHERE ID=5");
});

test("DELETE không WHERE → SELECT toàn bảng", () => {
  const sql = "DELETE FROM S.T";
  assert.equal(buildShadowQuery(sql, parseSql(sql)), "SELECT * FROM S.T");
});

test("UPDATE có subquery → null (không chắc, không đoán)", () => {
  const sql = "UPDATE S.T SET A=(SELECT X FROM S.U WHERE U.ID=1) WHERE ID=5";
  assert.equal(buildShadowQuery(sql, parseSql(sql)), null);
});

test("SELECT → null", () => {
  const sql = "SELECT * FROM S.T";
  assert.equal(buildShadowQuery(sql, parseSql(sql)), null);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --import tsx --test test/safety/shadow.test.ts`
Expected: FAIL — `src/safety/shadow.js` chưa tồn tại.

- [ ] **Step 3: Viết `src/safety/shadow.ts`**

```ts
import { ParsedSql } from "../drivers/oracle/parser.js";

/**
 * Dựng "shadow query" (SELECT) để preview các dòng bị UPDATE/DELETE tác động.
 * Chỉ xử lý các trường hợp KHÔNG mơ hồ; trả null khi không chắc (có subquery,
 * nhiều bảng/WHERE) để KHÔNG hiển thị preview sai.
 */
export function buildShadowQuery(sql: string, parsed: ParsedSql): string | null {
  if (parsed.type !== "UPDATE" && parsed.type !== "DELETE") return null;
  if (parsed.tableNames.length !== 1) return null;

  const upper = sql.toUpperCase();

  // Có bất kỳ SELECT nào ⇒ subquery (vì câu gốc là UPDATE/DELETE) ⇒ không chắc.
  if (/\bSELECT\b/.test(upper)) return null;
  // Nhiều WHERE ⇒ không chắc đâu là WHERE chính.
  if ((upper.match(/\bWHERE\b/g) || []).length > 1) return null;

  const table = parsed.tableNames[0];
  const whereIdx = upper.indexOf(" WHERE ");

  if (whereIdx === -1) {
    return `SELECT * FROM ${table}`;
  }
  const whereClause = sql.substring(whereIdx + 1); // từ "WHERE ..." tới hết
  return `SELECT * FROM ${table} ${whereClause}`;
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --import tsx --test test/safety/shadow.test.ts`
Expected: PASS — 4 passing.

- [ ] **Step 5: Bỏ `buildShadowQuery` cũ khỏi `src/drivers/oracle/parser.ts`**

Xóa toàn bộ hàm `buildShadowQuery` (dòng ~68-105) trong `parser.ts`. Giữ nguyên `parseSql` và `ParsedSql`.

- [ ] **Step 6: Sửa import trong `src/drivers/oracle/executor.ts`**

Đổi dòng 2 từ:
```ts
import {buildShadowQuery, ParsedSql} from "./parser.js";
```
thành:
```ts
import {ParsedSql} from "./parser.js";
import {buildShadowQuery} from "../../safety/shadow.js";
```
(Phần thân `executePreview` giữ nguyên vì chữ ký `buildShadowQuery(sql, parsed)` không đổi.)

- [ ] **Step 7: Build + chạy lại test**

Run: `npm run build && node --import tsx --test test/safety/shadow.test.ts`
Expected: build OK, 4 passing.

- [ ] **Step 8: Commit**

```bash
git add src/safety/shadow.ts src/drivers/oracle/parser.ts src/drivers/oracle/executor.ts test/safety/shadow.test.ts
git commit -m "fix(safety): shadow preview dựng từ AST, từ chối khi không chắc"
```

---

## Task 8: Tunnel manager (`net/tunnel-manager.ts`)

**Files:**
- Create: `src/net/tunnel-manager.ts`
- Test: `test/net/tunnel-manager.test.ts`

- [ ] **Step 1: Viết test fail trước**

Create `test/net/tunnel-manager.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ensure, shutdownAll, SshConnector } from "../../src/net/tunnel-manager.js";
import { DbConfig } from "../../src/config/schema.js";

const directDb: DbConfig = {
  name: "direct", type: "oracle", host: "xx.xxx.xx.xx", port: 1521, service: "XE", user: "u", password: "p",
};
const sshDb: DbConfig = {
  ...directDb, name: "viassh",
  ssh: { host: "xx.xxx.xx.xx", port: 22, user: "ssh-user", privateKey: "/tmp/key" },
};

test("DB không có ssh → trả thẳng host/port", async () => {
  const ep = await ensure(directDb);
  assert.deepEqual(ep, { host: "xx.xxx.xx.xx", port: 1521 });
  await shutdownAll();
});

test("DB có ssh → trả loopback + chỉ mở 1 lần (cache)", async () => {
  let opens = 0;
  const fake: SshConnector = {
    open: async () => { opens++; return { localPort: 54321, close: async () => {} }; },
  };
  const ep1 = await ensure(sshDb, fake);
  const ep2 = await ensure(sshDb, fake);
  assert.deepEqual(ep1, { host: "127.0.0.1", port: 54321 });
  assert.deepEqual(ep2, { host: "127.0.0.1", port: 54321 });
  assert.equal(opens, 1);
  await shutdownAll();
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --import tsx --test test/net/tunnel-manager.test.ts`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết `src/net/tunnel-manager.ts`**

```ts
import net from "node:net";
import { readFileSync } from "node:fs";
import { Client } from "ssh2";
import { DbConfig } from "../config/schema.js";

export interface OpenTunnel {
  localPort: number;
  close(): Promise<void>;
}
export interface SshConnector {
  open(db: DbConfig): Promise<OpenTunnel>;
}

/** Connector mặc định: mở tunnel thật bằng ssh2 + local TCP forwarder. */
export const defaultConnector: SshConnector = {
  open(db: DbConfig): Promise<OpenTunnel> {
    const ssh = db.ssh!;
    return new Promise((resolve, reject) => {
      const client = new Client();
      client
        .on("ready", () => {
          const server = net.createServer((sock) => {
            client.forwardOut(sock.remoteAddress || "127.0.0.1", sock.remotePort || 0, db.host, db.port, (err, stream) => {
              if (err) { sock.destroy(); return; }
              sock.pipe(stream).pipe(sock);
            });
          });
          server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            const localPort = typeof addr === "object" && addr ? addr.port : 0;
            resolve({
              localPort,
              close: () => new Promise((res) => { server.close(() => { client.end(); res(); }); }),
            });
          });
        })
        .on("error", reject)
        .connect({
          host: ssh.host,
          port: ssh.port,
          username: ssh.user,
          privateKey: readFileSync(ssh.privateKey),
          passphrase: ssh.passphrase,
          keepaliveInterval: 30000,
        });
    });
  },
};

const tunnels = new Map<string, OpenTunnel>();

/** Trả endpoint để driver connect. Mở tunnel (cache theo tên DB) nếu DB có ssh. */
export async function ensure(db: DbConfig, connector: SshConnector = defaultConnector): Promise<{ host: string; port: number }> {
  if (!db.ssh) return { host: db.host, port: db.port };

  const existing = tunnels.get(db.name);
  if (existing) return { host: "127.0.0.1", port: existing.localPort };

  const t = await connector.open(db);
  tunnels.set(db.name, t);
  return { host: "127.0.0.1", port: t.localPort };
}

export async function shutdownAll(): Promise<void> {
  for (const [name, t] of tunnels) {
    try { await t.close(); } catch { /* ignore */ }
    tunnels.delete(name);
  }
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --import tsx --test test/net/tunnel-manager.test.ts`
Expected: PASS — 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/net/tunnel-manager.ts test/net/tunnel-manager.test.ts
git commit -m "feat(net): tunnel-manager ssh2 (lazy, cache, injectable connector)"
```

---

## Task 9: Guard `$where` cho Mongo (`drivers/mongo/executor.ts`)

**Files:**
- Modify: `src/drivers/mongo/executor.ts`
- Test: `test/drivers/mongo-guard.test.ts`

- [ ] **Step 1: Viết test fail trước**

Create `test/drivers/mongo-guard.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafeFilter } from "../../src/drivers/mongo/executor.js";

test("cho phép filter thường", () => {
  assert.doesNotThrow(() => assertSafeFilter({ status: "active", n: { $gt: 5 } }));
});

test("chặn $where", () => {
  assert.throws(() => assertSafeFilter({ $where: "sleep(9999)" }), /\$where/);
});

test("chặn operator nguy hiểm lồng sâu", () => {
  assert.throws(() => assertSafeFilter({ a: { b: { $function: {} } } }), /\$function/);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `node --import tsx --test test/drivers/mongo-guard.test.ts`
Expected: FAIL — `assertSafeFilter` chưa export.

- [ ] **Step 3: Thêm `assertSafeFilter` vào `src/drivers/mongo/executor.ts`**

Thêm ngay sau `import` đầu file:
```ts
const FORBIDDEN_OPERATORS = ["$where", "$function", "$accumulator", "$expr"];

/** Throw nếu filter/update chứa operator cho phép chạy JS phía server. */
export function assertSafeFilter(obj: any): void {
  if (obj === null || typeof obj !== "object") return;
  if (Array.isArray(obj)) { obj.forEach(assertSafeFilter); return; }
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_OPERATORS.includes(key)) {
      throw new Error(`Forbidden MongoDB operator '${key}' is not allowed.`);
    }
    assertSafeFilter(value);
  }
}
```

- [ ] **Step 4: Gọi guard trong các hàm execute**

Trong `executeFind`, `executeUpdateMany`, `executeDeleteMany`: ngay sau khi `deserializeMongoQuery(filter)`, thêm `assertSafeFilter(parsedFilter)`. Trong `executeUpdateMany` thêm `assertSafeFilter(parsedUpdate)`. Ví dụ trong `executeFind`:
```ts
const parsedFilter = deserializeMongoQuery(filter) || {};
assertSafeFilter(parsedFilter);
```

- [ ] **Step 5: Chạy test + build**

Run: `node --import tsx --test test/drivers/mongo-guard.test.ts && npm run build`
Expected: 3 passing, build OK.

- [ ] **Step 6: Commit**

```bash
git add src/drivers/mongo/executor.ts test/drivers/mongo-guard.test.ts
git commit -m "fix(mongo): chặn \$where/\$function/\$accumulator/\$expr trong filter"
```

---

## Task 10: Driver pools dùng config + tunnel (Oracle + Mongo)

**Files:**
- Modify: `src/drivers/oracle/pool.ts`
- Modify: `src/drivers/mongo/pool.ts`

> Pool kết nối DB thật nên không unit-test ở đây; xác minh bằng `npm run build`. Việc kết nối thực sẽ smoke-test ở Task 13.

- [ ] **Step 1: Viết lại `src/drivers/oracle/pool.ts`**

```ts
import oracledb from "oracledb";
import { getDb } from "../../config/loader.js";
import { ensure } from "../../net/tunnel-manager.js";

const pools = new Map<string, oracledb.Pool>();

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.DATE, oracledb.CLOB];

export async function getOraclePool(dbName: string): Promise<oracledb.Pool> {
  const db = getDb(dbName);
  if (!db) throw new Error(`Database configuration '${dbName}' not found`);
  if (db.type !== "oracle") throw new Error(`Database '${dbName}' is not an Oracle database`);

  const existing = pools.get(dbName);
  if (existing) return existing;

  const { host, port } = await ensure(db);
  const connectString = `${host}:${port}/${db.service}`;

  try {
    console.error(`[oracle-pool] Creating pool for '${dbName}' → ${connectString}`);
    const pool = await oracledb.createPool({
      user: db.user,
      password: db.password,
      connectString,
      poolMin: 1,
      poolMax: 4,
      poolIncrement: 1,
    });
    pools.set(dbName, pool);
    return pool;
  } catch (error) {
    throw new Error(`Failed to create Oracle pool for '${dbName}': ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function withOracleConnection<T>(
  dbName: string,
  callback: (connection: oracledb.Connection) => Promise<T>
): Promise<T> {
  const pool = await getOraclePool(dbName);
  let connection: oracledb.Connection | null = null;
  try {
    connection = await pool.getConnection();
    return await callback(connection);
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) {
        console.error(`Error closing Oracle connection for '${dbName}':`, err);
      }
    }
  }
}
```

- [ ] **Step 2: Viết lại `src/drivers/mongo/pool.ts`**

```ts
import { Db, MongoClient } from "mongodb";
import { getDb } from "../../config/loader.js";
import { ensure } from "../../net/tunnel-manager.js";

const clients = new Map<string, MongoClient>();

export async function getMongoDb(dbName: string): Promise<Db> {
  const db = getDb(dbName);
  if (!db) throw new Error(`Database configuration '${dbName}' not found`);
  if (db.type !== "mongo") throw new Error(`Database '${dbName}' is not a MongoDB database`);

  const existing = clients.get(dbName);
  if (existing) return existing.db(db.database);

  const { host, port } = await ensure(db);
  const uri = `mongodb://${host}:${port}`;

  try {
    const client = new MongoClient(uri, {
      auth: { username: db.user, password: db.password },
      maxPoolSize: 4,
    });
    await client.connect();
    clients.set(dbName, client);
    return client.db(db.database);
  } catch (error) {
    throw new Error(`Failed to connect to MongoDB '${dbName}': ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

- [ ] **Step 3: Build để xác nhận type khớp**

Run: `npm run build`
Expected: build OK (lưu ý các tool còn import `env-scanner` sẽ vẫn OK đến khi Task 11; nếu lỗi do `getDatabase` chưa đụng tới thì bỏ qua — env-scanner vẫn còn tồn tại ở task này).
Expected cụ thể: không lỗi ở `drivers/oracle/pool.ts` và `drivers/mongo/pool.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/drivers/oracle/pool.ts src/drivers/mongo/pool.ts
git commit -m "feat(drivers): pool dùng getDb + tunnel.ensure (bỏ env-scanner)"
```

---

## Task 11: Tools — bind source + assertAccess + filter; `server.ts`

**Files:**
- Create: `src/server.ts`
- Modify: tất cả `src/tools/*.ts`
- Test: `test/tools/sql-read-access.test.ts`

> Mẫu sửa áp dụng cho mọi tool: (a) đổi chữ ký `register*(server, source)`; (b) đổi import `getDatabase` → `getDb`; (c) thêm `assertAccess(source, db_name, <cap>)` ngay sau khi nhận `db_name`. Capability theo bảng: read tools → `"read"`, `sql_write`/`mongo_write` → `"write"`, `sql_execute_script` → `"script"`.

- [ ] **Step 1: Sửa `src/tools/sql-read.ts`**

Đổi import dòng 3:
```ts
import {getDb} from "../config/loader.js";
import {assertAccess} from "../auth/access.js";
import {Source} from "../config/schema.js";
```
Đổi chữ ký hàm:
```ts
export function registerSqlRead(server: McpServer, source: Source): void {
```
Trong handler, thay `const dbConfig = getDatabase(db_name);` bằng:
```ts
assertAccess(source, db_name, "read");
const dbConfig = getDb(db_name);
```
(Giữ nguyên phần kiểm `!dbConfig || dbConfig.type !== "oracle"` và phần còn lại.)

- [ ] **Step 2: Áp cùng mẫu cho các tool đọc Oracle còn lại**

`sql-list-tables.ts`, `sql-get-columns.ts`, `sql-get-constraints.ts`: import `getDb` + `assertAccess` + `Source`; chữ ký `(server, source)`; thêm `assertAccess(source, db_name, "read");` trước `getDb(db_name)`. (Các tool này hiện dùng biến `db_name`.)

- [ ] **Step 3: Áp mẫu cho tool đọc Mongo**

`mongo-read.ts`, `mongo-list-collections.ts`, `mongo-get-schema.ts`: tương tự với `assertAccess(source, db_name, "read")` và `getDb`.

- [ ] **Step 4: Sửa tool ghi**

`sql-write.ts` → `assertAccess(source, db_name, "write")`; `mongo-write.ts` → `assertAccess(source, db_name, "write")`; `sql-execute-script.ts` → `assertAccess(source, db_name, "script")`. Tất cả đổi `getDatabase`→`getDb`, chữ ký `(server, source)`.

- [ ] **Step 5: Viết lại `src/tools/list-databases.ts`**

```ts
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {Source} from "../config/schema.js";
import {accessibleDatabases} from "../auth/access.js";
import {getDb} from "../config/loader.js";

export function registerListDatabases(server: McpServer, source: Source): void {
  server.tool(
    "list_databases",
    "List databases this source is allowed to access, with their type and granted capabilities. Call this first.",
    {},
    async () => {
      const list = accessibleDatabases(source).map((entry) => {
        const db = getDb(entry.name);
        return { name: entry.name, type: db?.type ?? "unknown", capabilities: entry.capabilities };
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ databases: list, total: list.length }, null, 2) }],
      };
    }
  );
}
```

- [ ] **Step 6: Viết `src/server.ts`**

```ts
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {Source} from "./config/schema.js";

import {registerListDatabases} from "./tools/list-databases.js";
import {registerSqlListTables} from "./tools/sql-list-tables.js";
import {registerSqlGetColumns} from "./tools/sql-get-columns.js";
import {registerSqlGetConstraints} from "./tools/sql-get-constraints.js";
import {registerSqlRead} from "./tools/sql-read.js";
import {registerSqlWrite} from "./tools/sql-write.js";
import {registerSqlExecuteScript} from "./tools/sql-execute-script.js";
import {registerMongoListCollections} from "./tools/mongo-list-collections.js";
import {registerMongoGetSchema} from "./tools/mongo-get-schema.js";
import {registerMongoRead} from "./tools/mongo-read.js";
import {registerMongoWrite} from "./tools/mongo-write.js";

export function createServer(source: Source): McpServer {
  const server = new McpServer({ name: "mcp-db-tools", version: "2.0.0" });
  registerListDatabases(server, source);
  registerSqlListTables(server, source);
  registerSqlGetColumns(server, source);
  registerSqlGetConstraints(server, source);
  registerSqlRead(server, source);
  registerSqlWrite(server, source);
  registerSqlExecuteScript(server, source);
  registerMongoListCollections(server, source);
  registerMongoGetSchema(server, source);
  registerMongoRead(server, source);
  registerMongoWrite(server, source);
  return server;
}
```

- [ ] **Step 7: Viết test enforcement cho một tool (sql_read từ chối khi thiếu quyền)**

Create `test/tools/sql-read-access.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSqlRead } from "../../src/tools/sql-read.js";
import { Source } from "../../src/config/schema.js";

// Bắt tool handler bằng cách stub server.tool
function captureHandler(register: (s: any, src: Source) => void, source: Source) {
  let handler: any;
  const fakeServer = { tool: (_n: string, _d: string, _schema: any, h: any) => { handler = h; } };
  register(fakeServer as unknown as McpServer, source);
  return handler;
}

const source: Source = { name: "a", apiKey: "k", access: { other_db: ["read"] } };

test("sql_read từ chối DB ngoài quyền", async () => {
  const handler = captureHandler(registerSqlRead, source);
  const res = await handler({ db_name: "secret_db", sql: "SELECT * FROM S.T" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not found or access denied/);
});
```

- [ ] **Step 8: Chạy test + build**

Run: `node --import tsx --test test/tools/sql-read-access.test.ts && npm run build`
Expected: 1 passing; build có thể còn báo lỗi ở `index.ts` (chưa cập nhật) — chấp nhận, sẽ sửa ở Task 12. Nếu muốn build sạch, tạm để index như cũ vẫn lỗi do `createServer` cũ; bỏ qua tới Task 12.

- [ ] **Step 9: Commit**

```bash
git add src/server.ts src/tools/ test/tools/sql-read-access.test.ts
git commit -m "feat(tools): bind source + assertAccess + list_databases lọc theo source"
```

---

## Task 12: `index.ts` — load config, binding source, vá bảo mật

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Viết lại `src/index.ts`**

```ts
#!/usr/bin/env node
import {SSEServerTransport} from "@modelcontextprotocol/sdk/server/sse.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import dotenv from "dotenv";
import {randomUUID} from "node:crypto";

import {initConfig, getConfig} from "./config/loader.js";
import {initSourceIndex, resolveSource} from "./auth/resolve-source.js";
import {shutdownAll} from "./net/tunnel-manager.js";
import {createServer} from "./server.js";
import {Source} from "./config/schema.js";

dotenv.config({override: true});

const CONFIG_PATH = process.env.CONFIG_PATH || "./config.yaml";
initConfig(CONFIG_PATH);
initSourceIndex();

// Đóng tunnel khi tắt
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => { await shutdownAll(); process.exit(0); });
}

const isStdio = process.argv.includes("--stdio");

function resolveStdioSource(): Source {
  const flagIdx = process.argv.indexOf("--source");
  const wanted = flagIdx >= 0 ? process.argv[flagIdx + 1] : process.env.MCP_SOURCE;
  const sources = getConfig().sources;
  if (wanted) {
    const s = sources[wanted];
    if (!s) throw new Error(`Unknown --source '${wanted}'`);
    return s;
  }
  const names = Object.keys(sources);
  if (names.length === 1) return sources[names[0]];
  throw new Error(`Multiple sources configured; specify --source <name> or MCP_SOURCE`);
}

if (isStdio) {
  const source = resolveStdioSource();
  const server = createServer(source);
  const transport = new StdioServerTransport();
  server.connect(transport)
    .then(() => console.error(`🚀 MCP DB Tools (stdio) as source '${source.name}'`))
    .catch(console.error);
} else {
  const app = express();
  app.use(express.json());

  // Logger: chỉ method + path, KHÔNG log query (tránh lộ key/sessionId)
  app.use((req, res, next) => {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({status: "UP", timestamp: new Date().toISOString()});
  });

  // Auth: chỉ nhận x-api-key qua HEADER; gắn source vào req
  app.use((req, res, next) => {
    const apiKey = req.headers["x-api-key"];
    const source = resolveSource(typeof apiKey === "string" ? apiKey : undefined);
    if (!source) {
      res.status(401).json({error: "Unauthorized: invalid or missing API key"});
      return;
    }
    (req as any).source = source;
    next();
  });

  const streamableTransports: Record<string, StreamableHTTPServerTransport> = {};

  const streamableHandler = async (req: express.Request, res: express.Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && streamableTransports[sessionId]) {
        await streamableTransports[sessionId].handleRequest(req, res, req.body);
        return;
      }
      if (sessionId && !streamableTransports[sessionId]) {
        res.status(404).json({jsonrpc: "2.0", error: {code: -32000, message: "Session not found"}, id: null});
        return;
      }
      if (req.method !== "POST") {
        res.status(400).json({jsonrpc: "2.0", error: {code: -32000, message: "Bad Request: No session ID for non-POST"}, id: null});
        return;
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => { streamableTransports[sid] = transport; console.error(`[streamable-http] New session: ${sid}`); },
      });
      transport.onclose = () => { const sid = transport.sessionId; if (sid) delete streamableTransports[sid]; };

      const source = (req as any).source as Source;
      const server = createServer(source);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[streamable-http] Error:", e);
      if (!res.headersSent) {
        res.status(500).json({jsonrpc: "2.0", error: {code: -32603, message: "Internal server error"}, id: null});
      }
    }
  };

  app.all("/mcp", streamableHandler);
  app.post("/", streamableHandler);
  app.get("/", streamableHandler);
  app.delete("/", streamableHandler);

  const sseTransports: Record<string, SSEServerTransport> = {};
  app.get("/sse", async (req, res) => {
    try {
      const transport = new SSEServerTransport("/messages", res);
      sseTransports[transport.sessionId] = transport;
      transport.onclose = () => { delete sseTransports[transport.sessionId]; };
      const source = (req as any).source as Source;
      const server = createServer(source);
      await server.connect(transport);
    } catch (e) {
      console.error("[sse] Error:", e);
      if (!res.headersSent) res.status(500).send("Error establishing SSE stream");
    }
  });

  const sseMessageHandler = async (req: express.Request, res: express.Response) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) { res.status(400).send("Missing sessionId parameter"); return; }
    const transport = sseTransports[sessionId];
    if (!transport) { res.status(404).send("Session not found"); return; }
    try { await transport.handlePostMessage(req, res); }
    catch (e) { console.error("[sse] post error:", e); if (!res.headersSent) res.status(500).send("Error handling post message"); }
  };
  app.post("/messages", sseMessageHandler);
  app.post("/sse", sseMessageHandler);

  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.error(`🚀 MCP DB Tools listening at http://0.0.0.0:${PORT}`);
    console.error(`   Sources configured: ${Object.keys(getConfig().sources).length}`);
  });
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build OK (không còn tham chiếu `env-scanner`/`API_KEY` cũ ở index).

- [ ] **Step 3: Tạo `config.example.yaml` để smoke test**

Create `config.example.yaml`:
```yaml
databases:
  oracle_prod:
    type: oracle
    host: 127.0.0.1
    port: 1521
    service: XEPDB1
    user: ${PROD_USER}
    password: ${PROD_PASS}
sources:
  agent_a:
    apiKey: ${KEY_A}
    access:
      oracle_prod: [read]
```

- [ ] **Step 4: Smoke test khởi động (health + 401)**

Run:
```bash
KEY_A=test PROD_USER=u PROD_PASS=p CONFIG_PATH=./config.example.yaml PORT=3999 node dist/index.js &
sleep 1
curl -s localhost:3999/health
curl -s -o /dev/null -w "%{http_code}\n" localhost:3999/mcp -X POST -d '{}' -H 'content-type: application/json'
kill %1
```
Expected: `/health` trả `{"status":"UP",...}`; POST `/mcp` không key → `401`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts config.example.yaml
git commit -m "feat(server): load config, bind source per transport, vá bảo mật (header-only key, redact log)"
```

---

## Task 13: Cleanup env-scanner + smoke toàn cục

**Files:**
- Delete: `src/config/env-scanner.ts`

- [ ] **Step 1: Tìm tham chiếu còn sót tới env-scanner**

Run: `grep -rn "env-scanner\|getDatabase\|scanDatabases" src/`
Expected: KHÔNG còn kết quả (mọi tool/driver đã chuyển sang `getDb`). Nếu còn, sửa nốt file đó sang `getDb` + `getConfig`.

- [ ] **Step 2: Xóa file**

Run: `git rm src/config/env-scanner.ts`

- [ ] **Step 3: Build + chạy toàn bộ test**

Run: `npm run build && npm test`
Expected: build OK; tất cả test PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: bỏ env-scanner (thay bằng config/loader)"
```

---

## Task 14: Docs + service file + migration

**Files:**
- Modify: `README.md`, `.env.example`, `mcp-db-tools.service`

- [ ] **Step 1: Cập nhật `.env.example`**

Viết lại thành dạng "secrets cho config.yaml":
```
# Secrets được config.yaml tham chiếu qua ${ENV}. Không đặt connection ở đây nữa.
CONFIG_PATH=./config.yaml

# Ví dụ cho config.example.yaml:
PROD_USER=system
PROD_PASS=changeme
KEY_A=replace-with-strong-random-key
# SSH_KEY_PATH=/home/user/.ssh/id_rsa
```

- [ ] **Step 2: Cập nhật `mcp-db-tools.service`**

Bỏ phụ thuộc bắt buộc vào tunnel ngoài (SSH giờ server tự quản):
```ini
[Unit]
Description=MCP DB Tools Server
After=network.target

[Service]
WorkingDirectory=/home/zane/Desktop/tools/db-remote
ExecStart=/home/zane/.nvm/versions/node/v21.7.1/bin/node dist/index.js
Environment="NODE_ENV=production"
Environment="CONFIG_PATH=/home/zane/Desktop/tools/db-remote/config.yaml"
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```
(Có thể xóa `mcp-db-tunnel.service` nếu không còn dùng tunnel ngoài; giữ lại nếu một số DB vẫn dùng tunnel ngoài.)

- [ ] **Step 3: Cập nhật `README.md`**

Thay phần "Auto-Discovery / .env convention" bằng mô tả mô hình mới: config.yaml + `${ENV}`, source/API key per-source, capability per-DB, SSH first-class. Thêm mục **Migration** từ `.env` cũ:
```
## Migration từ .env cũ
1. Mỗi `{PREFIX}_URL/USERNAME/PASSWORD` cũ → một mục trong `databases:` của config.yaml.
   - Oracle: tách host/port/service từ URL (vd jdbc:oracle:thin:@host:1521/SVC).
   - Mongo: tách host/port/database từ mongodb URL.
2. Khai báo `sources:` với API key riêng + access per-DB.
3. Đưa secrets vào .env và tham chiếu ${ENV} trong config.yaml.
4. DB cần SSH: thêm khối `ssh:` thay vì tunnel systemd.
```
Thêm khuyến nghị bảo mật: **dùng DB account least-privilege**; chỉ cấp `script` khi thật cần.

- [ ] **Step 4: Build cuối + test**

Run: `npm run build && npm test`
Expected: build OK, tất cả test PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example mcp-db-tools.service
git commit -m "docs: mô hình multi-source + config.yaml + migration từ .env"
```

---

## Self-Review (đã thực hiện khi viết plan)

**Spec coverage:**
- §2 config schema → Task 2; §3 config.yaml + ${ENV} → Task 3-4; §4 file layout → toàn bộ; §5 capability→tool → Task 6, 11; §6 tunnel ssh2 → Task 8, 10; §7 source binding → Task 12; §8 vá bảo mật → Task 7 (shadow), 9 (mongo $where), 12 (header-only key, redact log, bỏ debug log); §10 test+migration → các test trong từng task + Task 14.
- Audit log & hot-reload: non-goal, không có task — đúng spec.

**Placeholder scan:** không có "TBD/TODO"; mọi step có code/lệnh cụ thể.

**Type consistency:** `Source`, `DbConfig`, `AppConfig`, `Capability` định nghĩa ở Task 2 và dùng nhất quán; `ensure(db, connector?)`, `assertAccess(source, db, cap)`, `getDb(name)`, `buildShadowQuery(sql, parsed)`, `assertSafeFilter(obj)`, `createServer(source)` khớp giữa các task.
