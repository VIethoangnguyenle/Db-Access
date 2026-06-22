#!/usr/bin/env node
import {SSEClientTransport} from "@modelcontextprotocol/sdk/client/sse.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";

async function main() {
    let urlStr = process.argv[2];

    // Parse simple CLI arguments if provided
    let host = 'localhost';
    let port = '3000';
    let apiKey = '';

    for (let i = 2; i < process.argv.length; i++) {
        if (process.argv[i] === '--host' && process.argv[i + 1]) host = process.argv[++i];
        else if (process.argv[i] === '--port' && process.argv[i + 1]) port = process.argv[++i];
        else if (process.argv[i] === '--api-key' && process.argv[i + 1]) apiKey = process.argv[++i];
    }

    // If the first argument isn't a URL and we have some args, build the URL
    if (urlStr && !urlStr.startsWith('http') && !urlStr.startsWith('--')) {
        console.error("Usage: mcp-sse-proxy <sse-url> OR mcp-sse-proxy --host <ip> --port <port> --api-key <key>");
        process.exit(1);
    }

    if (!urlStr || urlStr.startsWith('--')) {
        urlStr = `http://${host}:${port}/sse`;
    }

    if (!urlStr) {
        console.error("Usage: mcp-sse-proxy <sse-url> OR mcp-sse-proxy --host <ip> --port <port> --api-key <key>");
        process.exit(1);
    }

    // The server authenticates via the `x-api-key` HEADER (query-string auth was removed).
    // Pass it on both the SSE stream (GET) and the message channel (POST).
    const transportOpts = {};
    if (apiKey) {
        const headers = {"x-api-key": apiKey};
        transportOpts.requestInit = {headers};
        transportOpts.eventSourceInit = {
            fetch: (url, init) => fetch(url, {...init, headers: {...init?.headers, ...headers}}),
        };
    }

    const clientTransport = new SSEClientTransport(new URL(urlStr), transportOpts);
    const serverTransport = new StdioServerTransport();

    // Assign handlers before starting
    clientTransport.onmessage = (msg) => {
        serverTransport.send(msg).catch(err => console.error("Error sending to stdio", err));
    };

    serverTransport.onmessage = (msg) => {
        clientTransport.send(msg).catch(err => console.error("Error sending to sse", err));
    };

    clientTransport.onerror = (err) => console.error("SSE Client Error", err);
    serverTransport.onerror = (err) => console.error("Stdio Server Error", err);

    clientTransport.onclose = () => process.exit(0);
    serverTransport.onclose = () => process.exit(0);

    // StdioServerTransport does not have start() method? Let's check. Wait, it might.
    try {
        await serverTransport.start();
        await clientTransport.start();
    } catch (e) {
        console.error("Failed to start SSE Client Transport", e);
        process.exit(1);
    }
}

main().catch(err => {
    console.error("Fatal error", err);
    process.exit(1);
});
