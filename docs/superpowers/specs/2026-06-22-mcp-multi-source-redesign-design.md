# Thiết kế lại MCP DB Remote — Multi-source + SSH first-class

- **Ngày:** 2026-06-22
- **Trạng thái:** Design (chờ review trước khi lập plan)
- **Phạm vi:** Thiết kế lại mô hình kết nối/truy cập của MCP DB server. Không thay đổi tập tool nghiệp vụ (vẫn 11 tool), mà thay lớp config + auth + access control + SSH + vá các lỗ bảo mật đã review.

## 1. Mục tiêu & bối cảnh

MCP server hiện tại discover toàn bộ DB từ một `.env` phẳng; bất kỳ client nào có API key chung đều thấy và dùng được **mọi** DB. Cần đổi sang mô hình mà:

- Một server cầu nối tới **nhiều DB**.
- **DB nào được dùng phụ thuộc vào "source"** (project/agent) đang gọi MCP — không phải ai có key cũng thấy hết.
- Giữ khả năng **kết nối qua SSH tunnel**, nhưng nâng SSH thành first-class do server quản lý.

### Quyết định đã chốt (qua brainstorming)

| Vấn đề | Lựa chọn |
|---|---|
| Credentials nằm ở đâu | **Server giữ tập trung, map theo source** (multi-tenant) |
| Định danh source | **API key riêng cho mỗi source** |
| Granularity quyền | **Per-DB capability**: `read` / `write` / `script` |
| SSH | **First-class** — server tự mở/quản lý tunnel theo config từng DB |
| Định dạng config | **Một file YAML có cấu trúc**, secret tham chiếu `${ENV}` |
| Lớp safety | **Giữ** confirmation token 2 bước + shadow preview làm guardrail; boundary chính = capability + quyền DB account; **vá** các lỗ bảo mật đã review |
| Cách mở SSH | **Thư viện `ssh2` (Node)** — quản lý tunnel trong process |

### Non-goals

- Không xây UI quản trị config.
- Không làm hot-reload config (load lúc khởi động là đủ; reload có thể thêm sau).
- Không đổi giao thức/tập tool nghiệp vụ ngoài việc lọc theo source và enforce capability.
- Không thêm audit log trong vòng này (đã cân nhắc, để dành mở rộng sau).

## 2. Tổng quan kiến trúc

```
client (x-api-key) ─► resolve-source ─► createServer(source)
                                            │ tools đóng gói theo source (closure)
   tool call (db_name, capability) ─► assertAccess(source, db, cap)
                                   ─► tunnel.ensure(db) → local endpoint
                                   ─► driver pool → execute → safety guardrails
```

- **Boundary thật:** capability per-source + quyền của DB account (least-privilege).
- **Guardrail:** confirmation token 2 bước + shadow preview (chống thao tác nhầm, không phải security boundary).

## 3. Config schema (`config.yaml`)

```yaml
databases:
  oracle_prod:
    type: oracle
    host: xx.xxx.xx.xx
    port: 1521
    service: XEPDB1            # oracle service name
    user: ${PROD_USER}
    password: ${PROD_PASS}
    ssh:                        # optional → có thì server tự tunnel
      host: xx.xxx.xx.xx
      user: ssh-user
      privateKey: ${SSH_KEY_PATH}
      # passphrase: ${SSH_PASSPHRASE}   # optional
  mongo_logs:
    type: mongo
    host: xx.xxx.xx.xx
    port: 27017
    database: logs
    user: ${MONGO_USER}
    password: ${MONGO_PASS}
    # ssh: {...}                # optional

sources:
  agent_a:
    apiKey: ${KEY_A}
    access:
      oracle_prod: [read]
      oracle_dev:  [read, write, script]
  agent_b:
    apiKey: ${KEY_B}
    access:
      mongo_logs:  [read]
```

Quy tắc:

