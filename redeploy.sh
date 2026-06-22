#!/bin/bash
echo "🚀 Redeploying MCP DB Tools..."

echo "📦 1. Compiling TypeScript..."
npm run build

echo "🐳 2. Rebuilding and starting Docker container..."
docker compose down
docker compose up -d --build

echo "✅ Deployment complete! Checking logs..."
sleep 2
docker logs mcp-db-tools --tail 20
