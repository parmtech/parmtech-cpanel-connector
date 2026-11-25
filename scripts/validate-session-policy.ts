import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import express, { type Response } from "express";
import { rateLimit } from "express-rate-limit";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { HostedOAuthProvider } from "../src/hosted/oauth-provider.js";
import type { HostedRepository } from "../src/hosted/repository.js";
import { insufficientScopeChallenge, mcpRateLimitKey } from "../src/hosted/security-policy.js";
import { CONNECTOR_VERSION } from "../src/version.js";

// Validate actual HTTP headers/rate limiting and the provider's consent rules.
// Database token rotation is exercised separately against a disposable schema.
const origin = "https://connector.example";
const resource = new URL("/mcp", origin);
const client = { client_id: "fixture-client" } as OAuthClientInformationFull;
let saved: { scopes: string[] } | undefined;
const repository = {
  async saveAuthorizationTransaction(value: { scopes: string[] }) { saved = value; },
} as unknown as HostedRepository;
const params = {
  resource, scopes: ["cpanel:read"], redirectUri: "https://client.example/callback",
  codeChallenge: "fixture-challenge",
} as AuthorizationParams;
const response = { redirect() {} } as unknown as Response;
const provider = new HostedOAuthProvider(repository, resource, new URL(origin));
await provider.authorize(client, params, response);
assert.deepEqual(saved?.scopes, ["cpanel:read", "offline_access"]);
assert.ok(!saved?.scopes.includes("cpanel:write"), "consent must not gain tool-write scopes");
await assert.rejects(provider.authorize(client, { ...params, scopes: ["unsupported:scope"] }, response));
await assert.rejects(provider.authorize(client, { ...params, resource: new URL("https://other.example/mcp") }, response));
const shortLived = new HostedOAuthProvider(repository, resource, new URL(origin), {
  scopes: ["cpanel:read"], defaults: ["cpanel:read"], approvalPath: "/oauth/approve",
});
await shortLived.authorize(client, params, response);
assert.deepEqual(saved?.scopes, ["cpanel:read"], "a policy without offline access cannot request it");

const app = express();
app.set("trust proxy", 1);
app.get("/challenge", (req, res) => {
  res.setHeader("WWW-Authenticate", insufficientScopeChallenge(origin, String(req.query.scope ?? "")));
  res.status(403).end();
});
app.use("/limited", (req, _res, next) => {
  const userId = req.get("x-fixture-user");
  if (userId) req.auth = { token: "fixture", clientId: "fixture", scopes: [], extra: { userId } };
  next();
}, rateLimit({ windowMs: 60_000, limit: 1, legacyHeaders: false, keyGenerator: mcpRateLimitKey }));
app.get("/limited", (_req, res) => res.sendStatus(204));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
async function limited(ip: string, user?: string): Promise<number> {
  const response = await fetch(base + "/limited", { headers: { "x-forwarded-for": ip, ...(user ? { "x-fixture-user": user } : {}) } });
  await response.text(); return response.status;
}
try {
  const challenge = await fetch(base + "/challenge?scope=cpanel%3Awrite");
  assert.equal(challenge.status, 403);
  assert.match(challenge.headers.get("www-authenticate")!, /scope="cpanel:write"/);
  assert.match(challenge.headers.get("www-authenticate")!, /error="insufficient_scope"/);
  const injection = await fetch(base + "/challenge?scope=" + encodeURIComponent('cpanel:write"\r\nX-Injected: yes'));
  assert.equal(injection.headers.get("x-injected"), null);
  assert.ok(!injection.headers.get("www-authenticate")!.includes('scope="'));
  assert.equal(await limited("2001:db8:1111:2200::1"), 204);
  assert.equal(await limited("2001:db8:1111:2200::2"), 429, "rotating IPv6 host addresses must not bypass the limit");
  assert.equal(await limited("192.0.2.1", "user-a"), 204);
  assert.equal(await limited("192.0.2.2", "user-a"), 429, "one authenticated identity must keep its limit across IP changes");
  assert.equal(await limited("192.0.2.1", "user-b"), 204, "distinct authenticated users must not share a limit");
  for (const file of ["package.json", "plugin.json", "package-lock.json"]) {
    const value = JSON.parse(await readFile(new URL("../" + file, import.meta.url), "utf8"));
    assert.equal(value.version, CONNECTOR_VERSION, `${file} and the MCP version must agree`);
  }
  console.log("Session policy checks passed: consent boundaries, wrong-resource rejection, usable scope challenges, header-injection rejection, IPv6 aggregation, identity limits and consistent release metadata.");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
