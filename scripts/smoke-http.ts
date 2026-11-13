import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "parmtech-http-smoke", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3210/mcp"));
await client.connect(transport);
const tools = await client.listTools();
assert.ok(tools.tools.some((tool) => tool.name === "cpanel_uapi_execute"));
const accounts = await client.callTool({ name: "cpanel_list_accounts", arguments: {} });
assert.equal(accounts.isError, undefined);
await client.close();
process.stdout.write("HTTP MCP smoke passed: endpoint initialized, tools discovered, and local accounts tool responded.\n");
