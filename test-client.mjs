import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {SSEClientTransport} from "@modelcontextprotocol/sdk/client/sse.js";

async function main() {
    const transport = new SSEClientTransport(
            new URL("http://xx.xxx.xx.xx:3000/sse"),
            {
                eventSourceInit: {
                    headers: {
                        "x-api-key": "sme-omni-super-secret-key-2026"
                    }
                },
                requestInit: {
                    headers: {
                        "x-api-key": "sme-omni-super-secret-key-2026"
                    }
                }
            }
    );

    const client = new Client(
            {name: "test-client", version: "1.0.0"},
            {capabilities: {}}
    );

    try {
        await client.connect(transport);

        const dbsResponse = await client.callTool({
            name: "list_databases",
            arguments: {}
        });

        const dbs = JSON.parse(dbsResponse.content[0].text);
        if (!dbs.databases || dbs.databases.length === 0) {
            console.error("No databases available");
            process.exit(1);
        }

        const dbName = dbs.databases.find(db => db.type === "oracle")?.name || dbs.databases[0].name;

        console.log(`Using database: ${dbName}`);

        const sqlResponse = await client.callTool({
            name: "run_sql",
            arguments: {
                db_name: dbName,
                sql: "SELECT * FROM OMNI_CUSTOMER WHERE user_alias = 'hoangnlv01'"
            }
        });

        console.log("\n--- Query Results ---");
        console.log(sqlResponse.content[0].text);
    } catch (e) {
        console.error("Error:", e);
    } finally {
        process.exit(0);
    }
}

main().catch(console.error);
