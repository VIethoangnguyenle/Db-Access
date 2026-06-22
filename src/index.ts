#!/usr/bin/env node
import {SSEServerTransport} from "@modelcontextprotocol/sdk/server/sse.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import dotenv from "dotenv";
import {randomUUID} from "node:crypto";
import {watchFile} from "node:fs";

import {initConfig, getConfig, reloadConfig} from "./config/loader.js";
import {initSourceIndex, resolveSource} from "./auth/resolve-source.js";
import {extractApiKey} from "./auth/http.js";
import {shutdownAll} from "./net/tunnel-manager.js";
import {createServer} from "./server.js";
import {Source} from "./config/schema.js";

dotenv.config({override: true});

const CONFIG_PATH = process.env.CONFIG_PATH || "./config.yaml";
initConfig(CONFIG_PATH);
initSourceIndex();

// Hot-reload: tự nạp lại khi config.yaml đổi (polling, bền với atomic-save).
// Đọc lại .env trước để bắt được secret mới (vd apiKey của source vừa thêm).
// Session HTTP mới sẽ dùng source/quyền mới; session đang mở giữ snapshot cũ.
watchFile(CONFIG_PATH, {interval: 1000}, (curr, prev) => {
  if (curr.mtimeMs === prev.mtimeMs) return;
  dotenv.config({override: true});
  const r = reloadConfig(CONFIG_PATH);
  if (r.ok) {
    initSourceIndex();
    console.error(`[config] reloaded from ${CONFIG_PATH}`);
  } else {
    console.error(`[config] reload failed (kept previous config): ${r.error}`);
  }
});

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

  // Auth: nhận key qua HEADER (x-api-key hoặc Authorization: Bearer); gắn source vào req
  app.use((req, res, next) => {
    const source = resolveSource(extractApiKey(req.headers as Record<string, unknown>));
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