- `${ENV}` được nội suy lúc load; toàn bộ config validate bằng zod, fail-fast nếu sai/thiếu.
- DB không xuất hiện trong `access` của source thì source đó **không thấy và không truy cập được**.
- `access` tham chiếu tên DB phải tồn tại trong `databases` (validate cross-reference).
- Capability hợp lệ: `read`, `write`, `script`. `script` chỉ có nghĩa với DB Oracle.

## 4. Thành phần & file layout

```
src/
  config/
    schema.ts          # zod schema cho AppConfig (databases, sources)
    loader.ts          # đọc yaml + nội suy ${ENV} + validate → AppConfig (thay env-scanner.ts)
  auth/
    resolve-source.ts  # apiKey → Source | undefined (Map lookup)
    access.ts          # assertAccess(source, dbName, capability) → throw nếu bị từ chối
  net/
    tunnel-manager.ts  # ssh2 tunnels: lazy, cached, health-check, reconnect, đóng sạch
  drivers/
    oracle/  pool.ts (keyed theo db, connect endpoint đã resolve) · executor.ts · parser.ts · schema.ts · plsql-executor.ts · plsql-parser.ts
    mongo/   pool.ts · executor.ts · schema.ts
  safety/
    token-manager.ts   # giữ; cân nhắc cap kích thước map
    shadow.ts          # preview dựng lại từ AST (tách khỏi parser.ts, sửa bug)
  tools/               # mỗi tool gọi assertAccess trước khi chạy
  server.ts            # createServer(source) — đăng ký tool đóng gói theo source
  index.ts             # transports + binding source + vá bảo mật
```

`config/env-scanner.ts` bị thay bằng `config/loader.ts`.

### Kiểu dữ liệu cốt lõi (định hướng)

```ts
type Capability = "read" | "write" | "script";

interface DbConfig {
  name: string;
  type: "oracle" | "mongo";
  host: string; port: number;
  service?: string;        // oracle
  database?: string;       // mongo
  user: string; password: string;
  ssh?: SshConfig;
}

interface SshConfig { host: string; port?: number; user: string; privateKey: string; passphrase?: string; }

interface Source {
  name: string;
  apiKey: string;
  access: Record<string /*dbName*/, Capability[]>;
}

interface AppConfig {
  databases: Record<string, DbConfig>;
  sources: Record<string, Source>;
}
```

## 5. Capability → tool

| Capability | Tools |
|---|---|
| `read` | `list_databases`, `sql_list_tables`, `sql_get_columns`, `sql_get_constraints`, `sql_read`, `mongo_list_collections`, `mongo_get_schema`, `mongo_read` |
| `write` | `sql_write`, `mongo_write` |
| `script` | `sql_execute_script` |

- `list_databases` chỉ trả các DB có trong `access` của source, kèm capability từng DB.
- Mọi tool gọi `assertAccess(source, db_name, <capability của tool>)` ngay sau khi resolve `db_name`, trước khi chạm driver. Bị từ chối → trả lỗi rõ ràng, không lộ sự tồn tại của DB ngoài quyền (thông điệp dạng "DB not found or access denied").

## 6. Tunnel manager (ssh2)

API: `ensure(db: DbConfig): Promise<{ host: string; port: number }>`.

- DB không có `ssh` → trả thẳng `{host, port}` của DB.
- Có `ssh` → nếu tunnel còn sống, trả local endpoint đã cache; chưa có thì mở forward trên `127.0.0.1:<port tự cấp>` qua `ssh2`, lưu cache theo tên DB.
- Keepalive + health-check; tự reconnect khi đứt (đánh dấu cache stale, mở lại ở lần `ensure` kế tiếp hoặc qua watcher).
- `shutdownAll()` đóng toàn bộ tunnel khi server dừng.
- Driver pool **luôn** connect vào endpoint do `ensure(db)` trả về (không hardcode host/port của DB).

## 7. Source binding theo transport

- **HTTP (Streamable + SSE):** đọc `x-api-key` từ **header** → `resolveSource(apiKey)`; không có/không khớp → 401. Khớp → `createServer(source)` cho session đó. Tool đóng gói (closure) source này.
- **Stdio (local):** source xác định qua `--source <name>` hoặc env `MCP_SOURCE`; nếu config chỉ có đúng 1 source thì mặc định dùng source đó. Local trust → không bắt API key.

