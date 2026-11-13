import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { normalizeCpanelHost } from "../src/host.js";
import { MemoryAccountStore } from "../src/store.js";
import { createCpanelMcpServer } from "../src/tools.js";
import { UapiClient, type FetchLike } from "../src/uapi.js";

const mockToken = "mock-token-never-use-in-production";
const requests: Array<{ url: string; authorization: string | null }> = [];
const mockFetch: FetchLike = async (input, init) => {
  const url = String(input);
  const authorization = new Headers(init?.headers).get("Authorization");
  requests.push({ url, authorization });
  const endpoint = new URL(url);
  const payload = endpoint.pathname.endsWith("/DomainInfo/list_domains")
    ? { apiversion: 3, module: "DomainInfo", func: "list_domains", result: { status: 1, data: { main_domain: "example.test", addon_domains: [], sub_domains: [] }, errors: null } }
    : endpoint.pathname.endsWith("/Email/add_pop")
      ? { apiversion: 3, module: "Email", func: "add_pop", result: { status: 1, data: { email: endpoint.searchParams.get("email"), password: "should-not-be-returned" }, errors: null } }
      : { apiversion: 3, module: "Tokens", func: "revoke", result: { status: 1, data: { revoked: true }, errors: null } };
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
};

assert.equal(normalizeCpanelHost("cpanel.example.test"), "https://cpanel.example.test:2083");
assert.equal(normalizeCpanelHost("https://192.0.2.7:2083"), "https://192.0.2.7:2083");
assert.throws(() => normalizeCpanelHost("http://cpanel.example.test"));
assert.throws(() => normalizeCpanelHost("https://user:pass@cpanel.example.test"));
assert.throws(() => normalizeCpanelHost("https://cpanel.example.test/some/path"));

const store = new MemoryAccountStore();
const account = await store.add({
  label: "Mock cPanel",
  host: "https://cpanel.example.test:2083",
  username: "exampleuser",
  apiToken: mockToken,
  tokenName: "PARMTECH Connector Test",
});
const mcpServer = createCpanelMcpServer(store, new UapiClient(mockFetch));
const mcpClient = new Client({ name: "mock-validation", version: "0.0.1" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await mcpServer.connect(serverTransport);
await mcpClient.connect(clientTransport);

const toolList = await mcpClient.listTools();
const toolNames = toolList.tools.map((tool) => tool.name);
for (const required of ["cpanel_list_accounts", "cpanel_list_domains", "cpanel_list_email_accounts", "cpanel_list_files", "cpanel_create_email_account", "cpanel_delete_email_account", "cpanel_uapi_execute", "cpanel_disconnect_account"]) {
  assert.ok(toolNames.includes(required), `Missing MCP tool: ${required}`);
}

const listed = await mcpClient.callTool({ name: "cpanel_list_domains", arguments: { accountId: account.id } });
assert.equal(listed.isError, undefined);
assert.match(JSON.stringify(listed), /example\.test/);

const created = await mcpClient.callTool({
  name: "cpanel_uapi_execute",
  arguments: {
    accountId: account.id,
    module: "Email",
    function: "add_pop",
    parameters: { email: "helpdesk", domain: "example.test", password: "temporary-test-value" },
  },
});
assert.equal(created.isError, undefined);
assert.doesNotMatch(JSON.stringify(created), /should-not-be-returned|temporary-test-value|mock-token-never-use-in-production/);
assert.ok(requests.some((request) => request.url.includes("/execute/Email/add_pop") && request.url.includes("password=temporary-test-value")));
assert.ok(requests.every((request) => request.authorization === `cpanel exampleuser:${mockToken}`));

await mcpClient.close();
await mcpServer.close();
process.stdout.write("Mock validation passed: tool registration, UAPI auth, host validation, and secret redaction. No cPanel account was contacted.\n");
