import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GitHubClient, GitHubApiError, githubUrl } from "../src/github/client.js";
import { createGitHubMcpServer } from "../src/github/tools.js";
import { installGitHubRoutes } from "../src/github/routes.js";
import { HostedOAuthProvider } from "../src/hosted/oauth-provider.js";
import { securityHeaders } from "../src/hosted/security-policy.js";

for (const path of ["https://example.org", "//example.org/x", "/\\example.org", "/user#fragment", "/user\r\nX-Foo: bad"]) assert.throws(() => githubUrl(path));
assert.equal(githubUrl("/user/repos", { page: 2 }).href, "https://api.github.com/user/repos?page=2");
const credential = "fixture-token-do-not-use";
let requests: { url: string; method: string; body: any }[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  assert.equal(new URL(String(input)).origin, "https://api.github.com");
  assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${credential}`);
  assert.equal(init?.redirect, "error");
  requests.push({ url: String(input), method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : undefined });
  return new Response(JSON.stringify({ id: 1, login: "fixture-user", reflected: credential }), { status: 200, headers: { "x-oauth-scopes": "repo, workflow" } });
};
async function connect(scopes: string[]) {
  const server = createGitHubMcpServer(async () => ({ token: credential, login: "fixture-user", scopes: ["repo"] }), new Set(scopes));
  const client = new Client({ name: "github-validation", version: "0.0.1" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  return { client, server };
}
try {
  const read = await connect(["github:read"]);
  assert.ok(!(await read.client.callTool({ name: "github_connection_status", arguments: {} })).isError);
  assert.equal((await read.client.callTool({ name: "github_create_repository", arguments: { name: "not-created" } })).isError, true);
  assert.equal((await read.client.callTool({ name: "github_graphql", arguments: { query: "mutation { fixture }" } })).isError, true);
  assert.equal(requests.length, 1);
  await read.client.close(); await read.server.close();
  const write = await connect(["github:read", "github:write"]);
  const tools = (await write.client.listTools()).tools;
  assert.equal(tools.length, 7);
  assert.equal(tools.find(t => t.name === "github_api_write")?.annotations?.destructiveHint, true);
  const created = await write.client.callTool({ name: "github_create_repository", arguments: { name: "fixture-repo" } });
  assert.ok(!created.isError); assert.ok(!JSON.stringify(created).includes(credential));
  assert.equal(requests.at(-1)?.url, "https://api.github.com/user/repos");
  assert.equal(requests.at(-1)?.body.private, true);
  await write.client.callTool({ name: "github_update_repository", arguments: { owner: "fixture-user", repo: "fixture-repo", changes: { private: false } } });
  assert.equal(requests.at(-1)?.method, "PATCH");
  assert.equal(requests.at(-1)?.body.private, false);
  await write.client.callTool({ name: "github_put_file", arguments: { owner: "fixture-user", repo: "fixture-repo", path: "README.md", content: "hello", message: "Add README" } });
  assert.equal(requests.at(-1)?.body.content, Buffer.from("hello").toString("base64"));
  await write.client.callTool({ name: "github_api_write", arguments: { method: "POST", path: "/repos/fixture-user/fixture-repo/actions/runners/registration-token" } });
  assert.match(requests.at(-1)!.url, /actions\/runners\/registration-token$/);
  await write.client.close(); await write.server.close();
  const failing = new GitHubClient(credential, async () => new Response(JSON.stringify({ message: "Forbidden" }), { status: 403, headers: { "retry-after": "60" } }));
  await assert.rejects(failing.request("POST", "/user/repos", {}, { name: "fixture" }), e => e instanceof GitHubApiError && e.status === 403 && e.retryAfter === "60");
} finally { globalThis.fetch = originalFetch; }

// Exercise actual route discovery, authentication and cross-resource consent
// rejection without sending a live GitHub authorization or mutating GitHub.
let loaded = 0;
const fakeRepo: any = {
  registerClient: async (client: unknown) => client,
  getClient: async () => undefined,
  pool: { query: async (sql: string) => ({ rows: sql.includes("role='admin'") ? [{ id: "fixture" }] : [] }) },
  getAuthorizationTransaction: async () => ({ id: "fixture", resource: "https://connector.example/mcp", scopes: ["cpanel:write"] }),
  findToken: async () => { loaded++; return { clientId: "fixture", userId: "fixture", resource: "https://connector.example/mcp", scopes: ["cpanel:write"], expiresAt: new Date(Date.now() + 100000) }; },
};
const app = express(); app.use(express.urlencoded({ extended: false })); app.use(express.json()); app.use(securityHeaders);
await installGitHubRoutes(app, fakeRepo, new URL("https://connector.example"), async () => ({ userId: "fixture", email: "fixture@example.test", csrf: "fixture-csrf" }));
const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
const address = server.address(); assert.ok(address && typeof address === "object"); const base = `http://127.0.0.1:${address.port}`;
try {
  const meta = await (await fetch(base + "/.well-known/oauth-protected-resource/github/mcp")).json() as any;
  assert.equal(meta.resource, "https://connector.example/github/mcp");
  const auth = await (await fetch(base + "/.well-known/oauth-authorization-server/github")).json() as any;
  assert.equal(auth.authorization_endpoint, "https://connector.example/github/authorize");
  assert.equal((await fetch(base + "/github/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await fetch(base + "/github/mcp", { method: "POST", headers: { Authorization: "Bearer fixture", "content-type": "application/json" }, body: "{}" })).status, 401);
  assert.ok(loaded > 0);
  assert.equal((await fetch(base + "/github/oauth/approve?tx=fixture")).status, 400);
  assert.equal((await fetch(base + "/github/oauth/consent", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "csrf=fixture-csrf&tx=fixture&scope=github%3Awrite" })).status, 400);
  const settings = await fetch(base + "/mani_admin/github");
  assert.match(settings.headers.get("content-security-policy")!, /form-action 'self' https:\/\/github.com/);
  assert.match(await settings.text(), /GitHub is not connected yet/);
  const githubProvider = new HostedOAuthProvider(fakeRepo, new URL("https://connector.example/github/mcp"), new URL("https://connector.example"), { scopes: ["github:read"], defaults: ["github:read"], approvalPath: "/github/oauth/approve" });
  await assert.rejects(githubProvider.verifyAccessToken("fixture"), /invalid or expired/);
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }
console.log("GitHub tools, private defaults, credential redaction, scope enforcement, OAuth discovery and cross-resource isolation passed.");