## 8. Vá bảo mật (gộp từ review)

1. API key **chỉ nhận qua header `x-api-key`**, bỏ nhận qua query string.
2. **Redact** API key và `sessionId` khỏi request logger; bỏ dòng debug in `VBSMEONL_URL` ở `index.ts`.
3. Resolve source qua `Map<apiKey, Source>` (key entropy cao). Nếu cần chống timing, hash key trước khi so khớp.
4. **Mongo:** từ chối filter chứa `$where`, `$function`, `$accumulator`, và operation `mapReduce` (kiểm đệ quy trong `deserializeMongoQuery`/validator).
5. **Shadow preview** dựng lại từ AST (`safety/shadow.ts`); nếu không chắc (subquery, nhiều bảng, alias phức tạp) thì **báo "không tạo được preview tin cậy"** thay vì đoán mệnh đề WHERE bằng cắt chuỗi.
6. **Sanitize error** trả về client (thông điệp chung); chi tiết DB error chỉ ghi vào log server.
7. Doc khuyến nghị **DB account least-privilege**; capability `script` không cấp mặc định cho source nào trừ khi khai báo tường minh.

## 9. Luồng dữ liệu (end-to-end)

1. **Khởi động:** `loader` đọc `config.yaml`, nội suy `${ENV}`, validate (fail-fast). Chưa mở tunnel nào.
2. Client HTTP gửi `x-api-key` → `resolveSource` → `Source` hoặc 401.
3. `createServer(source)` đăng ký tool đóng gói theo source.
4. `list_databases` → chỉ các DB trong `source.access` (kèm capability).
5. Tool nghiệp vụ (vd `sql_write(db_name)`) → `assertAccess(source, db, "write")` → `tunnel.ensure(db)` → driver pool connect endpoint trả về → safety guardrails (token + preview) → execute.
6. **Shutdown:** `tunnel.shutdownAll()` + drain pool.

## 10. Test & migration

**Unit test (ưu tiên vùng nhiều bug/critical):**
- `config/loader.ts`: nội suy `${ENV}`, thiếu biến, cross-reference DB không tồn tại, capability sai.
- `auth/access.ts`: cho phép/từ chối đúng theo (source, db, capability); DB ngoài quyền bị che.
- `net/tunnel-manager.ts`: mock `ssh2` — mở/cache/reconnect/shutdown.
- `safety/shadow.ts`: dựng preview đúng cho UPDATE/DELETE có WHERE; từ chối đúng khi không chắc.
- Enforcement capability ở từng tool (read-only source không gọi được write/script).

**Migration:**
- Script/doc convert `.env` cũ (`{PREFIX}_URL/USERNAME/PASSWORD`) → `config.yaml`. Secrets vẫn để ở `.env` và tham chiếu `${ENV}`.
- Cập nhật `mcp-db-tools.service`: bỏ phụ thuộc `mcp-db-tunnel.service` (SSH giờ do server quản lý). Giữ tunnel ngoài nếu muốn nhưng không còn bắt buộc.

## 11. Rủi ro & lưu ý

- **ssh2 lifecycle:** cần xử lý reconnect/cleanup cẩn thận để tránh tunnel mồ côi hoặc rò connection. Có test mock + shutdown hook.
- **Parser Oracle dùng dialect mysql** vẫn là điểm yếu nền tảng — design này coi capability + quyền DB là boundary, parser chỉ là gợi ý. Có thể cải thiện dialect ở vòng sau.
- **`sql_execute_script`** vẫn nguy hiểm về bản chất (PL/SQL tùy ý); được kiểm soát bằng capability `script` (mặc định không cấp) + khuyến nghị account hạn chế quyền.
- **Stdio multi-source:** nếu có nhiều source mà không chỉ định `--source`/`MCP_SOURCE` → fail rõ ràng thay vì đoán.
