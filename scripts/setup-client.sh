#!/usr/bin/env bash
#
# setup-client.sh — Đăng ký MCP "db-access" (HTTP) vào Antigravity / Claude Code / Codex.
#
# Cách dùng:
#   scripts/setup-client.sh --url http://<host>:3000/mcp --key <apiKey> \
#       [--name db-access] [--tools antigravity,claude,codex] [--key-env DB_ACCESS_API_KEY]
#
# Auth: server chấp nhận key qua header `x-api-key` HOẶC `Authorization: Bearer`.
#   - Antigravity / Claude Code: dùng x-api-key.
#   - Codex: HTTP MCP chỉ set được bearer-token-env-var → dùng Bearer (đọc từ env var).
#
set -euo pipefail

NAME="db-access"
URL=""
KEY=""
KEY_ENV="DB_ACCESS_API_KEY"
TOOLS="antigravity,claude,codex"

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --tools) TOOLS="${2:-}"; shift 2 ;;
    --key-env) KEY_ENV="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "✗ Tham số không nhận diện: $1"; usage; exit 1 ;;
  esac
done

[[ -n "$URL" && -n "$KEY" ]] || { echo "✗ Cần --url và --key"; usage; exit 1; }

has_tool() { [[ ",$TOOLS," == *",$1,"* ]]; }

# ── Claude Code ───────────────────────────────────────────────────────────────
if has_tool claude; then
  if command -v claude >/dev/null 2>&1; then
    claude mcp remove "$NAME" >/dev/null 2>&1 || true
    claude mcp add --scope user --transport http "$NAME" "$URL" --header "x-api-key: $KEY"
    echo "✓ Claude Code: đã thêm '$NAME' (x-api-key)"
  else
    echo "… bỏ qua Claude Code (không có lệnh 'claude')"
  fi
fi

# ── Antigravity (merge JSON) ──────────────────────────────────────────────────
if has_tool antigravity; then
  CFG="${ANTIGRAVITY_MCP_CONFIG:-$HOME/.gemini/antigravity/mcp_config.json}"
  mkdir -p "$(dirname "$CFG")"
  [[ -f "$CFG" ]] || echo '{}' > "$CFG"
  NAME="$NAME" URL="$URL" KEY="$KEY" CFG="$CFG" node -e '
    const fs = require("fs");
    const p = process.env.CFG;
    let j = {};
    try { j = JSON.parse(fs.readFileSync(p, "utf8") || "{}"); } catch { j = {}; }
    j.mcpServers = j.mcpServers || {};
    j.mcpServers[process.env.NAME] = {
      serverUrl: process.env.URL,
      headers: { "x-api-key": process.env.KEY },
    };
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  '
  echo "✓ Antigravity: đã cập nhật $CFG (serverUrl + x-api-key)"
  echo "  ⚠ Xác minh bản Antigravity của bạn hỗ trợ remote MCP (serverUrl); nếu không, dùng stdio/sse-proxy."
fi

# ── Codex (HTTP MCP qua bearer token env var) ─────────────────────────────────
if has_tool codex; then
  if command -v codex >/dev/null 2>&1; then
    codex mcp remove "$NAME" >/dev/null 2>&1 || true
    codex mcp add "$NAME" --url "$URL" --bearer-token-env-var "$KEY_ENV"
    echo "✓ Codex: đã thêm '$NAME' (Authorization: Bearer, đọc từ \$$KEY_ENV)"
    echo "  → Đặt biến môi trường để Codex có token, ví dụ thêm vào ~/.bashrc / ~/.zshrc:"
    echo "      export $KEY_ENV='$KEY'"
  else
    echo "… bỏ qua Codex (không có lệnh 'codex')"
  fi
fi

echo "Hoàn tất."
