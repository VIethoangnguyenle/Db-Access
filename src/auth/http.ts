/**
 * Trích API key từ HTTP headers. Hỗ trợ:
 *   - `x-api-key: <key>`                  (Antigravity, Claude Code, curl)
 *   - `Authorization: Bearer <key>`       (Codex HTTP MCP — bearer-token-env-var)
 * `x-api-key` được ưu tiên nếu cả hai cùng có.
 */
export function extractApiKey(headers: Record<string, unknown>): string | undefined {
  const x = headers["x-api-key"];
  if (typeof x === "string" && x.length > 0) return x;

  const auth = headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
  return undefined;
}
