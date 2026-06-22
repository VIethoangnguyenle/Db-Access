import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSqlRead } from "../../src/tools/sql-read.js";
import { Source } from "../../src/config/schema.js";

// Capture the tool handler by stubbing server.tool
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
