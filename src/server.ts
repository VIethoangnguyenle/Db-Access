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
import {registerPgListTables} from "./tools/pg-list-tables.js";
import {registerPgGetColumns} from "./tools/pg-get-columns.js";
import {registerPgGetConstraints} from "./tools/pg-get-constraints.js";
import {registerPgRead} from "./tools/pg-read.js";
import {registerPgWrite} from "./tools/pg-write.js";
import {registerPgExecuteScript} from "./tools/pg-execute-script.js";

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
  registerPgListTables(server, source);
  registerPgGetColumns(server, source);
  registerPgGetConstraints(server, source);
  registerPgRead(server, source);
  registerPgWrite(server, source);
  registerPgExecuteScript(server, source);
  return server;
}
